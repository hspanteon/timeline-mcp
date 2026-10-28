# Presence of this file at the project root puts the root on sys.path for pytest,
# so tests under tests/ can `import panteon_client` without packaging the project.

import pytest


@pytest.fixture(autouse=True)
def _request_log_dir(tmp_path, monkeypatch):
    # Keep the daily Timeline request log out of the real logs/ folder.
    monkeypatch.setenv("PANTEON_REQUEST_LOG_DIR", str(tmp_path / "request-logs"))


@pytest.fixture(autouse=True)
def _no_request_pacing(monkeypatch):
    monkeypatch.setenv("PANTEON_MIN_REQUEST_GAP_MS", "0")
