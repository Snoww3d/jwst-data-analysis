import re
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class MastSearchType(str, Enum):
    TARGET = "target"
    COORDINATES = "coordinates"
    OBSERVATION_ID = "observation_id"
    PROGRAM_ID = "program_id"


_CRITERIA_VALUE_PATTERN = re.compile(r"^[A-Za-z0-9_./*-]+$")
_MAX_CRITERIA_ITEMS = 20

_CALIB_LEVEL_DESCRIPTION = (
    "Calibration levels to include (1=minimally processed, 2=calibrated, "
    "3=combined/mosaic). Default: [3]"
)


def _validate_criteria_values(values: list[str] | None) -> list[str] | None:
    if values is None:
        return None
    if len(values) > _MAX_CRITERIA_ITEMS:
        raise ValueError(f"at most {_MAX_CRITERIA_ITEMS} values allowed")
    for v in values:
        if not _CRITERIA_VALUE_PATTERN.match(v):
            raise ValueError(f"value {v!r} contains invalid characters")
    return values


def _validate_range(value: tuple[float, float] | None) -> tuple[float, float] | None:
    if value is not None and value[0] > value[1]:
        raise ValueError("range lower bound must be <= upper bound")
    return value


class MastCriteria(BaseModel):
    """Whitelisted astroquery ``query_criteria`` filters a client may send.

    Splatted into the MAST query on top of the server-set bounds, so the set
    of keys is closed (``extra='forbid'``): ``pagesize``, ``obs_collection``,
    ``s_ra``/``s_dec``, ``t_obs_release`` and ``calib_level`` are never
    accepted here — an unauthenticated CE client could otherwise override
    the page cap, the JWST collection, the search cone or the
    proprietary-data exclusion. List fields are OR'd by MAST; ``*`` is the
    MAST wildcard.
    """

    model_config = ConfigDict(extra="forbid")

    instrument_name: list[str] | None = None
    filters: list[str] | None = None
    dataproduct_type: list[str] | None = None
    intentType: list[str] | None = None  # raw CAOM column name, mixed case on the wire
    target_classification: list[str] | None = None
    proposal_id: list[str] | None = None
    proposal_pi: list[str] | None = None
    t_min: tuple[float, float] | None = None
    t_max: tuple[float, float] | None = None
    t_exptime: tuple[float, float] | None = None

    @field_validator(
        "instrument_name",
        "filters",
        "dataproduct_type",
        "intentType",
        "target_classification",
        "proposal_id",
        "proposal_pi",
    )
    @classmethod
    def validate_list_values(cls, v: list[str] | None) -> list[str] | None:
        return _validate_criteria_values(v)

    @field_validator("t_min", "t_max", "t_exptime")
    @classmethod
    def validate_ranges(cls, v: tuple[float, float] | None) -> tuple[float, float] | None:
        return _validate_range(v)

    def to_query_criteria(self) -> dict[str, Any]:
        """Only the keys the client actually set, as astroquery expects them."""
        out: dict[str, Any] = {}
        for key, value in self.model_dump(exclude_none=True).items():
            out[key] = list(value) if isinstance(value, tuple) else value
        return out


class MastTargetSearchRequest(BaseModel):
    target_name: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="Target name (e.g., 'NGC 1234', 'Carina Nebula')",
    )
    radius: float = Field(
        default=0.2,
        gt=0,
        le=10.0,
        description="Search radius in degrees (must be > 0, ≤ 10)",
    )
    filters: MastCriteria | None = None
    calib_level: list[int] | None = Field(default=[3], description=_CALIB_LEVEL_DESCRIPTION)


class MastCoordinateSearchRequest(BaseModel):
    ra: float = Field(
        ...,
        ge=0.0,
        le=360.0,
        description="Right Ascension in degrees (0–360)",
    )
    dec: float = Field(
        ...,
        ge=-90.0,
        le=90.0,
        description="Declination in degrees (-90–90)",
    )
    radius: float = Field(
        default=0.2,
        gt=0,
        le=10.0,
        description="Search radius in degrees (must be > 0, ≤ 10)",
    )
    filters: MastCriteria | None = None
    calib_level: list[int] | None = Field(default=[3], description=_CALIB_LEVEL_DESCRIPTION)
    mode: Literal["cone", "box"] = Field(
        default="cone",
        description=(
            "'cone' keeps only observations whose centre lies within `radius` "
            "of (ra, dec); 'box' returns the raw RA/Dec bounding-box hits"
        ),
    )

    @field_validator("mode", mode="before")
    @classmethod
    def default_mode_when_null(cls, v: object) -> object:
        # the .NET tier serialises an unset Mode as JSON null
        return "cone" if v is None else v


class MastObservationSearchRequest(BaseModel):
    obs_id: str = Field(..., min_length=1, max_length=200, description="MAST Observation ID")
    calib_level: list[int] | None = Field(
        default=None,
        description="Calibration levels to include. Default: None (all levels for specific obs lookup)",
    )


class MastProgramSearchRequest(BaseModel):
    program_id: str = Field(
        ..., min_length=1, max_length=50, description="JWST Program/Proposal ID"
    )
    calib_level: list[int] | None = Field(default=[3], description=_CALIB_LEVEL_DESCRIPTION)


class MastSearchResponse(BaseModel):
    search_type: str
    query_params: dict[str, Any]
    results: list[dict[str, Any]]
    result_count: int
    timestamp: str
    # MAST returns at most `page_size` rows per query; `truncated` is set
    # when the raw result saturated that cap, so the client can tell the
    # user to narrow the search instead of trusting the count.
    truncated: bool = False
    page_size: int = 0


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


class S3DownloadRequest(BaseModel):
    """Request to start an S3 download job."""

    obs_id: str = Field(..., description="Observation ID to download")
    product_type: str = Field(default="SCIENCE", description="Product type filter")
    calib_level: list[int] | None = Field(
        default=None,
        description="Calibration levels to download (1, 2, 3). Default: None (all levels)",
    )

    @field_validator("obs_id")
    @classmethod
    def validate_obs_id(cls, v: str) -> str:
        return _validate_obs_id(v)


class MastRecentReleasesRequest(BaseModel):
    """Request for searching recently released JWST observations."""

    days_back: int = Field(default=30, ge=1, le=365, description="Number of days to look back")
    instrument: str | None = Field(
        None, description="Filter by instrument (NIRCAM, MIRI, NIRSPEC, NIRISS)"
    )
    limit: int = Field(default=50, ge=1, le=200, description="Maximum number of results")
    offset: int = Field(default=0, ge=0, description="Offset for pagination")
