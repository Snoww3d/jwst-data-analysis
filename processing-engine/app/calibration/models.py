# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""CalibrationRecipe models (collection ``calibration_recipes``).

Named "CalibrationRecipe" to avoid colliding with the discovery ``Recipe``
(composite color suggestions, ``app/discovery/models.py``). Documents are
snake_case (Python-native collection, like ``jobs``).

The security-load-bearing invariant lives in ``step_overrides``: values are
restricted to scalars (or flat scalar lists), so a recipe carries no
executable behavior. NOTE: scalar strings can still be file paths (e.g. the
jwst ``override_<ref>`` step params) — the PR 5 executor must allowlist step
and parameter NAMES and reject/scope path-valued params before passing
overrides to ``Pipeline.call``.
"""

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, field_validator


SCHEMA_VERSION = 1

# Association rules the executor will instantiate (asn_from_list). Extend
# deliberately; anything not listed here is rejected at validation time.
ALLOWED_ASSOCIATION_RULES = ("DMS_Level3_Base",)

# Stage names in execution order. coron3 is schema-reserved for Phase 2; the
# executor rejects it until Coron3 support lands.
STAGE_NAMES = ("detector1", "image2", "image3", "coron3")

Scalar = str | int | float | bool | None


def _is_scalar(value: Any) -> bool:
    return value is None or isinstance(value, str | int | float | bool)


class StageConfig(BaseModel):
    name: Literal["detector1", "image2", "image3", "coron3"]
    enabled: bool = True
    # {step_name: {param_name: scalar-or-flat-scalar-list}}
    step_overrides: dict[str, dict[str, Any]] = Field(default_factory=dict)

    @field_validator("step_overrides")
    @classmethod
    def _scalars_only(cls, overrides: dict) -> dict:
        for step, params in overrides.items():
            if not isinstance(params, dict):
                raise ValueError(f"step '{step}': overrides must be a mapping")
            for param, value in params.items():
                if isinstance(value, list):
                    if not all(_is_scalar(item) for item in value):
                        raise ValueError(
                            f"step '{step}' param '{param}': list values must contain only scalars"
                        )
                elif not _is_scalar(value):
                    raise ValueError(
                        f"step '{step}' param '{param}': only scalar values "
                        "(str/int/float/bool/null) or flat scalar lists are allowed"
                    )
        return overrides


class MastQueryInput(BaseModel):
    type: Literal["mast_query"] = "mast_query"
    proposal_id: str = Field(pattern=r"^\d{1,6}$")
    observation: str | None = None
    filters: list[str] = Field(default_factory=list)
    calib_level: Literal[1, 2] = 1
    product_suffixes: list[str] = Field(default_factory=lambda: ["_uncal"])


class LibraryProductsInput(BaseModel):
    type: Literal["library_products"] = "library_products"
    # Concrete files are picked at run time from the user's library.
    product_suffixes: list[str] = Field(default_factory=lambda: ["_cal"])


InputSource = Annotated[MastQueryInput | LibraryProductsInput, Field(discriminator="type")]


class InputRole(BaseModel):
    role: Literal["science", "psf_ref", "background"] = "science"
    required: bool = True
    min_count: int = Field(default=1, ge=1)


class Provenance(BaseModel):
    notebook_name: str | None = None
    jwst_version_authored: str | None = None


class Association(BaseModel):
    rule: Literal["DMS_Level3_Base"] = "DMS_Level3_Base"
    product_name: str = "calibrated"

    @field_validator("product_name")
    @classmethod
    def _sanitize_product_name(cls, name: str) -> str:
        cleaned = name.strip()
        if not cleaned or len(cleaned) > 80:
            raise ValueError("product_name must be 1-80 characters")
        if not all((ch.isascii() and ch.isalnum()) or ch in "-_" for ch in cleaned):
            raise ValueError("product_name may contain only letters, digits, '-' and '_'")
        return cleaned


class CalibrationRecipe(BaseModel):
    id: str
    schema_version: int = SCHEMA_VERSION
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    instrument: Literal["nircam", "niriss", "miri"]
    mode: Literal["imaging", "coronagraphy"] = "imaging"
    source: Literal["seed", "imported", "user"] = "user"
    # Visibility follows the documented data model: user content is private
    # until explicitly shared. Seeds are always public.
    is_public: bool = False
    provenance: Provenance = Field(default_factory=Provenance)
    input_source: InputSource
    input_roles: list[InputRole] = Field(default_factory=lambda: [InputRole()])
    stages: list[StageConfig]
    association: Association = Field(default_factory=Association)
    output_suffixes: list[str] = Field(default_factory=lambda: ["_i2d"])
    created_by: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_validator("stages")
    @classmethod
    def _stages_ordered_unique(cls, stages: list[StageConfig]) -> list[StageConfig]:
        if not stages:
            raise ValueError("a recipe needs at least one stage")
        names = [stage.name for stage in stages]
        if len(set(names)) != len(names):
            raise ValueError("duplicate stage names")
        order = [STAGE_NAMES.index(n) for n in names]
        if order != sorted(order):
            raise ValueError(f"stages must be in pipeline order {STAGE_NAMES}")
        return stages

    def to_document(self) -> dict[str, Any]:
        return self.model_dump(mode="json")
