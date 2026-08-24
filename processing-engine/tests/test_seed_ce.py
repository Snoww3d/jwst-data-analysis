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
    apply_threshold,
    build_estimate_channels,
    evaluate_all,
    evaluate_recipe,
    export_bundle,
    find_recipe,
    missing_filters,
    observation_ids_for_filters,
    plan_fetch,
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


class TestObservationIdsForFilters:
    """#1681: the seed gate must ask about EVERY filter-matching observation.

    The frontend was fixed this way in #1679 (the Cas A case): a recipe's
    observationIds is a MAST row-order winner, but the library data can sit
    under a different obs set entirely. Asking only about the recipe's chosen
    set reports every filter missing and fails a recipe GuidedCreate correctly
    shows as "Ready to render".
    """

    ROWS = [
        {"obs_id": "jw01947-o015_t012", "filters": "F090W"},
        {"obs_id": "jw01947-o001_t010", "filters": "F090W"},
        {"obs_id": "jw01947-o002_t011", "filters": "F187N"},
        {"obs_id": "jw01947-o003_t013", "filters": "F444W"},
    ]

    def test_includes_every_observation_matching_a_recipe_filter(self):
        ids = observation_ids_for_filters(self.ROWS, ["F090W", "F187N"])
        assert ids == [
            "jw01947-o015_t012",
            "jw01947-o001_t010",
            "jw01947-o002_t011",
        ]

    def test_is_case_insensitive_like_the_frontend(self):
        assert observation_ids_for_filters(self.ROWS, ["f444w"]) == ["jw01947-o003_t013"]

    def test_skips_rows_without_an_obs_id_or_filter(self):
        rows = [
            {"obs_id": None, "filters": "F090W"},
            {"obs_id": "jw-x", "filters": None},
            {"obs_id": "jw-y", "filters": "F090W"},
        ]
        assert observation_ids_for_filters(rows, ["F090W"]) == ["jw-y"]

    def test_deduplicates_repeated_observations(self):
        rows = [
            {"obs_id": "jw-dup", "filters": "F090W"},
            {"obs_id": "jw-dup", "filters": "F090W"},
        ]
        assert observation_ids_for_filters(rows, ["F090W"]) == ["jw-dup"]

    def test_evaluate_all_asks_about_all_matching_obs_not_just_the_recipe_set(self):
        """The gate's regression: library data under a different obs set.

        The recipe points at o015; the library holds the data under o001. The
        old code asked only about o015 and failed the recipe.
        """
        rows = [
            {
                "obs_id": "jw01947-o015_t012",
                "filters": "F090W",
                "instrument_name": "NIRCAM",
                "dataproduct_type": "image",
            },
            {
                "obs_id": "jw01947-o001_t010",
                "filters": "F090W",
                "instrument_name": "NIRCAM",
                "dataproduct_type": "image",
            },
        ]
        asked: list[list[str]] = []

        class FakeClient:
            def search_target(self, _name):
                return rows

            def suggest_recipes(self, _name, _observations):
                return [
                    {
                        "name": "Cas A",
                        "filters": ["F090W"],
                        "observationIds": ["jw01947-o015_t012"],
                    }
                ]

            def check_availability(self, observation_ids):
                asked.append(list(observation_ids))
                # Only the obs set the library actually holds.
                return {
                    "jw01947-o001_t010": {
                        "available": True,
                        "dataIds": ["deadbeefdeadbeefdeadbeef"],
                        "filter": "F090W",
                    }
                }

            def estimate(self, _channels):
                return {"status": "ok"}

        class FakeCollection:
            def find(self, _query):
                return [
                    {
                        "_id": ObjectId("deadbeefdeadbeefdeadbeef"),
                        "FilePath": "/data/x_i2d.fits",
                        "FileSize": 10,
                    }
                ]

        targets = [{"name": "Cas A", "mastSearchParams": {"target": "CAS A"}}]
        reports, _docs = evaluate_all(FakeClient(), targets, FakeCollection())

        assert asked == [["jw01947-o015_t012", "jw01947-o001_t010"]]
        assert reports[0].missing_filters == []
        assert reports[0].passed


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
        monkeypatch.setattr(mod, "evaluate_all", lambda _c, _t, _m, **_kw: (reports, docs))
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

    def test_allow_failures_cannot_ship_an_unrenderable_recipe(self, monkeypatch, tmp_path):
        """All data present + estimate fail = curation error, not a data gap (#1883).

        --allow-failures exists for recipes missing FITS we never fetched. A
        recipe that has everything and still fails the estimate would ship in
        the featured list and dead-end a stranger, so the flag must not pass it.
        """
        oid = ObjectId()
        reports = [
            RecipeReport("T", "good", [], "ok", [str(oid)], 5),
            RecipeReport("Tarantula Nebula", "8 filters", [], "fail", ["b" * 24], 12_400_000_000),
        ]
        docs = [{"_id": oid, "FilePath": "mast/x.fits", "FileSize": 5}]
        out = tmp_path / "bundle"
        rc = self._run_main(
            monkeypatch,
            tmp_path,
            reports,
            docs,
            ["export", "--allow-failures", "--out", str(out)],
        )
        assert rc == 1
        assert not out.exists()

    def test_excluded_unrenderable_recipe_is_allowed(self, monkeypatch, tmp_path):
        """--exclude IS the sanctioned answer for a too-big recipe."""
        oid = ObjectId()
        reports = [
            RecipeReport("T", "good", [], "ok", [str(oid)], 5),
            RecipeReport("Carina Nebula", "NIRCam", [], "fail", [], 0, excluded=True),
        ]
        docs = [{"_id": oid, "FilePath": "mast/x.fits", "FileSize": 5}]
        rc = self._run_main(
            monkeypatch,
            tmp_path,
            reports,
            docs,
            ["export", "--allow-failures", "--out", str(tmp_path / "b")],
        )
        assert rc == 0

    def test_missing_data_failure_still_passes_with_allow_failures(self, monkeypatch, tmp_path):
        """The guard must not swallow the case --allow-failures is actually for."""
        oid = ObjectId()
        reports = [
            RecipeReport("T", "good", [], "ok", [str(oid)], 5),
            RecipeReport("SMACS", "prefetch-capped", ["F444W"], "fail", [], 0),
        ]
        docs = [{"_id": oid, "FilePath": "mast/x.fits", "FileSize": 5}]
        rc = self._run_main(
            monkeypatch,
            tmp_path,
            reports,
            docs,
            ["export", "--allow-failures", "--out", str(tmp_path / "b")],
        )
        assert rc == 0

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


