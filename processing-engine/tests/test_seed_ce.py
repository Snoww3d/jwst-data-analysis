"""CE seed bundle tool (CE plan Phase 5).

The completeness gate replicates the stranger flow end to end: MAST search →
suggest-recipes → check-availability (the frontend's ``needsDownload === 0``
branch in GuidedCreate) → /composite/estimate. A seed bundle only ships when
every featured recipe is fully renderable from local files — files-on-disk
alone is NOT the bar (Phase 1 spike: files can exist yet the render can fail
the memory budget).
"""

import json

from bson import ObjectId

from scripts.seed_ce import (
    RecipeReport,
    build_estimate_channels,
    evaluate_all,
    evaluate_recipe,
    export_bundle,
    missing_filters,
    transform_doc,
)


RECIPE = {
    "name": "NASA NIRCam (Southern Ring)",
    "filters": ["F090W", "F187N"],
    "observationIds": [
        "jw02733-o001_t001_nircam_clear-f090w",
        "jw02733-o001_t001_nircam_clear-f187n",
    ],
}


def _availability(*entries):
    """results map as the /api/jwstdata/check-availability facade returns it."""
    return dict(entries)


class TestMissingFilters:
    def test_all_covered_returns_empty(self):
        avail = _availability(
            (
                "jw02733-o001_t001_nircam_clear-f090w",
                {"available": True, "dataIds": ["a" * 24], "filter": "F090W"},
            ),
            (
                "jw02733-o001_t001_nircam_clear-f187n",
                {"available": True, "dataIds": ["b" * 24], "filter": "F187N"},
            ),
        )
        assert missing_filters(RECIPE, avail) == []

    def test_absent_obs_id_means_missing(self):
        """The facade simply omits obsIds with no verified files."""
        avail = _availability(
            (
                "jw02733-o001_t001_nircam_clear-f090w",
                {"available": True, "dataIds": ["a" * 24], "filter": "F090W"},
            ),
        )
        assert missing_filters(RECIPE, avail) == ["F187N"]

    def test_empty_data_ids_means_missing(self):
        """GuidedCreate requires available && dataIds non-empty."""
        avail = _availability(
            (
                "jw02733-o001_t001_nircam_clear-f090w",
                {"available": True, "dataIds": [], "filter": "F090W"},
            ),
            (
                "jw02733-o001_t001_nircam_clear-f187n",
                {"available": True, "dataIds": ["b" * 24], "filter": "F187N"},
            ),
        )
        assert missing_filters(RECIPE, avail) == ["F090W"]

    def test_filter_match_is_case_insensitive(self):
        """GuidedCreate uppercases filter keys on both sides."""
        avail = _availability(
            (
                "jw02733-o001_t001_nircam_clear-f090w",
                {"available": True, "dataIds": ["a" * 24], "filter": "f090w"},
            ),
            (
                "jw02733-o001_t001_nircam_clear-f187n",
                {"available": True, "dataIds": ["b" * 24], "filter": "F187N"},
            ),
        )
        assert missing_filters(RECIPE, avail) == []


class TestBuildEstimateChannels:
    def test_groups_paths_per_filter(self):
        avail = _availability(
            (
                "jw02733-o001_t001_nircam_clear-f090w",
                {"available": True, "dataIds": ["a" * 24], "filter": "F090W"},
            ),
            (
                "jw02733-o001_t001_nircam_clear-f187n",
                {"available": True, "dataIds": ["b" * 24, "c" * 24], "filter": "F187N"},
            ),
        )
        paths = {
            "a" * 24: "mast/obs1/f090w_i2d.fits",
            "b" * 24: "mast/obs2/f187n_i2d.fits",
            "c" * 24: "mast/obs3/f187n_seg2_i2d.fits",
        }
        channels = build_estimate_channels(RECIPE, avail, paths)
        by_paths = [sorted(c["file_paths"]) for c in channels]
        assert ["mast/obs1/f090w_i2d.fits"] in by_paths
        assert sorted(["mast/obs2/f187n_i2d.fits", "mast/obs3/f187n_seg2_i2d.fits"]) in by_paths
        assert len(channels) == 2
        for c in channels:
            assert c["color"]["hue"] is not None  # estimate model requires a color


