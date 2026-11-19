"""work_session: worktrees and the Claude launch, against real git repos in tmp (no network)."""
import json
import os
import subprocess

import pytest
from starlette.testclient import TestClient

import dashboard
import panteon_client as pc
import release_check
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
    long = "Serial number does not get saved if order has packing slip generated and customer is invoiced later"
    assert ws.branch_name("6117", long) == "6117-" + long.lower().replace(" ", "-")  # the whole title, never cut short
    huge = ws.branch_name("6117", "word " * 100)
    assert len(huge) <= ws.MAX_BRANCH and huge.endswith("-word")  # only past the file-name limit, at a word break


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


def test_worktree_created_then_reused(setup):
    cfg = setup["config"]
    result = ws.worktree_for(cfg, "15033", "5001", "New report")
    path = os.path.join(cfg["repos"]["15033"]["worktrees"], "duell-admin-5001")  # the folder is named by the ID only
    assert result == {"path": path, "branch": "5001-new-report", "created": True, "repo": "duell-admin"}
    assert os.path.isfile(os.path.join(path, "a.txt"))
    again = ws.worktree_for(cfg, "15033", "5001", "Renamed")
    assert again["created"] is False and again["path"] == path
    # Found by its folder too, even after the branch is renamed.
    git(path, "branch", "-m", "renamed-by-hand")
    assert ws.worktree_for(cfg, "15033", "5001", "x")["path"] == path
    listed = ws.list_worktrees(cfg)
    assert [(w["issue_id"], w["branch"]) for w in listed] == [("5001", "renamed-by-hand")]


def test_worktree_reuses_remote_branch(setup):
    result = ws.worktree_for(setup["config"], "15033", "6034", "Whatever")
    assert result["branch"] == "6034-existing" and result["created"] is True
    assert result["path"].endswith(os.sep + "duell-admin-6034")
    assert os.path.isfile(os.path.join(result["path"], "b.txt"))
    assert git(result["path"], "rev-parse", "--abbrev-ref", "@{u}").strip() == "origin/6034-existing"


def test_worktree_validates(setup):
    with pytest.raises(ValueError, match="no repo"):
        ws.worktree_for(setup["config"], "999", "5001", "x")
    with pytest.raises(ValueError, match="number"):
        ws.worktree_for(setup["config"], "15033", "50; rm", "x")


def test_terminal_command_passes_args_and_exit_file(setup):
    args = ws.terminal_command(setup["config"], "/w", "#1", ["--session-id", "abc", "the prompt"], "/w/x.exit")
    assert args[0] == "gnome-terminal" and "--working-directory=/w" in args
    assert args[-6:] == ["/w", "/w/x.exit", "/opt/node/bin/claude", "--session-id", "abc", "the prompt"]
    assert ws.launch_env(setup["config"])["PATH"].startswith("/opt/node/bin" + os.pathsep)


def test_list_and_remove(setup):
    cfg = setup["config"]
    clean = ws.worktree_for(cfg, "15033", "5001", "Clean one")["path"]
    work = ws.worktree_for(cfg, "15033", "5002", "Work one")["path"]
    (setup["repo"].parent / "duell-admin-worktrees" / "duell-admin-5002" / "c.txt").write_text("c\n")

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


def test_worktree_timeline_links_to_main_checkout(setup):
    cfg, repo = setup["config"], setup["repo"]
    path = ws.worktree_for(cfg, "15033", "5001", "New report")["path"]
    link = os.path.join(path, "timeline")
    assert os.path.islink(link) and os.path.realpath(link) == os.path.realpath(repo / "timeline")
    (repo / "timeline" / "5001").mkdir()
    (repo / "timeline" / "5001" / "analysis.md").write_text("plan\n")
    assert open(os.path.join(link, "5001", "analysis.md")).read() == "plan\n"  # same files on both sides

    # git ignores the link (a `timeline/` gitignore line alone wouldn't), so the worktree stays clean
    assert git(path, "status", "--porcelain") == ""
    assert {i["issue_id"]: i for i in ws.list_worktrees(cfg)}["5001"]["dirty"] == 0
    excluded = open(repo / ".git" / "info" / "exclude").read()
    ws.worktree_for(cfg, "15033", "5001", "New report")
    assert open(repo / ".git" / "info" / "exclude").read() == excluded  # added once

    # removing the worktree drops the link, never the task docs
    ws.remove_worktree(cfg, path)
    assert not os.path.exists(path) and (repo / "timeline" / "5001" / "analysis.md").read_text() == "plan\n"


