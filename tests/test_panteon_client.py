"""Unit tests for panteon_client's pure functions and networking error handling.

No live Panteon credentials or network access are required: HTTP calls are made
against a monkeypatched session.
"""
import pytest

import panteon_client as pc


# --------------------------------------------------------------------------- #
# extract_issue_id
# --------------------------------------------------------------------------- #
class TestExtractIssueId:
    def test_bare_numeric(self):
        assert pc.extract_issue_id("5461") == "5461"

    def test_bare_numeric_with_whitespace(self):
        assert pc.extract_issue_id("  5461  ") == "5461"

    def test_edit_url(self):
        url = "https://timeline.panteon.no/tasks#/list/15033/edit/5461"
        assert pc.extract_issue_id(url) == "5461"

    def test_edit_url_trailing_slash(self):
        url = "https://timeline.panteon.no/tasks#/list/15033/edit/5461/"
        assert pc.extract_issue_id(url) == "5461"

    def test_list_url_without_edit_raises(self):
        # Must NOT silently return the board/list id (15033).
        with pytest.raises(ValueError):
            pc.extract_issue_id("https://timeline.panteon.no/tasks#/list/15033")

    def test_garbage_raises(self):
        with pytest.raises(ValueError):
            pc.extract_issue_id("not-a-task")


# --------------------------------------------------------------------------- #
# _normalize_date
# --------------------------------------------------------------------------- #
class TestNormalizeDate:
    def test_iso(self):
        assert pc._normalize_date("2026-06-26T10:00:00") == "2026-06-26"

    def test_dmy(self):
        assert pc._normalize_date("26.06.2026 10:00") == "2026-06-26"

    def test_empty(self):
        assert pc._normalize_date("") == ""
        assert pc._normalize_date(None) == ""

    def test_unparseable_passthrough(self):
        assert pc._normalize_date("June 26") == "June 26"


# --------------------------------------------------------------------------- #
# _resolve_url
# --------------------------------------------------------------------------- #
class TestResolveUrl:
    def test_absolute_untouched(self):
        assert pc._resolve_url("https://x/y.png") == "https://x/y.png"

    def test_protocol_relative(self):
        assert pc._resolve_url("//cdn/y.png") == "https://cdn/y.png"

    def test_root_relative(self):
        assert pc._resolve_url("/storage/a.png") == f"{pc.BASE_URL}/storage/a.png"

    def test_bare_relative(self):
        assert pc._resolve_url("storage/a.png") == f"{pc.BASE_URL}/storage/a.png"

    def test_data_uri_untouched(self):
        data_uri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
        assert pc._resolve_url(data_uri) == data_uri


# --------------------------------------------------------------------------- #
# extract_images
# --------------------------------------------------------------------------- #
class TestExtractImages:
    def test_markdown_image_absolutized(self):
        assert pc.extract_images("![a](/storage/x.png)") == [f"{pc.BASE_URL}/storage/x.png"]

    def test_html_image(self):
        assert pc.extract_images('<img src="/storage/y.png">') == [f"{pc.BASE_URL}/storage/y.png"]

    def test_non_image_link_ignored(self):
        assert pc.extract_images("[report](/files/data.csv)") == []

    def test_dedup_preserves_order(self):
        text = "![a](/s/1.png) ![b](/s/2.png) ![c](/s/1.png)"
        assert pc.extract_images(text) == [f"{pc.BASE_URL}/s/1.png", f"{pc.BASE_URL}/s/2.png"]

    def test_empty(self):
        assert pc.extract_images("") == []
        assert pc.extract_images(None) == []

    def test_data_uri_image_untouched(self):
        data_uri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
        assert pc.extract_images(f"![a]({data_uri})") == [data_uri]


# --------------------------------------------------------------------------- #
# absolutize_markdown_images
# --------------------------------------------------------------------------- #
class TestAbsolutizeMarkdownImages:
    def test_rewrites_src(self):
        out = pc.absolutize_markdown_images("![alt](/storage/x.png)")
        assert out == f"![alt]({pc.BASE_URL}/storage/x.png)"

    def test_leaves_non_image_links(self):
        assert pc.absolutize_markdown_images("[x](/f.csv)") == "[x](/f.csv)"


# --------------------------------------------------------------------------- #
# collect_all_images
# --------------------------------------------------------------------------- #
def test_collect_all_images_dedups_across_sources():
    comments = [{"images": [f"{pc.BASE_URL}/s/1.png", f"{pc.BASE_URL}/s/3.png"]}]
    urls = pc.collect_all_images(
        "![a](/s/1.png)",
        comments,
        extra_descriptions=["![b](/s/2.png)"],
    )
    assert urls == [
        f"{pc.BASE_URL}/s/1.png",
        f"{pc.BASE_URL}/s/2.png",
        f"{pc.BASE_URL}/s/3.png",
    ]


# --------------------------------------------------------------------------- #
# _as_code_block
# --------------------------------------------------------------------------- #
def test_as_code_block_outgrows_inner_fences():
    text = "```\nnested\n```"
    out = pc._as_code_block(text)
    # Outer fence must be longer than any backtick run inside so it can't break out.
    assert out.startswith("````")
    assert out.endswith("````")


# --------------------------------------------------------------------------- #
# parse_conversation_comments
# --------------------------------------------------------------------------- #
def test_parse_conversation_comments():
    timeline = [
        {
            "type": "task_comment",
            "employee": {"name": "Alice"},
            "created_at": "2026-06-26",
            "task_comment": {"description": "Hello ![p](/s/a.png)"},
        },
        {"type": "status_change"},  # ignored: not a comment
        {
            "field_name": "Comment Added",
            "employee_name": "Bob",
            "description": "",  # empty & no images -> skipped
        },
    ]
    comments = pc.parse_conversation_comments(timeline)
    assert len(comments) == 1
    assert comments[0]["author"] == "Alice"
    assert comments[0]["images"] == [f"{pc.BASE_URL}/s/a.png"]