class TestEvaluateRecipe:
    def test_missing_filter_fails_without_estimate_call(self):
        calls = []

        def estimate(_channels):
            calls.append(1)
            return {"status": "ok"}

        report = evaluate_recipe(RECIPE, _availability(), {}, estimate)
        assert report.missing_filters == ["F090W", "F187N"]
        assert not report.passed
        assert report.estimate_status is None
        assert calls == []

    def test_estimate_fail_fails_the_recipe(self):
        avail = _availability(
            (
                "jw02733-o001_t001_nircam_clear-f090w",
                {"available": True, "dataIds": ["a" * 24], "filter": "F090W"},
            ),
            (
                "jw02733-o001_t001_nircam_clear-f187n",
                {"available": True, "dataIds": ["b" * 24], "filter": "F187N"},
            ),
        )
        paths = {"a" * 24: "mast/a.fits", "b" * 24: "mast/b.fits"}
        report = evaluate_recipe(
            RECIPE, avail, paths, lambda _c: {"status": "fail", "detail": "too big"}
        )
        assert report.missing_filters == []
        assert report.estimate_status == "fail"
        assert not report.passed

    def test_warn_passes(self):
        """A downscaled-but-renderable recipe is acceptable for CE."""
        avail = _availability(
            (
                "jw02733-o001_t001_nircam_clear-f090w",
                {"available": True, "dataIds": ["a" * 24], "filter": "F090W"},
            ),
            (
                "jw02733-o001_t001_nircam_clear-f187n",
                {"available": True, "dataIds": ["b" * 24], "filter": "F187N"},
            ),
        )
        paths = {"a" * 24: "mast/a.fits", "b" * 24: "mast/b.fits"}
        report = evaluate_recipe(RECIPE, avail, paths, lambda _c: {"status": "warn"})
        assert report.passed
        assert report.data_ids == sorted(["a" * 24, "b" * 24])


class TestTransformDoc:
    def test_forces_public_and_clears_user(self):
        doc = {
            "_id": ObjectId(),
            "FileName": "x_i2d.fits",
            "FilePath": "mast/obs/x_i2d.fits",
            "IsPublic": False,
            "UserId": "someone",
        }
        out = transform_doc(doc)
        assert out["IsPublic"] is True
        assert out["UserId"] is None
        assert out["_id"] == doc["_id"]  # identity preserved for idempotent re-import

    def test_does_not_mutate_input(self):
        doc = {"_id": ObjectId(), "IsPublic": False, "UserId": "u"}
        transform_doc(doc)
        assert doc["UserId"] == "u"


class TestExportBundle:
    def test_writes_extjson_manifest_and_file_list(self, tmp_path):
        oid = ObjectId()
        docs = [
            {
                "_id": oid,
                "FileName": "x_i2d.fits",
                "FilePath": "mast/obs/x_i2d.fits",
                "FileSize": 123,
                "IsPublic": False,
                "UserId": "u",
            }
        ]
        reports = [
            RecipeReport(
                target="Southern Ring Nebula",
                recipe="NASA NIRCam (Southern Ring)",
                missing_filters=[],
                estimate_status="ok",
                data_ids=[str(oid)],
                total_bytes=123,
            )
        ]
        export_bundle(docs, reports, tmp_path, generated_at="2026-07-08T00:00:00Z")

        raw = (tmp_path / "jwst_data.extjson").read_text().strip().splitlines()
        assert len(raw) == 1  # one document per line (mongoimport-friendly)
        parsed = json.loads(raw[0])
        assert parsed["_id"] == {"$oid": str(oid)}  # canonical Extended JSON
        assert parsed["IsPublic"] is True
        assert parsed["UserId"] is None

        files = (tmp_path / "files.txt").read_text().splitlines()
        assert files == ["mast/obs/x_i2d.fits"]

        manifest = json.loads((tmp_path / "manifest.json").read_text())
        assert manifest["generatedAt"] == "2026-07-08T00:00:00Z"
        assert manifest["documentCount"] == 1
        assert manifest["totalBytes"] == 123
        assert manifest["recipes"][0]["recipe"] == "NASA NIRCam (Southern Ring)"
        assert manifest["recipes"][0]["passed"] is True

    def test_deduplicates_shared_files_across_recipes(self, tmp_path):
        oid = ObjectId()
        doc = {
            "_id": oid,
            "FilePath": "mast/obs/shared_i2d.fits",
            "FileSize": 10,
            "IsPublic": True,
            "UserId": None,
        }
        reports = [
            RecipeReport("T", "r1", [], "ok", [str(oid)], 10),
            RecipeReport("T", "r2", [], "ok", [str(oid)], 10),
        ]
        export_bundle([doc, doc], reports, tmp_path, generated_at="2026-07-08T00:00:00Z")
        files = (tmp_path / "files.txt").read_text().splitlines()
        assert files == ["mast/obs/shared_i2d.fits"]
        manifest = json.loads((tmp_path / "manifest.json").read_text())
        assert manifest["documentCount"] == 1
        assert manifest["totalBytes"] == 10  # shared file counted once


