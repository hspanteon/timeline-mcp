"""Unit tests for server.py's MCP-layer logic: elicitation, error translation,
the inline flag, and the task.md resource. panteon_client's real network/API
calls are monkeypatched; no live Panteon credentials are required.

`@mcp.tool()`/`@mcp.resource()` decorators return the original function
unmodified (fastmcp attaches metadata via `__fastmcp__` rather than wrapping),
so these are called directly like plain functions/coroutines.
"""
import requests
import pytest
from fastmcp.exceptions import ToolError
from mcp.shared.exceptions import McpError
from mcp.types import ErrorData

import panteon_client as pc
import server


@pytest.fixture
def anyio_backend():
    return "asyncio"


class _FakeElicitResult:
    def __init__(self, action, data=None):
        self.action = action
        self.data = data


class FakeContext:
    """Duck-typed stand-in for fastmcp.Context, recording calls made on it."""

    def __init__(self, elicit_result=None, elicit_exc=None):
        self._elicit_result = elicit_result
        self._elicit_exc = elicit_exc
        self.warnings = []
        self.infos = []
        self.progress = []

    async def elicit(self, *args, **kwargs):
        if self._elicit_exc is not None:
            raise self._elicit_exc
        return self._elicit_result

    async def warning(self, message):
        self.warnings.append(message)

    async def info(self, message):
        self.infos.append(message)

    async def report_progress(self, progress, total=None):
        self.progress.append((progress, total))


# --------------------------------------------------------------------------- #
# _request_empty_task_context
# --------------------------------------------------------------------------- #
class TestRequestEmptyTaskContext:
    @pytest.mark.anyio
    async def test_accept_returns_stripped_context(self):
        ctx = FakeContext(elicit_result=_FakeElicitResult("accept", "  extra info  "))
        result = await server._request_empty_task_context(ctx, "5461", "Some title")
        assert result == "extra info"

    @pytest.mark.anyio
    async def test_decline_returns_none(self):
        ctx = FakeContext(elicit_result=_FakeElicitResult("decline"))
        result = await server._request_empty_task_context(ctx, "5461", "Some title")
        assert result is None

    @pytest.mark.anyio
    async def test_accept_with_blank_data_returns_none(self):
        ctx = FakeContext(elicit_result=_FakeElicitResult("accept", "   "))
        result = await server._request_empty_task_context(ctx, "5461", "Some title")
        assert result is None

    @pytest.mark.anyio
    async def test_mcp_error_is_silently_skipped(self):
        # Client doesn't support elicitation -> expected, no warning logged.
        ctx = FakeContext(elicit_exc=McpError(ErrorData(code=-32601, message="not supported")))
        result = await server._request_empty_task_context(ctx, "5461", "Some title")
        assert result is None
        assert ctx.warnings == []

    @pytest.mark.anyio
    async def test_unexpected_error_is_logged_not_swallowed_silently(self):
        ctx = FakeContext(elicit_exc=RuntimeError("boom"))
        result = await server._request_empty_task_context(ctx, "5461", "Some title")
        assert result is None
        assert len(ctx.warnings) == 1
        assert "boom" in ctx.warnings[0]


# --------------------------------------------------------------------------- #
# check_auth tool
# --------------------------------------------------------------------------- #
class TestCheckAuthTool:
    @pytest.mark.anyio
    async def test_missing_credentials(self, monkeypatch):
        monkeypatch.delenv("PANTEON_BEARER_TOKEN", raising=False)
        monkeypatch.delenv("PANTEON_COOKIE", raising=False)
        result = await server.check_auth()
        assert result.startswith("Status: missing")

    @pytest.mark.anyio
    async def test_valid_credentials(self, monkeypatch):
        monkeypatch.setattr(
            pc, "check_auth", lambda headers, company_id=None: {"status": "valid", "detail": "ok"}
        )
        result = await server.check_auth(bearer_token="abc")
        assert "Status: valid" in result
        assert "ok" in result


# --------------------------------------------------------------------------- #
# get_task_conversation tool
# --------------------------------------------------------------------------- #
def _fake_data(issue_id="5461", description="desc", comments=None):
    return {
        "issue_id": issue_id,
        "task_id": 999,
        "task_meta": {"title": "Label print", "description": description, "status": "open"},
        "comments": comments or [],
    }