class TestApplyThreshold:
    """CE runs a relaxed COMPOSITE_DOWNSCALE_FAIL_THRESHOLD (curation
    decision 2026-07-08); the gate re-verdicts estimates client-side so it
    can evaluate CE's posture against a dev engine running the default."""

    def test_none_threshold_is_identity(self):
        v = {"status": "fail", "side_factor": 0.5}
        assert apply_threshold(v, None) is v

    def test_reverdicts_fail_to_warn_above_threshold(self):
        v = {"status": "fail", "side_factor": 0.20}
        assert apply_threshold(v, 0.15)["status"] == "warn"

    def test_still_fail_below_threshold(self):
        v = {"status": "fail", "side_factor": 0.10}
        assert apply_threshold(v, 0.15)["status"] == "fail"

    def test_full_scale_is_ok(self):
        v = {"status": "warn", "side_factor": 1.0}
        assert apply_threshold(v, 0.15)["status"] == "ok"

    def test_boundary_equal_to_threshold_is_warn(self):
        assert apply_threshold({"status": "fail", "side_factor": 0.15}, 0.15)["status"] == "warn"

    def test_just_under_full_scale_is_warn_not_ok(self):
        assert apply_threshold({"status": "warn", "side_factor": 0.99}, 0.15)["status"] == "warn"

    def test_missing_side_factor_passes_through(self):
        """413s and no-path failures carry no side_factor — never upgraded."""
        v = {"status": "fail", "detail": "over estimate file cap (413)"}
        assert apply_threshold(v, 0.15)["status"] == "fail"


class TestExcludePatterns:
    """Curation: --exclude drops recipes from the bundle without failing the
    gate (decision 2026-07-08: Carina/Stephan's NIRCam mega-mosaics stay out
    of the ~100GB budget; their MIRI recipes still ship)."""

    def _fake_client(self):
        class FakeClient:
            estimate_calls = []

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
                return [
                    {
                        "name": "Classic 3-color NIRCam",
                        "filters": ["F770W"],
                        "observationIds": ["jw0001-o001"],
                    },
                    {
                        "name": "Classic 3-color MIRI",
                        "filters": ["F770W"],
                        "observationIds": ["jw0001-o001"],
                    },
                ]

            def check_availability(self, _ids):
                return {
                    "jw0001-o001": {
                        "available": True,
                        "dataIds": ["c" * 24],
                        "filter": "F770W",
                    }
                }

            def estimate(self, channels):
                FakeClient.estimate_calls.append(channels)
                return {"status": "ok"}

        return FakeClient()

    def _fake_collection(self):
        from bson import ObjectId

        class FakeCollection:
            def find(self, _query):
                return [{"_id": ObjectId("c" * 24), "FilePath": "mast/c.fits", "FileSize": 7}]

        return FakeCollection()

    def test_excluded_recipe_skips_evaluation_and_gate(self):
        client = self._fake_client()
        targets = [{"name": "Carina Nebula", "mastSearchParams": {"target": "NGC 3324"}}]
        reports, docs = evaluate_all(
            client, targets, self._fake_collection(), exclude=["Carina Nebula/*NIRCam*"]
        )
        by_name = {r.recipe: r for r in reports}
        assert by_name["Classic 3-color NIRCam"].excluded is True
        assert by_name["Classic 3-color NIRCam"].passed is False
        assert by_name["Classic 3-color MIRI"].passed is True
        # excluded recipe never evaluated: exactly one estimate call (MIRI)
        assert len(type(client).estimate_calls) == 1
        # excluded recipes contribute no docs beyond the passing MIRI ones
        assert {str(d["_id"]) for d in docs} == {"c" * 24}

    def test_unmatched_exclude_pattern_aborts(self):
        """A stale pattern would silently re-admit the excluded mega-mosaics
        — refuse to run instead."""
        import pytest

        client = self._fake_client()
        targets = [{"name": "Carina Nebula", "mastSearchParams": {"target": "NGC 3324"}}]
        with pytest.raises(SystemExit, match="matched no recipe"):
            evaluate_all(client, targets, self._fake_collection(), exclude=["Tyop Target/*NIRCam*"])

    def test_excluded_does_not_fail_the_gate(self, monkeypatch, tmp_path):
        import scripts.seed_ce as mod

        reports = [
            RecipeReport("T", "good MIRI", [], "ok", ["c" * 24], 7),
            RecipeReport("T", "big NIRCam", [], None, excluded=True),
        ]
        targets_file = tmp_path / "featured.json"
        targets_file.write_text(json.dumps([{"name": "T"}]))
        monkeypatch.setattr(mod, "_mongo_collection", lambda: None)
        monkeypatch.setattr(mod, "EngineClient", lambda _url: None)
        monkeypatch.setattr(mod, "evaluate_all", lambda _c, _t, _m, **_kw: (reports, []))
        assert mod.main(["gate", "--targets", str(targets_file)]) == 0


