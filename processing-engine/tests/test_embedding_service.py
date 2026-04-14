"""Tests for EmbeddingService.search — NaN scores, empty results, mismatches."""

from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from app.semantic.embedding_service import EmbeddingService


@pytest.fixture()
def service():
    """Create an EmbeddingService with a mocked index and id_map (no disk/model)."""
    with patch.object(EmbeddingService, "_load_index"):
        svc = EmbeddingService()

    # Set up a fake FAISS index that we control via mocks
    svc._index = MagicMock()
    svc._index.ntotal = 3
    svc._id_map = [
        {"file_id": "f1", "text": "Crab Nebula"},
        {"file_id": "f2", "text": "Pillars of Creation"},
        {"file_id": "f3", "text": "Horsehead Nebula"},
    ]
    return svc


def _patch_encode(svc):
    """Stub _encode to return a dummy query embedding."""
    svc._ensure_model = MagicMock()
    svc._encode = MagicMock(return_value=np.zeros((1, 384), dtype=np.float32))


class TestSearchNanScores:
    """NaN scores should be silently skipped, not raise or appear in results."""

    def test_nan_score_filtered_out(self, service):
        _patch_encode(service)
        service._index.search.return_value = (
            np.array([[0.9, float("nan"), 0.5]], dtype=np.float32),
            np.array([[0, 1, 2]], dtype=np.int64),
        )

        results, _, _ = service.search("nebula", top_k=3, min_score=0.3)

        returned_ids = [r["file_id"] for r in results]
        assert "f1" in returned_ids
        assert "f2" not in returned_ids  # NaN score — skipped
        assert "f3" in returned_ids

    def test_all_nan_scores_returns_empty(self, service):
        _patch_encode(service)
        service._index.search.return_value = (
            np.array([[float("nan"), float("nan")]], dtype=np.float32),
            np.array([[0, 1]], dtype=np.int64),
        )

        results, _, _ = service.search("nebula", top_k=2, min_score=0.0)

        assert results == []


class TestSearchEmptyResults:
    """FAISS returning empty arrays should not raise."""

    def test_empty_scores_and_indices(self, service):
        _patch_encode(service)
        service._index.search.return_value = (
            np.array([], dtype=np.float32).reshape(0, 0),
            np.array([], dtype=np.int64).reshape(0, 0),
        )

        results, _, _ = service.search("nebula", top_k=3, min_score=0.3)

        assert results == []

    def test_empty_inner_arrays(self, service):
        """scores shape (1, 0) — FAISS found nothing."""
        _patch_encode(service)
        service._index.search.return_value = (
            np.array([[]], dtype=np.float32),
            np.array([[]], dtype=np.int64),
        )

        results, _, _ = service.search("nebula", top_k=3, min_score=0.3)

        assert results == []


class TestSearchLengthMismatch:
    """Mismatched score/index array lengths should log a warning, not crash."""

    def test_scores_longer_than_indices(self, service):
        _patch_encode(service)
        service._index.search.return_value = (
            np.array([[0.9, 0.8, 0.7]], dtype=np.float32),
            np.array([[0, 1]], dtype=np.int64),
        )

        results, _, _ = service.search("nebula", top_k=3, min_score=0.3)

        # zip stops at the shorter array — only 2 results possible
        assert len(results) <= 2

    def test_indices_longer_than_scores(self, service):
        _patch_encode(service)
        service._index.search.return_value = (
            np.array([[0.9]], dtype=np.float32),
            np.array([[0, 1, 2]], dtype=np.int64),
        )

        results, _, _ = service.search("nebula", top_k=3, min_score=0.3)

        assert len(results) <= 1


class TestSearchNegativeIndices:
    """FAISS uses -1 to indicate 'no result' — should be filtered."""

    def test_negative_index_skipped(self, service):
        _patch_encode(service)
        service._index.search.return_value = (
            np.array([[0.9, 0.8]], dtype=np.float32),
            np.array([[0, -1]], dtype=np.int64),
        )

        results, _, _ = service.search("nebula", top_k=2, min_score=0.3)

        assert len(results) == 1
        assert results[0]["file_id"] == "f1"


class TestSearchOutOfBoundsIndex:
    """Index beyond id_map length should be silently skipped."""

    def test_out_of_bounds_index_skipped(self, service):
        _patch_encode(service)
        service._index.search.return_value = (
            np.array([[0.9, 0.8]], dtype=np.float32),
            np.array([[0, 999]], dtype=np.int64),
        )

        results, _, _ = service.search("nebula", top_k=2, min_score=0.3)

        assert len(results) == 1
        assert results[0]["file_id"] == "f1"


class TestSearchNoIndex:
    """Search with no index should return empty results immediately."""

    def test_no_index_returns_empty(self):
        with patch.object(EmbeddingService, "_load_index"):
            svc = EmbeddingService()

        svc._index = None
        results, embed_ms, search_ms = svc.search("nebula")

        assert results == []
        assert embed_ms == 0.0
        assert search_ms == 0.0

    def test_empty_index_returns_empty(self):
        with patch.object(EmbeddingService, "_load_index"):
            svc = EmbeddingService()

        svc._index = MagicMock()
        svc._index.ntotal = 0
        results, embed_ms, search_ms = svc.search("nebula")

        assert results == []
        assert embed_ms == 0.0
        assert search_ms == 0.0
