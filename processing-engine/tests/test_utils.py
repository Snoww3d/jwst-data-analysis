"""Tests for the processing utilities module."""

import os
import tempfile

import numpy as np
import pytest
from astropy.io import fits

from app.processing.utils import load_fits_data, normalize_array, save_fits_data


@pytest.fixture
def temp_fits_file():
    """Create a temporary FITS file with known data."""
    data = np.array([[1.0, 2.0], [3.0, 4.0]], dtype=np.float64)
    header = {"OBJECT": "Test", "EXPTIME": 100.0}

    with tempfile.NamedTemporaryFile(suffix=".fits", delete=False) as f:
        path = f.name

    hdu = fits.PrimaryHDU(data=data)
    hdu.header["OBJECT"] = "Test"
    hdu.header["EXPTIME"] = 100.0
    hdu.writeto(path, overwrite=True)

    yield path, data, header

    os.unlink(path)


@pytest.fixture
def empty_fits_file():
    """Create a FITS file with no data."""
    with tempfile.NamedTemporaryFile(suffix=".fits", delete=False) as f:
        path = f.name

    hdu = fits.PrimaryHDU()
    hdu.writeto(path, overwrite=True)

    yield path

    os.unlink(path)


class TestLoadFitsData:
    def test_loads_data_and_header(self, temp_fits_file):
        path, expected_data, _ = temp_fits_file
        data, header = load_fits_data(path)
        assert data is not None
        np.testing.assert_array_equal(data, expected_data)
        assert header["OBJECT"] == "Test"
        assert header["EXPTIME"] == 100.0

    def test_nonexistent_file_returns_none(self):
        data, header = load_fits_data("/nonexistent/path.fits")
        assert data is None
        assert header == {}

    def test_no_data_returns_none(self, empty_fits_file):
        data, header = load_fits_data(empty_fits_file)
        assert data is None
        assert header == {}

    def test_corrupt_file_returns_none(self):
        with tempfile.NamedTemporaryFile(suffix=".fits", delete=False, mode="w") as f:
            f.write("not a fits file")
            path = f.name

        try:
            data, header = load_fits_data(path)
            assert data is None
            assert header == {}
        finally:
            os.unlink(path)


