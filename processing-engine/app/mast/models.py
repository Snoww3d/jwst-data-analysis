from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional
from enum import Enum


class MastSearchType(str, Enum):
    TARGET = "target"
    COORDINATES = "coordinates"
    OBSERVATION_ID = "observation_id"
    PROGRAM_ID = "program_id"


class MastTargetSearchRequest(BaseModel):
    target_name: str = Field(..., description="Target name (e.g., 'NGC 1234', 'Carina Nebula')")
    radius: float = Field(default=0.2, description="Search radius in degrees")
    filters: Optional[Dict[str, Any]] = None


class MastCoordinateSearchRequest(BaseModel):
    ra: float = Field(..., description="Right Ascension in degrees")
    dec: float = Field(..., description="Declination in degrees")
    radius: float = Field(default=0.2, description="Search radius in degrees")


class MastObservationSearchRequest(BaseModel):
    obs_id: str = Field(..., description="MAST Observation ID")


class MastProgramSearchRequest(BaseModel):
    program_id: str = Field(..., description="JWST Program/Proposal ID")


class MastSearchResponse(BaseModel):
    search_type: str
    query_params: Dict[str, Any]
    results: List[Dict[str, Any]]
    result_count: int
    timestamp: str


class MastDownloadRequest(BaseModel):
    obs_id: str = Field(..., description="Observation ID to download")
    product_type: str = Field(default="SCIENCE", description="Product type filter")
    product_id: Optional[str] = Field(None, description="Specific product ID (optional)")


class MastDownloadResponse(BaseModel):
    status: str
    obs_id: str
    files: List[str] = []
    file_count: int = 0
    download_dir: Optional[str] = None
    error: Optional[str] = None
    timestamp: str


class MastDataProductsRequest(BaseModel):
    obs_id: str = Field(..., description="Observation ID")


class MastDataProductsResponse(BaseModel):
    obs_id: str
    products: List[Dict[str, Any]]
    product_count: int


# === Chunked Download Models ===

class ChunkedDownloadRequest(BaseModel):
    """Request to start a chunked download job."""
    obs_id: str = Field(..., description="Observation ID to download")
    product_type: str = Field(default="SCIENCE", description="Product type filter")
    resume_job_id: Optional[str] = Field(None, description="Job ID to resume (if resuming)")


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
    current_file: Optional[str] = None
    files: List[str] = []  # Completed file paths
    error: Optional[str] = None
    started_at: str
    completed_at: Optional[str] = None
    download_dir: Optional[str] = None
    is_complete: bool = False
    # Byte-level progress
    total_bytes: int = 0
    downloaded_bytes: int = 0
    download_progress_percent: float = 0.0
    speed_bytes_per_sec: float = 0.0
    eta_seconds: Optional[float] = None
    file_progress: List[FileProgressResponse] = []
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
    started_at: Optional[str] = None


class ResumableJobsResponse(BaseModel):
    """Response listing resumable jobs."""
    jobs: List[ResumableJobSummary]
    count: int


class PauseResumeResponse(BaseModel):
    """Response for pause/resume operations."""
    job_id: str
    status: str
    message: str
