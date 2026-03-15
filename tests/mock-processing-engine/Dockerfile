FROM python:3.14-alpine
WORKDIR /app
COPY server.py .
EXPOSE 8000
HEALTHCHECK --interval=2s --timeout=2s --retries=3 --start-period=1s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
CMD ["python", "server.py"]
