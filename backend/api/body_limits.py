"""Bound actual streamed bytes even when Content-Length is absent or dishonest."""

from fastapi import HTTPException
from starlette.responses import JSONResponse

from read.reader import MAX_BYTES


def request_body_limit(path):
    if path.rstrip("/") == "/invoice-batches":
        return 101 * 1024 * 1024
    if path.startswith(("/auth/", "/admin/")):
        return 16 * 1024
    return MAX_BYTES + 65536


class BodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        limit = request_body_limit(scope["path"])
        consumed = 0
        exceeded = False
        started = finished = False

        async def reject():
            nonlocal started, finished
            if not started:
                response = JSONResponse(
                    {"detail": "Upload exceeds the allowed request size"},
                    status_code=413,
                    headers={"Connection": "close", "Cache-Control": "no-store"},
                )
                await response(scope, receive, send)
                started = finished = True
            elif not finished:
                await send({"type": "http.response.body", "body": b"", "more_body": False})
                finished = True

        async def bounded_send(message):
            nonlocal started, finished
            if exceeded:
                await reject()
                return
            if message["type"] == "http.response.start":
                started = True
            elif message["type"] == "http.response.body" and not message.get("more_body", False):
                finished = True
            await send(message)

        async def bounded_receive():
            nonlocal consumed, exceeded
            if exceeded:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                consumed += len(message.get("body", b""))
                if consumed > limit:
                    exceeded = True
                    raise HTTPException(413, "Upload exceeds the allowed request size")
            return message

        try:
            await self.app(scope, bounded_receive, bounded_send)
        except Exception:
            # BaseHTTPMiddleware may wrap a receive error in an ExceptionGroup.
            # A rejected stream must still produce one 413, never an accidental 500.
            if not exceeded:
                raise
            await reject()
