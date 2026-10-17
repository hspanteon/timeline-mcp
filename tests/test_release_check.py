"""release_check: parsing helpers and the full report over a fake git/gh runner."""
import json
from datetime import date

import pytest
from starlette.testclient import TestClient

import dashboard
import release_check as rc


class TestParsing:
    @pytest.mark.parametrize("subject,branch", [
        ("Merge pull request #671 from Panteon-norway/5627-product-search", "5627-product-search"),
        ("Merge branch '4107-serial-number' into qa-release", "4107-serial-number"),
        ("Merge remote-tracking branch 'origin/3627-loomis' into qa-release", "3627-loomis"),
        ("Merge 4054 In qa-release", "4054"),
        ("Merge branch 'master' into qa-release", None),
        ("Merge remote-tracking branch 'origin/qa-release' into qa-release", None),
        ("Merge branch 'qa-release' of https://github.com/Panteon-norway/duell-admin into qa-release", None),
        ("Fix typo", None),
    ])
    def test_merged_branch(self, subject, branch):
        assert rc.merged_branch(subject) == branch

    def test_task_ids(self):
        assert rc.task_id_from_branch("temp-4608-general-settings") == "4608"
        assert rc.task_id_from_branch("pos-settings-error-logs-fixes") is None
        assert rc.task_id_from_title("PROD: #6034 - BUG: x") == "6034"
        assert rc.task_id_from_title("PROD : 4128 event channel") == "4128"
        assert rc.pr_task_id({"title": "PROD: fix", "headRefName": "5749-bug"}) == "5749"

    def test_release_entry_normalizes_levels(self):
        body = " - #4128 - Event channel\n    - Implement UI as per figma\n        - Sub point here\n - #1 - Other\n"
        entry = rc.release_entry(body, "4128")
        assert entry["title"] == "Event channel"
        assert entry["bullets"] == [(1, "Implement UI as per figma"), (2, "Sub point here")]
        assert entry["indent_ok"] is False
        assert rc.release_entry("- #4128 - Event channel\n  - Added the form tabs\n", "4128")["indent_ok"] is True
        assert rc.release_entry(body, "999") is None

    def test_note_problems(self):
        good = {"title": "PROD: #6034 - BUG: x", "body": "- #6034 - BUG: x\n  - Fixed course delete on update\n"}
        assert rc.note_problems(good, "master", "6034", "BUG: x") == []
        bad = {"title": "6034 fix", "body": "## Summary\n- [ ] tested\n- #6034 - Old title\n  - fixed\n"}
        problems = rc.note_problems(bad, "master", "6034", "BUG: x")
        assert "Title should start with PROD:" in problems
        assert "Description has headings or checklists" in problems
        assert "No change bullets under the entry" in problems
        assert any(p.startswith("Entry title differs") for p in problems)
        assert rc.note_problems({"title": "QA: 5", "body": ""}, "qa-release", "5555", None) == [
            "No `- #5555 - <title>` entry in the description"]

    def test_checks_summary_treats_snyk_as_warning(self):
        summary = rc.summarize_checks([
            {"__typename": "CheckRun", "name": "CI", "status": "COMPLETED", "conclusion": "FAILURE"},
            {"__typename": "CheckRun", "name": "Lint", "status": "IN_PROGRESS", "conclusion": ""},
            {"__typename": "StatusContext", "context": "security/snyk (phpanteon)", "state": "FAILURE"},
            {"__typename": "StatusContext", "context": "other", "state": "SUCCESS"},
        ])
        assert summary["failed"] == ["CI"] and summary["pending"] == ["Lint"]
        assert len(summary["warnings"]) == 1 and summary["total"] == 4

    def test_versions(self):
        assert rc.bump_version("v1.0.2.9") == "v1.0.3.0"
        assert rc.bump_version("v1.0.3.1") == "v1.0.3.2"
        releases = [
            {"tagName": "v1.0.3.1", "isDraft": False, "publishedAt": "2026-10-16T01:47:17Z"},
            {"tagName": "v1.0.3.1-qa", "isDraft": False, "publishedAt": "2026-10-15T05:22:56Z"},
            {"tagName": "v1.0.3.0", "isDraft": False, "publishedAt": "2026-10-14T03:09:56Z"},
        ]
        v = rc.next_versions(releases)
        assert v["latest_prod"] == {"tag": "v1.0.3.1", "date": "2026-10-16"}
        assert v["next_prod"] == "v1.0.3.2" and v["next_qa"] == "v1.0.3.2-qa" and v["draft"] is None
        v = rc.next_versions(releases + [{"tagName": "v1.0.3.2-qa", "isDraft": False}, {"tagName": "v1.0.3.2", "isDraft": True}])
        assert v["draft"] == "v1.0.3.2" and v["next_prod"] == "v1.0.3.2" and v["next_qa"] == "v1.0.3.3-qa"