def test_old_worktree_timeline_is_merged(setup):
    cfg, repo = setup["config"], setup["repo"]
    path = ws.worktree_for(cfg, "15033", "5001", "x")["path"]
    os.remove(os.path.join(path, "timeline"))  # a worktree from before the link existed
    old = os.path.join(path, "timeline", "5001")
    os.makedirs(old)
    for name, text in {"spec.md": "spec\n", "task.md": "same\n", "progress.md": "mine\n"}.items():
        with open(os.path.join(old, name), "w") as fh:
            fh.write(text)
    (repo / "timeline" / "5001").mkdir(parents=True)
    (repo / "timeline" / "5001" / "task.md").write_text("same\n")
    (repo / "timeline" / "5001" / "progress.md").write_text("theirs\n")

    result = ws.worktree_for(cfg, "15033", "5001", "x")
    assert "5001/progress.md" in result["note"] and not os.path.islink(os.path.join(path, "timeline"))
    assert (repo / "timeline" / "5001" / "spec.md").read_text() == "spec\n"  # moved over
    assert sorted(os.listdir(old)) == ["progress.md"]  # identical task.md dropped, the clash kept

    os.remove(os.path.join(old, "progress.md"))
    result = ws.worktree_for(cfg, "15033", "5001", "x")
    assert "note" not in result and os.path.islink(os.path.join(path, "timeline"))
    assert (repo / "timeline" / "5001" / "progress.md").read_text() == "theirs\n"


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
    assert client.get("/api/work/config").json() == {"boards": {"15033": "duell-admin"}, "projects": []}
    assert client.post("/api/work/start", json={"issue": "5001", "code": "15033"}).status_code in (404, 405)  # gone

    h = {"X-Timeline-Desk": "1"}
    ws.worktree_for(setup["config"], "15033", "5001", "From Timeline")

    listed = client.get("/api/work/worktrees").json()["worktrees"]
    assert [w["branch"] for w in listed] == ["5001-from-timeline"]
    assert client.post("/api/work/remove", json={"path": listed[0]["path"]}).status_code == 403
    removed = client.post("/api/work/remove", json={"path": listed[0]["path"]}, headers=h).json()
    assert removed["removed"] == listed[0]["path"]
    assert client.post("/api/work/remove", json={"path": "/etc"}, headers=h).status_code == 400


# ---- existing work (the pre-start check) -----------------------------------
def gh_runner(prs=None, fail=None):
    """Real git; `gh pr list` answers with `prs` (or fails with `fail`), so no test reaches GitHub."""
    calls = []

    def runner(args, cwd, timeout):
        calls.append(tuple(args))
        if args[0] == "gh":
            if fail:
                return 1, "", fail
            return 0, json.dumps(prs or []), ""
        return release_check._subprocess_runner(args, cwd, timeout)
    runner.calls = calls
    return runner


def pushed_elsewhere(setup, branch, message, files=None, base="master"):
    """A colleague's clone pushes `branch` (after the desk's clone was made, so only a fetch sees it)."""
    other = setup["tmp"] / "colleague"
    if not other.exists():
        git(setup["tmp"], "clone", "-q", str(setup["tmp"] / "origin.git"), str(other))
        git(other, "config", "user.email", "c@example.com")
        git(other, "config", "user.name", "C")
    git(other, "fetch", "-q", "origin")
    git(other, "checkout", "-q", "-B", branch, f"origin/{base}")
    (other / (files or f"{branch.replace('/', '_')}.txt")).write_text(message + "\n")
    git(other, "add", ".")
    git(other, "commit", "-qm", message)
    git(other, "push", "-q", "origin", branch)
    return other


