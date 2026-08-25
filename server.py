import os
from typing import Optional

import anyio
import requests
from fastmcp import Context, FastMCP
from fastmcp.exceptions import ToolError
from mcp.shared.exceptions import McpError

import panteon_client

# Initialize the FastMCP server
mcp = FastMCP(
    "Panteon Timeline MCP Server",
    instructions=(
        "Fetches task descriptions and full comment conversations (including images) "
        "from Panteon Timeline (timeline.panteon.no). Use get_task_conversation whenever "
        "the user references a Panteon task URL (containing '/edit/<id>') or a bare issue "
        "ID and wants its content, history, or context. Use check_auth first if "
        "PANTEON_BEARER_TOKEN/PANTEON_COOKIE haven't been verified yet, or after a call "
        "fails with an authentication error, to confirm whether credentials are missing, "
        "invalid, or expired before retrying."
    ),
)


async def _request_empty_task_context(
    ctx: Context,
    issue_id: str,
    title: str,
) -> Optional[str]:
    """Ask the user for context when Panteon has no description or comments."""
    try:
        result = await ctx.elicit(
            (
                f"Issue #{issue_id} ({title or 'no title'}) has no description "
                "or comments in Panteon. Provide any context that should be "
                "included in the exported task markdown?"
            ),
            response_type=str,
        )
    except McpError:
        # Client doesn't support elicitation (or the request otherwise failed at
        # the protocol level) — this is an expected, silent skip.
        return None
    except Exception as exc:
        # Something unexpected (not a capability issue) — surface it instead of
        # silently swallowing a real bug.
        await ctx.warning(f"Elicitation for issue {issue_id} failed unexpectedly: {exc}")
        return None

    if getattr(result, "action", None) != "accept":
        return None

    context = getattr(result, "data", None)
    if isinstance(context, str) and context.strip():
        return context.strip()
    return None


@mcp.tool()
async def check_auth(
    bearer_token: Optional[str] = None,
    cookie: Optional[str] = None,
) -> str:
    """
    Verifies Panteon Timeline credentials without needing a real issue ID.

    Reports whether PANTEON_BEARER_TOKEN / PANTEON_COOKIE (or the passed
    overrides) are missing, accepted by the API, or rejected — plus the
    bearer token's expiry if it's a decodable JWT. Useful for debugging
    setup before attempting a real get_task_conversation call, or after one
    fails with an authentication error.

    Args:
        bearer_token: Optional JWT Bearer token (defaults to PANTEON_BEARER_TOKEN env var).
        cookie: Optional raw Cookie header string (defaults to PANTEON_COOKIE env var).
    """
    try:
        headers = panteon_client.build_api_headers(bearer_token=bearer_token, cookie=cookie)
    except PermissionError as exc:
        return f"Status: missing\n{exc}"

    result = await anyio.to_thread.run_sync(panteon_client.check_auth, headers)
    lines = [f"Status: {result['status']}", result["detail"]]

    token = bearer_token or os.getenv("PANTEON_BEARER_TOKEN")
    if token:
        expiry = panteon_client.describe_token_expiry(token.replace("Bearer ", "").strip())
        if expiry:
            lines.append(f"Token: {expiry}")

    return "\n".join(lines)


