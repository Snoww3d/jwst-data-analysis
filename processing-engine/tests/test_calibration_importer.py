# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Tests for the JWPipeNB notebook importer: golden parses of the three real
STScI imaging notebooks (fixtures), adversarial/fail-closed cases, and the
import endpoint. The importer must NEVER execute notebook code — adversarial
fixtures prove hostile notebooks are data, not behavior.
"""

import json
import time
import uuid
from pathlib import Path

import httpx
import jwt as pyjwt
import pytest

from app.calibration.importer import (
    NotebookImportError,
    import_notebook,
    parse_notebook,
)
from app.calibration.routes import get_recipe_store
from app.calibration.store import RecipeStore
from app.db.client import get_database, reset_client


FIXTURES = Path(__file__).parent / "fixtures" / "jwpipenb"

SECRET = "unit-test-secret-key-at-least-32-chars!!"
ROLE_URI = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role"
USER = "user-a"


def notebook_of(cells: list[str]) -> bytes:
    return json.dumps(
        {
            "cells": [{"cell_type": "code", "source": [text], "outputs": []} for text in cells],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 5,
        }
    ).encode()


TEMPLATE_PREAMBLE = """
demo_mode = True
dodet1 = True
doimage2 = True
doimage3 = True
program = "02739"
sci_observtn = "001"
"""

TEMPLATE_QUERY = """
sci_obs_id_table = Observations.query_criteria(
    instrument_name=["NIRCAM/IMAGE"], filters=["F200W"],
    obs_id=["jw" + program + "-o" + sci_observtn + "*"],
)
"""


class TestGoldenNotebooks:
    @pytest.mark.parametrize(
        ("fixture", "instrument", "program", "jump_override"),
        [
            (
                "JWPipeNB-nircam-imaging.ipynb",
                "nircam",
                "2739",
                {"maximum_cores": "half", "expand_large_events": True},
            ),
            ("JWPipeNB-niriss-imaging.ipynb", "niriss", "1475", {"maximum_cores": "half"}),
            ("JWPipeNB-MIRI-imaging.ipynb", "miri", "1040", {"maximum_cores": "half"}),
        ],
    )
    def test_real_notebooks_parse_to_seed_equivalents(
        self, fixture: str, instrument: str, program: str, jump_override: dict
    ) -> None:
        raw = (FIXTURES / fixture).read_bytes()
        fields, warnings = parse_notebook(raw, fixture)
        assert fields["instrument"] == instrument
        assert fields["input_source"]["proposal_id"] == program
        det1 = next(s for s in fields["stages"] if s["name"] == "detector1")
        # Cross-check against the hand-written seed recipes' overrides.
        assert det1["step_overrides"].get("jump") == jump_override
        assert all(s["enabled"] for s in fields["stages"])
        assert isinstance(warnings, list)

    def test_custom_code_reported_as_warning(self) -> None:
        raw = notebook_of(
            [TEMPLATE_PREAMBLE, TEMPLATE_QUERY, "def writel2asn(files):\n    return files"]
        )
        _, warnings = parse_notebook(raw, "helpers.ipynb")
        assert any("custom code" in w for w in warnings)

    def test_miri_bkg_sigma_extracted(self) -> None:
        raw = (FIXTURES / "JWPipeNB-MIRI-imaging.ipynb").read_bytes()
        fields, _ = parse_notebook(raw, "miri.ipynb")
        image2 = next(s for s in fields["stages"] if s["name"] == "image2")
        assert image2["step_overrides"].get("bkg_subtract") == {"sigma": 2}


class TestFailClosed:
    def test_random_python_rejected(self) -> None:
        raw = notebook_of(["import os\nos.system('echo pwned')\nx = 1"])
        with pytest.raises(NotebookImportError, match="not a recognizable JWPipeNB"):
            parse_notebook(raw, "evil.ipynb")

    def test_non_literal_override_rejected(self) -> None:
        raw = notebook_of(
            [
                TEMPLATE_PREAMBLE,
                TEMPLATE_QUERY,
                "det1dict['jump']['maximum_cores'] = os.environ['X']",
            ]
        )
        with pytest.raises(NotebookImportError, match="non-literal value"):
            parse_notebook(raw, "sneaky.ipynb")

    def test_non_literal_program_never_captured(self) -> None:
        # Identity fields: non-literals are ignored (first literal wins);
        # with no literal at all the essentials check rejects the notebook.
        raw = notebook_of([TEMPLATE_QUERY, "dodet1 = True\nprogram = get_program()"])
        with pytest.raises(NotebookImportError, match="'program' assignment"):
            parse_notebook(raw, "sneaky.ipynb")

    def test_later_non_literal_program_does_not_override(self) -> None:
        raw = notebook_of(
            [
                TEMPLATE_PREAMBLE,
                TEMPLATE_QUERY,
                "program = datamodels.open(f).meta.observation.program_number",
            ]
        )
        fields, _ = parse_notebook(raw, "reuse.ipynb")
        assert fields["input_source"]["proposal_id"] == "2739"

    def test_reference_file_override_rejected(self) -> None:
        raw = notebook_of(
            [TEMPLATE_PREAMBLE, TEMPLATE_QUERY, "image3dict['resample']['override_drizpars'] = 'x'"]
        )
        with pytest.raises(NotebookImportError, match="unsafe override"):
            parse_notebook(raw, "refs.ipynb")

    def test_hook_param_rejected(self) -> None:
        raw = notebook_of(
            [
                TEMPLATE_PREAMBLE,
                TEMPLATE_QUERY,
                "image3dict['resample']['post_hooks'] = 'evil.module'",
            ]
        )
        with pytest.raises(NotebookImportError, match="unsafe override"):
            parse_notebook(raw, "hooks.ipynb")

    def test_spectroscopy_mode_rejected(self) -> None:
        raw = notebook_of(
            [TEMPLATE_PREAMBLE, 'Observations.query_criteria(instrument_name=["MIRI/MRS"])']
        )
        with pytest.raises(NotebookImportError, match="only\\s+imaging|imaging modes"):
            parse_notebook(raw, "mrs.ipynb")

    def test_null_byte_cell_skipped_not_500(self) -> None:
        # Null bytes make ast.parse raise ValueError, not SyntaxError — the
        # cell is skipped, and the notebook still parses if the essentials
        # live in other cells.
        raw = notebook_of([TEMPLATE_PREAMBLE, TEMPLATE_QUERY, "x = '\x00'"])
        fields, warnings = parse_notebook(raw, "nul.ipynb")
        assert fields["instrument"] == "nircam"
        assert any("unparseable" in w for w in warnings)

    def test_corrupt_ipynb_rejected(self) -> None:
        with pytest.raises(NotebookImportError, match="not a valid .ipynb"):
            parse_notebook(b"{truncated", "broken.ipynb")

    def test_oversized_rejected(self) -> None:
        raw = b" " * (5 * 1024 * 1024 + 1)
        with pytest.raises(NotebookImportError, match="5MB"):
            parse_notebook(raw, "big.ipynb")

    def test_exec_eval_never_run(self, tmp_path: Path) -> None:
        # Executing this notebook would create the sentinel file; parsing
        # must not.
        sentinel = tmp_path / "pwned"
        raw = notebook_of(
            [TEMPLATE_PREAMBLE, TEMPLATE_QUERY, f"open({str(sentinel)!r}, 'w').write('x')"]
        )
        fields, _ = parse_notebook(raw, "exec.ipynb")
        assert fields["instrument"] == "nircam"
        assert not sentinel.exists()


class TestImportedRecipeValidation:
    def test_import_produces_valid_private_recipe(self) -> None:
        raw = notebook_of([TEMPLATE_PREAMBLE, TEMPLATE_QUERY])
        recipe, warnings = import_notebook(raw, "mini.ipynb", USER, "user-abc123")
        assert recipe.source == "imported"
        assert recipe.is_public is False
        assert recipe.created_by == USER
        assert recipe.input_source.proposal_id == "2739"
        assert warnings == []


@pytest.fixture(autouse=True)
def _jwt_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET_KEY", SECRET)
    reset_client()
    yield
    reset_client()


def bearer(user_id: str = USER) -> dict[str, str]:
    now = int(time.time())
    token = pyjwt.encode(
        {
            "sub": user_id,
            ROLE_URI: "User",
            "iss": "JwstDataAnalysis",
            "aud": "JwstDataAnalysisClient",
            "iat": now,
            "exp": now + 900,
        },
        SECRET,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
async def client():
    from main import app

    collection = get_database()[f"recipes_test_{uuid.uuid4().hex}"]
    store = RecipeStore(collection)
    app.dependency_overrides[get_recipe_store] = lambda: store
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as async_client:
            yield async_client
    finally:
        app.dependency_overrides.pop(get_recipe_store, None)
        await collection.drop()


class TestImportEndpoint:
    async def test_requires_auth(self, client: httpx.AsyncClient) -> None:
        response = await client.post(
            "/api/calibration/recipes/import",
            json={"filename": "x.ipynb", "notebook": "{}"},
        )
        assert response.status_code == 401

    async def test_golden_import_roundtrip(self, client: httpx.AsyncClient) -> None:
        raw = (FIXTURES / "JWPipeNB-MIRI-imaging.ipynb").read_text(encoding="utf-8")
        response = await client.post(
            "/api/calibration/recipes/import",
            json={"filename": "JWPipeNB-MIRI-imaging.ipynb", "notebook": raw},
            headers=bearer(),
        )
        assert response.status_code == 201
        body = response.json()
        assert body["recipe"]["instrument"] == "miri"
        assert body["recipe"]["source"] == "imported"
        assert body["recipe"]["created_by"] == USER
        assert any("custom code" in w for w in body["warnings"])
        # Imported recipe is fetchable through the normal recipe API.
        got = await client.get(f"/api/calibration/recipes/{body['recipe']['id']}", headers=bearer())
        assert got.status_code == 200

    async def test_reject_reports_reason(self, client: httpx.AsyncClient) -> None:
        response = await client.post(
            "/api/calibration/recipes/import",
            json={"filename": "x.ipynb", "notebook": json.dumps({"cells": []})},
            headers=bearer(),
        )
        assert response.status_code == 422
        assert "JWPipeNB" in response.json()["detail"]
