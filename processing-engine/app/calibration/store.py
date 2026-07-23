# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""Recipe persistence (collection ``calibration_recipes``) + seed loader."""

import json
import logging
from pathlib import Path
from typing import Any

from motor.motor_asyncio import AsyncIOMotorCollection

from app.calibration.models import CalibrationRecipe


logger = logging.getLogger(__name__)

COLLECTION_NAME = "calibration_recipes"
SEEDS_DIR = Path(__file__).parent / "seeds"


class RecipeStore:
    def __init__(self, collection: AsyncIOMotorCollection):
        self._col = collection

    async def ensure_indexes(self) -> None:
        await self._col.create_index("id", unique=True)

    async def list_visible(self, user_id: str | None) -> list[dict[str, Any]]:
        """Seeds and public recipes for everyone; private recipes only for
        their owner. Capped at 500 (documented; pagination when the gallery
        ever approaches that)."""
        visible: list[dict[str, Any]] = [{"source": "seed"}, {"is_public": True}]
        if user_id is not None:
            visible.append({"created_by": user_id})
        return (
            await self._col.find({"$or": visible}, {"_id": 0}).sort("name", 1).to_list(length=500)
        )

    async def get(self, recipe_id: str) -> dict[str, Any] | None:
        return await self._col.find_one({"id": recipe_id}, {"_id": 0})

    async def upsert(self, recipe: CalibrationRecipe) -> None:
        await self._col.replace_one({"id": recipe.id}, recipe.to_document(), upsert=True)

    async def delete(self, recipe_id: str) -> bool:
        result = await self._col.delete_one({"id": recipe_id})
        return result.deleted_count == 1

    async def seed(self) -> int:
        """Idempotently load the curated seed recipes. Seeds always overwrite
        their own ids (curated content is code-owned), never user recipes."""
        await self.ensure_indexes()
        count = 0
        for path in sorted(SEEDS_DIR.glob("*.json")):
            try:
                recipe = CalibrationRecipe.model_validate(
                    json.loads(path.read_text(encoding="utf-8"))
                )
                if recipe.source != "seed" or not recipe.id.startswith("seed-"):
                    raise ValueError("seed files must have source=seed and a seed- id")
                await self.upsert(recipe)
                count += 1
            except Exception:
                # One bad seed must not block the rest of the gallery.
                logger.exception("Failed to load seed recipe %s", path.name)
        logger.info("Seeded %d calibration recipes", count)
        return count
