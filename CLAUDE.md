# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small Python MCP (Model Context Protocol) server, built with FastMCP, that fetches task data and conversation history from Panteon Timeline (`https://timeline.panteon.no`) and renders it to markdown. It exposes one MCP tool (`get_task_conversation`) and one MCP resource (`timeline://<issue_id>/task.md`), plus an equivalent CLI (`fetch_task.py`) for shell use.

## Commands

```bash
# Setup (one-time)
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt   # adds pytest on top of runtime deps

# Run the MCP server over stdio
.venv/bin/python server.py

# Run the CLI fetcher directly
.venv/bin/python fetch_task.py 5461
.venv/bin/python fetch_task.py "https://timeline.panteon.no/tasks#/list/15033/edit/5461" --print
.venv/bin/python fetch_task.py 5461 --base-dir /path/to/project

# Tests (no network or credentials required — requests.get is mocked)
.venv/bin/python -m pytest
.venv/bin/python -m pytest tests/test_panteon_client.py::test_name   # single test

# Quick syntax check
.venv/bin/python -m py_compile server.py panteon_client.py fetch_task.py
```

There is no separate lint/format command configured in this repo.

## Architecture

Three files carry all the logic; keep the same separation when adding to them:

- **`panteon_client.py`** — everything that isn't MCP-specific: URL/issue-ID parsing, the two Panteon API calls, response parsing, image extraction, markdown rendering, and the `fetch_task_data` / `fetch_and_save` orchestration functions. This is the file to add unit tests against — its helpers are pure/deterministic and mock only `requests.get`.
- **`server.py`** — FastMCP tool/resource registration only. Calls into `panteon_client` for all real work, running the synchronous/blocking client off the event loop via `anyio.to_thread.run_sync`.
- **`fetch_task.py`** — thin CLI wrapper over `panteon_client.fetch_and_save`, kept in sync with the MCP tool by using the same shared orchestration function.

### Two-step API resolution

Fetching a task mirrors the reference browser extension's logic and always happens in two calls:
1. `GET /api/taskbyissue/{issue_id}/{company_id}` — resolves the external, user-facing issue ID (e.g. `5461`) to Panteon's internal `task_id`.
2. `GET /api/task/{task_id}/timeline` — fetches the full timeline, from which comments are filtered out via `parse_conversation_comments`.

`extract_issue_id` only accepts a bare numeric ID or a URL containing `/edit/<id>` — it deliberately does NOT fall back to "trailing digits" in the URL, since a list/board URL like `.../list/15033` would otherwise silently resolve to the wrong (board) ID.

### Markdown rendering contract

`render_task_markdown` produces a `task.md` (header: ID, Title, Creator, Date Created, Status, Tags; comments by the task creator are labelled "(task creator)" in their heading) with a fixed section order (Description, User-Provided Context, Conversation, Acceptance Criteria, Open Questions, Images). Two markdown "layers" are intentionally kept apart: the document's own structure is plain markdown, while all original content (task description, each comment) is wrapped in a fenced code block via `_as_code_block`, sized to a backtick run longer than any backticks already in the content, so embedded content can never break out and corrupt the document structure. Image URLs found inside that content are rewritten to absolute URLs (`absolutize_markdown_images` / `_resolve_url`) before being embedded, since the file is meant to stand alone outside the browser.

`## Acceptance Criteria` and `## Open Questions` are always emitted as placeholders — they require reasoning over the description that this deterministic fetcher does not attempt, and are left for an AI assistant reading the file to fill in.

### Output location and side effects

Fetching always writes `<base>/timeline/<issue_id>/task.md`, where `<base>` is `PANTEON_TIMELINE_DIR` if set, else the current working directory (see `task_markdown_path`). The MCP server also exposes whatever was last written for an issue as a resource at `timeline://<issue_id>/task.md` (`server.py`'s `task_markdown_resource`), so a client can re-read a previous fetch without touching the filesystem directly.

When a fetched task has neither description nor comments, the MCP tool asks the user for optional context via `ctx.elicit` (only if the connected client supports elicitation); accepted input is folded into `task_meta["user_context"]` and rendered under its own section. The CLI does not perform elicitation — that behavior lives only in `server.py`.

### Authentication

`build_api_headers` in `panteon_client.py` accepts a bearer token or cookie either as function arguments (per-call override, used by the MCP tool's optional args) or via `PANTEON_BEARER_TOKEN` / `PANTEON_COOKIE` env vars, loaded from a `.env` sitting next to `panteon_client.py` (not the caller's cwd) so credentials resolve regardless of which project the server is launched from. 401/403 responses are translated into a `PermissionError` with a consistent message; missing credentials raise before any request is made.

## Plugin packaging

The repo doubles as a Claude Code plugin (`panteon-timeline`): `.claude-plugin/plugin.json` (manifest), `.claude-plugin/marketplace.json` (so the repo can be added as a marketplace), `.mcp.json` (launches `server.py` via `uv run`, credentials from the caller's environment since the installed copy has no `.env`), and `skills/task-spec/SKILL.md` (fetch a task → write `timeline/<issue_id>/spec.md`, then stop for review). Validate changes with `claude plugin validate .`. The skill must not depend on edits to `task.md` — it is overwritten on every fetch.

## Testing conventions

Tests live in `tests/`, named `test_*.py`; `conftest.py` exists solely to put the project root on `sys.path` so tests can `import panteon_client` without packaging. Prioritize unit tests for the pure helpers (`extract_issue_id`, `_normalize_date`, `extract_images`, `absolutize_markdown_images`, `render_task_markdown`) and mock `requests.get`/the shared session for API-call and auth-error behavior — no live Panteon credentials should ever be required for the automated suite.

## Security

Never commit `.env`, bearer tokens, cookies, or anything under `timeline/` (generated task exports may contain customer data). `.gitignore` already covers `.env`, `timeline/`, `.venv/`, and caches — keep it that way when adding new generated-output paths.