# --------------------------------------------------------------------------- #
# extract_task_meta
# --------------------------------------------------------------------------- #
def test_extract_task_meta():
    raw = {
        "data": {
            "issue_number": 5461,
            "title": "Label print",
            "description": "  body  ",
            "task_creator": {"name": "Carol"},
            "created_at": "2026-06-26T09:00:00",
            "task_status": "open",
            "task_tags": [{"name": "bug"}, {"nope": 1}],
        }
    }
    meta = pc.extract_task_meta(raw)
    assert meta["title"] == "Label print"
    assert meta["description"] == "body"
    assert meta["creator"] == "Carol"
    assert meta["created_date"] == "2026-06-26"
    assert meta["status"] == "open"
    assert meta["tags"] == ["bug"]


# --------------------------------------------------------------------------- #
# render_task_markdown
# --------------------------------------------------------------------------- #
class TestRenderTaskMarkdown:
    def _meta(self, **over):
        base = {
            "title": "Label print",
            "description": "Do the thing ![p](/s/a.png)",
            "created_date": "2026-06-26",
            "status": "open",
        }
        base.update(over)
        return base

    def test_uses_real_status_not_hardcoded(self):
        md = pc.render_task_markdown("5461", self._meta(status="closed"), [])
        assert "**Status:** closed" in md
        assert "In Analysis" not in md  # the old hardcoded value must be gone

    def test_status_unknown_fallback(self):
        md = pc.render_task_markdown("5461", self._meta(status=""), [])
        assert "**Status:** (unknown)" in md

    def test_includes_title_and_description(self):
        md = pc.render_task_markdown("5461", self._meta(), [])
        assert "# Task 5461: Label print" in md
        assert f"{pc.BASE_URL}/s/a.png" in md  # image absolutized

    def test_conversation_and_images_sections(self):
        comments = [{
            "author": "Alice",
            "created_at": "2026-06-26",
            "description": "hi",
            "images": [],
        }]
        md = pc.render_task_markdown("5461", self._meta(), comments)
        assert "## Conversation (1 comment(s))" in md
        assert "### Alice — 2026-06-26" in md


# --------------------------------------------------------------------------- #
# build_api_headers
# --------------------------------------------------------------------------- #
class TestBuildApiHeaders:
    def test_strips_bearer_prefix(self, monkeypatch):
        monkeypatch.delenv("PANTEON_BEARER_TOKEN", raising=False)
        monkeypatch.delenv("PANTEON_COOKIE", raising=False)
        headers = pc.build_api_headers(bearer_token="Bearer eyJabc")
        assert headers["Authorization"] == "Bearer eyJabc"

    def test_cookie(self, monkeypatch):
        monkeypatch.delenv("PANTEON_BEARER_TOKEN", raising=False)
        monkeypatch.delenv("PANTEON_COOKIE", raising=False)
        headers = pc.build_api_headers(cookie="a=b")
        assert headers["Cookie"] == "a=b"

    def test_missing_credentials_raises(self, monkeypatch):
        monkeypatch.delenv("PANTEON_BEARER_TOKEN", raising=False)
        monkeypatch.delenv("PANTEON_COOKIE", raising=False)
        with pytest.raises(PermissionError):
            pc.build_api_headers()


# --------------------------------------------------------------------------- #
# _api_get / networking error handling (monkeypatched session)
# --------------------------------------------------------------------------- #
class _FakeResponse:
    def __init__(self, status_code=200, json_data=None):
        self.status_code = status_code
        self._json = json_data if json_data is not None else {}

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class TestApiGet:
    def test_401_becomes_permission_error(self, monkeypatch):
        monkeypatch.setattr(pc._SESSION, "get", lambda *a, **k: _FakeResponse(401))
        with pytest.raises(PermissionError):
            pc._api_get("http://x", {}, context=" ctx")

    def test_403_becomes_permission_error(self, monkeypatch):
        monkeypatch.setattr(pc._SESSION, "get", lambda *a, **k: _FakeResponse(403))
        with pytest.raises(PermissionError):
            pc._api_get("http://x", {})

    def test_timeline_401_is_permission_error(self, monkeypatch):
        # Regression: the timeline call used to leak a raw HTTP error on 401.
        monkeypatch.setattr(pc._SESSION, "get", lambda *a, **k: _FakeResponse(401))
        with pytest.raises(PermissionError):
            pc.get_task_timeline(123, {})

    def test_timeline_unwraps_data_list(self, monkeypatch):
        payload = {"data": [{"type": "task_comment", "task_comment": {"description": "x"}}]}
        monkeypatch.setattr(pc._SESSION, "get", lambda *a, **k: _FakeResponse(200, payload))
        items = pc.get_task_timeline(123, {})
        assert items == payload["data"]


# --------------------------------------------------------------------------- #
# save_task_markdown / task_markdown_path
# --------------------------------------------------------------------------- #
def test_save_and_path_roundtrip(tmp_path):
    meta = {"title": "T", "description": "d", "created_date": "2026-06-26", "status": "open"}
    saved = pc.save_task_markdown("5461", meta, [], base_dir=str(tmp_path))
    expected = pc.task_markdown_path("5461", base_dir=str(tmp_path))
    assert saved == expected
    with open(saved, encoding="utf-8") as fh:
        assert "# Task 5461: T" in fh.read()