class TestReviewHardening:
    """Round-1 review catches: null-filter fallback, traversal guard,
    empty-channel guard, zero-recipe sentinel."""

    def test_null_entry_filter_falls_back_to_observation_filter(self):
        """GuidedCreate keys coverage as item.filter ?? obs.filters — an
        availability entry with a null filter must not read as missing."""
        avail = _availability(
            (
                "jw02733-o001_t001_nircam_clear-f090w",
                {"available": True, "dataIds": ["a" * 24], "filter": None},
            ),
            (
                "jw02733-o001_t001_nircam_clear-f187n",
                {"available": True, "dataIds": ["b" * 24], "filter": "F187N"},
            ),
        )
        obs_filters = {"jw02733-o001_t001_nircam_clear-f090w": "F090W"}
        assert missing_filters(RECIPE, avail, obs_filters) == []
        # without the fallback map the strict behavior remains
        assert missing_filters(RECIPE, avail) == ["F090W"]

    def test_export_refuses_traversal_file_paths(self, tmp_path):
        import pytest
        from bson import ObjectId

        docs = [
            {
                "_id": ObjectId(),
                "FilePath": "mast/../../etc/passwd",
                "FileSize": 1,
                "IsPublic": True,
                "UserId": None,
            }
        ]
        with pytest.raises(ValueError, match="unsafe FilePath"):
            export_bundle(docs, [], tmp_path, generated_at="2026-07-08T00:00:00Z")

    def test_export_refuses_absolute_file_paths(self, tmp_path):
        import pytest
        from bson import ObjectId

        docs = [
            {
                "_id": ObjectId(),
                "FilePath": "/etc/passwd",
                "FileSize": 1,
                "IsPublic": True,
                "UserId": None,
            }
        ]
        with pytest.raises(ValueError, match="unsafe FilePath"):
            export_bundle(docs, [], tmp_path, generated_at="2026-07-08T00:00:00Z")

    def test_unresolvable_paths_fail_without_calling_estimate(self):
        """Availability says yes but no doc resolves a path: never POST an
        empty channel list (the estimate model 422s on it)."""
        avail = _availability(
            (
                "jw02733-o001_t001_nircam_clear-f090w",
                {"available": True, "dataIds": ["a" * 24], "filter": "F090W"},
            ),
            (
                "jw02733-o001_t001_nircam_clear-f187n",
                {"available": True, "dataIds": ["b" * 24], "filter": "F187N"},
            ),
        )
        calls = []

        def estimate(channels):
            calls.append(channels)
            return {"status": "ok"}

        report = evaluate_recipe(RECIPE, avail, {}, estimate)
        assert report.estimate_status == "fail"
        assert not report.passed
        assert calls == []

    def test_zero_recipe_target_fails_the_gate(self):
        """A featured tile whose suggest-recipes comes back empty is a dead
        end and must produce a failing sentinel report."""

        class FakeClient:
            def search_target(self, _name):
                return [
                    {
                        "obs_id": "jw0001-o001",
                        "filters": "F770W",
                        "instrument_name": "MIRI",
                        "dataproduct_type": "image",
                    }
                ]

            def suggest_recipes(self, _name, _observations):
                return []

        class FakeCollection:
            def find(self, _query):
                return []

        targets = [{"name": "Ghost Target", "mastSearchParams": {"target": "GHOST"}}]
        reports, docs = evaluate_all(FakeClient(), targets, FakeCollection())
        assert len(reports) == 1
        assert not reports[0].passed
        assert reports[0].recipe == "(no recipes suggested)"
        assert docs == []