@mcp.tool(output_schema=None)
async def get_task_conversation(
    issue_identifier: str,
    ctx: Context,
    bearer_token: Optional[str] = None,
    cookie: Optional[str] = None,
    inline: bool = False,
) -> str:
    """
    Fetches a Panteon Timeline task in full — its description body and the entire
    comment conversation — including every embedded image.

    Args:
        issue_identifier: The task URL (e.g. https://timeline.panteon.no/tasks#/list/15033/edit/5461)
            or numeric issue ID (e.g. '5461').
        bearer_token: Optional JWT Bearer token (defaults to PANTEON_BEARER_TOKEN env var).
        cookie: Optional raw Cookie header string (defaults to PANTEON_COOKIE env var).
        inline: When true, the full task markdown is appended to the return value
            in addition to being written to disk. Use this when the MCP client
            cannot read the local filesystem path (e.g. a remote/sandboxed client).

    User interaction:
        If the task has neither description nor comments, the tool asks for
        optional user-provided context when the MCP client supports elicitation.

    Side effect:
        Writes the task to `timeline/<issue_id>/task.md`
        (under PANTEON_TIMELINE_DIR, or the current working directory). The saved
        file is also exposed as an MCP resource at `timeline://<issue_id>/task.md`.

    Returns:
        A short, human-readable summary string with only the issue id, title,
        status, and the saved file path — for example:

            Issue #4117 — Label print
            Status:     open
            Saved to:   /abs/path/timeline/4117/task.md

        The full task body, the entire comment conversation, and every image URL
        are written to the saved file (timeline/<issue_id>/task.md). Read that file
        (or the `timeline://<issue_id>/task.md` resource, or pass inline=True) to
        access the full content — the conversation is intentionally NOT included in
        the summary by default to keep the tool output small for long conversations.
    """
    headers = panteon_client.build_api_headers(bearer_token=bearer_token, cookie=cookie)

    await ctx.report_progress(progress=0, total=3)
    await ctx.info(f"Resolving Panteon task from '{issue_identifier}'…")

    # The Panteon client is synchronous (blocking requests); run it off the event
    # loop so we don't stall concurrent tool calls, progress, or elicitation.
    try:
        data = await anyio.to_thread.run_sync(
            panteon_client.fetch_task_data, issue_identifier, headers
        )
    except requests.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else None
        if status_code == 404:
            raise ToolError(
                f"Issue '{issue_identifier}' was not found in Panteon Timeline. "
                "Double-check the issue ID or task URL."
            ) from exc
        raise ToolError(f"Panteon API request failed (HTTP {status_code}): {exc}") from exc
    except requests.RequestException as exc:
        raise ToolError(f"Could not reach Panteon Timeline: {exc}") from exc
    issue_id = data["issue_id"]
    task_id = data["task_id"]
    task_meta = data["task_meta"]
    comments = data["comments"]

    await ctx.report_progress(progress=2, total=3)
    await ctx.info(
        f"Resolved issue {issue_id} (internal task {task_id}); "
        f"{len(comments)} comment(s) found."
    )

    if not task_meta.get("description") and not comments:
        user_context = await _request_empty_task_context(
            ctx, issue_id, task_meta.get("title", "")
        )
        if user_context:
            task_meta["user_context"] = user_context

    saved_file = await anyio.to_thread.run_sync(
        panteon_client.save_task_markdown, issue_id, task_meta, comments
    )
    await ctx.report_progress(progress=3, total=3)

    title = task_meta.get("title") or "(no title)"
    status = task_meta.get("status") or "(unknown)"

    summary = (
        f"Issue #{issue_id} — {title}\n"
        f"Status:     {status}\n"
        f"Saved to:   {saved_file}"
    )

    if inline:
        markdown = panteon_client.render_task_markdown(issue_id, task_meta, comments)
        summary += "\n\n---\n\n" + markdown

    return summary


@mcp.resource("timeline://{issue_id}/task.md")
def task_markdown_resource(issue_id: str) -> str:
    """
    Exposes a previously-saved task export as an MCP resource so clients can read
    the full markdown through MCP instead of the local filesystem. Fetch a task
    with `get_task_conversation` first; this reads whatever was last written to
    `timeline/<issue_id>/task.md`.
    """
    path = panteon_client.task_markdown_path(issue_id)
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"No saved task for issue {issue_id} at {path}. "
            "Run the get_task_conversation tool for this issue first."
        )
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


if __name__ == "__main__":
    # Run the server via stdio by default for MCP integration
    mcp.run("stdio")
