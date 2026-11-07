import json
from types import SimpleNamespace

import httpx
import pytest
from pydantic import BaseModel

from extract import ollama_transport as transport
from extract.local_pipeline import UsageAccumulator, _call_ollama_structured

REAL_CLIENT = httpx.Client
PRIMARY = "http://primary.test:11434"
BACKUP = "https://backup.example.run.app"
PAYLOAD = {
    "model": "gemma4:e4b",
    "messages": [{"role": "user", "content": "A synthetic invoice"}],
    "keep_alive": "60m",
    "options": {"num_ctx": 8192},
}


class Clock:
    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


@pytest.fixture(autouse=True)
def isolated_transport(monkeypatch):
    for name in (
        "OLLAMA_FALLBACK_BASE_URL",
        "OLLAMA_FALLBACK_MODEL",
        "OLLAMA_FALLBACK_CHALLENGER_MODEL",
        "OLLAMA_CHALLENGER_MODEL",
        "OPENAI_MODEL",
        "OLLAMA_REQUEST_TIMEOUT_SECONDS",
        "OLLAMA_STARTUP_TIMEOUT_SECONDS",
        "GOOGLE_SERVICE_ACCOUNT_JSON",
    ):
        monkeypatch.delenv(name, raising=False)
    transport._unavailable_until.clear()
    transport._credentials.clear()


@pytest.fixture
def clock(monkeypatch):
    clock = Clock()
    monkeypatch.setattr(transport, "time", clock)
    return clock


@pytest.fixture
def authenticated(monkeypatch):
    def headers(url, timeout_seconds=15):
        return {"Authorization": "Bearer test-id-token"} if url == BACKUP else {}

    monkeypatch.setattr(transport, "cloud_run_headers", headers)


def factory(handler):
    return lambda **kwargs: REAL_CLIENT(transport=httpx.MockTransport(handler), **kwargs)


def result():
    return httpx.Response(
        200, json={"model": "gemma4:e4b", "message": {"content": '{"ready":true}'}}
    )


def test_healthy_primary_does_not_contact_backup(monkeypatch):
    monkeypatch.setenv("OLLAMA_FALLBACK_BASE_URL", BACKUP)
    calls = []

    def handler(request):
        calls.append(request)
        return result()

    transport.request_ollama(PRIMARY, PAYLOAD, client_factory=factory(handler))
    assert len(calls) == 1
    assert str(calls[0].url) == PRIMARY + "/api/chat"
    assert "authorization" not in calls[0].headers
    assert calls[0].extensions["timeout"]["connect"] == 3


def test_model_calls_share_the_invoice_deadline(monkeypatch, clock):
    from read import budget

    monkeypatch.setattr(budget, "time", clock)
    calls = []

    def handler(request):
        calls.append(request)
        return result()

    with budget.invoice_budget(5):
        transport.request_ollama(PRIMARY, PAYLOAD, client_factory=factory(handler))
        assert calls[0].extensions["timeout"]["read"] == 5
        clock.now = 6
        with pytest.raises(budget.ProcessingTimeout):
            transport.request_ollama(PRIMARY, PAYLOAD, client_factory=factory(handler))
    assert len(calls) == 1


def test_primary_outage_allows_three_minute_startup_then_full_inference_budget(
    monkeypatch, clock, authenticated
):
    monkeypatch.setenv("OLLAMA_FALLBACK_BASE_URL", BACKUP)
    calls = []

    def handler(request):
        calls.append(request)
        if request.url.host == "primary.test":
            clock.now += 3
            raise httpx.ConnectTimeout("primary offline", request=request)
        assert request.headers["authorization"] == "Bearer test-id-token"
        if request.url.path == "/api/generate":
            preload = json.loads(request.content)
            assert "messages" not in preload
            assert preload["options"]["num_ctx"] == 8192
            assert request.extensions["timeout"]["read"] == 600
            clock.now += 180
            return httpx.Response(200, json={"done": True, "done_reason": "load"})
        assert request.extensions["timeout"]["read"] == 120
        return result()

    data = transport.request_ollama(PRIMARY, PAYLOAD, client_factory=factory(handler))
    assert data["message"]["content"] == '{"ready":true}'
    assert clock.now == 183
    assert [request.url.path for request in calls] == ["/api/chat", "/api/generate", "/api/chat"]


def test_platform_timeout_and_model_download_are_retried_before_invoice_generation(
    clock, authenticated
):
    responses = [
        httpx.Response(503),
        httpx.Response(404, json={"error": "model 'gemma4:e4b' not found"}),
        httpx.Response(504),
        httpx.Response(200, json={"done": True}),
    ]
    paths = []

    def handler(request):
        paths.append(request.url.path)
        if request.url.path == "/api/generate":
            return responses.pop(0)
        return result()

    transport.request_ollama(BACKUP, PAYLOAD, client_factory=factory(handler))
    assert paths == ["/api/generate"] * 4 + ["/api/chat"]
    assert clock.sleeps == [3, 3, 3]


