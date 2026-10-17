"""work_session: worktrees and the Claude launch, against real git repos in tmp (no network)."""
import json
import os
import subprocess

import pytest
from starlette.testclient import TestClient

import dashboard
import panteon_client as pc
import work_session as ws


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


@pytest.fixture
def setup(tmp_path):
    """An 'origin' with master and 6034-existing, a clone of it, and a config for board 15033."""
    seed = tmp_path / "seed"
    seed.mkdir()
    git(seed, "init", "-q", "-b", "master")
    git(seed, "config", "user.email", "t@example.com")
    git(seed, "config", "user.name", "T")
    (seed / "a.txt").write_text("a\n")
    git(seed, "add", ".")
    git(seed, "commit", "-qm", "init")
    git(seed, "checkout", "-qb", "6034-existing")
    (seed / "b.txt").write_text("b\n")
    git(seed, "add", "b.txt")
    git(seed, "commit", "-qm", "x")
    git(seed, "checkout", "-q", "master")
    origin = tmp_path / "origin.git"
    git(tmp_path, "clone", "-q", "--bare", str(seed), str(origin))
    repo = tmp_path / "duell-admin"
    git(tmp_path, "clone", "-q", str(origin), str(repo))
    git(repo, "config", "user.email", "t@example.com")
    git(repo, "config", "user.name", "T")
    config_file = tmp_path / "timeline-desk.json"
    config_file.write_text(json.dumps({
        "repos": {"15033": {"name": "duell-admin", "path": "duell-admin", "base": "master"}},
        "claude": "/opt/node/bin/claude",
        "terminal": "gnome-terminal",
    }))
    launched = []
    return {
        "tmp": tmp_path, "repo": repo, "config": ws.load_config(str(config_file)),
        "launched": launched, "launcher": lambda args, env: launched.append((args, env)),
    }


def test_slug_and_prompt():
    assert ws.branch_name("5975", "[PRI2] [BO] [Billakksenteret AS]  Unused product number") == "5975-unused-product-number"
    assert ws.branch_name("6034", "BUG: Cannot delete Course") == "6034-cannot-delete-course"
    assert ws.slugify("Søk på ordre") == "sk-pa-ordre"  # ascii only
    assert ws.slugify("!!!") == "task"
    repo = {"name": "duell-admin", "base": "master"}
    prompt = ws.build_prompt("6034", repo, "6034-x")
    assert "#6034" in prompt and "`6034-x`" in prompt and "Never push" in prompt and ws.TASK_SPEC_SKILL in prompt


def test_load_config_defaults(tmp_path):
    assert ws.load_config(str(tmp_path / "missing.json"))["repos"] == {}
    cfg = tmp_path / "c.json"
    cfg.write_text(json.dumps({"repos": {"1": {"path": "../x"}}}))
    repo = ws.load_config(str(cfg))["repos"]["1"]
    assert repo["path"] == os.path.normpath(str(tmp_path / "../x"))
    assert repo["worktrees"] == repo["path"] + "-worktrees" and repo["base"] == "master" and repo["name"] == "x"
    cfg.write_text("{bad")
    with pytest.raises(ws.WorkSessionError):
        ws.load_config(str(cfg))


def test_start_creates_then_reuses(setup):
    cfg = setup["config"]
    result = ws.start_session(cfg, "15033", "5001", "New report", launcher=setup["launcher"])
    path = os.path.join(cfg["repos"]["15033"]["worktrees"], "5001-new-report")
    assert result == {"path": path, "branch": "5001-new-report", "created": True, "repo": "duell-admin",
                      "action": "implement", "label": "Implement"}
    assert os.path.isfile(os.path.join(path, "a.txt"))
    args, env = setup["launched"][0]
    assert args[0] == "gnome-terminal" and f"--working-directory={path}" in args
    assert args[-3:-1] == [path, "/opt/node/bin/claude"] and "#5001" in args[-1]
    assert "New report" not in args[-1]  # task text never goes into the prompt
    assert env["PATH"].startswith("/opt/node/bin" + os.pathsep)

    again = ws.start_session(cfg, "15033", "5001", "Renamed", launcher=setup["launcher"])
    assert again["created"] is False and again["path"] == path and again["action"] == "resume"
    assert "Resume" in setup["launched"][-1][0][-1]


def stages(**progress):
    base = {label: "not started" for label in ("RSD", "Estimate", "Development", "Testing", "QA", "Live")}
    return {**base, **progress}


@pytest.mark.parametrize("progress, action", [
    ({}, "spec"),
    ({"RSD": "in progress"}, "spec"),
    ({"RSD": "done", "Estimate": "done"}, "implement"),
    ({"Estimate": "skipped"}, "implement"),
    ({"Development": "in progress"}, "implement"),
    ({"Development": "done"}, "qa"),
    ({"Development": "done", "Testing": "done", "QA": "in progress"}, "qa"),
    ({"Development": "done", "QA": "done"}, "done"),
    ({"QA": "done", "Live": "done"}, "done"),
    ({"Development": "in progress", "Testing": "blocked"}, "blocked"),
])
def test_choose_action(progress, action):
    assert ws.choose_action(stages(**progress)) == action
    assert ws.choose_action(None) == "spec"