# ---- full report over a fake repo ---------------------------------------
LOG = "\n".join([
    "m4\x1fq3 b4\x1f2026-10-16T12:00:00+02:00\x1fMerge pull request #9 from Panteon-norway/2222-two",
    "m3\x1fq2 b3\x1f2026-10-15T12:00:00+02:00\x1fMerge branch 'hotfix-logs' into qa-release",
    "m2\x1fq1 b2\x1f2026-10-14T12:00:00+02:00\x1fMerge branch 'master' into qa-release",
    "m1\x1fq0 b1\x1f2026-10-13T12:00:00+02:00\x1fMerge remote-tracking branch 'origin/1111-one' into qa-release",
    "m0\x1fqx b0\x1f2026-10-12T12:00:00+02:00\x1fMerge branch '3333-shipped' into qa-release",
])


def _pr(number, title, branch, body, oid="tip", **extra):
    return {"number": number, "title": title, "headRefName": branch, "headRefOid": oid, "body": body,
            "isDraft": False, "createdAt": "2026-10-10T08:00:00Z", "reviewDecision": "", "mergeable": "MERGEABLE",
            "statusCheckRollup": [], "url": f"https://github.com/x/pull/{number}", "author": {"login": "dev"}, **extra}


def _gh_outputs():
    return {
        ("pr", "list", "--base", "qa-release", "--state", "open"): [
            _pr(10, "QA: 4444 four", "4444-four", "- #4444 - Four\n  - Added the fourth thing\n")],
        ("pr", "list", "--base", "master", "--state", "open"): [
            _pr(11, "PROD: #1111 - One", "1111-one", "- #1111 - One\n  - Changed the first screen\n", oid="b1"),
            _pr(12, "PROD: #5555 - Five", "5555-five", "- #5555 - Five\n  - Direct fix for five\n", oid="z9"),
            _pr(13, "PROD: quick css fix", "css-fix", "", oid="z8", isDraft=True),
            _pr(14, "PROD: #2222 - Two", "2222-two", "- #2222 - Two\n  - Updated the second report\n", oid="z7")],
        ("pr", "list", "--base", "qa-release", "--state", "merged"): [
            {"number": 9, "headRefName": "2222-two", "title": "QA: 2222", "body": "- #2222 - Two\n  - Updated the second report\n"}],
        ("release", "list"): [{"tagName": "v1.0.3.1", "isDraft": False, "publishedAt": "2026-10-16T01:00:00Z"}],
    }


def fake_runner(calls):
    gh = _gh_outputs()

    def run(args, cwd, timeout):
        calls.append(tuple(args))
        args = tuple(args)
        if args[:3] == ("git", "remote", "get-url"):
            return 0, "https://github.com/Panteon-norway/duell-admin.git\n", ""
        if args[:2] == ("git", "fetch"):
            return 0, "", ""
        if args[:2] == ("git", "log"):
            return 0, LOG + "\n", ""
        if args == ("git", "rev-list", "origin/master"):
            return 0, "b0\nb2\nmaster1\n", ""  # 3333-shipped (b0) is already in master
        if args[:3] == ("git", "rev-list", "--no-merges"):
            counts = {"z9": "2\n", "z7": "0\n"}  # z7 differs from QA only by merges of master
            return (0, counts[args[4]], "") if args[4] in counts else (128, "", "fatal: bad object")
        if args == ("git", "rev-list", "origin/master..origin/qa-release"):
            return 0, "m4\nm3\nm1\nb1\nb3\nb4\n", ""
        if args[0] == "gh":
            for key, value in gh.items():
                if args[1:1 + len(key)] == key:
                    return 0, json.dumps(value), ""
        return 1, "", f"unexpected {args}"
    return run


STATUSES = {
    "1111": {"issue_id": "1111", "title": "One", "stage_status": "Going live pending", "release_state": "qa approved", "qa_approved": True},
    "2222": {"issue_id": "2222", "title": "Two", "stage_status": "QA in progress", "release_state": "in qa", "qa_approved": False},
    "4444": {"issue_id": "4444", "title": "Four", "stage_status": "Testing", "release_state": "before qa", "qa_approved": False},
    "5555": {"issue_id": "5555", "title": "Five", "stage_status": "Testing", "release_state": "before qa", "qa_approved": False},
}


@pytest.fixture
def repo(tmp_path):
    (tmp_path / ".git").mkdir()
    return str(tmp_path)


