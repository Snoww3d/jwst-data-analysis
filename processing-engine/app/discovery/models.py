"""Pydantic models for the discovery suggestion/recipe engine."""

from pydantic import BaseModel, Field


class ObservationInput(BaseModel):
    """A single observation for recipe generation."""

    filter: str = Field(..., description="Filter name (e.g. F444W)")
    instrument: str = Field(..., description="Instrument name (e.g. NIRCAM)")
    wavelength_um: float | None = Field(default=None, description="Wavelength in micrometers")
    observation_id: str | None = Field(default=None, description="MAST observation ID")
    t_obs_release: float | None = Field(
        default=None,
        description="Data release date in Modified Julian Date. "
        "If set and in the future, the observation is still proprietary.",
    )
    dataproduct_type: str | None = Field(
        default=None,
        description="MAST data product type (e.g. 'image', 'spectrum'). "
        "Spectral observations are excluded from composite recipes.",
    )
    s_ra: float | None = Field(
        default=None, description="Right ascension of observation center (degrees)"
    )
    s_dec: float | None = Field(
        default=None, description="Declination of observation center (degrees)"
    )


class SuggestRecipesRequest(BaseModel):
    """Request for composite recipe suggestions."""

    target_name: str | None = Field(default=None, description="Target name for context")
    observations: list[ObservationInput] | None = Field(
        default=None, description="Observations to generate recipes from"
    )


class TargetInfo(BaseModel):
    """Basic target metadata returned with recipes."""

    name: str | None = None
    common_name: str | None = None
    ra: float | None = None
    dec: float | None = None
    category: str | None = None


class Recipe(BaseModel):
    """A composite recipe suggestion."""

    name: str = Field(..., description="Recipe display name")
    rank: int = Field(..., description="Rank (1 = recommended)")
    filters: list[str] = Field(..., description="Filter names in this recipe")
    color_mapping: dict[str, str] = Field(..., description="Filter name to hex color")
    instruments: list[str] = Field(..., description="Instruments used")
    requires_mosaic: bool = Field(
        default=False,
        description='Whether mosaic is needed (same filter at distinct pointings >10" apart)',
    )
    estimated_time_seconds: int = Field(default=30, description="Estimated processing time")
    observation_ids: list[str] | None = Field(default=None, description="Observation IDs to use")
    description: str | None = Field(
        default=None, description="Short description of what this recipe highlights"
    )
    overlap_warning: str | None = Field(
        default=None, description="Warning about spatial overlap issues in this recipe"
    )


class SuggestRecipesResponse(BaseModel):
    """Response with recipe suggestions."""

    target: TargetInfo | None = None
    recipes: list[Recipe] = Field(default_factory=list)
