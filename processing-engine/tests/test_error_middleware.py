"""Integration tests for exception handler middleware."""

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.exceptions import (
    CompositeError,
    ProcessingEngineError,
    StorageNotFoundError,
    StoragePermissionError,
    generic_error_handler,
    processing_engine_error_handler,
)


def _make_app() -> FastAPI:
    """Create a minimal FastAPI app with exception handlers and synthetic routes."""
    test_app = FastAPI()
    test_app.add_exception_handler(ProcessingEngineError, processing_engine_error_handler)
    test_app.add_exception_handler(Exception, generic_error_handler)

    @test_app.get("/raise-processing-error")
    def raise_processing_error():
        raise ProcessingEngineError("base error")

    @test_app.get("/raise-composite-error")
    def raise_composite_error():
        raise CompositeError("WCS computation failed")

    @test_app.get("/raise-storage-not-found")
    def raise_storage_not_found():
        raise StorageNotFoundError("file.fits not found")

    @test_app.get("/raise-storage-permission")
    def raise_storage_permission():
        raise StoragePermissionError("access denied")

    @test_app.get("/raise-http-exception")
    def raise_http_exception():
        raise HTTPException(status_code=400, detail="bad input")

    @test_app.get("/raise-runtime-error")
    def raise_runtime_error():
        raise RuntimeError("unexpected bug")

    @test_app.get("/raise-composite-400")
    def raise_composite_400():
        raise CompositeError("invalid channels", status_code=400)

    return test_app


client = TestClient(_make_app(), raise_server_exceptions=False)


class TestProcessingEngineErrorHandler:
    def test_base_error_returns_500(self):
        resp = client.get("/raise-processing-error")
        assert resp.status_code == 500
        body = resp.json()
        assert body["error"] == "ProcessingEngineError"
        assert body["detail"] == "base error"
        assert body["status_code"] == 500

    def test_composite_error_returns_500(self):
        resp = client.get("/raise-composite-error")
        assert resp.status_code == 500
        body = resp.json()
        assert body["error"] == "CompositeError"
        assert body["detail"] == "WCS computation failed"

    def test_storage_not_found_returns_404(self):
        resp = client.get("/raise-storage-not-found")
        assert resp.status_code == 404
        body = resp.json()
        assert body["error"] == "StorageNotFoundError"
        assert body["detail"] == "file.fits not found"

    def test_storage_permission_returns_403(self):
        resp = client.get("/raise-storage-permission")
        assert resp.status_code == 403
        body = resp.json()
        assert body["error"] == "StoragePermissionError"

    def test_status_code_override(self):
        resp = client.get("/raise-composite-400")
        assert resp.status_code == 400
        body = resp.json()
        assert body["error"] == "CompositeError"
        assert body["detail"] == "invalid channels"


class TestGenericErrorHandler:
    def test_unhandled_error_returns_500_no_leak(self):
        resp = client.get("/raise-runtime-error")
        assert resp.status_code == 500
        body = resp.json()
        assert body["error"] == "InternalServerError"
        assert body["detail"] == "An internal error occurred"
        assert "unexpected bug" not in body["detail"]


class TestHTTPExceptionPassthrough:
    def test_http_exception_unchanged(self):
        resp = client.get("/raise-http-exception")
        assert resp.status_code == 400
        body = resp.json()
        assert body["detail"] == "bad input"


class TestDetailFieldAlwaysPresent:
    """The .NET backend expects a 'detail' field in all error responses."""

    def test_domain_error_has_detail(self):
        resp = client.get("/raise-composite-error")
        assert "detail" in resp.json()

    def test_generic_error_has_detail(self):
        resp = client.get("/raise-runtime-error")
        assert "detail" in resp.json()

    def test_http_exception_has_detail(self):
        resp = client.get("/raise-http-exception")
        assert "detail" in resp.json()
