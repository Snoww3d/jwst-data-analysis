"""Route-level regression test for #1010: POST /mast/download reports
`file_count == len(files)` even when the MAST service's own count disagrees."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.mast import routes
from main_mast import app


client = TestClient(app)


@patch("app.mast.routes._persist_to_storage", new_callable=AsyncMock)
@patch.object(routes.mast_service, "download_observation")
def test_download_response_file_count_matches_files(mock_download, _mock_persist):
    mock_download.return_value = {
        "status": "completed",
        "files": ["a_cal.fits", "b_cal.fits"],
        "file_count": 99,
        "download_dir": "/app/data/mast/jw02733-o001",
        "timestamp": "2026-11-07T00:00:00Z",
    }

    response = client.post("/mast/download", json={"obs_id": "jw02733-o001"})

    assert response.status_code == 200
    body = response.json()
    assert body["files"] == ["a_cal.fits", "b_cal.fits"]
    assert body["file_count"] == len(body["files"]) == 2
