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
