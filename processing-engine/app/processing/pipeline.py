"""
Processing Pipeline Module

Provides functions for composing multiple processing steps into pipelines.
Enables flexible algorithm chaining with progress tracking.

Reference: docs/JWST_Image_Processing_Research.pdf Section 4.2
"""

import numpy as np
from numpy.typing import NDArray
from typing import Dict, Any, List, Optional, Callable, Union
from dataclasses import dataclass, field
from datetime import datetime
import logging
import copy

from .utils import load_fits_data, save_fits_data
from .background import estimate_background, subtract_background, get_background_statistics
from .filters import reduce_noise
from .enhancement import enhance_image
from .statistics import compute_statistics
from .detection import detect_sources, sources_to_dict

logger = logging.getLogger(__name__)


@dataclass
class PipelineStep:
    """Definition of a single processing step."""
    name: str
    function: str  # Name of function to call
    parameters: Dict[str, Any] = field(default_factory=dict)
    enabled: bool = True
    save_intermediate: bool = False


@dataclass
class PipelineResult:
    """Result from a pipeline execution."""
    success: bool
    data: Optional[NDArray[np.floating]] = None
    header: Dict[str, Any] = field(default_factory=dict)
    steps_completed: List[str] = field(default_factory=list)
    step_results: Dict[str, Any] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    execution_time: float = 0.0
    output_paths: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert result to dictionary for JSON serialization."""
        return {
            'success': self.success,
            'steps_completed': self.steps_completed,
            'step_results': self.step_results,
            'errors': self.errors,
            'execution_time': self.execution_time,
            'output_paths': self.output_paths,
            'data_shape': list(self.data.shape) if self.data is not None else None
        }


class ProcessingPipeline:
    """
    Configurable image processing pipeline.

    Chains multiple processing steps together with progress tracking
    and intermediate result storage.

    Example:
        >>> pipeline = ProcessingPipeline()
        >>> pipeline.add_step('background', 'estimate_background', {'box_size': 64})
        >>> pipeline.add_step('subtract', 'subtract_background')
        >>> pipeline.add_step('filter', 'reduce_noise', {'method': 'astropy_gaussian'})
        >>> result = pipeline.execute(image_data)
    """

    def __init__(self, name: str = "default"):
        self.name = name
        self.steps: List[PipelineStep] = []
        self._function_registry: Dict[str, Callable] = {}
        self._register_default_functions()

    def _register_default_functions(self):
        """Register built-in processing functions."""
        self._function_registry = {
            # Background
            'estimate_background': self._wrap_background_estimation,
            'subtract_background': self._wrap_background_subtraction,

            # Filters
            'reduce_noise': self._wrap_noise_reduction,

            # Enhancement
            'enhance_image': self._wrap_enhancement,

            # Statistics
            'compute_statistics': self._wrap_statistics,

            # Detection
            'detect_sources': self._wrap_detection,
        }

    def register_function(self, name: str, func: Callable):
        """Register a custom processing function."""
        self._function_registry[name] = func

    def add_step(
        self,
        name: str,
        function: str,
        parameters: Optional[Dict[str, Any]] = None,
        enabled: bool = True,
        save_intermediate: bool = False
    ):
        """Add a processing step to the pipeline."""
        if function not in self._function_registry:
            raise ValueError(f"Unknown function: {function}")

        step = PipelineStep(
            name=name,
            function=function,
            parameters=parameters or {},
            enabled=enabled,
            save_intermediate=save_intermediate
        )
        self.steps.append(step)
        logger.info(f"Added step '{name}' using {function}")

    def remove_step(self, name: str):
        """Remove a step by name."""
        self.steps = [s for s in self.steps if s.name != name]

    def execute(
        self,
        data: NDArray[np.floating],
        header: Optional[Dict[str, Any]] = None,
        output_dir: Optional[str] = None,
        on_progress: Optional[Callable[[str, float], None]] = None
    ) -> PipelineResult:
        """
        Execute the pipeline on input data.

        Args:
            data: Input 2D image array
            header: Optional FITS header dictionary
            output_dir: Directory for intermediate outputs
            on_progress: Progress callback(step_name, progress_fraction)

        Returns:
            PipelineResult with processed data and metadata
        """
        import time
        start_time = time.time()

        result = PipelineResult(
            success=True,
            data=data.copy(),
            header=header or {}
        )

        # Context for sharing data between steps
        context = {
            'original_data': data,
            'data': data.copy(),
            'header': header or {},
            'background': None,
            'background_rms': None,
        }

        enabled_steps = [s for s in self.steps if s.enabled]
        n_steps = len(enabled_steps)

        for i, step in enumerate(enabled_steps):
            try:
                logger.info(f"Executing step {i+1}/{n_steps}: {step.name}")

                if on_progress:
                    on_progress(step.name, i / n_steps)

                # Get the function
                func = self._function_registry[step.function]

                # Execute
                step_result = func(context, step.parameters)

                # Store result
                result.step_results[step.name] = step_result
                result.steps_completed.append(step.name)

                # Save intermediate if requested
                if step.save_intermediate and output_dir:
                    output_path = f"{output_dir}/{step.name}.fits"
                    save_fits_data(context['data'], context['header'], output_path)
                    result.output_paths.append(output_path)

            except Exception as e:
                logger.error(f"Step '{step.name}' failed: {e}")
                result.errors.append(f"{step.name}: {str(e)}")
                result.success = False
                break

        # Final progress
        if on_progress:
            on_progress("complete", 1.0)

        result.data = context['data']
        result.header = context['header']
        result.execution_time = time.time() - start_time

        logger.info(f"Pipeline completed in {result.execution_time:.2f}s")

        return result

    # Wrapper functions that work with context
    def _wrap_background_estimation(self, context: Dict, params: Dict) -> Dict[str, Any]:
        background, background_rms = estimate_background(context['data'], **params)
        context['background'] = background
        context['background_rms'] = background_rms
        return get_background_statistics(context['data'], background, background_rms)

    def _wrap_background_subtraction(self, context: Dict, params: Dict) -> Dict[str, Any]:
        if context['background'] is None:
            raise ValueError("Must run estimate_background before subtract_background")
        context['data'] = subtract_background(context['data'], context['background'])
        return {'subtracted': True}

    def _wrap_noise_reduction(self, context: Dict, params: Dict) -> Dict[str, Any]:
        context['data'] = reduce_noise(context['data'], **params)
        return {'method': params.get('method', 'astropy_gaussian')}

    def _wrap_enhancement(self, context: Dict, params: Dict) -> Dict[str, Any]:
        context['data'] = enhance_image(context['data'], **params)
        return {'method': params.get('method', 'zscale')}

    def _wrap_statistics(self, context: Dict, params: Dict) -> Dict[str, Any]:
        return compute_statistics(context['data'], **params)

    def _wrap_detection(self, context: Dict, params: Dict) -> Dict[str, Any]:
        if context['background'] is None or context['background_rms'] is None:
            raise ValueError("Must run background estimation before detection")

        result = detect_sources(
            context['original_data'],  # Use original, not processed
            context['background'],
            context['background_rms'],
            **params
        )

        # Convert for JSON serialization
        return {
            'method': result['method'],
            'n_sources': result['n_sources'],
            'threshold_sigma': result['threshold_sigma'],
            'sources': sources_to_dict(result.get('sources'))
        }


def create_standard_pipeline(
    include_background: bool = True,
    include_noise_reduction: bool = True,
    include_enhancement: bool = True,
    include_statistics: bool = True,
    include_detection: bool = False,
    **kwargs
) -> ProcessingPipeline:
    """
    Create a standard processing pipeline with common steps.

    Args:
        include_background: Include background estimation/subtraction
        include_noise_reduction: Include noise filtering
        include_enhancement: Include display enhancement
        include_statistics: Include statistics computation
        include_detection: Include source detection
        **kwargs: Override default parameters

    Returns:
        Configured ProcessingPipeline

    Example:
        >>> pipeline = create_standard_pipeline(include_detection=True)
        >>> result = pipeline.execute(image_data)
    """
    pipeline = ProcessingPipeline("standard")

    if include_background:
        pipeline.add_step(
            'background_estimation',
            'estimate_background',
            kwargs.get('background_params', {'box_size': 50, 'filter_size': 3})
        )
        pipeline.add_step(
            'background_subtraction',
            'subtract_background'
        )

    if include_noise_reduction:
        pipeline.add_step(
            'noise_reduction',
            'reduce_noise',
            kwargs.get('noise_params', {'method': 'astropy_gaussian', 'sigma': 1.0})
        )

    if include_statistics:
        pipeline.add_step(
            'statistics',
            'compute_statistics',
            kwargs.get('stats_params', {'sigma': 3.0})
        )

    if include_detection:
        pipeline.add_step(
            'source_detection',
            'detect_sources',
            kwargs.get('detection_params', {'threshold_sigma': 5.0})
        )

    if include_enhancement:
        pipeline.add_step(
            'enhancement',
            'enhance_image',
            kwargs.get('enhancement_params', {'method': 'zscale'})
        )

    return pipeline


async def run_pipeline_async(
    file_path: str,
    pipeline: ProcessingPipeline,
    output_dir: Optional[str] = None,
    on_progress: Optional[Callable[[str, float], None]] = None
) -> PipelineResult:
    """
    Run a pipeline asynchronously on a FITS file.

    Args:
        file_path: Path to input FITS file
        pipeline: Configured ProcessingPipeline
        output_dir: Directory for outputs
        on_progress: Progress callback

    Returns:
        PipelineResult
    """
    import asyncio

    # Load data (could be made async with aiofiles)
    data, header = load_fits_data(file_path)

    if data is None:
        return PipelineResult(
            success=False,
            errors=[f"Failed to load FITS file: {file_path}"]
        )

    # Run pipeline in thread pool to not block
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: pipeline.execute(data, header, output_dir, on_progress)
    )

    return result
