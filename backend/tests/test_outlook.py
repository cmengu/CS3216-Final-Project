import base64
import time
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.outlook import (
    AIEmailBatchClassification,
    AIEmailDecision,
    decrypt_tokens,
    encrypt_tokens,
)


def test_token_encryption_roundtrip_and_tamper_detection():
    payload = {
        "access_token": "acc-123",
        "refresh_token": "ref-456",
        "expires_at": 1750000000.0,
    }
    secret = "test-client-secret-value"
    blob = encrypt_tokens(payload, secret)
    assert "acc-123" not in blob
    assert decrypt_tokens(blob, secret) == payload

    with pytest.raises(ValueError, match="integrity check failed"):
        decrypt_tokens(blob, "wrong-secret")


def test_outlook_status_when_unconfigured(tmp_path, monkeypatch):
    monkeypatch.delenv("MICROSOFT_CLIENT_ID", raising=False)
    monkeypatch.delenv("MICROSOFT_CLIENT_SECRET", raising=False)

    with TestClient(create_app(storage_dir=tmp_path)) as client:
        status = client.get("/outlook/status")
        assert status.status_code == 200
        assert status.json() == {
            "configured": False,
            "connected": False,
            "email": None,
            "displayName": None,
            "connectedAt": None,
            "redirectUri": "http://localhost:8001/auth/outlook/callback",
        }
        login = client.get("/auth/outlook/login", follow_redirects=False)
        assert login.status_code == 503


