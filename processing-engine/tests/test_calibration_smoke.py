# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Opt-in real-pipeline smoke test (#1709 PR 5).

Runs the ACTUAL Image3Pipeline on two small NIRISS imaging _cal files from
MAST (PID 1475, the seed-recipe demo program — SUB80-sized products keep this
in the minutes range). Verifies the executor end-to-end including CRDS
reference-file access. Excluded from the default run and CI; execute with:

    docker exec jwst-processing python -m pytest -m calibration_smoke --no-cov
"""

import os
import uuid
from pathlib import Path

import pytest


pytest.importorskip("jwst", reason="calibration layer not installed")

from app.calibration.executor import run_stage3_job  # noqa: E402
from app.calibration.models import CalibrationRecipe  # noqa: E402
from app.db.client import get_database, reset_client  # noqa: E402
from app.jobs.models import JobRecord  # noqa: E402
from app.jobs.runner import JobContext  # noqa: E402
from app.jobs.store import JobStore  # noqa: E402


@pytest.mark.calibration_smoke
async def test_stage3_real_pipeline_smoke(tmp_path: Path, monkeypatch) -> None:
    from astroquery.mast import Observations

    monkeypatch.setenv("CALIBRATION_WORK_DIR", str(tmp_path / "work"))
    monkeypatch.setenv("CALIBRATION_MIN_FREE_DISK_GB", "1")
    monkeypatch.setenv("CRDS_PATH", os.environ.get("CRDS_PATH", str(tmp_path / "crds")))
    monkeypatch.setenv("CRDS_SERVER_URL", "https://jwst-crds.stsci.edu")

    # Two dithers of the NIRISS imaging demo observation (seed recipe PID).
    obs = Observations.query_criteria(
        proposal_id="1475", instrument_name="NIRISS/IMAGE", filters="F150W"
    )
    products = Observations.get_product_list(obs[:1])
    cal = Observations.filter_products(products, productSubGroupDescription="CAL", calib_level=[2])[
        :2
    ]
    assert len(cal) == 2, "expected two _cal products from MAST"
    download_dir = tmp_path / "inputs"
    manifest = Observations.download_products(cal, download_dir=str(download_dir))
    local_paths = [Path(p) for p in manifest["Local Path"]]

    # Bypass the storage layer: feed local paths straight to the executor.
    import app.calibration.executor as executor_module

    path_by_key = {p.name: p for p in local_paths}
    monkeypatch.setattr(executor_module, "resolve_fits_path", lambda key: path_by_key[key])

    class DirStorage:
        def __init__(self, root: Path):
            self.root = root

        def write_from_path(self, key: str, local_path: Path) -> None:
            dest = self.root / key
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(local_path.read_bytes())

    out_storage = DirStorage(tmp_path / "out")
    monkeypatch.setattr(executor_module, "get_storage_provider", lambda: out_storage)

    recipe = CalibrationRecipe.model_validate(
        {
            "id": "smoke-niriss",
            "name": "smoke",
            "instrument": "niriss",
            "input_source": {"type": "library_products", "product_suffixes": ["_cal"]},
            "stages": [
                {
                    "name": "image3",
                    "enabled": True,
                    # tweakreg needs a source catalog per input; skip to keep
                    # the smoke deterministic on two shallow dithers.
                    "step_overrides": {"tweakreg": {"skip": True}},
                }
            ],
            "association": {"rule": "DMS_Level3_Base", "product_name": "smoke-test"},
        }
    )

    reset_client()
    collection = get_database()[f"jobs_smoke_{uuid.uuid4().hex}"]
    store = JobStore(collection)
    job = JobRecord(type="calibration", user_id="smoke", request={})
    await store.create(job)
    try:
        result = await run_stage3_job(
            JobContext(store, job.job_id), recipe, list(path_by_key.keys()), {}
        )
        assert result.outputs, "real pipeline produced no _i2d output"
        i2d = tmp_path / "out" / result.outputs[0].storage_key
        assert i2d.is_file() and i2d.stat().st_size > 0
        assert result.jwst_version is not None
    finally:
        await collection.drop()
        reset_client()
