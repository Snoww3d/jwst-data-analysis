# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Tests for the CalibrationRecipe schema, seed loader, and /api/calibration
CRUD routes: scalar-only validation ("pure data, never code"), stage
ordering, seed immutability, ownership, and verbatim wire shape.
"""

import json
import time
import uuid

import httpx
import jwt as pyjwt
import pytest
from pydantic import ValidationError

from app.calibration.models import CalibrationRecipe, StageConfig
from app.calibration.routes import get_recipe_store
from app.calibration.store import SEEDS_DIR, RecipeStore
from app.db.client import get_database, reset_client


SECRET = "unit-test-secret-key-at-least-32-chars!!"
ROLE_URI = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role"
USER = "user-a"
OTHER = "user-b"


@pytest.fixture(autouse=True)
def _jwt_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET_KEY", SECRET)


def bearer(user_id: str, role: str = "User") -> dict[str, str]:
    now = int(time.time())
    token = pyjwt.encode(
        {
            "sub": user_id,
            ROLE_URI: role,
            "iss": "JwstDataAnalysis",
            "aud": "JwstDataAnalysisClient",
            "iat": now,
            "exp": now + 900,
        },
        SECRET,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


def recipe_payload(**overrides) -> dict:
    payload = {
        "id": "test-recipe",
        "name": "Test recipe",
        "instrument": "miri",
        "input_source": {"type": "library_products", "product_suffixes": ["_cal"]},
        "stages": [{"name": "image3", "enabled": True, "step_overrides": {}}],
    }
    payload.update(overrides)
    return payload


class TestSchemaValidation:
    def test_minimal_recipe_validates(self) -> None:
        recipe = CalibrationRecipe.model_validate(recipe_payload())
        assert recipe.schema_version == 1
        assert recipe.output_suffixes == ["_i2d"]

    def test_scalar_overrides_accepted(self) -> None:
        stage = StageConfig(
            name="detector1",
            step_overrides={
                "jump": {
                    "maximum_cores": "half",
                    "expand_large_events": True,
                    "rejection_threshold": 5.0,
                    "flag_4_neighbors": None,
                },
                "tweakreg": {"searchrad": [1.0, 2.0]},
            },
        )
        assert stage.step_overrides["jump"]["maximum_cores"] == "half"

    @pytest.mark.parametrize(
        "bad_value",
        [
            {"nested": "dict"},
            [{"list": "of dicts"}],
            [["nested", "list"]],
        ],
    )
    def test_non_scalar_override_values_rejected(self, bad_value) -> None:
        with pytest.raises(ValidationError):
            StageConfig(name="image3", step_overrides={"resample": {"p": bad_value}})

    def test_unknown_stage_rejected(self) -> None:
        with pytest.raises(ValidationError):
            CalibrationRecipe.model_validate(
                recipe_payload(stages=[{"name": "spec2", "enabled": True}])
            )

    def test_unknown_association_rule_rejected(self) -> None:
        with pytest.raises(ValidationError):
            CalibrationRecipe.model_validate(
                recipe_payload(association={"rule": "EvalRule", "product_name": "x"})
            )

    @pytest.mark.parametrize("bad_name", ["../etc/passwd", "a b", "x" * 81, ""])
    def test_product_name_sanitized(self, bad_name) -> None:
        with pytest.raises(ValidationError):
            CalibrationRecipe.model_validate(
                recipe_payload(association={"rule": "DMS_Level3_Base", "product_name": bad_name})
            )

    def test_out_of_order_stages_rejected(self) -> None:
        with pytest.raises(ValidationError):
            CalibrationRecipe.model_validate(
                recipe_payload(
                    stages=[
                        {"name": "image3", "enabled": True},
                        {"name": "detector1", "enabled": True},
                    ]
                )
            )

    def test_duplicate_stages_rejected(self) -> None:
        with pytest.raises(ValidationError):
            CalibrationRecipe.model_validate(
                recipe_payload(
                    stages=[
                        {"name": "image3", "enabled": True},
                        {"name": "image3", "enabled": False},
                    ]
                )
            )

    def test_empty_stages_rejected(self) -> None:
        with pytest.raises(ValidationError):
            CalibrationRecipe.model_validate(recipe_payload(stages=[]))


class TestSeeds:
    def test_all_seed_files_validate(self) -> None:
        seed_paths = sorted(SEEDS_DIR.glob("*.json"))
        assert len(seed_paths) == 3
        for path in seed_paths:
            recipe = CalibrationRecipe.model_validate(json.loads(path.read_text(encoding="utf-8")))
            assert recipe.source == "seed"
            assert recipe.id.startswith("seed-")
            assert recipe.mode == "imaging"
            assert recipe.output_suffixes == ["_i2d"]


@pytest.fixture()
async def store():
    reset_client()
    collection = get_database()[f"recipes_test_{uuid.uuid4().hex}"]
    yield RecipeStore(collection)
    await collection.drop()
    reset_client()


@pytest.fixture()
async def client(store: RecipeStore):
    from main import app

    app.dependency_overrides[get_recipe_store] = lambda: store
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as async_client:
            yield async_client
    finally:
        app.dependency_overrides.pop(get_recipe_store, None)


class TestSeederAndStore:
    async def test_seed_is_idempotent(self, store: RecipeStore) -> None:
        assert await store.seed() == 3
        assert await store.seed() == 3
        recipes = await store.list_visible(None)
        assert len(recipes) == 3
        assert {r["id"] for r in recipes} == {
            "seed-miri-imaging",
            "seed-nircam-imaging",
            "seed-niriss-imaging",
        }

    async def test_seed_roundtrip_preserves_overrides(self, store: RecipeStore) -> None:
        await store.seed()
        doc = await store.get("seed-nircam-imaging")
        det1 = next(s for s in doc["stages"] if s["name"] == "detector1")
        assert det1["step_overrides"]["jump"] == {
            "maximum_cores": "half",
            "expand_large_events": True,
        }
        # Round-trip through the model must not alter the document.
        assert CalibrationRecipe.model_validate(doc).to_document() == doc


class TestRoutes:
    async def test_list_and_get_are_anonymous(
        self, client: httpx.AsyncClient, store: RecipeStore
    ) -> None:
        await store.seed()
        listing = await client.get("/api/calibration/recipes")
        assert listing.status_code == 200
        assert len(listing.json()["recipes"]) == 3

        one = await client.get("/api/calibration/recipes/seed-miri-imaging")
        assert one.status_code == 200
        # Wire is verbatim: jwst identifiers keep their snake_case names.
        image2 = next(s for s in one.json()["stages"] if s["name"] == "image2")
        assert image2["step_overrides"] == {"bkg_subtract": {"sigma": 2}}
        assert "schema_version" in one.json()

    async def test_get_unknown_recipe_is_404(self, client: httpx.AsyncClient) -> None:
        response = await client.get("/api/calibration/recipes/nope")
        assert response.status_code == 404

    async def test_create_requires_auth(self, client: httpx.AsyncClient) -> None:
        response = await client.post("/api/calibration/recipes", json=recipe_payload())
        assert response.status_code == 401

    async def test_create_forces_identity_fields(self, client: httpx.AsyncClient) -> None:
        payload = recipe_payload(id="seed-evil", source="seed", created_by="someone")
        response = await client.post("/api/calibration/recipes", json=payload, headers=bearer(USER))
        assert response.status_code == 201
        body = response.json()
        assert body["id"].startswith("user-")
        assert body["source"] == "user"
        assert body["created_by"] == USER

    async def test_create_rejects_non_scalar_overrides(self, client: httpx.AsyncClient) -> None:
        payload = recipe_payload(
            stages=[
                {
                    "name": "image3",
                    "enabled": True,
                    "step_overrides": {"resample": {"hook": {"evil": "dict"}}},
                }
            ]
        )
        response = await client.post("/api/calibration/recipes", json=payload, headers=bearer(USER))
        assert response.status_code == 422

    async def test_seed_recipes_are_immutable(
        self, client: httpx.AsyncClient, store: RecipeStore
    ) -> None:
        await store.seed()
        update = await client.put(
            "/api/calibration/recipes/seed-miri-imaging",
            json=recipe_payload(),
            headers=bearer(USER, role="Admin"),
        )
        assert update.status_code == 403
        delete = await client.delete(
            "/api/calibration/recipes/seed-miri-imaging",
            headers=bearer(USER, role="Admin"),
        )
        assert delete.status_code == 403

    async def test_private_recipes_hidden_from_others(
        self, client: httpx.AsyncClient, store: RecipeStore
    ) -> None:
        await store.seed()
        created = await client.post(
            "/api/calibration/recipes", json=recipe_payload(), headers=bearer(OTHER)
        )
        recipe_id = created.json()["id"]
        assert created.json()["is_public"] is False

        # Anonymous and foreign users see only the seeds in the list...
        for headers in ({}, bearer(USER)):
            listing = await client.get("/api/calibration/recipes", headers=headers)
            assert {r["id"] for r in listing.json()["recipes"]} == {
                "seed-miri-imaging",
                "seed-nircam-imaging",
                "seed-niriss-imaging",
            }
            # ...and a direct fetch of the private recipe is a 404.
            got = await client.get(f"/api/calibration/recipes/{recipe_id}", headers=headers)
            assert got.status_code == 404

        # The owner sees it in both.
        own_list = await client.get("/api/calibration/recipes", headers=bearer(OTHER))
        assert recipe_id in {r["id"] for r in own_list.json()["recipes"]}
        assert (
            await client.get(f"/api/calibration/recipes/{recipe_id}", headers=bearer(OTHER))
        ).status_code == 200

    async def test_public_recipe_visible_to_everyone(self, client: httpx.AsyncClient) -> None:
        created = await client.post(
            "/api/calibration/recipes",
            json=recipe_payload(is_public=True),
            headers=bearer(OTHER),
        )
        recipe_id = created.json()["id"]
        anonymous = await client.get(f"/api/calibration/recipes/{recipe_id}")
        assert anonymous.status_code == 200

    async def test_update_foreign_recipe_is_404(self, client: httpx.AsyncClient) -> None:
        created = await client.post(
            "/api/calibration/recipes", json=recipe_payload(), headers=bearer(OTHER)
        )
        recipe_id = created.json()["id"]
        response = await client.put(
            f"/api/calibration/recipes/{recipe_id}",
            json=recipe_payload(name="Hijacked"),
            headers=bearer(USER),
        )
        assert response.status_code == 404

    async def test_owner_can_update_and_delete(self, client: httpx.AsyncClient) -> None:
        created = await client.post(
            "/api/calibration/recipes", json=recipe_payload(), headers=bearer(USER)
        )
        recipe_id = created.json()["id"]

        updated = await client.put(
            f"/api/calibration/recipes/{recipe_id}",
            json=recipe_payload(name="Renamed"),
            headers=bearer(USER),
        )
        assert updated.status_code == 200
        assert updated.json()["name"] == "Renamed"
        # Server-controlled fields survive the update payload.
        assert updated.json()["created_by"] == USER
        assert updated.json()["source"] == "user"

        deleted = await client.delete(f"/api/calibration/recipes/{recipe_id}", headers=bearer(USER))
        assert deleted.status_code == 204
        assert (await client.get(f"/api/calibration/recipes/{recipe_id}")).status_code == 404
