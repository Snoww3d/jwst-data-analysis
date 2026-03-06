"""Pydantic models for semantic search API."""

from pydantic import BaseModel, Field


class FileMetadata(BaseModel):
    """Metadata for a single FITS file to embed."""

    file_id: str = Field(..., description="MongoDB document ID")
    target_name: str | None = None
    instrument: str | None = None
    filter_name: str | None = None
    exposure_time: float | None = None
    wavelength_range: str | None = None
    processing_level: str | None = None
    calibration_level: int | None = None
    observation_date: str | None = None
    proposal_pi: str | None = None
    proposal_id: str | None = None
    observation_title: str | None = None
    data_type: str | None = None
    file_name: str | None = None


class EmbedRequest(BaseModel):
    """Request to embed a single file's metadata."""

    metadata: FileMetadata


class EmbedBatchRequest(BaseModel):
    """Request to embed multiple files' metadata."""

    items: list[FileMetadata]


class SearchRequest(BaseModel):
    """Request to search the semantic index."""

    query: str = Field(..., min_length=1, max_length=500)
    top_k: int = Field(default=20, ge=1, le=100)
    min_score: float = Field(default=0.3, ge=0.0, le=1.0)


class SearchResult(BaseModel):
    """A single search result."""

    file_id: str
    score: float
    matched_text: str


class SearchResponse(BaseModel):
    """Response from a semantic search."""

    results: list[SearchResult]
    query: str
    embed_time_ms: float
    search_time_ms: float
    total_indexed: int


class IndexStatus(BaseModel):
    """Status of the semantic index."""

    total_indexed: int
    model_loaded: bool
    index_file_exists: bool
    model_name: str = "all-MiniLM-L6-v2"
    embedding_dim: int = 384


class EmbedResponse(BaseModel):
    """Response from an embed operation."""

    file_id: str
    success: bool
    total_indexed: int


class EmbedBatchResponse(BaseModel):
    """Response from a batch embed operation."""

    embedded_count: int
    total_indexed: int
    errors: list[str] = []