class TestEntryFilterEmptyString:
    def test_empty_string_filter_does_not_fall_back(self):
        """GuidedCreate uses ?? (nullish), not || — an empty-string filter
        stays empty and reads as uncovered, so the gate must match."""
        avail = _availability(
            (
                "jw02733-o001_t001_nircam_clear-f090w",
                {"available": True, "dataIds": ["a" * 24], "filter": ""},
            ),
            (
                "jw02733-o001_t001_nircam_clear-f187n",
                {"available": True, "dataIds": ["b" * 24], "filter": "F187N"},
            ),
        )
        obs_filters = {"jw02733-o001_t001_nircam_clear-f090w": "F090W"}
        assert missing_filters(RECIPE, avail, obs_filters) == ["F090W"]


class TestEstimate413:
    def test_413_maps_to_fail_verdict(self, monkeypatch):
        from scripts.seed_ce import EngineClient

        client = EngineClient("http://example.invalid")

        class Resp:
            status_code = 413

        def boom(_path, _payload):
            import requests

            raise requests.HTTPError(response=Resp())

        monkeypatch.setattr(client, "_post", boom)
        assert client.estimate([{"file_paths": ["x"], "color": {"hue": 1}}])["status"] == "fail"

    def test_other_http_errors_re_raise(self, monkeypatch):
        import pytest
        import requests

        from scripts.seed_ce import EngineClient

        client = EngineClient("http://example.invalid")

        class Resp:
            status_code = 500

        def boom(_path, _payload):
            raise requests.HTTPError(response=Resp())

        monkeypatch.setattr(client, "_post", boom)
        with pytest.raises(requests.HTTPError):
            client.estimate([{"file_paths": ["x"], "color": {"hue": 1}}])


class TestMainExitCodes:
    """The gate's actual contract: exit codes and what ships."""

    @staticmethod
    def _run_main(monkeypatch, tmp_path, reports, docs, argv):
        import scripts.seed_ce as mod

        targets_file = tmp_path / "featured.json"
        targets_file.write_text(json.dumps([{"name": "T", "mastSearchParams": {"target": "T"}}]))
        monkeypatch.setattr(mod, "_mongo_collection", lambda: None)
        monkeypatch.setattr(mod, "EngineClient", lambda _url: None)
        monkeypatch.setattr(mod, "evaluate_all", lambda _c, _t, _m: (reports, docs))
        return mod.main([*argv, "--targets", str(targets_file)])

    def test_gate_fails_on_failing_recipe(self, monkeypatch, tmp_path):
        reports = [RecipeReport("T", "r", ["F090W"], None)]
        assert self._run_main(monkeypatch, tmp_path, reports, [], ["gate"]) == 1

    def test_gate_passes_when_all_pass(self, monkeypatch, tmp_path):
        reports = [RecipeReport("T", "r", [], "ok", ["a" * 24], 1)]
        assert self._run_main(monkeypatch, tmp_path, reports, [], ["gate"]) == 0

    def test_allow_failures_exports_passing_only(self, monkeypatch, tmp_path):
        oid = ObjectId()
        reports = [
            RecipeReport("T", "good", [], "ok", [str(oid)], 5),
            RecipeReport("T", "bad", ["F444W"], None),
        ]
        docs = [{"_id": oid, "FilePath": "mast/x.fits", "FileSize": 5}]
        out = tmp_path / "bundle"
        rc = self._run_main(
            monkeypatch,
            tmp_path,
            reports,
            docs,
            [
                "export",
                "--allow-failures",
                "--out",
                str(out),
                "--generated-at",
                "2026-07-08T00:00:00Z",
            ],
        )
        assert rc == 0
        manifest = json.loads((out / "manifest.json").read_text())
        assert manifest["documentCount"] == 1  # only the passing recipe's doc
        assert {r["recipe"]: r["passed"] for r in manifest["recipes"]} == {
            "good": True,
            "bad": False,
        }

    def test_allow_failures_still_refuses_empty_bundle(self, monkeypatch, tmp_path):
        reports = [RecipeReport("T", "bad", ["F444W"], None)]
        rc = self._run_main(
            monkeypatch,
            tmp_path,
            reports,
            [],
            ["export", "--allow-failures", "--out", str(tmp_path / "b")],
        )
        assert rc == 1
        assert not (tmp_path / "b").exists()
