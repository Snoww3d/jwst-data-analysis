"""Tests for the processing pipeline module."""

import numpy as np
import pytest
from astropy.io import fits

from app.processing.pipeline import (
    PipelineResult,
    PipelineStep,
    ProcessingPipeline,
    create_standard_pipeline,
    run_pipeline_async,
)


@pytest.fixture
def small_image():
    """20x20 synthetic image for fast pipeline tests."""
    rng = np.random.default_rng(42)
    return rng.normal(loc=100.0, scale=10.0, size=(20, 20)).astype(np.float64)


@pytest.fixture
def pipeline():
    """Fresh ProcessingPipeline instance."""
    return ProcessingPipeline("test")


@pytest.fixture
def fits_file(tmp_path, small_image):
    """Temporary FITS file for async pipeline tests."""
    path = str(tmp_path / "test.fits")
    hdu = fits.PrimaryHDU(data=small_image)
    hdu.writeto(path, overwrite=True)
    return path


def _identity_step(context, params):
    """Custom step that passes data through unchanged."""
    return {"identity": True}


def _multiply_step(context, params):
    """Custom step that multiplies data by a factor."""
    factor = params.get("factor", 2.0)
    context["data"] = context["data"] * factor
    return {"factor": factor}


def _failing_step(context, params):
    """Custom step that always raises."""
    raise RuntimeError("Intentional failure")


class TestPipelineStep:
    def test_defaults(self):
        step = PipelineStep(name="s1", function="f1")
        assert step.name == "s1"
        assert step.function == "f1"
        assert step.parameters == {}
        assert step.enabled is True
        assert step.save_intermediate is False

    def test_custom_values(self):
        step = PipelineStep(
            name="s2",
            function="f2",
            parameters={"a": 1},
            enabled=False,
            save_intermediate=True,
        )
        assert step.parameters == {"a": 1}
        assert step.enabled is False
        assert step.save_intermediate is True


class TestPipelineResult:
    def test_to_dict_with_data(self, small_image):
        result = PipelineResult(
            success=True,
            data=small_image,
            steps_completed=["step1"],
            step_results={"step1": {"ok": True}},
            errors=[],
            execution_time=1.5,
            output_paths=["/tmp/step1.fits"],
        )
        d = result.to_dict()
        assert d["success"] is True
        assert d["data_shape"] == [20, 20]
        assert d["steps_completed"] == ["step1"]
        assert d["step_results"] == {"step1": {"ok": True}}
        assert d["errors"] == []
        assert d["execution_time"] == 1.5
        assert d["output_paths"] == ["/tmp/step1.fits"]

    def test_to_dict_without_data(self):
        result = PipelineResult(success=False, errors=["load failed"])
        d = result.to_dict()
        assert d["success"] is False
        assert d["data_shape"] is None
        assert d["errors"] == ["load failed"]

    def test_default_field_values(self):
        result = PipelineResult(success=True)
        assert result.data is None
        assert result.header == {}
        assert result.steps_completed == []
        assert result.step_results == {}
        assert result.errors == []
        assert result.execution_time == 0.0
        assert result.output_paths == []


class TestProcessingPipelineAddStep:
    def test_add_step_with_registered_function(self, pipeline):
        pipeline.register_function("custom", _identity_step)
        pipeline.add_step("my_step", "custom")
        assert len(pipeline.steps) == 1
        assert pipeline.steps[0].name == "my_step"
        assert pipeline.steps[0].function == "custom"

    def test_add_step_with_default_function(self, pipeline):
        pipeline.add_step("bg", "estimate_background", {"box_size": 32})
        assert len(pipeline.steps) == 1
        assert pipeline.steps[0].parameters == {"box_size": 32}

    def test_add_step_unknown_function_raises(self, pipeline):
        with pytest.raises(ValueError, match="Unknown function"):
            pipeline.add_step("bad", "nonexistent_function")

    def test_add_step_disabled(self, pipeline):
        pipeline.register_function("custom", _identity_step)
        pipeline.add_step("my_step", "custom", enabled=False)
        assert pipeline.steps[0].enabled is False

    def test_add_step_save_intermediate(self, pipeline):
        pipeline.register_function("custom", _identity_step)
        pipeline.add_step("my_step", "custom", save_intermediate=True)
        assert pipeline.steps[0].save_intermediate is True

    def test_add_multiple_steps_preserves_order(self, pipeline):
        pipeline.register_function("a", _identity_step)
        pipeline.register_function("b", _identity_step)
        pipeline.add_step("first", "a")
        pipeline.add_step("second", "b")
        assert [s.name for s in pipeline.steps] == ["first", "second"]