class TestSaveFitsData:
    def test_save_and_reload(self):
        data = np.array([[10.0, 20.0], [30.0, 40.0]])
        header = {"OBJECT": "SaveTest", "TELESCOP": "JWST"}

        with tempfile.NamedTemporaryFile(suffix=".fits", delete=False) as f:
            path = f.name

        try:
            result = save_fits_data(data, header, path)
            assert result is True

            loaded_data, loaded_header = load_fits_data(path)
            np.testing.assert_array_equal(loaded_data, data)
            assert loaded_header["OBJECT"] == "SaveTest"
            assert loaded_header["TELESCOP"] == "JWST"
        finally:
            os.unlink(path)

    def test_skips_reserved_header_keys(self):
        data = np.array([[1.0, 2.0], [3.0, 4.0]])
        header = {"SIMPLE": True, "BITPIX": -64, "NAXIS": 2, "CUSTOM": "value"}

        with tempfile.NamedTemporaryFile(suffix=".fits", delete=False) as f:
            path = f.name

        try:
            result = save_fits_data(data, header, path)
            assert result is True

            _, loaded_header = load_fits_data(path)
            assert loaded_header["CUSTOM"] == "value"
        finally:
            os.unlink(path)

    def test_save_to_invalid_path_returns_false(self):
        data = np.array([[1.0]])
        result = save_fits_data(data, {}, "/nonexistent/dir/file.fits")
        assert result is False

    def test_overwrites_existing_file(self, temp_fits_file):
        path, _, _ = temp_fits_file
        new_data = np.array([[99.0, 88.0], [77.0, 66.0]])
        result = save_fits_data(new_data, {}, path)
        assert result is True

        loaded_data, _ = load_fits_data(path)
        np.testing.assert_array_equal(loaded_data, new_data)

    def test_bad_header_values_logged_and_skipped(self, caplog):
        """Headers with non-FITS-compatible values are skipped with a warning."""
        data = np.array([[1.0, 2.0], [3.0, 4.0]])
        header = {
            "GOOD": "valid",
            "BAD_DICT": {"a": 1},
            "BAD_LIST": [1, 2, 3],
            "BAD_BYTES": b"raw",
            "BAD_ARR": np.array([1, 2]),
        }

        with tempfile.NamedTemporaryFile(suffix=".fits", delete=False) as f:
            path = f.name

        try:
            result = save_fits_data(data, header, path)
            assert result is True

            warnings = [r for r in caplog.records if r.levelname == "WARNING"]
            skipped_messages = [r.message for r in warnings]
            assert len(warnings) == 4
            assert any("BAD_DICT" in m for m in skipped_messages)
            assert any("BAD_LIST" in m for m in skipped_messages)
            assert any("BAD_BYTES" in m for m in skipped_messages)
            assert any("BAD_ARR" in m for m in skipped_messages)

            _, loaded_header = load_fits_data(path)
            assert loaded_header["GOOD"] == "valid"
            assert "BAD_DICT" not in loaded_header
        finally:
            os.unlink(path)

    def test_none_header_value_accepted(self):
        """None is a valid FITS header value (maps to undefined)."""
        data = np.array([[1.0]])
        header = {"TESTNONE": None}

        with tempfile.NamedTemporaryFile(suffix=".fits", delete=False) as f:
            path = f.name

        try:
            result = save_fits_data(data, header, path)
            assert result is True
        finally:
            os.unlink(path)

    def test_good_headers_survive_alongside_bad(self):
        """Valid headers are written even when other headers fail."""
        data = np.array([[1.0]])
        header = {
            "BEFORE": "first",
            "BAD": {"not": "valid"},
            "AFTER": "last",
        }

        with tempfile.NamedTemporaryFile(suffix=".fits", delete=False) as f:
            path = f.name

        try:
            result = save_fits_data(data, header, path)
            assert result is True

            _, loaded_header = load_fits_data(path)
            assert loaded_header["BEFORE"] == "first"
            assert loaded_header["AFTER"] == "last"
            assert "BAD" not in loaded_header
        finally:
            os.unlink(path)


class TestNormalizeArray:
    def test_normalizes_to_0_1(self):
        data = np.array([[0.0, 50.0], [100.0, 200.0]])
        result = normalize_array(data)
        assert np.nanmin(result) == pytest.approx(0.0)
        assert np.nanmax(result) == pytest.approx(1.0)

    def test_known_values(self):
        data = np.array([[0.0, 10.0], [20.0, 30.0]])
        result = normalize_array(data)
        np.testing.assert_array_almost_equal(result, np.array([[0.0, 1 / 3], [2 / 3, 1.0]]))

    def test_constant_array_returns_zeros(self):
        data = np.array([[5.0, 5.0], [5.0, 5.0]])
        result = normalize_array(data)
        np.testing.assert_array_equal(result, np.zeros_like(data))

    def test_none_input_returns_none(self):
        result = normalize_array(None)
        assert result is None

    def test_handles_nan_values(self):
        data = np.array([[0.0, np.nan], [50.0, 100.0]])
        result = normalize_array(data)
        assert result[0, 0] == pytest.approx(0.0)
        assert result[2 // 2, 0] == pytest.approx(0.5)
        assert result[1, 1] == pytest.approx(1.0)

    def test_negative_values(self):
        data = np.array([[-10.0, 0.0], [10.0, 20.0]])
        result = normalize_array(data)
        assert np.nanmin(result) == pytest.approx(0.0)
        assert np.nanmax(result) == pytest.approx(1.0)

    def test_empty_array_returns_none(self):
        data = np.array([])
        result = normalize_array(data)
        assert result is None

    def test_all_nan_array_returns_zeros(self):
        data = np.array([[np.nan, np.nan], [np.nan, np.nan]])
        result = normalize_array(data)
        np.testing.assert_array_equal(result, np.zeros_like(data))