def test_existing_work_finds_branches_prs_and_commits(setup):
    repo = setup["config"]["repos"]["15033"]
    other = pushed_elsewhere(setup, "feature/6034-other-try", "second try")
    pushed_elsewhere(setup, "60345-unrelated", "another task")  # a longer number isn't #6034
    # qa-release has 6034-existing merged; master has a TL #6034 commit.
    git(other, "checkout", "-q", "-B", "qa-release", "origin/master")
    git(other, "merge", "-q", "--no-ff", "-m", "Merge 6034 In qa-release", "origin/6034-existing")
    git(other, "push", "-q", "origin", "qa-release")
    pushed_elsewhere(setup, "master", "TL #6034 hotfix")
    prs = [
        {"number": 12, "title": "6034 Cannot delete course", "state": "OPEN", "isDraft": False, "headRefName": "6034-existing",
         "baseRefName": "qa-release", "url": "https://github.com/o/r/pull/12", "updatedAt": "2026-11-01T10:00:00Z"},
        {"number": 13, "title": "Other", "state": "MERGED", "isDraft": False, "headRefName": "60345-unrelated",
         "baseRefName": "master", "url": "https://github.com/o/r/pull/13", "updatedAt": "2026-11-01T10:00:00Z"},
    ]
    runner = gh_runner(prs)
    found = ws.existing_work(repo, "6034", runner)
    assert found["fetched"] and found["fetch_error"] is None and found["worktree"] is None
    by_name = {b["name"]: b for b in found["branches"]}
    assert set(by_name) == {"6034-existing", "feature/6034-other-try"}  # fetched, so the colleague's branch is seen
    assert by_name["6034-existing"]["remote"] and not by_name["6034-existing"]["local"]
    assert by_name["6034-existing"]["ahead"] == 1 and by_name["6034-existing"]["in_qa"] is True
    assert by_name["feature/6034-other-try"]["in_qa"] is False
    assert [(c["ref"], c["subject"]) for c in found["commits"]] == [
        ("master", "TL #6034 hotfix"), ("qa-release", "Merge 6034 In qa-release")]
    assert [p["number"] for p in found["prs"]] == [12]
    assert ("gh", "pr", "list") == runner.calls[-1][:3] and "--state" in runner.calls[-1]

    ws.worktree_for(setup["config"], "15033", "6034", "x")
    found = ws.existing_work(repo, "6034", gh_runner(fail="gh: not logged in"), fetch=False)
    assert found["worktree"]["branch"] == "6034-existing" and not found["fetched"]
    assert {b["name"]: b["worktree"] for b in found["branches"]}["6034-existing"] == found["worktree"]["path"]
    assert found["prs"] == [] and "not logged in" in found["pr_error"]
    with pytest.raises(ValueError):
        ws.existing_work(repo, "60; x", runner)


def test_existing_work_survives_a_failed_fetch(setup):
    repo = setup["config"]["repos"]["15033"]
    git(setup["repo"], "remote", "set-url", "origin", str(setup["tmp"] / "gone.git"))
    found = ws.existing_work(repo, "6034", gh_runner())
    assert not found["fetched"] and "fetch" in found["fetch_error"]
    assert [b["name"] for b in found["branches"]] == ["6034-existing"]  # still the refs it has


def test_worktree_on_a_chosen_branch(setup):
    cfg = setup["config"]
    pushed_elsewhere(setup, "feature/6034-other-try", "second try")
    git(setup["repo"], "fetch", "-q", "origin")
    with pytest.raises(ValueError, match="doesn't name #6034"):
        ws.worktree_for(cfg, "15033", "6034", "x", branch="feature/9999-x", strict=True)
    with pytest.raises(ws.WorkSessionError, match="no branch"):
        ws.worktree_for(cfg, "15033", "6034", "x", branch="6034-gone", strict=True)
    result = ws.worktree_for(cfg, "15033", "6034", "x", branch="feature/6034-other-try", strict=True)
    assert result["branch"] == "feature/6034-other-try" and result["created"]
    assert result["path"].endswith(os.sep + "duell-admin-6034")
    assert git(result["path"], "rev-parse", "--abbrev-ref", "@{u}").strip() == "origin/feature/6034-other-try"
    # Later runs find it by that branch; picking another one at start is refused.
    assert ws.worktree_for(cfg, "15033", "6034", "x", branch="feature/6034-other-try")["path"] == result["path"]
    with pytest.raises(ws.WorkSessionError, match="is on feature/6034-other-try"):
        ws.worktree_for(cfg, "15033", "6034", "x", branch="6034-existing", strict=True)
    # Not strict (a run whose branch is gone): the usual rules.
    assert ws.worktree_for(cfg, "15033", "6034", "x", branch="6034-gone")["path"] == result["path"]


def test_worktree_sees_a_task_branch_pushed_since_the_last_fetch(setup):
    pushed_elsewhere(setup, "5001-started-elsewhere", "colleague's start")
    result = ws.worktree_for(setup["config"], "15033", "5001", "New report")
    assert result["branch"] == "5001-started-elsewhere"
