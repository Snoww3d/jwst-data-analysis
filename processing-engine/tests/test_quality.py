"""Tests for composite quality scoring."""

import numpy as np

from app.composite.quality import compute_quality_metrics


class TestComputeQualityMetrics:
    """Tests for quality metric computation."""

    def test_all_black_image(self):
        """All-black image should have near-zero coverage and minimum score."""
        rgb = np.zeros((100, 100, 3), dtype=np.float64)
        metrics = compute_quality_metrics(rgb)
        assert metrics["coverage_fraction"] < 0.01
        assert metrics["quality_score"] == 1.0

    def test_uniform_bright_image(self):
        """Uniform bright image: high coverage, low spread (constant)."""
        rgb = np.full((100, 100, 3), 0.5, dtype=np.float64)
        metrics = compute_quality_metrics(rgb)
        assert metrics["coverage_fraction"] > 0.9
        # Uniform = low histogram spread
        assert metrics["histogram_spread"] < 0.1

    def test_balanced_channels(self):
        """Three balanced channels should have high channel_balance."""
        rng = np.random.default_rng(42)
        rgb = np.zeros((200, 200, 3), dtype=np.float64)
        for c in range(3):
            rgb[:, :, c] = rng.uniform(0.3, 0.7, size=(200, 200))
        metrics = compute_quality_metrics(rgb)
        assert metrics["channel_balance"] > 0.5

    def test_good_synthetic_composite(self):
        """Synthetic good composite should score near 4-5."""
        rng = np.random.default_rng(42)
        rgb = np.zeros((200, 200, 3), dtype=np.float64)
        # Three channels with good spread and balance
        for c in range(3):
            base = rng.uniform(0.1, 0.3, size=(200, 200))
            # Add some bright structure
            y, x = np.mgrid[-100:100, -100:100]
            source = 0.6 * np.exp(-(x**2 + y**2) / (2 * 30**2))
            rgb[:, :, c] = np.clip(base + source, 0, 1)
        metrics = compute_quality_metrics(rgb)
        assert metrics["quality_score"] >= 3.0
        assert metrics["coverage_fraction"] > 0.9

    def test_imbalanced_channels(self):
        """Strongly imbalanced channels should have low balance score."""
        rgb = np.zeros((100, 100, 3), dtype=np.float64)
        rgb[:, :, 0] = 0.8  # Red very bright
        rgb[:, :, 1] = 0.01  # Green nearly black
        rgb[:, :, 2] = 0.01  # Blue nearly black
        metrics = compute_quality_metrics(rgb)
        assert metrics["channel_balance"] < 0.1

    def test_returns_all_keys(self):
        """Result should contain all expected metric keys."""
        rgb = np.random.default_rng(42).uniform(0.0, 1.0, size=(50, 50, 3))
        metrics = compute_quality_metrics(rgb)
        expected_keys = {
            "quality_score",
            "snr",
            "channel_balance",
            "histogram_spread",
            "coverage_fraction",
        }
        assert set(metrics.keys()) == expected_keys

    def test_score_bounded(self):
        """Score should always be between 1 and 5."""
        for seed in range(10):
            rng = np.random.default_rng(seed)
            rgb = rng.uniform(0, 1, size=(50, 50, 3))
            metrics = compute_quality_metrics(rgb)
            assert 1.0 <= metrics["quality_score"] <= 5.0

    def test_wrong_shape_returns_defaults(self):
        """Non-RGB array should return default metrics."""
        gray = np.ones((100, 100), dtype=np.float64) * 0.5
        metrics = compute_quality_metrics(gray)
        assert metrics["quality_score"] == 1.0

    def test_partial_coverage(self):
        """Image with 50% coverage should report ~0.5 coverage."""
        rgb = np.zeros((100, 100, 3), dtype=np.float64)
        rgb[:50, :, :] = 0.5  # Top half has signal
        metrics = compute_quality_metrics(rgb)
        assert 0.4 < metrics["coverage_fraction"] < 0.6
