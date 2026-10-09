# Panteon Timeline MCP Server 🚀

An MCP (Model Context Protocol) server built with FastMCP that enables AI assistants (Antigravity, Claude Desktop, Cursor, etc.) to fetch real-time task data and conversation history directly from **Panteon Timeline** (`https://timeline.panteon.no`).

---

## ✨ Features

- **Extract Issue ID**: Automatically parses URL formats like `https://timeline.panteon.no/tasks#/list/15033/edit/5461` or accepts direct issue IDs (`5461`).
- **Two-Step API Resolution**: Mirrors the browser extension logic by resolving the external issue ID (`5461`) to Panteon's internal `task_id` via API 1, and then fetching the complete conversation timeline via API 2.
- **AI-Optimized Formatting**: Provides structured XML/Markdown context (`<task_title>`, `<task_description>`, `<conversation_history>`) ready for AI analysis, summarization, and reply drafting.
- **Flexible Authentication**: Supports JWT Bearer tokens or Cookie headers via `.env` file configuration or per-tool-call parameters.

---

## 🛠️ Installation & Setup

### 1. Install Dependencies
Ensure you have Python 3.10+ installed, then create or reuse the project virtualenv and install dependencies into it:
```bash
cd timeline-mcp
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

### 2. Configure Authentication
To fetch protected data from `timeline.panteon.no`, the MCP server needs an authentication token from your logged-in browser session.

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Open **Google Chrome** and log in to `https://timeline.panteon.no`.
3. Open **Chrome DevTools** (`F12` or `Ctrl+Shift+I`) -> navigate to the **Network** tab.
4. Refresh the timeline task page or perform any action.
5. Click on any request starting with `api/` (e.g., `taskbyissue/...` or `timeline`).
6. Under **Request Headers**, copy the value of `Authorization` (without the `Bearer ` prefix) or the raw `Cookie` header string.
7. Paste it into your `.env` file:
   ```env
   PANTEON_BEARER_TOKEN=eyJ...
   # OR
   PANTEON_COOKIE=...
   ```

---

## 🤖 Configuring MCP Clients

### For Claude Desktop / Antigravity / Cursor
Add the following configuration to your MCP server configuration file (e.g., `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "timeline-mcp": {
      "command": "/home/harpalsinh.solanki@hs.local/projects/panteon/timeline-mcp/.venv/bin/python",
      "args": [
        "/home/harpalsinh.solanki@hs.local/projects/panteon/timeline-mcp/server.py"
      ],
      "env": {
        "PANTEON_BEARER_TOKEN": "your_jwt_token_here"
      }
    }
  }
}
```

### For Codex
Codex reads MCP servers from `config.toml`. Add this to `~/.codex/config.toml` for a global setup, or to `.codex/config.toml` inside this repository for a project-scoped setup:

```toml
[mcp_servers.timeline_mcp]
command = "/home/harpalsinh.solanki@hs.local/projects/panteon/timeline-mcp/.venv/bin/python"
args = ["/home/harpalsinh.solanki@hs.local/projects/panteon/timeline-mcp/server.py"]
cwd = "/home/harpalsinh.solanki@hs.local/projects/panteon/timeline-mcp"
startup_timeout_sec = 20
tool_timeout_sec = 120
```

With `cwd` set to this repository, `python-dotenv` loads `.env` automatically. If you prefer to pass credentials from the shell instead, add:

```toml
env_vars = ["PANTEON_BEARER_TOKEN", "PANTEON_COOKIE", "PANTEON_TIMELINE_DIR"]
```

After saving the config, restart Codex and run `/mcp` in the Codex TUI to confirm `timeline_mcp` is active.

---

## 🔌 Install as a Claude Code plugin

This repo is also a Claude Code plugin (`panteon-timeline`) that bundles the MCP server with the `task-spec` skill, which turns a fetched task into a repo-aware `spec.md`.

```bash
# One-time: credentials come from your shell environment (the plugin copy has no .env)
export PANTEON_BEARER_TOKEN="eyJ..."   # add to ~/.bashrc / ~/.zshrc

# Inside Claude Code
/plugin marketplace add <git-url-or-local-path-of-this-repo>
/plugin install panteon-timeline@panteon-tools
```

Requires [`uv`](https://docs.astral.sh/uv/) on the PATH; the server's dependencies are resolved by `uv run` on launch, so no `.venv` is needed.

Then, in any project repo: ask Claude to "write a spec for Panteon task 5461" (or invoke `/panteon-timeline:task-spec 5461`). Output stays project-based: `<project>/timeline/<issue_id>/task.md` and `spec.md`. Make sure `timeline/` is gitignored in each project.

If you previously registered `timeline-mcp` manually (see above), remove that entry to avoid two copies of the server.

## 🧰 Available Tools

### `get_task_conversation`
Fetches a task **in full** — its description body **and** the entire comment conversation —
including **every image** embedded anywhere, and **writes it to a markdown file**.
- **Arguments**:
  - `issue_identifier` (str) — e.g. `"https://timeline.panteon.no/tasks#/list/15033/edit/5461"` or `"5461"`. Must be a bare numeric ID or a URL containing `/edit/<id>`.
  - `bearer_token` / `cookie` (str, optional) — override the `.env` credentials per call.
  - `inline` (bool, default `false`) — when `true`, the full task markdown is appended to the return value in addition to being saved. Use this for clients that can't read the local filesystem path.
- **Side effect**: writes `timeline/<issue_id>/task.md` (title, metadata, description, comments). The saved file is also exposed as an MCP **resource** at `timeline://<issue_id>/task.md`, so clients can read the full content through MCP after a fetch.
- **Empty tasks**: when both description and comments are empty, the tool asks for optional user-provided context if the MCP client supports elicitation. Accepted input is saved under `## User-Provided Context`; unsupported clients keep the normal placeholder output.
- **Returns** a short human-readable summary string with the issue id, title, status, and saved file path — for example:

  ```
  Issue #4117 — Label print
  Status:     open
  Saved to:   /abs/path/timeline/4117/task.md
  ```

  The full task body, the entire comment conversation, and every image URL are written to the saved file. Read that file to access the full content.

Image URLs embedded in comments (markdown `![](…)` or HTML `<img>`) are resolved to absolute
`https://timeline.panteon.no/...` URLs. Non-image attachment links (e.g. `.csv`) are excluded.

#### Output location
The file is written to `<base>/timeline/<issue_id>/task.md`, where `<base>` is:
1. `PANTEON_TIMELINE_DIR` env var, if set (this MCP is configured with it pointing at the
   `duell-admin` project root); otherwise
2. the current working directory.

---

## 💻 Command-Line Usage

The same fetch logic is available from the shell via `fetch_task.py` (credentials come from `.env`):

```bash
# By numeric ID or full URL
.venv/bin/python fetch_task.py 5461
.venv/bin/python fetch_task.py "https://timeline.panteon.no/tasks#/list/15033/edit/5461"

# Also print the rendered markdown to stdout
.venv/bin/python fetch_task.py 5461 --print

# Write under a specific project root instead of PANTEON_TIMELINE_DIR / cwd
.venv/bin/python fetch_task.py 5461 --base-dir /path/to/project
```

---

## 🧪 Development & Testing

```bash
# Install dev dependencies (adds pytest)
.venv/bin/python -m pip install -r requirements-dev.txt

# Run the unit tests — no network or credentials required
.venv/bin/python -m pytest
```

Tests live in `tests/` and cover the pure parsing/rendering helpers plus authentication-error handling (via a mocked HTTP session).
