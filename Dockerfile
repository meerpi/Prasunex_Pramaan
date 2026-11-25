# syntax=docker/dockerfile:1
# ==============================================================================
# Stage 1: Build Zero-CDN Self-Hosted React 19 + Vite 6 Frontend SPA
# ==============================================================================
FROM node:22.11.0-alpine3.20 AS frontend-builder

WORKDIR /build/frontend
COPY pramaan/frontend/package.json pramaan/frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY pramaan/frontend/ ./
RUN npm run build

# ==============================================================================
# Stage 2: Python 3.12 Runtime with Z3, RapidOCR/Tesseract, DeBERTa NLI & FastAPI
# ==============================================================================
FROM python:3.12.7-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/var/lib/pramaan/hf_cache \
    PRAMAAN_UPLOAD_DIR=/var/lib/pramaan/uploads \
    PRAMAAN_DATABASE_URL=sqlite+aiosqlite:////var/lib/pramaan/pramaan.db

RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-eng \
        libgl1 \
        libglib2.0-0 \
        curl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 pramaan \
    && useradd --uid 10001 --gid pramaan --create-home --home-dir /home/pramaan pramaan \
    && mkdir -p /app/pramaan/backend /app/pramaan/canons /app/pramaan/frontend/dist /var/lib/pramaan/uploads /var/lib/pramaan/hf_cache \
    && chown -R pramaan:pramaan /app /var/lib/pramaan

WORKDIR /app/pramaan/backend
COPY --chown=pramaan:pramaan pramaan/backend/pyproject.toml ./
COPY --chown=pramaan:pramaan pramaan/backend/src/ ./src/
COPY --chown=pramaan:pramaan pramaan/backend/sql/ ./sql/

RUN pip install --upgrade pip setuptools wheel \
    && pip install ".[postgres]"

ARG PRELOAD_MODELS=0
RUN if [ "$PRELOAD_MODELS" = "1" ]; then \
        python -c "from sentence_transformers import CrossEncoder, SentenceTransformer; CrossEncoder('cross-encoder/nli-deberta-v3-base'); SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')" \
        && chown -R pramaan:pramaan /var/lib/pramaan/hf_cache; \
    fi

COPY --chown=pramaan:pramaan pramaan/canons/ /app/pramaan/canons/
COPY --from=frontend-builder --chown=pramaan:pramaan /build/frontend/dist/ /app/pramaan/frontend/dist/

USER pramaan
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

CMD ["sh", "-c", "exec uvicorn pramaan.api.app:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips \"${PRAMAAN_FORWARDED_ALLOW_IPS:-127.0.0.1}\""]
