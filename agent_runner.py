"""
Workflow runs inside the dashboard where every tool call Claude wants to make
(edit, write, command, …) waits for Approve or Deny on the task page
(phase 5). Built on the Claude Agent SDK (`pip install claude-agent-sdk`);
without it installed the option is simply not offered (`available`).

A run lives in a thread of the dashboard process with its own asyncio loop.
Its messages are appended to timeline/<id>/runs/<run>.stream.jsonl in the
same shape as `claude -p --output-format stream-json`, so the page's live
output is shared with desk runs (workflow.parse_transcript). Each permission
request is a row in `workflow_permissions` that the page decides; the run
polls the row and gives up (deny) after PERMISSION_TIMEOUT or when stopped.
You can also write to the session from the page (`send`). The session stays
open until the run is approved, rejected or stopped, then it is closed and
<run>.exit is written. A dashboard restart ends it (the run then shows
"Ended without a result" and can be continued in a terminal).

Only `sdk_backend` touches the SDK, so the rest is tested with a fake backend.
"""
import asyncio
import dataclasses
import importlib.util
import json
import os
import threading
import time
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

import panteon_client as pc

PERMISSION_TIMEOUT = 15 * 60
POLL_SECONDS = 0.5
# Reading never asks (the terminal doesn't ask for these either).
ALWAYS_ALLOWED = ("Read", "Grep", "Glob", "LS", "TodoWrite",
                  "mcp__timeline-mcp__get_task_conversation", "mcp__timeline-mcp__get_task_statuses",
                  "mcp__timeline-desk__get_task_conversation", "mcp__timeline-desk__get_task_statuses")

Backend = Callable[["AgentRun"], Awaitable[None]]
_RUNS: Dict[int, "AgentRun"] = {}
_registry_lock = threading.Lock()


def available() -> bool:
    return importlib.util.find_spec("claude_agent_sdk") is not None


def _now() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def tool_summary(name: str, tool_input: Any) -> str:
    """One line saying what a tool call does, for the approval card."""
    args = tool_input if isinstance(tool_input, dict) else {}
    for key in ("command", "file_path", "path", "pattern", "url", "query", "skill", "description"):
        if isinstance(args.get(key), str) and args[key].strip():
            return f"{name}: {args[key].strip()[:400]}"
    return name


def tool_detail(name: str, tool_input: Any) -> Dict[str, Any]:
    """What the page shows under a pending call: the command, or the change to a file."""
    args = tool_input if isinstance(tool_input, dict) else {}
    keep = {}
    for key in ("command", "description", "file_path", "old_string", "new_string", "content", "replace_all", "url", "pattern"):
        if key in args:
            value = args[key]
            keep[key] = value[:6000] if isinstance(value, str) else value
    if not keep:
        keep = {"input": json.dumps(args, ensure_ascii=False)[:6000]}
    return keep