def test_startup_deadline_is_shared_across_retries(monkeypatch, clock, authenticated):
    monkeypatch.setenv("OLLAMA_STARTUP_TIMEOUT_SECONDS", "7")
    timeouts = []

    def handler(request):
        assert request.url.path == "/api/generate"
        timeouts.append(request.extensions["timeout"]["read"])
        return httpx.Response(503)

    with pytest.raises(ValueError, match="not ready after 7 seconds"):
        transport.request_ollama(BACKUP, PAYLOAD, client_factory=factory(handler))
    assert timeouts == [7, 4, 1]
    assert clock.now == 7


def test_interactive_deadline_limits_startup_and_remaining_inference(clock, authenticated):
    def handler(request):
        if request.url.path == "/api/generate":
            assert request.extensions["timeout"]["read"] == 45
            clock.now += 40
            return httpx.Response(200, json={"done": True})
        assert request.extensions["timeout"]["read"] == 5
        return result()

    response = transport.request_ollama(
        BACKUP, PAYLOAD, deadline=45, client_factory=factory(handler)
    )
    assert response["message"]["content"] == '{"ready":true}'


def test_interactive_deadline_can_expire_during_startup(clock, authenticated):
    def handler(request):
        assert request.url.path == "/api/generate"
        clock.now += 45
        raise httpx.ReadTimeout("cold model", request=request)

    with pytest.raises(ValueError, match="not ready after 45 seconds"):
        transport.request_ollama(BACKUP, PAYLOAD, deadline=45, client_factory=factory(handler))
    assert clock.sleeps == []


def test_master_preview_shares_short_deadline_and_returns_manual_mapping(monkeypatch, clock):
    from api import master_mapping
    from api.master_import import preview

    monkeypatch.setenv("OLLAMA_BASE_URL", BACKUP)
    monkeypatch.setenv("OPENAI_MODEL", "gemma4:e4b")
    monkeypatch.setattr(master_mapping, "time", clock)
    deadlines = []

    def still_loading(**kwargs):
        deadlines.append(kwargs["deadline"])
        clock.now += min(30, max(0, kwargs["deadline"] - clock.now))
        raise ValueError("Model is still loading")

    monkeypatch.setattr("extract.local_pipeline._call_ollama_structured", still_loading)
    response = preview({"Prices": [["Name", "Price"], ["Bolt", "2.00"]]})
    assert deadlines == [45, 45]
    assert clock.now == 45
    assert response["sheets"][0]["mappingSource"] == "manual"
    assert response["sheets"][0]["rows"][1] == ["Bolt", "2.00"]


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
def test_permanent_startup_errors_fail_without_retry(status, clock, authenticated):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(status, json={"error": "invalid route or denied"})

    with pytest.raises(httpx.HTTPStatusError):
        transport.request_ollama(BACKUP, PAYLOAD, client_factory=factory(handler))
    assert len(calls) == 1
    assert clock.sleeps == []


def test_backup_inference_is_not_repeated_on_timeout(clock, authenticated):
    paths = []

    def handler(request):
        paths.append(request.url.path)
        if request.url.path == "/api/generate":
            return httpx.Response(200, json={"done": True})
        raise httpx.ReadTimeout("inference timed out", request=request)

    with pytest.raises(httpx.ReadTimeout):
        transport.request_ollama(BACKUP, PAYLOAD, client_factory=factory(handler))
    assert paths == ["/api/generate", "/api/chat"]


@pytest.mark.parametrize("explicit_challenger", [False, True])
def test_backup_does_not_replace_qwen_challenger_with_gemma(
    monkeypatch, authenticated, explicit_challenger
):
    monkeypatch.setenv("OLLAMA_FALLBACK_BASE_URL", BACKUP)
    monkeypatch.setenv("OLLAMA_FALLBACK_MODEL", "gemma4:e4b")
    if explicit_challenger:
        monkeypatch.setenv("OLLAMA_CHALLENGER_MODEL", "qwen3.5:4b")
    models = []

    def handler(request):
        if request.url.host == "primary.test":
            raise httpx.ConnectError("offline", request=request)
        models.append(json.loads(request.content)["model"])
        return httpx.Response(200, json={"done": True})

    transport.request_ollama(
        PRIMARY, {**PAYLOAD, "model": "qwen3.5:4b"}, client_factory=factory(handler)
    )
    assert models == ["qwen3.5:4b", "qwen3.5:4b"]


def test_dead_primary_is_temporarily_bypassed_and_later_probed(monkeypatch, clock, authenticated):
    monkeypatch.setenv("OLLAMA_FALLBACK_BASE_URL", BACKUP)
    primary_calls = []

    def handler(request):
        if request.url.host == "primary.test":
            primary_calls.append(request)
            if len(primary_calls) == 1:
                raise httpx.ConnectError("offline", request=request)
            return result()
        return httpx.Response(200, json={"done": True})

    for _ in range(2):
        transport.request_ollama(PRIMARY, PAYLOAD, client_factory=factory(handler))
    assert len(primary_calls) == 1
    clock.now += 31
    transport.request_ollama(PRIMARY, PAYLOAD, client_factory=factory(handler))
    assert len(primary_calls) == 2
    assert PRIMARY not in transport._unavailable_until


