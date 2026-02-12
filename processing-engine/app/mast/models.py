import re
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class MastSearchType(str, Enum):
    TARGET = "target"
    COORDINATES = "coordinates"
    OBSERVATION_ID = "observation_id"
    PROGRAM_ID = "program_id"


class MastTargetSearchRequest(BaseModel):
    target_name: str = Field(..., description="Target name (e.g., 'NGC 1234', 'Carina Nebula')")
    radius: float = Field(default=0.2, description="Search radius in degrees")
    filters: dict[str, Any] | None = None
    calib_level: list[int] | None = Field(
        default=[3],
        description="Calibration levels to include (1=minimally processed, 2=calibrated, 3=combined/mosaic). Default: [3]",
    )


class MastCoordinateSearchRequest(BaseModel):
    ra: float = Field(..., description="Right Ascension in degrees")
    dec: float = Field(..., description="Declination in degrees")
    radius: float = Field(default=0.2, description="Search radius in degrees")
    calib_level: list[int] | None = Field(
        default=[3],
        description="Calibration levels to include (1=minimally processed, 2=calibrated, 3=combined/mosaic). Default: [3]",
    )


class MastObservationSearchRequest(BaseModel):
    obs_id: str = Field(..., description="MAST Observation ID")
    calib_level: list[int] | None = Field(
        default=None,
        description="Calibration levels to include. Default: None (all levels for specific obs lookup)",
    )


class MastProgramSearchRequest(BaseModel):
    program_id: str = Field(..., description="JWST Program/Proposal ID")
    calib_level: list[int] | None = Field(
        default=[3],
        description="Calibration levels to include (1=minimally processed, 2=calibrated, 3=combined/mosaic). Default: [3]",
    )


class MastSearchResponse(BaseModel):
    search_type: str
    query_params: dict[str, Any]
    results: list[dict[str, Any]]
    result_count: int
    timestamp: str


_SAFE_OBS_ID_PATTERN = re.compile(r"^[a-zA-Z0-9._-]+$")


def _validate_obs_id(v: str) -> str:
    if not _SAFE_OBS_ID_PATTERN.match(v):
        raise ValueError("obs_id contains invalid characters")
    return v


class MastDownloadRequest(BaseModel):
    obs_id: str = Field(..., description="Observation ID to download")
    product_type: str = Field(default="SCIENCE", description="Product type filter")
    product_id: str | None = Field(None, description="Specific product ID (optional)")

    @field_validator("obs_id")
    @classmethod
    def validate_obs_id(cls, v: str) -> str:
        return _validate_obs_id(v)


class MastDownloadResponse(BaseModel):
    status: str
    obs_id: str
    files: list[str] = []
    file_count: int = 0
    download_dir: str | None = None
    error: str | None = None
    timestamp: str


class MastDataProductsRequest(BaseModel):
    obs_id: str = Field(..., description="Observation ID")


class MastDataProductsResponse(BaseModel):
    obs_id: str
    products: list[dict[str, Any]]
    product_count: int


# === Chunked Download Models ===


class ChunkedDownloadRequest(BaseModel):
    """Request to start a chunked download job."""

    obs_id: str = Field(..., description="Observation ID to download")
    product_type: str = Field(default="SCIENCE", description="Product type filter")
    resume_job_id: str | None = Field(None, description="Job ID to resume (if resuming)")
    calib_level: list[int] | None = Field(
        default=None,
        description="Calibration levels to download (1, 2, 3). Default: None (all levels)",
    )

    @field_validator("obs_id")
    @classmethod
    def validate_obs_id(cls, v: str) -> str:
        return _validate_obs_id(v)


class FileProgressResponse(BaseModel):
    """Progress information for a single file."""

    filename: str
    total_bytes: int = 0
    downloaded_bytes: int = 0
    progress_percent: float = 0.0
    status: str = "pending"


class ChunkedDownloadProgressResponse(BaseModel):
    """Enhanced progress response with byte-level tracking."""

    job_id: str
    obs_id: str
    stage: str
    message: str
    progress: int = 0  # 0-100, file-level progress
    total_files: int = 0
    downloaded_files: int = 0
    current_file: str | None = None
    files: list[str] = []  # Completed file paths
    error: str | None = None
    started_at: str
    completed_at: str | None = None
    download_dir: str | None = None
    is_complete: bool = False
    # Byte-level progress
    total_bytes: int = 0
    downloaded_bytes: int = 0
    download_progress_percent: float = 0.0
    speed_bytes_per_sec: float = 0.0
    eta_seconds: float | None = None
    file_progress: list[FileProgressResponse] = []
    is_resumable: bool = False


class ResumableJobSummary(BaseModel):
    """Summary of a resumable download job."""

    job_id: str
    obs_id: str
    total_bytes: int = 0
    downloaded_bytes: int = 0
    progress_percent: float = 0.0
    status: str
    total_files: int = 0
    completed_files: int = 0
    started_at: str | None = None


class ResumableJobsResponse(BaseModel):
    """Response listing resumable jobs."""

    jobs: list[ResumableJobSummary]
    count: int


class PauseResumeResponse(BaseModel):
    """Response for pause/resume operations."""

    job_id: str
    status: str
    message: str


class MastRecentReleasesRequest(BaseModel):
    """Request for searching recently released JWST observations."""

    days_back: int = Field(default=30, ge=1, le=365, description="Number of days to look back")
    instrument: str | None = Field(
        None, description="Filter by instrument (NIRCAM, MIRI, NIRSPEC, NIRISS)"
    )
    limit: int = Field(default=50, ge=1, le=200, description="Maximum number of results")
    offset: int = Field(default=0, ge=0, description="Offset for pagination")
