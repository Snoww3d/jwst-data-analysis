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


class TestEnsureModelRetry:
    """_ensure_model retries transient failures before giving up (#1102)."""

    def _make_svc(self):
        with patch.object(EmbeddingService, "_load_index"):
            return EmbeddingService()

    def test_succeeds_on_second_attempt(self):
        svc = self._make_svc()
        # First call raises a transient OSError; second succeeds.
        sentinel_model = MagicMock()
        mock_ctor = MagicMock(side_effect=[OSError("network blip"), sentinel_model])

        with (
            patch("sentence_transformers.SentenceTransformer", mock_ctor),
            patch("time.sleep"),  # don't actually wait the backoff
        ):
            svc._ensure_model()

        assert svc._model_loaded is True
        assert svc._model is sentinel_model
        assert mock_ctor.call_count == 2

    def test_raises_after_max_retries(self):
        svc = self._make_svc()
        mock_ctor = MagicMock(side_effect=OSError("permanent network failure"))

        with (
            patch("sentence_transformers.SentenceTransformer", mock_ctor),
            patch("time.sleep"),
            pytest.raises(OSError, match="permanent network failure"),
        ):
            svc._ensure_model()

        # Three attempts per _MODEL_LOAD_MAX_RETRIES.
        assert mock_ctor.call_count == 3
        assert svc._model_loaded is False

    def test_no_op_when_already_loaded(self):
        svc = self._make_svc()
        svc._model_loaded = True
        mock_ctor = MagicMock()

        with patch("sentence_transformers.SentenceTransformer", mock_ctor):
            svc._ensure_model()

        # Never even tried to construct — fast-path hit.
        mock_ctor.assert_not_called()


class TestModelLoadOutsideFaissLock:
    """Model loading must not hold the FAISS index lock (#1524).

    `_ensure_model` runs a bounded retry loop with `time.sleep()` backoff
    (#1102). If that ran while `self._lock` was held, a transient HuggingFace
    rate-limit on first use would stall every concurrent embed/search call for
    the full backoff window — a service-wide availability outage.
    """

    def _make_svc(self):
        with patch.object(EmbeddingService, "_load_index"):
            return EmbeddingService()

    def test_faiss_lock_not_held_during_model_load(self):
        svc = self._make_svc()
        svc._save_index = MagicMock()  # avoid disk writes
        lock_states: list[bool] = []

        def fake_ctor(*_args, **_kwargs):
            # Record whether the FAISS lock is held at the moment the (slow,
            # retrying) model load runs. It must not be.
            lock_states.append(svc._lock.locked())
            model = MagicMock()
            model.encode.return_value = np.zeros((1, 384), dtype=np.float32)
            return model

        with patch("sentence_transformers.SentenceTransformer", side_effect=fake_ctor):
            svc.embed("f1", "hello world")

        assert lock_states == [False], (
            "FAISS lock must not be held while the embedding model loads (#1524)"
        )

    def test_embed_batch_load_failure_returns_errors_not_raises(self):
        """A transient OSError model-load failure must surface as the errors
        list, not propagate as a 500 (#1524 error-contract preservation)."""
        svc = self._make_svc()
        svc._save_index = MagicMock()
        mock_ctor = MagicMock(side_effect=OSError("rate limited"))

        with (
            patch("sentence_transformers.SentenceTransformer", mock_ctor),
            patch("time.sleep"),  # don't wait the backoff
        ):
            total, errors = svc.embed_batch([("f1", "hello world")])

        assert total == 0
        assert len(errors) == 1
        assert "Model load failed" in errors[0]
        assert svc._model_loaded is False

    def test_concurrent_callers_load_model_once(self):
        """Double-checked locking: many threads contend, exactly one ctor call.

        `fake_ctor` blocks until every worker has reached `_ensure_model`, so
        multiple threads provably pass the lock-free outer check before the
        winner finishes — forcing the inner re-check branch to execute.
        """
        import threading
        import time as _time

        svc = self._make_svc()
        svc._save_index = MagicMock()
        ctor_calls = []
        all_arrived = threading.Barrier(8)

        def fake_ctor(*_args, **_kwargs):
            ctor_calls.append(1)
            # Hold the model-load lock briefly so the other workers (released
            # together by the barrier) pile up on it and exercise the inner
            # double-checked re-check branch rather than the fast path.
            _time.sleep(0.05)
            model = MagicMock()
            model.encode.return_value = np.zeros((1, 384), dtype=np.float32)
            return model

        def worker():
            # Ensure all 8 threads are running and have passed the outer
            # `if self._model_loaded` check (still False) before any one
            # acquires the model-load lock and constructs the model.
            all_arrived.wait(timeout=5)
            svc.embed("f1", "hello world")

        with patch("sentence_transformers.SentenceTransformer", side_effect=fake_ctor):
            threads = [threading.Thread(target=worker) for _ in range(8)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

        assert len(ctor_calls) == 1, "model should be constructed exactly once"
        assert svc._model_loaded is True