def test_start_by_stage(setup):
    cfg, launched = setup["config"], setup["launched"]
    spec = ws.start_session(cfg, "15033", "5003", "Spec me", stages=stages(), launcher=setup["launcher"])
    assert spec["action"] == "spec" and spec["created"] is True
    assert "don't implement" in launched[-1][0][-1]

    qa = ws.start_session(cfg, "15033", "6034", "x", stages=stages(Development="done", QA="in progress"), launcher=setup["launcher"])
    assert qa["action"] == "qa" and qa["branch"] == "6034-existing"
    assert "QA feedback" in launched[-1][0][-1] and "Never push" in launched[-1][0][-1]

    blocked = ws.start_session(cfg, "15033", "5004", "x", stages=stages(Development="blocked"), launcher=setup["launcher"])
    assert blocked["action"] == "blocked" and blocked["branch"] is None and blocked["path"] == cfg["repos"]["15033"]["path"]
    assert "read only" in launched[-1][0][-1]
    assert not any(i["issue_id"] == "5004" for i in ws.list_worktrees(cfg))  # no worktree for a blocked task

    count = len(launched)
    with pytest.raises(ValueError, match="passed QA"):
        ws.start_session(cfg, "15033", "5005", "x", stages=stages(QA="done"), launcher=setup["launcher"])
    assert len(launched) == count


def test_start_reuses_remote_branch(setup):
    result = ws.start_session(setup["config"], "15033", "6034", "Whatever", launcher=setup["launcher"])
    assert result["branch"] == "6034-existing" and result["created"] is True
    assert os.path.isfile(os.path.join(result["path"], "b.txt"))
    assert git(result["path"], "rev-parse", "--abbrev-ref", "@{u}").strip() == "origin/6034-existing"


def test_start_validates(setup):
    with pytest.raises(ValueError, match="no repo"):
        ws.start_session(setup["config"], "999", "5001", "x", launcher=setup["launcher"])
    with pytest.raises(ValueError, match="number"):
        ws.start_session(setup["config"], "15033", "50; rm", "x", launcher=setup["launcher"])
    assert setup["launched"] == []


def test_list_and_remove(setup):
    cfg = setup["config"]
    clean = ws.start_session(cfg, "15033", "5001", "Clean one", launcher=setup["launcher"])["path"]
    work = ws.start_session(cfg, "15033", "5002", "Work one", launcher=setup["launcher"])["path"]
    (setup["repo"].parent / "duell-admin-worktrees" / "5002-work-one" / "c.txt").write_text("c\n")

    items = {i["issue_id"]: i for i in ws.list_worktrees(cfg)}
    assert set(items) == {"5001", "5002"}  # the main checkout isn't listed
    assert items["5001"]["dirty"] == 0 and items["5001"]["merged"] is True and items["5001"]["unpushed"] == 0
    assert items["5002"]["dirty"] == 1 and items["5002"]["size"] > 0

    with pytest.raises(ws.WorkSessionError):  # uncommitted changes: git refuses
        ws.remove_worktree(cfg, work)
    git(work, "add", ".")
    git(work, "commit", "-qm", "TL #5002 work")
    assert {i["issue_id"]: i for i in ws.list_worktrees(cfg)}["5002"]["unpushed"] == 1

    result = ws.remove_worktree(cfg, work, delete_branch=True)
    assert result["branch_deleted"] is False and "Kept the branch" in result["branch_note"]
    assert "5002-work-one" in git(setup["repo"], "branch", "--list", "5002-*")

    result = ws.remove_worktree(cfg, clean, delete_branch=True)
    assert result["branch_deleted"] is True and not os.path.exists(clean)

    with pytest.raises(ValueError):
        ws.remove_worktree(cfg, str(setup["repo"]))  # never the main checkout


# ---- dashboard endpoints ------------------------------------------------
@pytest.fixture
def client(setup, monkeypatch, tmp_path):
    monkeypatch.setenv("PANTEON_BEARER_TOKEN", "tok")
    monkeypatch.setattr(pc, "get_task_statuses", lambda ids, headers: [
        {"issue_id": i, "title": "From Timeline", "stages": {"Estimate": "done", "Development": "not started"}} if i != "404" else {"issue_id": i, "error": "not found"} for i in ids])
    app = dashboard.create_app(user_id=135, base_dir=str(tmp_path), work_config=lambda: setup["config"],
                               work_launcher=setup["launcher"])
    return TestClient(app, base_url="http://127.0.0.1:8765")


def test_work_endpoints(client, setup):
    assert client.get("/api/work/config").json() == {"boards": {"15033": "duell-admin"}}
    assert client.post("/api/work/start", json={"issue": "5001", "code": "15033"}).status_code == 403

    h = {"X-Timeline-Desk": "1"}
    started = client.post("/api/work/start", json={"issue": "5001", "code": "15033"}, headers=h).json()
    assert started["branch"] == "5001-from-timeline" and started["action"] == "implement" and len(setup["launched"]) == 1
    assert client.post("/api/work/start", json={"issue": "404", "code": "15033"}, headers=h).status_code == 404
    assert client.post("/api/work/start", json={"issue": "5001", "code": "1"}, headers=h).status_code == 400

    listed = client.get("/api/work/worktrees").json()["worktrees"]
    assert [w["branch"] for w in listed] == ["5001-from-timeline"]
    assert client.post("/api/work/remove", json={"path": listed[0]["path"]}).status_code == 403
    removed = client.post("/api/work/remove", json={"path": listed[0]["path"]}, headers=h).json()
    assert removed["removed"] == listed[0]["path"]
    assert client.post("/api/work/remove", json={"path": "/etc"}, headers=h).status_code == 400