class TestProcessingPipelineRemoveStep:
    def test_remove_existing_step(self, pipeline):
        pipeline.register_function("custom", _identity_step)
        pipeline.add_step("step1", "custom")
        pipeline.add_step("step2", "custom")
        pipeline.remove_step("step1")
        assert len(pipeline.steps) == 1
        assert pipeline.steps[0].name == "step2"

    def test_remove_nonexistent_step_no_error(self, pipeline):
        pipeline.register_function("custom", _identity_step)
        pipeline.add_step("step1", "custom")
        pipeline.remove_step("does_not_exist")
        assert len(pipeline.steps) == 1

    def test_remove_all_steps(self, pipeline):
        pipeline.register_function("custom", _identity_step)
        pipeline.add_step("step1", "custom")
        pipeline.remove_step("step1")
        assert len(pipeline.steps) == 0


class TestProcessingPipelineExecute:
    def test_execute_custom_function(self, pipeline, small_image):
        pipeline.register_function("multiply", _multiply_step)
        pipeline.add_step("double", "multiply", {"factor": 2.0})
        result = pipeline.execute(small_image)

        assert result.success is True
        assert result.steps_completed == ["double"]
        assert result.step_results["double"] == {"factor": 2.0}
        np.testing.assert_array_almost_equal(result.data, small_image * 2.0)

    def test_execute_chained_steps(self, pipeline, small_image):
        pipeline.register_function("multiply", _multiply_step)
        pipeline.add_step("first", "multiply", {"factor": 2.0})
        pipeline.add_step("second", "multiply", {"factor": 3.0})
        result = pipeline.execute(small_image)

        assert result.success is True
        assert result.steps_completed == ["first", "second"]
        np.testing.assert_array_almost_equal(result.data, small_image * 6.0)

    def test_execute_with_on_progress(self, pipeline, small_image):
        progress_calls = []

        def on_progress(step_name, fraction):
            progress_calls.append((step_name, fraction))

        pipeline.register_function("identity", _identity_step)
        pipeline.add_step("s1", "identity")
        pipeline.add_step("s2", "identity")
        result = pipeline.execute(small_image, on_progress=on_progress)

        assert result.success is True
        # Should get progress for each step + the final "complete" callback
        assert ("s1", 0.0) in progress_calls
        assert ("s2", 0.5) in progress_calls
        assert ("complete", 1.0) in progress_calls

    def test_execute_step_failure_stops_pipeline(self, pipeline, small_image):
        pipeline.register_function("identity", _identity_step)
        pipeline.register_function("fail", _failing_step)
        pipeline.add_step("good", "identity")
        pipeline.add_step("bad", "fail")
        pipeline.add_step("never_reached", "identity")
        result = pipeline.execute(small_image)

        assert result.success is False
        assert result.steps_completed == ["good"]
        assert len(result.errors) == 1
        assert "bad" in result.errors[0]
        assert "Intentional failure" in result.errors[0]

    def test_execute_disabled_steps_skipped(self, pipeline, small_image):
        pipeline.register_function("multiply", _multiply_step)
        pipeline.register_function("identity", _identity_step)
        pipeline.add_step("enabled_step", "multiply", {"factor": 3.0})
        pipeline.add_step("disabled_step", "identity", enabled=False)
        result = pipeline.execute(small_image)

        assert result.success is True
        assert result.steps_completed == ["enabled_step"]
        assert "disabled_step" not in result.step_results
        np.testing.assert_array_almost_equal(result.data, small_image * 3.0)

    def test_execute_does_not_mutate_input(self, pipeline, small_image):
        original = small_image.copy()
        pipeline.register_function("multiply", _multiply_step)
        pipeline.add_step("double", "multiply", {"factor": 2.0})
        pipeline.execute(small_image)

        np.testing.assert_array_equal(small_image, original)

    def test_execute_with_header(self, pipeline, small_image):
        pipeline.register_function("identity", _identity_step)
        pipeline.add_step("s1", "identity")
        header = {"INSTRUME": "NIRCAM", "FILTER": "F200W"}
        result = pipeline.execute(small_image, header=header)

        assert result.header["INSTRUME"] == "NIRCAM"
        assert result.header["FILTER"] == "F200W"

    def test_execute_records_execution_time(self, pipeline, small_image):
        pipeline.register_function("identity", _identity_step)
        pipeline.add_step("s1", "identity")
        result = pipeline.execute(small_image)

        assert result.execution_time > 0.0

    def test_execute_empty_pipeline(self, pipeline, small_image):
        result = pipeline.execute(small_image)

        assert result.success is True
        assert result.steps_completed == []
        np.testing.assert_array_almost_equal(result.data, small_image)

    def test_execute_save_intermediate(self, pipeline, small_image, tmp_path):
        pipeline.register_function("identity", _identity_step)
        pipeline.add_step("s1", "identity", save_intermediate=True)
        output_dir = str(tmp_path)
        result = pipeline.execute(small_image, output_dir=output_dir)

        assert result.success is True
        assert len(result.output_paths) == 1
        assert result.output_paths[0].endswith("s1.fits")

        # Verify the file was actually written
        from astropy.io import fits as fits_mod

        with fits_mod.open(result.output_paths[0]) as hdul:
            assert hdul[0].data.shape == (20, 20)

    def test_execute_save_intermediate_no_output_dir(self, pipeline, small_image):
        """save_intermediate=True without output_dir should not save (no error)."""
        pipeline.register_function("identity", _identity_step)
        pipeline.add_step("s1", "identity", save_intermediate=True)
        result = pipeline.execute(small_image, output_dir=None)

        assert result.success is True
        assert result.output_paths == []