def test_outlook_oauth_flow_messages_attachments_and_refresh(tmp_path, monkeypatch):
    monkeypatch.setenv("MICROSOFT_CLIENT_ID", "client-id-123")
    monkeypatch.setenv("MICROSOFT_CLIENT_SECRET", "client-secret-xyz")
    monkeypatch.setenv("MICROSOFT_REDIRECT_URI", "http://localhost:8001/auth/outlook/callback")
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:3000")

    monkeypatch.setattr(
        "api.outlook._exchange_code_for_tokens",
        lambda cfg, code, verifier: {
            "access_token": "initial-access-token",
            "refresh_token": "initial-refresh-token",
            "expires_in": 3600,
        },
    )
    monkeypatch.setattr(
        "api.outlook._fetch_graph_profile",
        lambda token: {
            "displayName": "Alex Tan",
            "mail": "alex.tan@outlook.com",
        },
    )

    with TestClient(create_app(storage_dir=tmp_path)) as client:
        login_res = client.get("/auth/outlook/login?return_to=/invoices", follow_redirects=False)
        assert login_res.status_code == 302
        location = login_res.headers["location"]
        parsed = urlparse(location)
        assert parsed.netloc == "login.microsoftonline.com"
        qs = parse_qs(parsed.query)
        assert qs["client_id"] == ["client-id-123"]
        assert qs["code_challenge_method"] == ["S256"]
        state = qs["state"][0]

        cb_res = client.get(
            f"/auth/outlook/callback?code=auth-code-999&state={state}",
            follow_redirects=False,
        )
        assert cb_res.status_code == 302
        assert cb_res.headers["location"] == "http://localhost:3000/invoices?outlook=connected"

        status_res = client.get("/outlook/status")
        assert status_res.status_code == 200
        status_json = status_res.json()
        assert status_json["configured"] is True
        assert status_json["connected"] is True
        assert status_json["email"] == "alex.tan@outlook.com"
        assert status_json["displayName"] == "Alex Tan"

        pdf_bytes = b"%PDF-1.4\n% Fake invoice PDF content\n"
        pdf_b64 = base64.b64encode(pdf_bytes).decode("ascii")

        def fake_graph_get(store, cfg, path, *, params=None, prefer_text=False):
            if path == "/me/mailFolders/inbox/messages":
                return {
                    "value": [
                        {
                            "id": "msg-1",
                            "subject": "Invoice #INV-2026-089 from Pacific Paper",
                            "from": {
                                "emailAddress": {
                                    "name": "Pacific Paper Billing",
                                    "address": "billing@pacificpaper.example",
                                }
                            },
                            "receivedDateTime": "2026-10-23T09:15:00Z",
                            "bodyPreview": "Please find attached our October invoice.",
                            "body": {
                                "contentType": "text",
                                "content": "Hi Alex,\nPlease find attached our October invoice #INV-2026-089 for SGD 1,240.00.\nThanks!",
                            },
                            "hasAttachments": True,
                            "webLink": "https://outlook.live.com/owa/?ItemID=msg-1",
                        },
                        {
                            "id": "msg-2",
                            "subject": "Weekly team sync notes",
                            "from": {
                                "emailAddress": {
                                    "name": "Internal Team",
                                    "address": "team@company.example",
                                }
                            },
                            "receivedDateTime": "2026-10-22T08:00:00Z",
                            "bodyPreview": "Notes from Tuesday",
                            "body": {
                                "contentType": "html",
                                "content": "<p>Notes from <b>Tuesday</b></p>",
                            },
                            "hasAttachments": False,
                        },
                    ]
                }
            if path == "/me/messages/msg-1":
                return {
                    "id": "msg-1",
                    "subject": "Invoice #INV-2026-089 from Pacific Paper",
                    "from": {
                        "emailAddress": {
                            "name": "Pacific Paper Billing",
                            "address": "billing@pacificpaper.example",
                        }
                    },
                    "receivedDateTime": "2026-10-23T09:15:00Z",
                    "bodyPreview": "Please find attached our October invoice.",
                    "body": {
                        "contentType": "text",
                        "content": "Hi Alex,\nPlease find attached our October invoice #INV-2026-089 for SGD 1,240.00.\nThanks!",
                    },
                    "hasAttachments": True,
                }
            if path == "/me/messages/msg-1/attachments":
                return {
                    "value": [
                        {
                            "id": "att-pdf-1",
                            "name": "INV-2026-089.pdf",
                            "contentType": "application/pdf",
                            "size": len(pdf_bytes),
                            "isInline": False,
                        },
                        {
                            "id": "att-img-2",
                            "name": "logo.png",
                            "contentType": "image/png",
                            "size": 512,
                            "isInline": True,
                        },
                    ]
                }
            if path == "/me/messages/msg-1/attachments/att-pdf-1":
                return {
                    "id": "att-pdf-1",
                    "name": "INV-2026-089.pdf",
                    "contentType": "application/pdf",
                    "contentBytes": pdf_b64,
                }
            raise AssertionError(f"Unexpected Graph path: {path}")

        monkeypatch.setattr("api.outlook._graph_get", fake_graph_get)

        msgs_res = client.get("/outlook/messages?only_attachments=true&search=Pacific")
        assert msgs_res.status_code == 200
        msgs = msgs_res.json()["messages"]
        assert len(msgs) == 1
        assert msgs[0]["id"] == "msg-1"
        assert "SGD 1,240.00" in msgs[0]["bodyText"]

        detail_res = client.get("/outlook/messages/msg-1")
        assert detail_res.status_code == 200
        detail = detail_res.json()
        assert len(detail["attachments"]) == 2
        assert detail["attachments"][0]["isPdf"] is True
        assert detail["attachments"][1]["isPdf"] is False

        file_res = client.get("/outlook/messages/msg-1/attachments/att-pdf-1/file")
        assert file_res.status_code == 200
        assert file_res.headers["content-type"] == "application/pdf"
        assert file_res.content == pdf_bytes

        disc_res = client.post("/outlook/disconnect")
        assert disc_res.status_code == 200
        assert disc_res.json()["connected"] is False