class AgentRun:
    """One run: its files, its permission requests, its inbox of your messages."""

    def __init__(self, run_id: int, issue: str, base_dir: Optional[str], cwd: str, prompt: str, session_id: str,
                 stream_file: str, exit_file: str, claude: Optional[str] = None, add_dirs: Optional[List[str]] = None,
                 resume: Optional[str] = None, mcp_servers: Optional[Dict[str, Any]] = None):
        self.run_id, self.issue, self.base_dir, self.cwd = run_id, issue, base_dir, cwd
        self.prompt, self.session_id, self.resume = prompt, session_id, resume
        self.stream_file, self.exit_file = stream_file, exit_file
        self.claude, self.add_dirs = claude, add_dirs or []
        self.mcp_servers = mcp_servers or {}
        self.stop_event = threading.Event()
        self.ready = threading.Event()
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.inbox: Optional[asyncio.Queue] = None

    # -- output
    def emit(self, entry: Dict[str, Any]) -> None:
        entry = {**entry, "timestamp": entry.get("timestamp") or _now()}
        os.makedirs(os.path.dirname(self.stream_file), exist_ok=True)
        with open(self.stream_file, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")

    # -- permissions
    def _db(self):
        return pc._open_planner_db(self.base_dir, create=True)

    async def ask(self, tool: str, tool_input: Any) -> Tuple[bool, str]:
        """Waits for your decision on one tool call. True to allow; the note is your reason."""
        conn = self._db()
        try:
            cur = conn.execute(
                "INSERT INTO workflow_permissions (run_id, issue_number, tool, summary, input, status, requested_at) "
                "VALUES (?, ?, ?, ?, ?, 'pending', ?)",
                (self.run_id, self.issue, tool, tool_summary(tool, tool_input),
                 json.dumps(tool_detail(tool, tool_input), ensure_ascii=False), _now()))
            permission = cur.lastrowid
            conn.commit()
        finally:
            conn.close()
        self.emit({"type": "desk", "text": f"Waiting for your approval: {tool_summary(tool, tool_input)}"})
        deadline = time.monotonic() + PERMISSION_TIMEOUT
        while True:
            conn = self._db()
            try:
                row = conn.execute("SELECT status, note FROM workflow_permissions WHERE id = ?", (permission,)).fetchone()
                if row[0] in ("allowed", "denied"):
                    self.emit({"type": "desk", "text": f"You {row[0]}: {tool_summary(tool, tool_input)}"
                                                       + (f" ({row[1]})" if row[1] else "")})
                    return row[0] == "allowed", row[1] or ""
                if self.stop_event.is_set() or time.monotonic() > deadline:
                    why = "The run was stopped." if self.stop_event.is_set() else "No answer on the Timeline desk in time."
                    conn.execute("UPDATE workflow_permissions SET status = 'expired', decided_at = ?, note = ? WHERE id = ?",
                                 (_now(), why, permission))
                    conn.commit()
                    return False, why
            finally:
                conn.close()
            await asyncio.sleep(POLL_SECONDS)

    # -- your messages
    async def next_message(self) -> Optional[str]:
        """Your next message from the page, or None once the run is stopped."""
        while not self.stop_event.is_set():
            try:
                return await asyncio.wait_for(self.inbox.get(), timeout=POLL_SECONDS)
            except asyncio.TimeoutError:
                continue
        return None

    def send(self, text: str) -> None:
        if not self.loop or not self.inbox:
            raise LookupError("That run isn't ready for messages.")
        self.emit({"type": "user", "message": {"content": text}})
        self.loop.call_soon_threadsafe(self.inbox.put_nowait, text)


# ---- the SDK -----------------------------------------------------------------
def message_entry(message: Any) -> Dict[str, Any]:
    """An SDK message as a stream-json line (what `claude -p --output-format stream-json` writes)."""
    kind = type(message).__name__
    if kind in ("AssistantMessage", "UserMessage"):
        content = getattr(message, "content", "")
        blocks: Any = content
        if isinstance(content, list):
            blocks = []
            for block in content:
                name = type(block).__name__
                if name == "TextBlock":
                    blocks.append({"type": "text", "text": block.text})
                elif name == "ToolUseBlock":
                    blocks.append({"type": "tool_use", "name": block.name, "input": block.input})
                elif name == "ToolResultBlock":
                    blocks.append({"type": "tool_result"})
        return {"type": "assistant" if kind == "AssistantMessage" else "user", "message": {"content": blocks}}
    if kind == "ResultMessage":
        return {"type": "result", "subtype": getattr(message, "subtype", None), "session_id": getattr(message, "session_id", None)}
    return {"type": "system", "subtype": getattr(message, "subtype", kind)}


async def sdk_backend(run: AgentRun) -> None:
    """A Claude Code session through the Agent SDK, asking the page before each tool call."""
    import claude_agent_sdk as sdk

    async def can_use_tool(tool_name: str, tool_input: Dict[str, Any], context: Any = None):
        if tool_name in ALWAYS_ALLOWED:
            return sdk.PermissionResultAllow(updated_input=tool_input)
        ok, note = await run.ask(tool_name, tool_input)
        if ok:
            return sdk.PermissionResultAllow(updated_input=tool_input)
        return sdk.PermissionResultDeny(message=note or "Denied on the Timeline desk.", interrupt=False)

    wanted = {
        "cwd": run.cwd, "cli_path": run.claude, "can_use_tool": can_use_tool, "permission_mode": "default",
        "add_dirs": run.add_dirs, "resume": run.resume, "mcp_servers": run.mcp_servers or None,
        # Behave like Claude Code in a terminal: its system prompt, and the user's/project's settings,
        # CLAUDE.md and MCP servers (the timeline MCP among them).
        "setting_sources": ["user", "project", "local"],
        "system_prompt": {"type": "preset", "preset": "claude_code"},
    }
    fields = {f.name for f in dataclasses.fields(sdk.ClaudeAgentOptions)}
    if not run.resume:
        if "session_id" in fields:
            wanted["session_id"] = run.session_id
        elif "extra_args" in fields:
            wanted["extra_args"] = {"session-id": run.session_id}
    options = sdk.ClaudeAgentOptions(**{k: v for k, v in wanted.items() if k in fields and v is not None})
    async with sdk.ClaudeSDKClient(options=options) as client:
        text: Optional[str] = run.prompt
        while text is not None and not run.stop_event.is_set():
            await client.query(text)
            async for message in client.receive_response():
                run.emit(message_entry(message))
                if run.stop_event.is_set():
                    await client.interrupt()
                    break
            text = await run.next_message()


# ---- running ----------------------------------------------------------------------
def start(run: AgentRun, backend: Optional[Backend] = None) -> None:
    """Starts the run in its own thread; returns once it can take messages."""
    backend = backend or sdk_backend

    async def main() -> None:
        run.loop = asyncio.get_running_loop()
        run.inbox = asyncio.Queue()
        run.ready.set()
        code = 0
        try:
            await backend(run)
        except Exception as exc:  # shown in the run's output; the run then ends without a result
            run.emit({"type": "desk", "text": f"The session failed: {exc}"})
            code = 1
        finally:
            os.makedirs(os.path.dirname(run.exit_file), exist_ok=True)
            with open(run.exit_file, "w", encoding="utf-8") as fh:
                fh.write(f"{code}\n")
            with _registry_lock:
                _RUNS.pop(run.run_id, None)

    with _registry_lock:
        _RUNS[run.run_id] = run
    threading.Thread(target=lambda: asyncio.run(main()), name=f"agent-run-{run.run_id}", daemon=True).start()
    run.ready.wait(timeout=10)


def running(run_id: int) -> bool:
    with _registry_lock:
        return int(run_id) in _RUNS


def send(run_id: int, text: str) -> None:
    with _registry_lock:
        run = _RUNS.get(int(run_id))
    if not run:
        raise LookupError("That run isn't active in this dashboard any more. Continue it in a terminal.")
    run.send(text)


def stop(run_id: Any) -> bool:
    """Asks the run to end (pending approvals expire). False when it isn't running here."""
    with _registry_lock:
        run = _RUNS.get(int(run_id)) if run_id is not None else None
    if not run:
        return False
    run.stop_event.set()
    return True
