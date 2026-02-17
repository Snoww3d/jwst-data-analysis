FROM python:3.12-slim-bullseye

WORKDIR /app

# Install system dependencies needed for building Python packages
RUN apt-get update && apt-get install -y \
    build-essential \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create non-root user and writable data directories for MAST downloads/processing
RUN groupadd --system --gid 1001 appgroup && \
    useradd --system --uid 1001 --gid appgroup --no-create-home appuser && \
    mkdir -p /app/data/mast /tmp/matplotlib /tmp/jwst-cache && \
    chown -R appuser:appgroup /app/data && \
    chown -R appuser:appgroup /app /tmp/matplotlib /tmp/jwst-cache

# Matplotlib needs a writable config directory (no home dir for non-root user)
ENV MPLCONFIGDIR=/tmp/matplotlib

USER appuser

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-keep-alive", "600"]