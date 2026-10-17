"""Dashboard data helpers and HTTP layer. No network: the client is monkeypatched."""
import json
from datetime import date

import pytest
import requests
from starlette.testclient import TestClient

import dashboard
import panteon_client as pc


def _planners(tasks_by_period, user_id=135):
    return {p: [{"user_id": user_id, "data": tasks_by_period.get(p, [])}] for p in pc.PLANNER_PERIODS}


def _task(issue, order=1, **extra):
    return {"issue_number": issue, "code": "15033", "title": f"Task {issue}", "priority_sort_order": order,
            "stage_status": "QA in progress", "task_status": "open", "deadline": None, "support": 0, **extra}


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("PANTEON_BEARER_TOKEN", "tok")
    app = dashboard.create_app(user_id=135, base_dir=str(tmp_path))
    return TestClient(app, base_url="http://127.0.0.1:8765")


class TestPlannerOverview:
    def test_shape_flags_and_urls(self):
        planners = _planners({"now": [_task(2, 2, deadline="2026-10-01", support=1), _task(1, 1)]})
        overview = pc.planner_overview(planners, 135, today=date(2026, 10, 16))
        now = overview["periods"]["now"]
        assert overview["today"] == "2026-10-16"
        assert now["label"] == "Now"
        assert [t["issue_number"] for t in now["tasks"]] == [1, 2]
        assert now["tasks"][1]["deadline_flag"] == "overdue" and now["tasks"][1]["support"] is True
        assert now["tasks"][0]["url"] == f"{pc.BASE_URL}/tasks#/list/15033/edit/1"
        assert now["tasks"][0]["code"] == "15033"
        assert overview["periods"]["commingup"]["tasks"] == []

    def test_absent_user_raises(self):
        with pytest.raises(LookupError):
            pc.planner_overview({p: [] for p in pc.PLANNER_PERIODS}, 135)

    def test_task_url_needs_both_parts(self):
        assert pc.task_url(5, None) is None and pc.task_url(None, "1") is None


class TestPlannerHistory:
    def _save(self, tmp_path, day, tasks, user=135):
        snap = {"user_id": user, "date": day, "tasks": tasks}
        pc.save_planner_snapshot(snap, str(tmp_path))

    def test_history_newest_first_with_urls(self, tmp_path):
        t1 = {"issue_number": 1, "code": "9", "title": "A", "period": "now", "position": 1,
              "stage_status": "QA", "task_status": "open", "deadline": None}
        t2 = {**t1, "issue_number": 2, "title": "B"}
        self._save(tmp_path, "2026-10-14", {"1": t1})
        self._save(tmp_path, "2026-10-15", {"1": t1})
        self._save(tmp_path, "2026-10-16", {"1": t1, "2": t2})
        self._save(tmp_path, "2026-10-13", {}, user=999)
        history = pc.planner_history(135, str(tmp_path))
        assert history["first_date"] == "2026-10-14"
        assert [d["date"] for d in history["days"]] == ["2026-10-16", "2026-10-15"]
        assert history["days"][1]["diff"] == {"added": [], "removed": [], "moved": [], "changed": []}
        added = history["days"][0]["diff"]["added"]
        assert added[0]["issue_number"] == 2 and added[0]["url"].endswith("/list/9/edit/2")

    def test_empty_history(self, tmp_path):
        assert pc.planner_history(135, str(tmp_path)) == {"user_id": 135, "first_date": None, "days": []}


class TestDashboardHttp:
    def test_index_and_static(self, client):
        assert "Timeline desk" in client.get("/").text
        assert client.get("/static/app.js").status_code == 200

    def test_accepts_timeline_localhost(self, tmp_path):
        app = dashboard.create_app(user_id=135, base_dir=str(tmp_path))
        named = TestClient(app, base_url="http://timeline.localhost:8765")
        assert named.get("/").status_code == 200

    def test_rejects_foreign_host(self, monkeypatch, tmp_path):
        app = dashboard.create_app(user_id=135, base_dir=str(tmp_path))
        evil = TestClient(app, base_url="http://evil.example:8765")
        assert evil.get("/api/changes").status_code == 400

    def test_planner(self, client, monkeypatch):
        monkeypatch.setattr(pc, "get_priority_tasks",
                            lambda headers, period="now": _planners({"now": [_task(7)]})[period])
        body = client.get("/api/planner").json()
        assert body["user_id"] == 135
        assert body["periods"]["now"]["tasks"][0]["issue_number"] == 7

    def test_missing_credentials_is_401(self, client, monkeypatch):
        monkeypatch.delenv("PANTEON_BEARER_TOKEN", raising=False)
        monkeypatch.delenv("PANTEON_COOKIE", raising=False)
        response = client.get("/api/planner")
        assert response.status_code == 401 and "error" in response.json()

    def test_upstream_error_is_502(self, client, monkeypatch):
        def boom(headers, period="now"):
            raise requests.HTTPError(response=type("R", (), {"status_code": 500})())
        monkeypatch.setattr(pc, "get_priority_tasks", boom)
        assert client.get("/api/planner").status_code == 502

    def test_statuses(self, client, monkeypatch):
        monkeypatch.setattr(pc, "get_task_by_issue",
                            lambda issue_id, headers, company_id=None: {"data": {"title": "T", "stage_qa": 4}})
        body = client.get("/api/statuses?ids=5,6 5").json()
        assert [s["issue_id"] for s in body["statuses"]] == ["5", "6"]
        assert body["statuses"][0]["release_state"] == "qa approved"

    def test_statuses_validation(self, client):
        assert client.get("/api/statuses").status_code == 400
        too_many = ",".join(str(i) for i in range(dashboard.MAX_STATUS_IDS + 1))
        assert client.get(f"/api/statuses?ids={too_many}").status_code == 400

    def test_task(self, client, monkeypatch):
        monkeypatch.setattr(pc, "fetch_task_data", lambda ident, headers: {
            "issue_id": ident, "task_id": 1,
            "task_meta": {"title": "Hello", "creator": "Ann", "created_date": "2026-10-01", "status": "open",
                          "tags": ["x"], "description": "Body ![](/img/a.png)"},
            "comments": [{"author": "Ann", "created_at": "01.10.2026 10:00", "description": "Hi", "images": []}],
        })
        body = client.get("/api/task/42").json()
        assert body["title"] == "Hello" and body["comments"][0]["author"] == "Ann"
        assert body["description"] == "Body ![](/img/a.png)"

    def test_unknown_task_is_404(self, client, monkeypatch):
        def missing(ident, headers):
            raise requests.HTTPError(response=type("R", (), {"status_code": 422})())
        monkeypatch.setattr(pc, "fetch_task_data", missing)
        assert client.get("/api/task/999").status_code == 404

    def test_snapshot_requires_header(self, client, tmp_path):
        assert client.post("/api/snapshot").status_code == 403
        assert not (tmp_path / "timeline").exists()

    def test_snapshot_saves(self, client, monkeypatch, tmp_path):
        monkeypatch.setattr(pc, "get_priority_tasks",
                            lambda headers, period="now": _planners({"now": [_task(7)]})[period])
        response = client.post("/api/snapshot", headers={"X-Timeline-Desk": "1"})
        assert response.status_code == 200 and response.json()["tasks"] == 1
        saved = list((tmp_path / "timeline" / "planner").glob("*.json"))
        assert len(saved) == 1 and json.loads(saved[0].read_text())["user_id"] == 135

    def test_changes(self, client):
        assert client.get("/api/changes").json()["days"] == []