class TestCreateStandardPipeline:
    def test_default_includes_background_noise_enhancement_stats(self):
        p = create_standard_pipeline()
        step_names = [s.name for s in p.steps]
        assert "background_estimation" in step_names
        assert "background_subtraction" in step_names
        assert "noise_reduction" in step_names
        assert "enhancement" in step_names
        assert "statistics" in step_names
        assert "source_detection" not in step_names

    def test_include_detection(self):
        p = create_standard_pipeline(include_detection=True)
        step_names = [s.name for s in p.steps]
        assert "source_detection" in step_names

    def test_exclude_all(self):
        p = create_standard_pipeline(
            include_background=False,
            include_noise_reduction=False,
            include_enhancement=False,
            include_statistics=False,
            include_detection=False,
        )
        assert len(p.steps) == 0

    def test_only_background(self):
        p = create_standard_pipeline(
            include_background=True,
            include_noise_reduction=False,
            include_enhancement=False,
            include_statistics=False,
        )
        step_names = [s.name for s in p.steps]
        assert "background_estimation" in step_names
        assert "background_subtraction" in step_names
        assert len(p.steps) == 2

    def test_only_enhancement(self):
        p = create_standard_pipeline(
            include_background=False,
            include_noise_reduction=False,
            include_enhancement=True,
            include_statistics=False,
        )
        step_names = [s.name for s in p.steps]
        assert step_names == ["enhancement"]

    def test_custom_params_override(self):
        p = create_standard_pipeline(
            background_params={"box_size": 32, "filter_size": 5},
            noise_params={"method": "median", "size": 5},
        )
        bg_step = next(s for s in p.steps if s.name == "background_estimation")
        noise_step = next(s for s in p.steps if s.name == "noise_reduction")
        assert bg_step.parameters["box_size"] == 32
        assert bg_step.parameters["filter_size"] == 5
        assert noise_step.parameters["method"] == "median"

    def test_pipeline_name_is_standard(self):
        p = create_standard_pipeline()
        assert p.name == "standard"


class TestRunPipelineAsync:
    async def test_runs_pipeline_on_fits_file(self, fits_file):
        pipeline = ProcessingPipeline("async_test")
        pipeline.register_function("identity", _identity_step)
        pipeline.add_step("s1", "identity")

        result = await run_pipeline_async(fits_file, pipeline)

        assert result.success is True
        assert result.steps_completed == ["s1"]
        assert result.data is not None
        assert result.data.shape == (20, 20)

    async def test_runs_with_progress_callback(self, fits_file):
        progress_calls = []

        def on_progress(step_name, fraction):
            progress_calls.append((step_name, fraction))

        pipeline = ProcessingPipeline("async_test")
        pipeline.register_function("identity", _identity_step)
        pipeline.add_step("s1", "identity")

        await run_pipeline_async(fits_file, pipeline, on_progress=on_progress)

        assert len(progress_calls) > 0
        assert ("complete", 1.0) in progress_calls

    async def test_returns_failure_for_missing_file(self, tmp_path):
        pipeline = ProcessingPipeline("async_test")
        pipeline.register_function("identity", _identity_step)
        pipeline.add_step("s1", "identity")

        result = await run_pipeline_async(str(tmp_path / "nonexistent.fits"), pipeline)

        assert result.success is False
        assert len(result.errors) > 0

    async def test_runs_with_output_dir(self, fits_file, tmp_path):
        output_dir = str(tmp_path / "output")
        import os

        os.makedirs(output_dir)

        pipeline = ProcessingPipeline("async_test")
        pipeline.register_function("identity", _identity_step)
        pipeline.add_step("s1", "identity", save_intermediate=True)

        result = await run_pipeline_async(fits_file, pipeline, output_dir=output_dir)

        assert result.success is True
        assert len(result.output_paths) == 1
