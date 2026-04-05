"""Tests for the custom exception hierarchy."""

import pytest

from app.exceptions import (
    AnalysisError,
    CompositeError,
    EmbeddingError,
    FITSProcessingError,
    MosaicError,
    ProcessingEngineError,
    StorageError,
    StorageNotFoundError,
    StoragePermissionError,
)


class TestProcessingEngineError:
    def test_default_status_code(self):
        exc = ProcessingEngineError("test")
        assert exc.status_code == 500

    def test_message_passthrough(self):
        exc = ProcessingEngineError("something broke")
        assert str(exc) == "something broke"

    def test_status_code_override(self):
        exc = ProcessingEngineError("bad request", status_code=400)
        assert exc.status_code == 400

    def test_error_type(self):
        exc = ProcessingEngineError("test")
        assert exc.error_type == "ProcessingEngineError"


class TestSubclassDefaults:
    @pytest.mark.parametrize(
        "cls, expected_code, expected_type",
        [
            (FITSProcessingError, 500, "FITSProcessingError"),
            (CompositeError, 500, "CompositeError"),
            (MosaicError, 500, "MosaicError"),
            (AnalysisError, 500, "AnalysisError"),
            (StorageError, 500, "StorageError"),
            (StoragePermissionError, 403, "StoragePermissionError"),
            (StorageNotFoundError, 404, "StorageNotFoundError"),
            (EmbeddingError, 500, "EmbeddingError"),
        ],
    )
    def test_defaults(self, cls, expected_code, expected_type):
        exc = cls("test message")
        assert exc.status_code == expected_code
        assert exc.error_type == expected_type
        assert str(exc) == "test message"


class TestInheritanceChain:
    def test_storage_permission_is_storage_error(self):
        exc = StoragePermissionError("denied")
        assert isinstance(exc, StorageError)
        assert isinstance(exc, ProcessingEngineError)

    def test_storage_not_found_is_storage_error(self):
        exc = StorageNotFoundError("missing")
        assert isinstance(exc, StorageError)
        assert isinstance(exc, ProcessingEngineError)

    def test_all_subclasses_are_processing_engine_error(self):
        for cls in [
            FITSProcessingError,
            CompositeError,
            MosaicError,
            AnalysisError,
            StorageError,
            EmbeddingError,
        ]:
            assert issubclass(cls, ProcessingEngineError)

    def test_status_code_override_on_subclass(self):
        exc = CompositeError("bad input", status_code=400)
        assert exc.status_code == 400
        assert isinstance(exc, ProcessingEngineError)
