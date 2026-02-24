"""Tests for FITS Table Viewer endpoints and helper functions."""

from unittest.mock import patch

import numpy as np
import pytest
from astropy.io import fits as astropy_fits
from fastapi.testclient import TestClient

from app.analysis.routes import _safe_str, _serialize_cell
from app.storage.local_storage import LocalStorage


_STORAGE_PATCH_TARGET = "app.storage.helpers.get_storage_provider"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def temp_table_fits(tmp_path):
    """Create a temporary FITS file with a binary table."""
    filepath = tmp_path / "test_cat.fits"

    # Create primary HDU (no image data)
    primary = astropy_fits.PrimaryHDU()

    # Create binary table with various column types
    col1 = astropy_fits.Column(name="id", format="K", array=np.arange(25))
    col2 = astropy_fits.Column(name="ra", format="D", array=np.linspace(0.0, 360.0, 25))
    col3 = astropy_fits.Column(name="dec", format="D", array=np.linspace(-90.0, 90.0, 25))
    col4 = astropy_fits.Column(name="flux", format="E", array=np.linspace(0.01, 100.0, 25))
    col5 = astropy_fits.Column(
        name="name",
        format="20A",
        array=[f"source_{i}".encode() for i in range(25)],
    )

    table_hdu = astropy_fits.BinTableHDU.from_columns(
        [col1, col2, col3, col4, col5], name="CATALOG"
    )

    hdul = astropy_fits.HDUList([primary, table_hdu])
    hdul.writeto(filepath, overwrite=True)

    return filepath


@pytest.fixture
def temp_image_only_fits(tmp_path):
    """Create a temporary FITS file with only image data (no tables)."""
    filepath = tmp_path / "image_only.fits"
    data = np.zeros((10, 10), dtype=np.float32)
    hdu = astropy_fits.PrimaryHDU(data)
    hdul = astropy_fits.HDUList([hdu])
    hdul.writeto(filepath, overwrite=True)
    return filepath


@pytest.fixture
def client():
    """Create a test client."""
    from main import app

    return TestClient(app)


@pytest.fixture
def storage_patch(tmp_path):
    """Patch storage provider to use tmp_path."""
    return patch(
        _STORAGE_PATCH_TARGET,
        return_value=LocalStorage(base_path=str(tmp_path)),
    )


# ---------------------------------------------------------------------------
# _serialize_cell tests
# ---------------------------------------------------------------------------


class TestSerializeCell:
    """Tests for the _serialize_cell helper function."""

    def test_none_returns_none(self):
        assert _serialize_cell(None) is None

    def test_numpy_masked_returns_none(self):
        masked_val = np.ma.masked
        assert _serialize_cell(masked_val) is None

    def test_numpy_masked_array_element(self):
        arr = np.ma.array([1.0, 2.0, 3.0], mask=[False, True, False])
        # The masked element (index 1) should serialize to None
        assert _serialize_cell(arr[1]) is None
        # Unmasked elements should pass through
        assert _serialize_cell(arr[0]) == 1.0

    def test_bytes_decoded(self):
        result = _serialize_cell(b"hello world")
        assert result == "hello world"

    def test_bytes_with_trailing_spaces(self):
        result = _serialize_cell(b"star   ")
        assert result == "star"

    def test_bytes_with_invalid_utf8(self):
        # Should use errors='replace' and not raise
        result = _serialize_cell(b"\xff\xfe")
        assert isinstance(result, str)

    def test_numpy_array_serialized_as_string(self):
        arr = np.array([1.0, 2.0, 3.0])
        result = _serialize_cell(arr)
        assert isinstance(result, str)

    def test_numpy_array_truncated_at_100_chars(self):
        # Create a large array whose string representation exceeds 100 chars
        arr = np.arange(100, dtype=np.float64)
        result = _serialize_cell(arr)
        assert isinstance(result, str)
        assert len(result) <= 100

    def test_numpy_int_scalar(self):
        val = np.int64(42)
        result = _serialize_cell(val)
        assert result == 42
        assert isinstance(result, int)

    def test_numpy_float_scalar(self):
        val = np.float64(3.14)
        result = _serialize_cell(val)
        assert result == pytest.approx(3.14)
        assert isinstance(result, float)

    def test_numpy_float_nan_returns_none(self):
        val = np.float64(float("nan"))
        assert _serialize_cell(val) is None

    def test_numpy_float_inf_returns_none(self):
        val = np.float64(float("inf"))
        assert _serialize_cell(val) is None

    def test_numpy_float_neg_inf_returns_none(self):
        val = np.float64(float("-inf"))
        assert _serialize_cell(val) is None

    def test_python_float_nan_returns_none(self):
        assert _serialize_cell(float("nan")) is None

    def test_python_float_inf_returns_none(self):
        assert _serialize_cell(float("inf")) is None

    def test_python_float_regular(self):
        assert _serialize_cell(2.718) == pytest.approx(2.718)

    def test_regular_int(self):
        assert _serialize_cell(7) == 7

    def test_regular_string(self):
        assert _serialize_cell("hello") == "hello"

    def test_list_serialized_as_string(self):
        # Lists have __len__ but are not str, so they go through the array branch
        result = _serialize_cell([1, 2, 3])
        assert isinstance(result, str)