@pytest.mark.parametrize("setting", ["0", "-1", "nan", "inf", "bad"])
def test_invalid_startup_limit_is_rejected(monkeypatch, setting):
    monkeypatch.setenv("OLLAMA_STARTUP_TIMEOUT_SECONDS", setting)
    with pytest.raises(ValueError, match="OLLAMA_STARTUP_TIMEOUT_SECONDS"):
        transport.request_ollama(PRIMARY, PAYLOAD)


def test_invoice_structured_call_uses_startup_grace(monkeypatch, clock, authenticated):
    class Ready(BaseModel):
        ready: bool

    def handler(request):
        if request.url.path == "/api/generate":
            clock.now += 180
            return httpx.Response(200, json={"done": True})
        return result()

    monkeypatch.setattr("extract.local_pipeline.httpx.Client", factory(handler))
    output = _call_ollama_structured(
        base_url=BACKUP,
        model="gemma4:e4b",
        system_prompt="Extract the supplied fields",
        user_prompt="A synthetic invoice",
        schema_type=Ready,
        tracker=UsageAccumulator(model="gemma4:e4b"),
    )
    assert output.ready is True
    assert clock.now == 180


def test_invoice_error_identifies_exhausted_startup_budget(monkeypatch, clock, authenticated):
    class Ready(BaseModel):
        ready: bool

    monkeypatch.setenv("OLLAMA_STARTUP_TIMEOUT_SECONDS", "3")

    def handler(request):
        return httpx.Response(503)

    monkeypatch.setattr("extract.local_pipeline.httpx.Client", factory(handler))
    with pytest.raises(ValueError, match="backup model was not ready after 3 seconds"):
        _call_ollama_structured(
            base_url=BACKUP,
            model="gemma4:e4b",
            system_prompt="Extract",
            user_prompt="Synthetic invoice",
            schema_type=Ready,
            tracker=UsageAccumulator(model="gemma4:e4b"),
        )


def test_cloud_identity_tokens_are_cached_and_refreshed(monkeypatch):
    import google.oauth2.id_token

    credentials = SimpleNamespace(valid=False, token=None)
    refreshes = []

    def refresh(request):
        refreshes.append(request)
        credentials.valid = True
        credentials.token = f"test-token-{len(refreshes)}"

    credentials.refresh = refresh
    monkeypatch.setattr(
        google.oauth2.id_token, "fetch_id_token_credentials", lambda *args, **kwargs: credentials
    )
    assert transport.cloud_run_headers(BACKUP) == {"Authorization": "Bearer test-token-1"}
    assert transport.cloud_run_headers(BACKUP) == {"Authorization": "Bearer test-token-1"}
    credentials.valid = False
    assert transport.cloud_run_headers(BACKUP) == {"Authorization": "Bearer test-token-2"}
    assert len(refreshes) == 2
    assert transport.cloud_run_headers(PRIMARY) == {}


def test_authentication_failure_does_not_expose_credentials(monkeypatch):
    import google.oauth2.id_token

    def fail(*args, **kwargs):
        raise RuntimeError("private-key-material")

    monkeypatch.setattr(google.oauth2.id_token, "fetch_id_token_credentials", fail)
    with pytest.raises(ValueError, match="Cloud Run authentication failed") as caught:
        transport.cloud_run_headers(BACKUP)
    assert "private-key-material" not in str(caught.value)


def test_railway_json_credentials_are_used_and_refreshed_after_rotation(monkeypatch):
    from google.oauth2 import service_account

    provided = []

    def from_info(info, target_audience):
        assert target_audience == BACKUP
        provided.append(info)
        credentials = SimpleNamespace(valid=False, token=None)

        def refresh(request):
            credentials.valid = True
            credentials.token = info["private_key_id"]

        credentials.refresh = refresh
        return credentials

    monkeypatch.setattr(service_account.IDTokenCredentials, "from_service_account_info", from_info)
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", "/unavailable/windows/path.json")
    monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", json.dumps({"private_key_id": "test-key-1"}))
    assert transport.cloud_run_headers(BACKUP) == {"Authorization": "Bearer test-key-1"}
    assert transport.cloud_run_headers(BACKUP) == {"Authorization": "Bearer test-key-1"}
    monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", json.dumps({"private_key_id": "test-key-2"}))
    assert transport.cloud_run_headers(BACKUP) == {"Authorization": "Bearer test-key-2"}
    assert len(provided) == 2


def test_invalid_json_credentials_are_redacted(monkeypatch):
    monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", "invalid-json-private-key-material")
    with pytest.raises(ValueError, match="Cloud Run authentication failed") as caught:
        transport.cloud_run_headers(BACKUP)
    assert "private-key-material" not in str(caught.value)