class TestFetchPlanning:
    """Admin gap-fill (#1675): plan exactly what a recipe is missing, refuse
    over-cap files BEFORE any download, and surface unfindable filters."""

    def _mosaic(self, filt, size):
        from scripts.prefetch_discovery import MosaicInfo

        return MosaicInfo(
            obs_id=f"jw0001-{filt.lower()}",
            filename=f"jw0001_{filt.lower()}_i2d.fits",
            filter_name=filt,
            instrument="NIRCAM",
            size_bytes=size,
            data_uri="mast:JWST/x",
        )

    def test_complete_recipe_plans_nothing(self):
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
        plan = plan_fetch(RECIPE, avail, {}, max_bytes=6_000_000_000)
        assert plan.downloads == [] and plan.unfindable == [] and plan.over_cap == []

    def test_missing_filters_become_downloads(self):
        avail = _availability(
            (
                "jw02733-o001_t001_nircam_clear-f090w",
                {"available": True, "dataIds": ["a" * 24], "filter": "F090W"},
            ),
        )
        mosaics = {"F187N": self._mosaic("F187N", 1_000)}
        plan = plan_fetch(RECIPE, avail, mosaics, max_bytes=6_000_000_000)
        assert [m.filter_name for m in plan.downloads] == ["F187N"]
        assert plan.unfindable == [] and plan.over_cap == []

    def test_over_cap_files_are_separated_not_downloaded(self):
        mosaics = {
            "F090W": self._mosaic("F090W", 20_000_000_000),
            "F187N": self._mosaic("F187N", 1_000),
        }
        plan = plan_fetch(RECIPE, _availability(), mosaics, max_bytes=6_000_000_000)
        assert [m.filter_name for m in plan.over_cap] == ["F090W"]
        assert [m.filter_name for m in plan.downloads] == ["F187N"]

    def test_null_filter_entry_with_fallback_is_not_planned(self):
        """MUST-fix regression: a null-filter availability entry covered via
        the obs_filters fallback must not be re-planned as missing (false
        'unfindable' abort or re-download of a local filter)."""
        avail = _availability(
            (
                "jw02733-o001_t001_nircam_clear-f090w",
                {"available": True, "dataIds": ["a" * 24], "filter": None},
            ),
        )
        obs_filters = {"jw02733-o001_t001_nircam_clear-f090w": "F090W"}
        mosaics = {"F187N": self._mosaic("F187N", 1_000)}
        plan = plan_fetch(RECIPE, avail, mosaics, max_bytes=6_000_000_000, obs_filters=obs_filters)
        assert [m.filter_name for m in plan.downloads] == ["F187N"]
        assert plan.unfindable == []  # F090W covered via fallback, not unfindable

    def test_unfindable_filters_reported(self):
        plan = plan_fetch(RECIPE, _availability(), {}, max_bytes=6_000_000_000)
        assert plan.unfindable == ["F090W", "F187N"]
        assert plan.downloads == []


class TestFindRecipe:
    def test_exact_match(self):
        recipes = [{"name": "A"}, {"name": "B"}]
        assert find_recipe(recipes, "B") == {"name": "B"}

    def test_miss_raises_with_available_names(self):
        import pytest

        with pytest.raises(SystemExit, match=r"Classic 3-color MIRI"):
            find_recipe([{"name": "Classic 3-color MIRI"}], "Clasic MIRI")
