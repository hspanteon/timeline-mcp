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
      "command": "/path/to/timeline-mcp/.venv/bin/python",
      "args": [
        "/path/to/timeline-mcp/server.py"
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
command = "/path/to/timeline-mcp/.venv/bin/python"
args = ["/path/to/timeline-mcp/server.py"]
cwd = "/path/to/timeline-mcp"
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

This repo is also a Claude Code plugin (`panteon-timeline`) that bundles the MCP server with two skills:

- `task-spec` turns a fetched task into a repo-aware `spec.md`.
- `my-day` gives a morning brief from your planner: overdue and soon-due tasks, the latest conversation on your top 3, and where to start.
- `release-pr-check` (duell-admin only; run it from a duell-admin checkout) checks the open PRs into `qa-release` and `master` against the team's release-note format, counts QA-approved tickets from their Timeline QA stage, flags git/Timeline mismatches, and can draft the production and QA release notes. Report-only; needs `gh` logged in.

```bash
# One-time: credentials come from your shell environment (the plugin copy has no .env)
export PANTEON_BEARER_TOKEN="eyJ..."   # add to ~/.bashrc / ~/.zshrc

# Inside Claude Code
/plugin marketplace add <git-url-of-this-repo>
/plugin install panteon-timeline@panteon-tools
```

Add the marketplace from the git URL. A local clone works too, but write it as `./` or an absolute path (a bare `.` is rejected), and note that a local-path install copies the whole working tree, including any `.env` and `timeline/` exports.

Requires [`uv`](https://docs.astral.sh/uv/) on the PATH; the server's dependencies are resolved by `uv run` on launch, so no `.venv` is needed.

Then, in any project repo: ask Claude to "write a spec for Panteon task 5461" (or invoke `/panteon-timeline:task-spec 5461`). Output stays project-based: `<project>/timeline/<issue_id>/task.md` and `spec.md`. Make sure `timeline/` is gitignored in each project.

For a morning brief, ask "what should I work on today?" (or invoke `/panteon-timeline:my-day`). It is read only, apart from the `task.md` files that fetching the top tasks writes.

If you previously registered `timeline-mcp` manually (see above), remove that entry to avoid two copies of the server.

## 🧩 Install on other AI tools (Codex, Gemini CLI, Cursor)

The same repo carries a wrapper per tool. All of them share the same `skills/` directory (`task-spec`, `my-day` and `release-pr-check`).

| Tool | Wrapper files | Install | Gets |
|---|---|---|---|
| **Gemini CLI** | `gemini-extension.json` | `gemini extensions install <git-url-of-this-repo>` (asks for your bearer token and keeps it in the system keychain) | MCP server + skill |
| **Codex** | `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json` | `codex plugin marketplace add <git-url-of-this-repo>`, then `codex plugin add panteon-timeline@panteon-tools` | Skill only. Add the MCP server through `config.toml` (see "For Codex" above) |
| **Cursor** | `.cursor-plugin/plugin.json`, `.cursor-plugin/marketplace.json` | Dashboard → Settings → Plugins → Import, paste the git URL; set `PANTEON_BEARER_TOKEN` under Configure | MCP server + skill |

Why Codex is skill-only: Codex starts a plugin's MCP server with the plugin directory as its working directory, so `timeline/<issue_id>/` would be written inside the plugin cache instead of your project. The `config.toml` setup runs the server from your project, which keeps the output project-based.

Status: the Gemini and Codex wrappers were validated and installed with their CLIs; the Cursor wrapper follows Cursor's documented format but has not been run in Cursor. Tools without a plugin system can still use the manual MCP configs above.

## 👥 Setup for colleagues

Everything is per person: your own token, your own planner, your own paths. Nothing in the repo is tied to one user (the planner user comes from your token's `sub` claim).

**Core (all platforms)** — MCP tools, `fetch_task.py`, skills:
1. Clone, then create the venv and install dependencies (see Installation & Setup above).
2. `cp .env.example .env` and paste your own Timeline token.
3. Check it: `.venv/bin/python fetch_task.py --planner`.
4. Register the server once (user scope, so it works from any project):
   ```bash
   claude mcp add timeline-mcp -s user -- "$PWD/.venv/bin/python" "$PWD/server.py"
   ```
   Or install it as a plugin (see "Install as a Claude Code plugin" below) to get the skills too.

**Dashboard** — Board, Changes and Task view work right away: `.venv/bin/python dashboard.py`, then open http://timeline.localhost:8765.

| Extra | Needs |
|---|---|
| Release view, `release-pr-check` skill | A duell-admin checkout at `../duell-admin` (or `DUELL_ADMIN_DIR`), and `gh auth login` with access to Panteon-norway |
| Claude buttons, Work tab | `cp timeline-desk.example.json timeline-desk.json`, set `claude` to the output of `which claude` (an nvm path changes when Node is upgraded). Linux with `gnome-terminal` only for now |
| Always-on service | Linux with systemd: `scripts/dashboard-service.sh install` |

**Not in the repo** — set these up yourself if you want them:
- Scheduled briefs (my-day at 09:30, 13:00 and 17:00) are Claude app scheduled tasks on each machine. Create your own that run the `my-day` skill.
- `timeline/` (task exports, planner snapshots) is gitignored, so the Changes view starts empty and fills up from your first day.
- Personal hooks or permissions go in `.claude/settings.local.json` (gitignored), not `.claude/settings.json`.

---

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

### `get_my_priority_tasks`
Lists **your** priority tasks from the employee planner
(`/api/employee-planner/get-priority-tasks/{now|next|commingup}`) as a markdown table in priority order:
issue (linked to its task page), title, stage, status, deadline, support flag.
Deadlines are flagged `(overdue)`, `(due today)` or `(due in Nd)` (within 7 days), and the header counts overdue and due-soon tasks.
- **Arguments**:
  - `period` (`now` | `next` | `commingup`, default `now`) — planner column. `commingup` is the API's own spelling ("coming up") and must be used exactly. Other values (including `comingup`) are rejected, because the API silently returns every task for an unknown period.
  - `user_id` (int, optional) — whose planner to show. Defaults to `PANTEON_USER_ID`, then the `sub` claim of the bearer JWT. Cookie-only auth must set `PANTEON_USER_ID`.
  - `bearer_token` / `cookie` (str, optional) — override the `.env` credentials per call.
- **Returns** the markdown directly; nothing is written to disk. Pass any issue number to `get_task_conversation` for the full task.

### `get_my_planner_changes`
Reports what changed in your planner since the last saved day: **new** tasks, tasks that **left the planner**, tasks **moved** between now/next/commingup, and **changed** deadlines, stages or statuses. Priority-order shuffles are not reported.
- Fetches all three periods and records a snapshot of your tasks in the SQLite file `database/timeline_task.db` (same base directory as `task.md`; a row is only added when something changed since the latest one). The diff is always against the latest snapshot from an **earlier** day, so running it twice a day gives the same answer.
- The first run has nothing to compare with; it only saves the snapshot.
- **Arguments**: `user_id`, `bearer_token`, `cookie` as for `get_my_priority_tasks`; `save` (bool, default `true`) — `false` compares without writing anything.

### `get_task_statuses`
Workflow status of several tasks at once: title, stage (e.g. `QA in progress`, `Going live pending`), QA and Live stage progress, and a **release state** — `live`, `qa approved`, `in qa`, `qa blocked` or `before qa`. A task counts as QA-approved once its QA stage is done; `task_status` is `open` for every live task, so the stage is the real signal.
- **Arguments**: `issue_identifiers` (list of IDs or `/edit/<id>` URLs; duplicates dropped, unknown or invalid ones reported per row), `bearer_token` / `cookie`.
- One light request per task (no conversation fetch); nothing is written to disk. Used by the `release-pr-check` skill.

### `get_my_day`
One call for a daily brief: your `now` tasks (with deadline flags), `next` tasks that are overdue or due within 7 days, and the changes section from `get_my_planner_changes`. Each planner period is fetched once (3 requests), and today's snapshot is saved unless `save=false`. Same arguments as `get_my_planner_changes`. The `my-day` skill uses this tool.

#### Output location (`get_task_conversation`)
The file is written to `<base>/timeline/<issue_id>/task.md`, where `<base>` is:
1. `PANTEON_TIMELINE_DIR` env var, if set (this MCP is configured with it pointing at the
   `duell-admin` project root); otherwise
2. the current working directory.

---

## 🖥️ Timeline desk (local dashboard)

A web view over the same data: your planner as a board, planner changes day by day, the pending duell-admin releases, and a readable task view. Every task shows a six-segment **stage rail** (RSD → Estimate → Development → Testing → QA → Live), coloured by each stage's progress.

**Always on (recommended, Linux):** install it once as a systemd *user* service. It then starts at login, restarts if it crashes, and lives at **http://timeline.localhost:8765**. No sudo is needed: `*.localhost` names resolve to your own machine without editing `/etc/hosts`.

```bash
scripts/dashboard-service.sh install     # write the unit, enable and start it
scripts/dashboard-service.sh restart     # after pulling or changing code
scripts/dashboard-service.sh status      # state and recent log lines
scripts/dashboard-service.sh uninstall   # stop and remove it
```

The service runs the code in this checkout. There is no build step: after editing `web/` files just reload the page (they're served with `Cache-Control: no-cache`); after editing Python files run `scripts/dashboard-service.sh restart`. Keep a branch checked out that has `dashboard.py`. Use `TIMELINE_DESK_PORT=9000 scripts/dashboard-service.sh install` for another port.

**One-off:**

```bash
.venv/bin/python dashboard.py            # then open http://timeline.localhost:8765
.venv/bin/python dashboard.py --port 9000 --user-id 135
```

| View | Shows |
|---|---|
| Board | Now / Next / Coming up columns with deadline flags (overdue, due soon), support tasks and stage rails |
| Changes | New, removed, moved and changed tasks with the time they were detected, from the `database/timeline_task.db` snapshots; the dashboard checks the planner every 30 minutes (`--interval` or `TIMELINE_SNAPSHOT_MINUTES`), Refresh checks it immediately |
| Release | Pending duell-admin PRs grouped by destination (into `qa-release` / into `master`): verdict (ready / needs notes / blocked), CI, Timeline stage, release-note problems, "not via QA" warnings, and each PR's description. "Check again" runs `git fetch` and the `gh` lookups (about 10 s) |
| Task | Description and conversation of any task, with safe markdown rendering, and a "Start in Claude" button for planner tasks |
| Work | The task worktrees "Start in Claude" made: size, uncommitted changes, commits that exist only there; Remove (worktree) or Remove + branch |

### Start in Claude

The button on a board card (or **… in Claude** in the Task view) opens a terminal running an interactive Claude Code session for the task. What it does follows the task's Timeline stage:

| Stage | Button | Session |
|---|---|---|
| RSD / Estimate not done | ▶ Spec | Writes `timeline/<id>/spec.md` (via `skills/task-spec`) in a task worktree, lists open questions, and stops. No code. |
| Estimated / Development | ▶ Implement | Spec, then implements only if no stage is blocked and the spec has no open questions; otherwise it stops and lists them. |
| Development, worktree exists | ▶ Resume | Reads the spec, the branch's commits and new comments, then continues. |
| Development done, Testing / QA | ▶ Fix QA | Finds the testing/QA feedback in the conversation and fixes it on the task branch. |
| Any stage blocked | ⏸ Blocked | Read only, in the main checkout: explains the blocker and drafts a question for the task thread. Posts nothing. |
| QA done / Live | (none) | Remove the worktree from the Work tab. |

The board label is a hint from the planner; on click the server re-reads the stage codes and picks the action (so Implement becomes Resume when a worktree already exists). Sessions commit locally to the task branch and never push, open PRs or merge. You approve their tool calls as usual.

- The worktree reuses an existing `<id>-…` branch (local or on GitHub), else creates `<id>-<title-slug>` from `origin/<base>`. Worktrees go to `<repo>-worktrees/<branch>`; one costs about 75 MB for duell-admin (git history is shared; dependencies aren't installed there).
- The prompt contains only the issue ID. The session fetches the task itself and treats its text as data.
- Set up boards once: `cp timeline-desk.example.json timeline-desk.json` and edit it (board/list id → repo path and base branch, the `claude` binary, the terminal; `gnome-terminal` by default). It's gitignored and re-read on every request. A board without a repo shows no button. If you installed `claude` with nvm, update the path after a Node upgrade.
- Clean up on the **Work** tab. Removal never forces: git keeps a worktree with uncommitted changes, and `git branch -d` keeps a branch with commits that aren't merged anywhere.

The Release view needs a duell-admin checkout (`DUELL_ADMIN_DIR`, `--repo-dir`, or `../duell-admin` next to this repo) and `gh auth login`. It only reads: `git fetch/log/rev-list` and `gh pr/release list`; it never merges, pushes, comments or creates releases. Release-note drafts, the QA-approval count and the translation/migration checks come from the `release-pr-check` skill.

It uses the `.env` credentials and reads snapshots from `PANTEON_TIMELINE_DIR` (or `--base-dir`, or the current directory). It listens only on `127.0.0.1` and rejects requests whose Host header isn't `127.0.0.1`, `localhost` or `timeline.localhost`, because the pages show customer data. Nothing is written except the planner snapshot database.

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

# Your priority tasks from the employee planner
.venv/bin/python fetch_task.py --planner
.venv/bin/python fetch_task.py --planner --period next        # or: commingup
.venv/bin/python fetch_task.py --planner --user-id 135

# Planner changes since the last saved day (also saves today's snapshot)
.venv/bin/python fetch_task.py --changes
.venv/bin/python fetch_task.py --changes --no-save

# Daily brief: now + soon-due next + changes (one fetch per planner period)
.venv/bin/python fetch_task.py --my-day

# Workflow stage / QA approval of several tasks
.venv/bin/python fetch_task.py --status 4054 5627 6027
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
