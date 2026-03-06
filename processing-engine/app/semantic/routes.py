"""FastAPI routes for semantic search."""

import logging

from fastapi import APIRouter, HTTPException

from .embedding_service import get_embedding_service
from .models import (
    EmbedBatchRequest,
    EmbedBatchResponse,
    EmbedRequest,
    EmbedResponse,
    IndexStatus,
    SearchRequest,
    SearchResponse,
    SearchResult,
)
from .text_builder import build_text


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/semantic", tags=["Semantic Search"])


@router.post("/embed", response_model=EmbedResponse)
def embed_single(request: EmbedRequest) -> EmbedResponse:
    """Embed a single file's metadata into the FAISS index."""
    text = build_text(request.metadata)
    if not text.strip():
        raise HTTPException(status_code=400, detail="No embeddable text from metadata")

    service = get_embedding_service()
    total = service.embed(request.metadata.file_id, text)

    logger.info("Embedded file %s, total indexed: %d", request.metadata.file_id, total)
    return EmbedResponse(
        file_id=request.metadata.file_id,
        success=True,
        total_indexed=total,
    )


@router.post("/embed-batch", response_model=EmbedBatchResponse)
def embed_batch(request: EmbedBatchRequest) -> EmbedBatchResponse:
    """Batch embed multiple files' metadata into the FAISS index."""
    if not request.items:
        raise HTTPException(status_code=400, detail="items list is required")

    # Build texts
    batch: list[tuple[str, str]] = []
    errors: list[str] = []
    for item in request.items:
        text = build_text(item)
        if text.strip():
            batch.append((item.file_id, text))
        else:
            errors.append(f"{item.file_id}: no embeddable text")

    service = get_embedding_service()
    total, encode_errors = service.embed_batch(batch)
    errors.extend(encode_errors)

    # If encoding failed, 0 items were embedded; otherwise all batch items succeeded
    embedded_count = 0 if encode_errors else len(batch)

    logger.info("Batch embedded %d files, total indexed: %d", embedded_count, total)
    return EmbedBatchResponse(
        embedded_count=embedded_count,
        total_indexed=total,
        errors=errors,
    )


@router.post("/search", response_model=SearchResponse)
def search(request: SearchRequest) -> SearchResponse:
    """Search the semantic index with a natural language query."""
    service = get_embedding_service()

    if service.total_indexed == 0:
        return SearchResponse(
            results=[],
            query=request.query,
            embed_time_ms=0,
            search_time_ms=0,
            total_indexed=0,
        )

    results, embed_ms, search_ms = service.search(
        request.query, top_k=request.top_k, min_score=request.min_score
    )

    logger.info(
        "Search '%s': %d results (embed: %.1fms, search: %.1fms)",
        request.query,
        len(results),
        embed_ms,
        search_ms,
    )

    return SearchResponse(
        results=[SearchResult(**r) for r in results],
        query=request.query,
        embed_time_ms=round(embed_ms, 1),
        search_time_ms=round(search_ms, 1),
        total_indexed=service.total_indexed,
    )


@router.get("/index-status", response_model=IndexStatus)
def index_status() -> IndexStatus:
    """Get the status of the semantic index."""
    service = get_embedding_service()
    return IndexStatus(
        total_indexed=service.total_indexed,
        model_loaded=service.model_loaded,
        index_file_exists=service.index_file_exists,
    )
