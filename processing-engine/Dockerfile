FROM python:3.12-slim-bullseye

WORKDIR /app

# Install system dependencies needed for building Python packages
RUN apt-get update && apt-get install -y \
    build-essential \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Production images install runtime deps only. Set INSTALL_DEV=true (local/CI
# test images) to additionally install test/lint tooling from requirements-dev.txt
# (which itself includes requirements.txt). Defaults false so a plain build — and
# the production stack — never ships pytest/ruff. (#1468)
ARG INSTALL_DEV=false
COPY requirements.txt requirements-dev.txt ./
RUN if [ "$INSTALL_DEV" = "true" ]; then \
        pip install --no-cache-dir -r requirements-dev.txt; \
    else \
        pip install --no-cache-dir -r requirements.txt; \
    fi

# STScI jwst calibration pipeline (#1709), in its own layer AFTER the base
# requirements so jwst resolves against the already-pinned base deps (numpy/
# astropy) instead of the base install overwriting jwst's resolution. Note:
# base-requirement changes therefore DO rebuild this ~2GB layer (linear Docker
# cache) — accepted cost; editing requirements-calibration.txt alone is cheap.
# CE builds pass INSTALL_CALIBRATION=false to stay slim; runtime is
# additionally gated by the CALIBRATION_ENABLED env var.
ARG INSTALL_CALIBRATION=true
COPY requirements-calibration.txt ./
RUN if [ "$INSTALL_CALIBRATION" = "true" ]; then \
        pip install --no-cache-dir -r requirements-calibration.txt; \
    fi

COPY . .

# Create non-root user and writable data directories for MAST downloads/processing
RUN groupadd --system --gid 1001 appgroup && \
    useradd --system --uid 1001 --gid appgroup --no-create-home appuser && \
    mkdir -p /app/data/mast /app/data/semantic /app/data/model-cache /app/data/crds /tmp/matplotlib /tmp/jwst-cache && \
    chown -R appuser:appgroup /app/data && \
    chown -R appuser:appgroup /app /tmp/matplotlib /tmp/jwst-cache

# Matplotlib needs a writable config directory (no home dir for non-root user)
ENV MPLCONFIGDIR=/tmp/matplotlib
# Cache sentence-transformers models to persistent volume
ENV SENTENCE_TRANSFORMERS_HOME=/app/data/model-cache

USER appuser

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-keep-alive", "600", "--workers", "1"]