def test_outlook_automatic_token_refresh(tmp_path, monkeypatch):
    monkeypatch.setenv("MICROSOFT_CLIENT_ID", "client-id-123")
    monkeypatch.setenv("MICROSOFT_CLIENT_SECRET", "client-secret-xyz")

    refresh_calls = []

    def fake_refresh(cfg, refresh_token):
        refresh_calls.append(refresh_token)
        return {
            "access_token": "fresh-access-token-777",
            "refresh_token": "rotated-refresh-token-888",
            "expires_in": 3600,
        }

    monkeypatch.setattr("api.outlook._refresh_access_token", fake_refresh)

    app = create_app(storage_dir=tmp_path)
    with TestClient(app) as client:
        store = app.state.store
        expired_blob = encrypt_tokens(
            {
                "access_token": "expired-token",
                "refresh_token": "valid-refresh-token",
                "expires_at": time.time() - 120,
            },
            "client-secret-xyz",
        )
        with store.connect() as conn:
            conn.execute(
                """
                INSERT INTO outlook_connections (id, email, display_name, encrypted_tokens, connected_at)
                VALUES (1, 'user@outlook.com', 'User', ?, '2026-10-23T00:00:00Z')
                """,
                (expired_blob,),
            )

        from api.outlook import _get_valid_access_token, get_outlook_config

        token = _get_valid_access_token(store, get_outlook_config())
        assert token == "fresh-access-token-777"
        assert refresh_calls == ["valid-refresh-token"]
        assert client.get("/outlook/status").json()["connected"] is True