# ---------------------------------------------------------------------------
# _safe_str tests
# ---------------------------------------------------------------------------


class TestSafeStr:
    """Tests for the _safe_str helper function."""

    def test_none_returns_empty(self):
        assert _safe_str(None) == ""

    def test_masked_returns_empty(self):
        assert _safe_str(np.ma.masked) == ""

    def test_bytes_decoded(self):
        assert _safe_str(b"hello") == "hello"

    def test_bytes_stripped(self):
        assert _safe_str(b"  star  ") == "star"

    def test_bytes_invalid_utf8(self):
        result = _safe_str(b"\xff\xfe")
        assert isinstance(result, str)

    def test_regular_int(self):
        assert _safe_str(42) == "42"

    def test_regular_float(self):
        assert _safe_str(3.14) == "3.14"

    def test_regular_string(self):
        assert _safe_str("test") == "test"

    def test_numpy_scalar(self):
        assert _safe_str(np.float64(1.5)) == "1.5"


# ---------------------------------------------------------------------------
# GET /analysis/table-info tests
# ---------------------------------------------------------------------------


class TestTableInfoEndpoint:
    """Tests for the GET /analysis/table-info endpoint."""

    def test_happy_path(self, client, temp_table_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/table-info",
                params={"file_path": "test_cat.fits"},
            )

        assert response.status_code == 200
        data = response.json()

        assert data["file_name"] == "test_cat.fits"
        assert len(data["table_hdus"]) == 1

        hdu_info = data["table_hdus"][0]
        assert hdu_info["index"] == 1  # Primary is index 0
        assert hdu_info["name"] == "CATALOG"
        assert hdu_info["hdu_type"] == "BinTableHDU"
        assert hdu_info["n_rows"] == 25
        assert hdu_info["n_columns"] == 5

        # Check column metadata
        col_names = [c["name"] for c in hdu_info["columns"]]
        assert col_names == ["id", "ra", "dec", "flux", "name"]

        # Check column dtypes are present
        for col in hdu_info["columns"]:
            assert "dtype" in col
            assert isinstance(col["dtype"], str)

    def test_no_table_hdus(self, client, temp_image_only_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/table-info",
                params={"file_path": "image_only.fits"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["table_hdus"] == []

    def test_file_not_found(self, client, storage_patch):
        with storage_patch:
            response = client.get(
                "/analysis/table-info",
                params={"file_path": "nonexistent.fits"},
            )

        assert response.status_code == 404

    def test_multiple_table_hdus(self, client, tmp_path, storage_patch):  # noqa: ARG002
        """Test a FITS file with two table HDUs."""
        filepath = tmp_path / "multi_table.fits"
        primary = astropy_fits.PrimaryHDU()

        col_a = astropy_fits.Column(name="x", format="D", array=np.array([1.0, 2.0]))
        table1 = astropy_fits.BinTableHDU.from_columns([col_a], name="TABLE_A")

        col_b = astropy_fits.Column(name="y", format="K", array=np.array([10, 20, 30]))
        table2 = astropy_fits.BinTableHDU.from_columns([col_b], name="TABLE_B")

        hdul = astropy_fits.HDUList([primary, table1, table2])
        hdul.writeto(filepath, overwrite=True)

        with storage_patch:
            response = client.get(
                "/analysis/table-info",
                params={"file_path": "multi_table.fits"},
            )

        assert response.status_code == 200
        data = response.json()
        assert len(data["table_hdus"]) == 2
        assert data["table_hdus"][0]["name"] == "TABLE_A"
        assert data["table_hdus"][0]["n_rows"] == 2
        assert data["table_hdus"][1]["name"] == "TABLE_B"
        assert data["table_hdus"][1]["n_rows"] == 3

    def test_array_column_detection(self, client, tmp_path, storage_patch):  # noqa: ARG002
        """Test that array columns are detected correctly."""
        filepath = tmp_path / "array_col.fits"
        primary = astropy_fits.PrimaryHDU()

        # Column with array format (e.g., 3E = 3 floats per cell)
        col = astropy_fits.Column(
            name="spectrum",
            format="3E",
            array=np.zeros((5, 3), dtype=np.float32),
        )
        table = astropy_fits.BinTableHDU.from_columns([col], name="SPECTRA")
        hdul = astropy_fits.HDUList([primary, table])
        hdul.writeto(filepath, overwrite=True)

        with storage_patch:
            response = client.get(
                "/analysis/table-info",
                params={"file_path": "array_col.fits"},
            )

        assert response.status_code == 200
        data = response.json()
        col_info = data["table_hdus"][0]["columns"][0]
        assert col_info["name"] == "spectrum"
        assert col_info["is_array"] is True
        assert col_info["array_shape"] == [3]


# ---------------------------------------------------------------------------
# GET /analysis/table-data tests
# ---------------------------------------------------------------------------


class TestTableDataEndpoint:
    """Tests for the GET /analysis/table-data endpoint."""

    def test_happy_path(self, client, temp_table_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/table-data",
                params={"file_path": "test_cat.fits", "hdu_index": 1},
            )

        assert response.status_code == 200
        data = response.json()

        assert data["hdu_index"] == 1
        assert data["hdu_name"] == "CATALOG"
        assert data["total_rows"] == 25
        assert data["total_columns"] == 5
        assert data["page"] == 0
        assert data["page_size"] == 100
        assert len(data["rows"]) == 25  # All 25 rows fit on one page

        # Each row should have all columns
        row = data["rows"][0]
        assert "id" in row
        assert "ra" in row
        assert "dec" in row
        assert "flux" in row
        assert "name" in row

        # Check first row values
        assert row["id"] == 0

    def test_pagination_page_0(self, client, temp_table_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/table-data",
                params={
                    "file_path": "test_cat.fits",
                    "hdu_index": 1,
                    "page": 0,
                    "page_size": 10,
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert len(data["rows"]) == 10
        assert data["page"] == 0
        assert data["page_size"] == 10
        assert data["total_rows"] == 25
        # First page should start at id=0
        assert data["rows"][0]["id"] == 0

    def test_pagination_page_1(self, client, temp_table_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/table-data",
                params={
                    "file_path": "test_cat.fits",
                    "hdu_index": 1,
                    "page": 1,
                    "page_size": 10,
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert len(data["rows"]) == 10
        assert data["page"] == 1
        # Second page should start at id=10
        assert data["rows"][0]["id"] == 10

    def test_pagination_last_page(self, client, temp_table_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/table-data",
                params={
                    "file_path": "test_cat.fits",
                    "hdu_index": 1,
                    "page": 2,
                    "page_size": 10,
                },
            )

        assert response.status_code == 200
        data = response.json()
        # 25 rows, page_size 10 -> page 2 has 5 rows
        assert len(data["rows"]) == 5

    def test_pagination_beyond_last_page_clamps(self, client, temp_table_fits, storage_patch):  # noqa: ARG002
        """Requesting a page beyond the last should clamp to the last page."""
        with storage_patch:
            response = client.get(
                "/analysis/table-data",
                params={
                    "file_path": "test_cat.fits",
                    "hdu_index": 1,
                    "page": 100,
                    "page_size": 10,
                },
            )

        assert response.status_code == 200
        data = response.json()
        # Should clamp to last page (page 2)
        assert data["page"] == 2
        assert len(data["rows"]) == 5

    def test_sort_ascending(self, client, temp_table_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/table-data",
                params={
                    "file_path": "test_cat.fits",
                    "hdu_index": 1,
                    "sort_column": "id",
                    "sort_direction": "asc",
                },
            )

        assert response.status_code == 200
        data = response.json()
        ids = [row["id"] for row in data["rows"]]
        assert ids == sorted(ids)
        assert data["sort_column"] == "id"
        assert data["sort_direction"] == "asc"

    def test_sort_descending(self, client, temp_table_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/table-data",
                params={
                    "file_path": "test_cat.fits",
                    "hdu_index": 1,
                    "sort_column": "id",
                    "sort_direction": "desc",
                },
            )

        assert response.status_code == 200
        data = response.json()
        ids = [row["id"] for row in data["rows"]]
        assert ids == sorted(ids, reverse=True)

    def test_search_finds_matching_rows(self, client, temp_table_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/table-data",
                params={
                    "file_path": "test_cat.fits",
                    "hdu_index": 1,
                    "search": "source_1",
                },
            )

        assert response.status_code == 200
        data = response.json()
        # "source_1" should match source_1, source_10-19 = 11 rows
        assert data["total_rows"] == 11
        for row in data["rows"]:
            assert "source_1" in row["name"].lower()

    def test_search_no_matches(self, client, temp_table_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/table-data",
                params={
                    "file_path": "test_cat.fits",
                    "hdu_index": 1,
                    "search": "nonexistent_term_xyz",
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["total_rows"] == 0
        assert len(data["rows"]) == 0

    def test_search_case_insensitive(self, client, temp_table_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/table-data",
                params={
                    "file_path": "test_cat.fits",
                    "hdu_index": 1,
                    "search": "SOURCE_0",
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["total_rows"] >= 1

    def test_invalid_page_size_zero(self, client, temp_table_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/table-data",
                params={
                    "file_path": "test_cat.fits",
                    "hdu_index": 1,
                    "page_size": 0,
                },
            )

        assert response.status_code == 400
        assert "page_size" in response.json()["detail"]

    def test_invalid_page_size_exceeds_max(self, client, temp_table_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/table-data",
                params={
                    "file_path": "test_cat.fits",
                    "hdu_index": 1,
                    "page_size": 501,
                },
            )

        assert response.status_code == 400
        assert "page_size" in response.json()["detail"]

    def test_invalid_hdu_index_out_of_range(self, client, temp_table_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/table-data",
                params={
                    "file_path": "test_cat.fits",
                    "hdu_index": 99,
                },
            )

        assert response.status_code == 400
        assert "out of range" in response.json()["detail"]

    def test_hdu_not_a_table(self, client, temp_table_fits, storage_patch):  # noqa: ARG002
        """Requesting a primary (image) HDU should return an error."""
        with storage_patch:
            response = client.get(
                "/analysis/table-data",
                params={
                    "file_path": "test_cat.fits",
                    "hdu_index": 0,  # Primary HDU, not a table
                },
            )

        assert response.status_code == 400
        assert "not a table" in response.json()["detail"]

    def test_file_not_found(self, client, storage_patch):
        with storage_patch:
            response = client.get(
                "/analysis/table-data",
                params={
                    "file_path": "nonexistent.fits",
                    "hdu_index": 1,
                },
            )

        assert response.status_code == 404

    def test_negative_page(self, client, temp_table_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/table-data",
                params={
                    "file_path": "test_cat.fits",
                    "hdu_index": 1,
                    "page": -1,
                },
            )

        assert response.status_code == 400
        assert "page" in response.json()["detail"]

    def test_columns_metadata_in_response(self, client, temp_table_fits, storage_patch):  # noqa: ARG002
        """Verify that column metadata is returned alongside data."""
        with storage_patch:
            response = client.get(
                "/analysis/table-data",
                params={"file_path": "test_cat.fits", "hdu_index": 1},
            )

        assert response.status_code == 200
        data = response.json()
        assert len(data["columns"]) == 5
        col_names = [c["name"] for c in data["columns"]]
        assert col_names == ["id", "ra", "dec", "flux", "name"]

    def test_sort_with_pagination(self, client, temp_table_fits, storage_patch):  # noqa: ARG002
        """Sort descending by id, then get page 1 to verify sort + pagination combo."""
        with storage_patch:
            response = client.get(
                "/analysis/table-data",
                params={
                    "file_path": "test_cat.fits",
                    "hdu_index": 1,
                    "sort_column": "id",
                    "sort_direction": "desc",
                    "page": 0,
                    "page_size": 5,
                },
            )

        assert response.status_code == 200
        data = response.json()
        ids = [row["id"] for row in data["rows"]]
        # Descending: first page should be [24, 23, 22, 21, 20]
        assert ids == [24, 23, 22, 21, 20]

    def test_search_with_numeric_value(self, client, tmp_path, storage_patch):  # noqa: ARG002
        """Search for a numeric value that appears in a column."""
        # Create a file with a specific known numeric value to search for
        filepath = tmp_path / "searchable.fits"
        primary = astropy_fits.PrimaryHDU()
        col = astropy_fits.Column(
            name="label",
            format="20A",
            array=[b"alpha", b"beta", b"gamma"],
        )
        table = astropy_fits.BinTableHDU.from_columns([col], name="DATA")
        hdul = astropy_fits.HDUList([primary, table])
        hdul.writeto(filepath, overwrite=True)

        with storage_patch:
            response = client.get(
                "/analysis/table-data",
                params={
                    "file_path": "searchable.fits",
                    "hdu_index": 1,
                    "search": "beta",
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["total_rows"] == 1
        assert data["rows"][0]["label"] == "beta"
