"""
Lightweight mock processing engine for E2E tests.

Mirrors the real processing engine's API surface but returns canned responses
instantly. Starts in <1s vs 30s+ for the real engine (no numpy/astropy/torch imports).

Used via docker-compose.e2e.yml which swaps jwst-processing for this mock.
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import sys

# 1x1 transparent PNG (68 bytes) — valid image for composite/mosaic responses
TINY_PNG = bytes([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
    0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x62, 0x00, 0x00, 0x00, 0x02,
    0x00, 0x01, 0xE5, 0x27, 0xDE, 0xFC, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
])

# Minimal valid FITS header (2880 bytes) — valid for mosaic/export responses
FITS_HEADER = b"SIMPLE  =                    T / conforms to FITS standard" + b" " * 24
FITS_HEADER += b"BITPIX  =                   16 / array data type" + b" " * 33
FITS_HEADER += b"NAXIS   =                    2 / number of array dimensions" + b" " * 23
FITS_HEADER += b"NAXIS1  =                    1 /" + b" " * 49
FITS_HEADER += b"NAXIS2  =                    1 /" + b" " * 49
FITS_HEADER += b"END" + b" " * 77
FITS_HEADER += b" " * (2880 - len(FITS_HEADER))
TINY_FITS = FITS_HEADER + b"\x00\x00"  # 1x1 16-bit pixel


class MockHandler(BaseHTTPRequestHandler):
    """Handles all processing engine routes with canned responses."""

    def do_GET(self):
        if self.path == "/health":
            self._json({"status": "healthy", "service": "mock-processing-engine"})

        elif self.path.startswith("/semantic/index-status"):
            self._json({
                "total_indexed": 10,
                "total_documents": 10,
                "embedding_dim": 384,
                "index_type": "flat",
                "last_updated": "2026-01-01T00:00:00Z",
            })

        elif self.path.startswith("/analysis/table-info"):
            self._json({
                "hdus": [{"name": "PRIMARY", "type": "image", "columns": []}],
                "total_rows": 0,
            })

        elif self.path.startswith("/analysis/table-data"):
            self._json({"total_rows": 0, "page": 0, "page_size": 50, "rows": []})

        elif self.path.startswith("/analysis/spectral-data"):
            self._json({
                "columns": [
                    {"name": "WAVELENGTH", "unit": "um"},
                    {"name": "FLUX", "unit": "Jy"},
                ],
                "data": {"WAVELENGTH": [1.0, 2.0, 3.0], "FLUX": [0.1, 0.2, 0.3]},
                "n_points": 3,
                "hdu_name": "EXTRACT1D",
            })

        elif self.path.startswith("/mast/download/progress"):
            self._json({"status": "COMPLETE", "progress": 100, "files": []})

        elif self.path.startswith("/mast/download/resumable"):
            self._json([])

        else:
            self._json({"error": f"Unknown GET route: {self.path}"}, status=404)

    def do_POST(self):
        # Read request body (ignore content for mock purposes)
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > 0:
            self.rfile.read(content_length)

        if self.path == "/composite/generate-nchannel":
            self._blob(TINY_PNG, "image/png")

        elif self.path == "/mosaic/generate":
            self._blob(TINY_FITS, "application/fits")

        elif self.path == "/mosaic/generate-observation":
            self._blob(TINY_FITS, "application/fits")

        elif self.path == "/mosaic/footprint":
            self._json({
                "footprints": [],
                "bounding_box": {
                    "ra_min": 0.0, "ra_max": 1.0,
                    "dec_min": 0.0, "dec_max": 1.0,
                },
                "n_files": 1,
            })

        elif self.path == "/semantic/search":
            self._json({
                "query": "test",
                "results": [],
                "embed_time_ms": 1,
                "search_time_ms": 1,
                "total_indexed": 10,
            })

        elif self.path == "/semantic/embed-batch":
            self._json({"embedded_count": 0, "total_indexed": 10})

        elif self.path == "/discovery/suggest-recipes":
            self._json({"recipes": [], "target_name": "test", "observation_count": 0})

        elif self.path == "/analysis/region-statistics":
            self._json({
                "pixel_count": 100, "mean": 50.0, "std": 10.0,
                "min": 0.0, "max": 100.0, "sum": 5000.0,
            })

        elif self.path == "/analysis/detect-sources":
            self._json({"sources": [], "count": 0, "method": "daofind"})

        elif self.path.startswith("/mast/search/"):
            self._json({"results": [], "total_count": 0})

        elif self.path == "/mast/products":
            self._json({"products": [], "total_count": 0})

        elif self.path.startswith("/mast/download"):
            self._json({"status": "complete", "files": [], "job_id": "mock-job-1"})

        elif self.path == "/semantic/embed":
            self._json({"embedded": True, "total_indexed": 10})

        else:
            self._json({"error": f"Unknown POST route: {self.path}"}, status=404)

    def do_DELETE(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > 0:
            self.rfile.read(content_length)

        if self.path.startswith("/mast/download/resumable/"):
            self._json({"deleted": True})
        else:
            self._json({"error": f"Unknown DELETE route: {self.path}"}, status=404)

    def _json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _blob(self, data, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        """Log to stdout so Docker logs capture it."""
        sys.stdout.write(f"[mock-engine] {args[0]} {args[1]} {args[2]}\n")
        sys.stdout.flush()


if __name__ == "__main__":
    port = 8000
    server = HTTPServer(("0.0.0.0", port), MockHandler)
    print(f"[mock-engine] Mock processing engine running on port {port}", flush=True)
    server.serve_forever()
