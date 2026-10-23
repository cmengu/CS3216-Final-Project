# The invoice service for Railway. Build from the repo root so the image keeps the layout the
# code expects: /app/backend holds the service and /app/data/dummy the demo price sheet.
#
#   docker build -f backend/Dockerfile -t invoice-api .
#   docker run -p 8000:8000 -e INVOICE_MODE=live -e OPENAI_API_KEY=... invoice-api

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

# OpenCV, pulled in by docling, needs these shared libraries even in headless builds.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    HF_HOME=/app/cache/huggingface

WORKDIR /app/backend

# Dependencies first, so a source change does not reinstall docling.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev --extra docling --no-install-project

COPY backend/ ./
COPY data/dummy/ /app/data/dummy/
RUN uv sync --locked --no-dev --extra docling

# Fetch the layout and table models at build time. Without this the first upload after every
# deploy spends minutes downloading and trips INVOICE_OCR_TIMEOUT.
RUN uv run docling-tools models download

# Railway sets PORT. INVOICE_DATA_DIR should point at a mounted volume so uploads and the
# SQLite database survive a redeploy.
EXPOSE 8000
CMD .venv/bin/uvicorn api.app:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1