def test_full_report(repo):
    calls, looked_up = [], []

    def lookup(ids):
        looked_up.append(list(ids))
        return [STATUSES[i] for i in ids]

    report = rc.build_report(repo, status_lookup=lookup, runner=fake_runner(calls), today=date(2026, 10, 16))

    assert looked_up == [["1111", "2222", "4444", "5555"]]  # one lookup for every ticket
    assert [t["issue_id"] for t in report["tickets"]] == ["1111", "2222"]  # oldest first, shipped dropped
    assert report["no_ticket"][0]["branches"] == ["hotfix-logs"]
    assert report["approval"] == {"approved": 1, "total": 3}
    assert report["pending_qa"] == [{"issue_id": "4444", "number": 10, "title": "Four"}]

    master = {p["number"]: p for p in report["prs"]["master"]}
    assert master[11]["via_qa"] == "yes" and master[11]["verdict"] == "ready"
    assert (master[12]["via_qa"], master[12]["commits_not_on_qa"]) == ("no", 2)
    assert master[13]["via_qa"] == "no" and master[13]["commits_not_on_qa"] is None  # tip not fetched
    assert master[14]["via_qa"] == "yes"
    assert master[11]["body"] == "- #1111 - One\n  - Changed the first screen"
    assert master[13]["verdict"] == "blocked" and master[13]["issue_id"] is None
    qa_pr = report["prs"]["qa-release"][0]
    assert qa_pr["problems"] == [] and qa_pr["verdict"] == "ready"  # no PROD: needed into qa-release
    assert report["mismatches"] == []

    notes = report["notes"]
    assert notes["master"]["name"] == "Release note 16.10.2026 v1.0.3.2"
    assert notes["master"]["body"].splitlines() == [
        "- #1111 - One", "  - Changed the first screen",
        "- #5555 - Five", "  - Direct fix for five",
        "- Hotfixes", "  - PROD: quick css fix",
        "- Not approved (held back)", "  - #2222 - Two — QA in progress",
    ]
    assert notes["qa"]["name"] == "QA Release note 16.10.2026 v1.0.3.2-qa"
    assert notes["qa"]["body"].splitlines() == [
        "- #1111 - One", "  - Changed the first screen",
        "- #2222 - Two", "  - Updated the second report",
        "- Hotfixes", "  - hotfix-logs",
        "- Not approved (held back)", "  - #4444 - Four — not on QA yet",
    ]
    assert notes["drafted"] == []
    # Read-only: the only commands are these.
    assert {c[:2] for c in calls} <= {("git", "remote"), ("git", "fetch"), ("git", "log"), ("git", "rev-list"), ("gh", "pr"), ("gh", "release")}
    assert all(c[2] == "list" for c in calls if c[0] == "gh")


def test_timeline_failure_keeps_git_side(repo):
    def lookup(ids):
        raise PermissionError("Panteon credentials rejected")

    report = rc.build_report(repo, status_lookup=lookup, runner=fake_runner([]), today=date(2026, 10, 16))
    assert report["timeline_error"] == "Panteon credentials rejected"
    assert report["approval"]["approved"] == 0 and len(report["tickets"]) == 2


def test_no_fetch_skips_git_fetch(repo):
    calls = []
    rc.build_report(repo, status_lookup=None, fetch=False, runner=fake_runner(calls), today=date(2026, 10, 16))
    assert not any(c[:2] == ("git", "fetch") for c in calls)


def test_rejects_other_repos(repo, tmp_path):
    def runner(args, cwd, timeout):
        return 0, "git@github.com:someone/else.git\n", ""
    with pytest.raises(rc.ReleaseCheckError, match="not a duell-admin checkout"):
        rc.build_report(repo, runner=runner)
    with pytest.raises(rc.ReleaseCheckError, match="No duell-admin checkout"):
        rc.build_report(str(tmp_path / "missing"), runner=runner)


def test_git_failure_raises(repo):
    def runner(args, cwd, timeout):
        if args[:2] == ("git", "fetch"):
            return 128, "", "fatal: could not read from remote\n"
        return fake_runner([])(args, cwd, timeout)
    with pytest.raises(rc.ReleaseCheckError, match="could not read from remote"):
        rc.build_report(repo, runner=runner)


# ---- dashboard endpoints ------------------------------------------------
@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("PANTEON_BEARER_TOKEN", "tok")
    seen = {}

    def builder(repo_dir=None, status_lookup=None):
        seen["repo_dir"] = repo_dir
        return {"approval": {"approved": 1, "total": 2}}

    app = dashboard.create_app(user_id=135, base_dir=str(tmp_path), repo_dir="/x/duell-admin", release_builder=builder)
    client = TestClient(app, base_url="http://127.0.0.1:8765")
    client.seen = seen
    return client


def test_release_get_is_cache_only(client):
    assert client.get("/api/release").json() == {"report": None}
    assert client.seen == {}


def test_release_refresh_needs_header(client):
    assert client.post("/api/release").status_code == 403
    response = client.post("/api/release", headers={"X-Timeline-Desk": "1"})
    assert response.status_code == 200 and response.json()["report"]["approval"]["approved"] == 1
    assert client.seen["repo_dir"] == "/x/duell-admin"
    assert client.get("/api/release").json()["report"]["approval"]["total"] == 2


def test_release_errors_map_to_502(monkeypatch, tmp_path):
    def builder(**kwargs):
        raise rc.ReleaseCheckError("`gh` is not installed.")
    app = dashboard.create_app(user_id=135, base_dir=str(tmp_path), release_builder=builder)
    response = TestClient(app, base_url="http://127.0.0.1:8765").post("/api/release", headers={"X-Timeline-Desk": "1"})
    assert response.status_code == 502 and response.json()["error"] == "`gh` is not installed."


def test_web_files_revalidate(client):
    assert client.get("/").headers["cache-control"] == "no-cache"
    assert client.get("/static/app.js").headers["cache-control"] == "no-cache"
