"""ONNX-based embedding service with FAISS vector store.

- Model: all-MiniLM-L6-v2 via sentence-transformers (ONNX export)
- Vector store: FAISS flat L2 index, file-backed
- Thread-safe via threading.Lock
- Lazy model loading on first use
"""

import json
import logging
import os
import threading
import time

import faiss
import numpy as np


logger = logging.getLogger(__name__)

# Defaults
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_DIM = 384
DATA_DIR = os.environ.get("SEMANTIC_DATA_DIR", "/app/data/semantic")
INDEX_PATH = os.path.join(DATA_DIR, "faiss.index")
ID_MAP_PATH = os.path.join(DATA_DIR, "id_map.json")


class EmbeddingService:
    """Manages embedding model and FAISS index."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._model = None
        self._tokenizer = None
        self._index: faiss.IndexFlatIP | None = None
        # Maps FAISS integer position → (file_id, text)
        self._id_map: list[dict] = []
        self._model_loaded = False

        # Load existing index if available
        self._load_index()

    def _ensure_model(self) -> None:
        """Lazy-load the ONNX model on first use."""
        if self._model_loaded:
            return

        logger.info("Loading embedding model %s (first use)...", MODEL_NAME)
        start = time.time()

        from sentence_transformers import SentenceTransformer

        self._model = SentenceTransformer(MODEL_NAME, backend="onnx")

        elapsed = time.time() - start
        logger.info("Model loaded in %.1fs", elapsed)
        self._model_loaded = True

    def _load_index(self) -> None:
        """Load FAISS index and ID map from disk if they exist."""
        if os.path.exists(INDEX_PATH) and os.path.exists(ID_MAP_PATH):
            try:
                self._index = faiss.read_index(INDEX_PATH)
                with open(ID_MAP_PATH) as f:
                    self._id_map = json.load(f)
                logger.info("Loaded FAISS index with %d vectors", self._index.ntotal)
            except Exception:
                logger.warning("Failed to load existing index, starting fresh", exc_info=True)
                self._index = None
                self._id_map = []

    def _save_index(self) -> None:
        """Persist FAISS index and ID map to disk."""
        if self._index is None:
            return

        os.makedirs(DATA_DIR, exist_ok=True)
        faiss.write_index(self._index, INDEX_PATH)
        with open(ID_MAP_PATH, "w") as f:
            json.dump(self._id_map, f)

    def _get_or_create_index(self) -> faiss.IndexFlatIP:
        """Get existing index or create a new one."""
        if self._index is None:
            # Inner product on L2-normalized vectors = cosine similarity
            self._index = faiss.IndexFlatIP(EMBEDDING_DIM)
        return self._index

    def _encode(self, texts: list[str]) -> np.ndarray:
        """Encode texts to normalized embeddings."""
        self._ensure_model()
        embeddings = self._model.encode(texts, normalize_embeddings=True)
        return np.array(embeddings, dtype=np.float32)

    def embed(self, file_id: str, text: str) -> int:
        """Embed a single text and add to index. Returns total indexed count."""
        with self._lock:
            index = self._get_or_create_index()

            # Remove existing entry for this file_id (re-embed case)
            self._remove_by_file_id(file_id)

            embedding = self._encode([text])
            index.add(embedding)
            self._id_map.append({"file_id": file_id, "text": text})
            self._save_index()

            return index.ntotal

    def embed_batch(self, items: list[tuple[str, str]]) -> tuple[int, list[str]]:
        """Embed multiple (file_id, text) pairs. Returns (total_indexed, errors)."""
        if not items:
            return self.total_indexed, []

        errors: list[str] = []
        with self._lock:
            index = self._get_or_create_index()

            # Remove existing entries for these file_ids
            file_ids = {fid for fid, _ in items}
            self._remove_by_file_ids(file_ids)

            texts = [text for _, text in items]
            try:
                embeddings = self._encode(texts)
            except Exception as e:
                return index.ntotal, [f"Encoding failed: {e}"]

            index.add(embeddings)
            for file_id, text in items:
                self._id_map.append({"file_id": file_id, "text": text})

            self._save_index()
            return index.ntotal, errors

    def search(
        self, query: str, top_k: int = 20, min_score: float = 0.3
    ) -> tuple[list[dict], float, float]:
        """Search the index. Returns (results, embed_time_ms, search_time_ms)."""
        with self._lock:
            if self._index is None or self._index.ntotal == 0:
                return [], 0.0, 0.0

            # Embed query
            t0 = time.time()
            query_embedding = self._encode([query])
            embed_ms = (time.time() - t0) * 1000

            # Search
            t1 = time.time()
            # Clamp top_k to available vectors
            k = min(top_k, self._index.ntotal)
            scores, indices = self._index.search(query_embedding, k)
            search_ms = (time.time() - t1) * 1000

            results = []
            for score, idx in zip(scores[0], indices[0], strict=True):
                if idx < 0 or score < min_score:
                    continue
                if idx < len(self._id_map):
                    entry = self._id_map[idx]
                    results.append(
                        {
                            "file_id": entry["file_id"],
                            "score": float(score),
                            "matched_text": entry["text"],
                        }
                    )

            return results, embed_ms, search_ms

    def _remove_by_file_id(self, file_id: str) -> None:
        """Remove a single file_id from the index (must hold lock)."""
        self._remove_by_file_ids({file_id})

    def _remove_by_file_ids(self, file_ids: set[str]) -> None:
        """Remove entries by file_id and rebuild index (must hold lock).

        FAISS IndexFlatIP doesn't support removal, so we rebuild.
        This is fine for our scale (<10k vectors).
        """
        if not file_ids or self._index is None or self._index.ntotal == 0:
            return

        # Check if any of the file_ids are actually in the index
        existing_ids = {entry["file_id"] for entry in self._id_map}
        to_remove = file_ids & existing_ids
        if not to_remove:
            return

        # Rebuild: keep entries not in the removal set
        keep = [
            (i, entry) for i, entry in enumerate(self._id_map) if entry["file_id"] not in to_remove
        ]

        if not keep:
            self._index = faiss.IndexFlatIP(EMBEDDING_DIM)
            self._id_map = []
            return

        # Extract kept vectors from current index
        kept_indices = [i for i, _ in keep]
        vectors = np.array(
            [self._index.reconstruct(i) for i in kept_indices],
            dtype=np.float32,
        )

        new_index = faiss.IndexFlatIP(EMBEDDING_DIM)
        new_index.add(vectors)
        self._index = new_index
        self._id_map = [entry for _, entry in keep]

    @property
    def total_indexed(self) -> int:
        """Number of vectors in the index."""
        if self._index is None:
            return 0
        return self._index.ntotal

    @property
    def model_loaded(self) -> bool:
        """Whether the embedding model has been loaded."""
        return self._model_loaded

    @property
    def index_file_exists(self) -> bool:
        """Whether the index file exists on disk."""
        return os.path.exists(INDEX_PATH)


# Module-level singleton
_service: EmbeddingService | None = None
_service_lock = threading.Lock()


def get_embedding_service() -> EmbeddingService:
    """Get or create the singleton EmbeddingService."""
    global _service
    if _service is None:
        with _service_lock:
            if _service is None:
                _service = EmbeddingService()
    return _service
