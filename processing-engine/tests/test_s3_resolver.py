"""Unit tests for S3 path resolution."""

from app.mast.s3_resolver import resolve_s3_key, resolve_s3_keys_from_products


class TestResolveS3Key:
    def test_resolves_from_explicit_program_id(self):
        key = resolve_s3_key(
            filename="jw02733-o001_t001_nircam_clear-f090w_i2d.fits",
            program_id="02733",
        )
        assert key == "jwst/public/02733/jw02733-o001_t001_nircam_clear-f090w_i2d.fits"

    def test_resolves_from_numeric_program_id(self):
        key = resolve_s3_key(
            filename="jw02733-o001_t001_nircam_clear-f090w_i2d.fits",
            program_id="2733",
        )
        assert key == "jwst/public/02733/jw02733-o001_t001_nircam_clear-f090w_i2d.fits"

    def test_resolves_from_obs_id(self):
        key = resolve_s3_key(
            filename="jw02733-o001_t001_nircam_clear-f090w_i2d.fits",
            obs_id="jw02733-o001_t001_nircam_clear-f090w",
        )
        assert key == "jwst/public/02733/jw02733-o001_t001_nircam_clear-f090w_i2d.fits"

    def test_resolves_from_filename_only(self):
        key = resolve_s3_key(
            filename="jw02733-o001_t001_nircam_clear-f090w_i2d.fits",
        )
        assert key == "jwst/public/02733/jw02733-o001_t001_nircam_clear-f090w_i2d.fits"

    def test_returns_none_for_unresolvable(self):
        key = resolve_s3_key(filename="unknown_file.fits")
        assert key is None

    def test_zero_pads_short_program_id(self):
        key = resolve_s3_key(filename="test.fits", program_id="123")
        assert key == "jwst/public/00123/test.fits"

    def test_extracts_from_jw_prefix_program_id(self):
        key = resolve_s3_key(filename="test.fits", program_id="jw02733")
        assert key == "jwst/public/02733/test.fits"


class TestResolveS3KeysFromProducts:
    def test_resolves_product_list(self):
        products = [
            {
                "productFilename": "jw02733-o001_t001_nircam_clear-f090w_i2d.fits",
                "obs_id": "jw02733-o001_t001_nircam_clear-f090w",
                "proposal_id": "2733",
                "size": 1024,
            },
            {
                "productFilename": "jw02733-o001_t001_nircam_clear-f090w_cal.fits",
                "obs_id": "jw02733-o001_t001_nircam_clear-f090w",
                "proposal_id": "2733",
                "size": 2048,
            },
        ]
        result = resolve_s3_keys_from_products(products)
        assert len(result) == 2
        assert (
            result[0]["s3_key"] == "jwst/public/02733/jw02733-o001_t001_nircam_clear-f090w_i2d.fits"
        )
        assert (
            result[1]["s3_key"] == "jwst/public/02733/jw02733-o001_t001_nircam_clear-f090w_cal.fits"
        )
        # Original fields preserved
        assert result[0]["size"] == 1024

    def test_skips_unresolvable_products(self):
        products = [
            {
                "productFilename": "jw02733-o001_t001_nircam_clear-f090w_i2d.fits",
                "proposal_id": "2733",
            },
            {"productFilename": "unknown_file.fits"},  # No program info
        ]
        result = resolve_s3_keys_from_products(products)
        assert len(result) == 1

    def test_empty_list(self):
        result = resolve_s3_keys_from_products([])
        assert result == []

    def test_uses_filename_field_as_fallback(self):
        products = [
            {"filename": "jw01234-o001_t001_miri_f770w_i2d.fits", "proposal_id": "1234"},
        ]
        result = resolve_s3_keys_from_products(products)
        assert len(result) == 1
        assert result[0]["s3_key"] == "jwst/public/01234/jw01234-o001_t001_miri_f770w_i2d.fits"

    def test_skips_product_missing_both_filename_keys(self):
        """Product with neither productFilename nor filename should be skipped."""
        products = [
            {"obs_id": "jw02733-o001", "proposal_id": "2733"},
        ]
        result = resolve_s3_keys_from_products(products)
        assert len(result) == 0

    def test_skips_product_with_none_filename_values(self):
        """Product where both filename keys are explicitly None should be skipped."""
        products = [
            {"productFilename": None, "filename": None, "proposal_id": "2733"},
        ]
        result = resolve_s3_keys_from_products(products)
        assert len(result) == 0

    def test_skips_product_with_empty_string_filenames(self):
        """Product where both filename keys are empty strings should be skipped."""
        products = [
            {"productFilename": "", "filename": "", "proposal_id": "2733"},
        ]
        result = resolve_s3_keys_from_products(products)
        assert len(result) == 0

    def test_mixed_valid_and_missing_filename_products(self):
        """Valid products are resolved; ones missing filenames are skipped."""
        products = [
            {
                "productFilename": "jw02733-o001_t001_nircam_clear-f090w_i2d.fits",
                "proposal_id": "2733",
            },
            {"obs_id": "jw02733-o001", "proposal_id": "2733"},  # No filename
            {"productFilename": None, "proposal_id": "2733"},  # None filename
        ]
        result = resolve_s3_keys_from_products(products)
        assert len(result) == 1
        assert "jw02733" in result[0]["s3_key"]

    def test_logs_warning_for_missing_filename(self, caplog):
        """Skipped products should produce a warning log."""
        import logging

        with caplog.at_level(logging.WARNING):
            resolve_s3_keys_from_products([{"proposal_id": "2733"}])
        assert "missing required filename" in caplog.text