class TestGetTaskConversationTool:
    @pytest.mark.anyio
    async def test_happy_path_writes_file_and_summarizes(self, monkeypatch, tmp_path):
        monkeypatch.setenv("PANTEON_TIMELINE_DIR", str(tmp_path))
        monkeypatch.setattr(pc, "fetch_task_data", lambda *a, **k: _fake_data())
        ctx = FakeContext()

        result = await server.get_task_conversation("5461", ctx, bearer_token="tok")

        assert "Issue #5461 — Label print" in result
        assert "Status:     open" in result
        assert str(tmp_path) in result
        assert "---" not in result  # inline defaults to False

    @pytest.mark.anyio
    async def test_inline_appends_markdown(self, monkeypatch, tmp_path):
        monkeypatch.setenv("PANTEON_TIMELINE_DIR", str(tmp_path))
        monkeypatch.setattr(pc, "fetch_task_data", lambda *a, **k: _fake_data())
        ctx = FakeContext()

        result = await server.get_task_conversation(
            "5461", ctx, bearer_token="tok", inline=True
        )

        assert "# Task 5461: Label print" in result

    @pytest.mark.anyio
    async def test_elicits_when_no_description_or_comments(self, monkeypatch, tmp_path):
        monkeypatch.setenv("PANTEON_TIMELINE_DIR", str(tmp_path))
        monkeypatch.setattr(
            pc, "fetch_task_data", lambda *a, **k: _fake_data(description="", comments=[])
        )
        ctx = FakeContext(elicit_result=_FakeElicitResult("accept", "manual context"))

        await server.get_task_conversation("5461", ctx, bearer_token="tok", inline=True)

        assert ctx._elicit_result is not None  # sanity: elicit path was reachable

    @pytest.mark.anyio
    async def test_skips_elicit_when_description_present(self, monkeypatch, tmp_path):
        monkeypatch.setenv("PANTEON_TIMELINE_DIR", str(tmp_path))
        monkeypatch.setattr(pc, "fetch_task_data", lambda *a, **k: _fake_data(description="has body"))

        called = {"elicit": False}

        class NoElicitContext(FakeContext):
            async def elicit(self, *a, **k):
                called["elicit"] = True
                raise AssertionError("elicit should not be called when description is present")

        await server.get_task_conversation("5461", NoElicitContext(), bearer_token="tok")
        assert called["elicit"] is False

    @pytest.mark.anyio
    async def test_404_becomes_friendly_tool_error(self, monkeypatch, tmp_path):
        monkeypatch.setenv("PANTEON_TIMELINE_DIR", str(tmp_path))

        def _raise_404(*a, **k):
            response = requests.Response()
            response.status_code = 404
            raise requests.HTTPError("404", response=response)

        monkeypatch.setattr(pc, "fetch_task_data", _raise_404)
        ctx = FakeContext()

        with pytest.raises(ToolError) as exc_info:
            await server.get_task_conversation("nope", ctx, bearer_token="tok")
        assert "not found" in str(exc_info.value).lower()

    @pytest.mark.anyio
    async def test_other_http_error_becomes_tool_error(self, monkeypatch, tmp_path):
        monkeypatch.setenv("PANTEON_TIMELINE_DIR", str(tmp_path))

        def _raise_500(*a, **k):
            response = requests.Response()
            response.status_code = 500
            raise requests.HTTPError("500", response=response)

        monkeypatch.setattr(pc, "fetch_task_data", _raise_500)
        ctx = FakeContext()

        with pytest.raises(ToolError) as exc_info:
            await server.get_task_conversation("5461", ctx, bearer_token="tok")
        assert "500" in str(exc_info.value)

    @pytest.mark.anyio
    async def test_network_error_becomes_tool_error(self, monkeypatch, tmp_path):
        monkeypatch.setenv("PANTEON_TIMELINE_DIR", str(tmp_path))

        def _raise_conn_error(*a, **k):
            raise requests.ConnectionError("dns fail")

        monkeypatch.setattr(pc, "fetch_task_data", _raise_conn_error)
        ctx = FakeContext()

        with pytest.raises(ToolError) as exc_info:
            await server.get_task_conversation("5461", ctx, bearer_token="tok")
        assert "Could not reach Panteon" in str(exc_info.value)


# --------------------------------------------------------------------------- #
# task_markdown_resource
# --------------------------------------------------------------------------- #
class TestTaskMarkdownResource:
    def test_reads_saved_file(self, monkeypatch, tmp_path):
        monkeypatch.setenv("PANTEON_TIMELINE_DIR", str(tmp_path))
        pc.save_task_markdown(
            "5461",
            {"title": "T", "description": "d", "status": "open"},
            [],
            base_dir=str(tmp_path),
        )
        content = server.task_markdown_resource("5461")
        assert "# Task 5461: T" in content

    def test_missing_file_raises(self, monkeypatch, tmp_path):
        monkeypatch.setenv("PANTEON_TIMELINE_DIR", str(tmp_path))
        with pytest.raises(FileNotFoundError):
            server.task_markdown_resource("999999")