def test_outlook_date_filtering_and_ai_scan_classification(tmp_path, monkeypatch):
    monkeypatch.setenv("MICROSOFT_CLIENT_ID", "client-id-123")
    monkeypatch.setenv("MICROSOFT_CLIENT_SECRET", "client-secret-xyz")

    app = create_app(storage_dir=tmp_path)
    with TestClient(app) as client:
        store = app.state.store
        valid_blob = encrypt_tokens(
            {
                "access_token": "valid-token",
                "refresh_token": "valid-refresh",
                "expires_at": time.time() + 3600,
            },
            "client-secret-xyz",
        )
        with store.connect() as conn:
            conn.execute(
                """
                INSERT INTO outlook_connections (id, email, display_name, encrypted_tokens, connected_at)
                VALUES (1, 'ap@company.com', 'AP Team', ?, '2026-10-23T00:00:00Z')
                """,
                (valid_blob,),
            )

        observed_filters: list[str | None] = []

        def fake_graph_get(store, cfg, path, *, params=None, prefer_text=False):
            if path == "/me/mailFolders/inbox/messages":
                observed_filters.append((params or {}).get("$filter"))
                return {
                    "value": [
                        {
                            "id": "msg-inv-1",
                            "subject": "Tax Invoice #INV-9001 - Bean & Co",
                            "from": {
                                "emailAddress": {
                                    "name": "Bean & Co Accounts",
                                    "address": "accounts@beanco.example",
                                }
                            },
                            "receivedDateTime": "2026-10-20T10:30:00Z",
                            "bodyPreview": "Attached is Tax Invoice #INV-9001 and our catalogue.",
                            "body": {
                                "contentType": "text",
                                "content": "Dear Customer, please find attached Tax Invoice #INV-9001 and our Q4 product catalogue.",
                            },
                            "hasAttachments": True,
                        },
                        {
                            "id": "msg-news-2",
                            "subject": "October Industry Newsletter",
                            "from": {
                                "emailAddress": {
                                    "name": "Coffee Weekly",
                                    "address": "news@coffeeweekly.example",
                                }
                            },
                            "receivedDateTime": "2026-10-19T14:00:00Z",
                            "bodyPreview": "Top stories this week",
                            "body": {
                                "contentType": "text",
                                "content": "Welcome to our October newsletter!",
                            },
                            "hasAttachments": False,
                        },
                        {
                            "id": "msg-old-3",
                            "subject": "September Invoice #INV-8000",
                            "from": {
                                "emailAddress": {
                                    "name": "Bean & Co Accounts",
                                    "address": "accounts@beanco.example",
                                }
                            },
                            "receivedDateTime": "2026-09-15T09:00:00Z",
                            "bodyPreview": "September invoice",
                            "body": {
                                "contentType": "text",
                                "content": "Attached is your September invoice.",
                            },
                            "hasAttachments": True,
                        },
                    ]
                }
            if path == "/me/messages/msg-inv-1/attachments":
                return {
                    "value": [
                        {
                            "id": "att-inv-pdf",
                            "name": "Tax_Invoice_INV-9001.pdf",
                            "contentType": "application/pdf",
                            "size": 24500,
                            "isInline": False,
                        },
                        {
                            "id": "att-cat-pdf",
                            "name": "Q4_Product_Catalogue.pdf",
                            "contentType": "application/pdf",
                            "size": 98000,
                            "isInline": False,
                        },
                        {
                            "id": "att-sig-png",
                            "name": "signature.png",
                            "contentType": "image/png",
                            "size": 1200,
                            "isInline": True,
                        },
                    ]
                }
            raise AssertionError(f"Unexpected Graph path: {path}")

        monkeypatch.setattr("api.outlook._graph_get", fake_graph_get)

        # 1. Invalid date range (date_from > date_to) returns 400
        bad_res = client.get("/outlook/messages?date_from=2026-10-25&date_to=2026-10-18")
        assert bad_res.status_code == 400

        # 2. Valid date range filters out September email (msg-old-3) and passes OData $filter
        filtered_res = client.get("/outlook/messages?date_from=2026-10-18&date_to=2026-10-21")
        assert filtered_res.status_code == 200
        filtered_msgs = filtered_res.json()["messages"]
        assert [m["id"] for m in filtered_msgs] == ["msg-inv-1", "msg-news-2"]
        assert observed_filters[-1] == (
            "receivedDateTime ge 2026-10-18T00:00:00Z and receivedDateTime le 2026-10-21T23:59:59Z"
        )

        # 3. AI Scan with mocked OpenAI responses.parse classifies each email and picks only the invoice PDF
        class FakeParsedResponse:
            status = "completed"
            model = "gpt-5.4-mini"
            output_parsed = AIEmailBatchClassification(
                decisions=[
                    AIEmailDecision(
                        message_id="msg-inv-1",
                        is_invoice_email=True,
                        confidence="high",
                        supplier_name="Bean & Co",
                        reasoning="Email delivers Tax Invoice #INV-9001; selected the invoice PDF and excluded the product catalogue.",
                        invoice_attachment_ids=["att-inv-pdf", "att-sig-png"],
                    ),
                    AIEmailDecision(
                        message_id="msg-news-2",
                        is_invoice_email=False,
                        confidence="high",
                        supplier_name=None,
                        reasoning="Industry newsletter with no billing content or attachments.",
                        invoice_attachment_ids=[],
                    ),
                ]
            )

        class FakeResponsesAPI:
            def parse(self, **kwargs):
                return FakeParsedResponse()

        class FakeOpenAIClient:
            responses = FakeResponsesAPI()

        app.state.outlook_ai_client = FakeOpenAIClient()

        scan_res = client.post(
            "/outlook/scan",
            json={"dateFrom": "2026-10-18", "dateTo": "2026-10-21", "limit": 25},
        )
        assert scan_res.status_code == 200
        scan_json = scan_res.json()
        assert scan_json["scannedCount"] == 2
        assert scan_json["invoiceEmailCount"] == 1
        assert scan_json["invoiceAttachmentCount"] == 1
        assert scan_json["model"] == "gpt-5.4-mini"

        inv_item = scan_json["items"][0]
        assert inv_item["message"]["id"] == "msg-inv-1"
        assert inv_item["isInvoiceEmail"] is True
        assert inv_item["supplierName"] == "Bean & Co"
        # Non-PDF att-sig-png and catalogue att-cat-pdf are excluded; only att-inv-pdf is returned
        assert [a["id"] for a in inv_item["invoiceAttachments"]] == ["att-inv-pdf"]

        news_item = scan_json["items"][1]
        assert news_item["message"]["id"] == "msg-news-2"
        assert news_item["isInvoiceEmail"] is False
        assert news_item["invoiceAttachments"] == []
