import base64
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
import requests
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv

# Load the .env sitting next to this module, so credentials resolve regardless of
# which project the MCP server is launched from (it runs globally at user scope,
# with the cwd set to whatever project you're in). Variables already present in
# the environment — e.g. those set in the MCP registration — are NOT overridden.
# Falls back to the default cwd-based search when there is no local .env.
_ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(_ENV_PATH if _ENV_PATH.exists() else None)

BASE_URL = "https://timeline.panteon.no"

# Panteon tenant/company id used in API URLs. This server is single-tenant (one
# Panteon company per deployment), so PANTEON_COMPANY_ID is normally never set
# and this default applies. See .env.example.
DEFAULT_COMPANY_ID = "16"

# Reused across calls for connection pooling.
_SESSION = requests.Session()

# Markdown image: ![alt](src)  and  HTML image: <img src="...">
# Shared by extract_images (src only) and absolutize_markdown_images (alt + src,
# to rewrite in place) so the two never drift apart.
_MD_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(\s*<?([^)\s>]+)[^)]*\)")
_HTML_IMAGE_RE = re.compile(r"<img[^>]+src=[\"']([^\"']+)[\"']", re.IGNORECASE)


def _api_get(url: str, headers: Dict[str, str], *, context: str = "") -> requests.Response:
    """
    Performs a GET against the Panteon API with a shared session, a 30s timeout,
    and uniform authentication-error handling. `context` is appended to the
    auth-error message (e.g. " when fetching task 5461").
    """
    response = _SESSION.get(url, headers=headers, timeout=30)
    if response.status_code in (401, 403):
        raise PermissionError(
            f"Authentication failed (HTTP {response.status_code}){context}. "
            "Please verify your PANTEON_BEARER_TOKEN or PANTEON_COOKIE."
        )
    response.raise_for_status()
    return response


def extract_issue_id(issue_identifier: str) -> str:
    """
    Extracts the numeric issue ID from a URL or raw ID string.
    Example URL: https://timeline.panteon.no/tasks#/list/15033/edit/5461 -> returns '5461'
    Example ID: '5461' -> returns '5461'
    """
    issue_identifier = issue_identifier.strip()

    # Check if input is already a purely numeric ID
    if issue_identifier.isdigit():
        return issue_identifier

    # Check for URL pattern /edit/<id> — the issue id lives here.
    match = re.search(r"/edit/(\d+)", issue_identifier)
    if match:
        return match.group(1)

    # We intentionally do NOT fall back to "trailing digits" here: a URL such as
    # https://timeline.panteon.no/tasks#/list/15033 would silently yield the
    # board/list id (15033) instead of an issue id, fetching the wrong task.
    raise ValueError(
        f"Could not extract a valid issue ID from input: '{issue_identifier}'. "
        "Provide a task URL containing '/edit/<id>' "
        "(e.g. https://timeline.panteon.no/tasks#/list/15033/edit/5461) "
        "or a bare numeric ID (e.g. 5461)."
    )


def build_api_headers(
    bearer_token: Optional[str] = None,
    cookie: Optional[str] = None,
    xsrf_token: Optional[str] = None,
) -> Dict[str, str]:
    """
    Constructs required headers for Panteon API requests.
    Prioritizes passed parameters over environment variables.
    """
    token = bearer_token or os.getenv("PANTEON_BEARER_TOKEN")
    cookie_str = cookie or os.getenv("PANTEON_COOKIE")
    xsrf = xsrf_token or os.getenv("PANTEON_XSRF_TOKEN")

    headers = {
        "Accept": "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }

    if token:
        # Remove prefix if user accidentally included 'Bearer '
        clean_token = token.replace("Bearer ", "").strip()
        headers["Authorization"] = f"Bearer {clean_token}"

    if cookie_str:
        headers["Cookie"] = cookie_str.strip()

    if xsrf:
        headers["X-XSRF-TOKEN"] = xsrf.strip()

    if not token and not cookie_str:
        raise PermissionError(
            "Authentication credentials missing! Please supply `bearer_token` or `cookie` argument, "
            "or set `PANTEON_BEARER_TOKEN` or `PANTEON_COOKIE` in your `.env` file."
        )

    return headers


def _decode_jwt_payload(token: str) -> Optional[Dict[str, Any]]:
    """
    Decodes (without verifying the signature) the payload segment of a JWT,
    purely to read informational claims like `exp`. Returns None if the
    token isn't a parseable 3-segment JWT.
    """
    parts = token.split(".")
    if len(parts) != 3:
        return None
    padded = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(padded))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return None


def describe_token_expiry(token: str) -> Optional[str]:
    """
    Returns a human-readable expiry description for a bearer JWT (e.g.
    "expired 2h ago" or "valid, expires in 3d 4h"), or None if the token
    isn't a JWT or carries no `exp` claim.
    """
    payload = _decode_jwt_payload(token)
    if not payload or "exp" not in payload:
        return None
    try:
        exp = datetime.fromtimestamp(float(payload["exp"]), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None

    total_seconds = int((exp - datetime.now(tz=timezone.utc)).total_seconds())
    days, rem = divmod(abs(total_seconds), 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    span = f"{days}d {hours}h" if days else (f"{hours}h {minutes}m" if hours else f"{minutes}m")

    return f"expired {span} ago" if total_seconds <= 0 else f"valid, expires in {span}"


def check_auth(headers: Dict[str, str], company_id: Optional[str] = None) -> Dict[str, str]:
    """
    Verifies that `headers` are accepted by the Panteon API, without needing a
    real issue ID. Requests a deliberately non-existent issue id and inspects
    the outcome: Panteon's auth layer rejects with 401/403 before it would
    ever look up the task, so any other response (including a 404) means the
    credentials themselves are valid — only the probe id doesn't exist.

    Returns {"status": "valid" | "invalid" | "unknown", "detail": str}.
    Never raises for auth or network failures; those are reported in the
    result instead.
    """
    probe_issue_id = "999999999"
    try:
        get_task_by_issue(probe_issue_id, headers, company_id=company_id)
        return {"status": "valid", "detail": "Credentials accepted by the Panteon API."}
    except PermissionError as exc:
        return {"status": "invalid", "detail": str(exc)}
    except requests.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else "?"
        return {
            "status": "valid",
            "detail": f"Credentials accepted (probe request returned HTTP {status_code}, as expected).",
        }
    except requests.RequestException as exc:
        return {"status": "unknown", "detail": f"Could not reach Panteon API: {exc}"}


def get_task_by_issue(
    issue_id: str,
    headers: Dict[str, str],
    company_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Calls Panteon API 1: /api/taskbyissue/{issue_id}/{company_id}
    Resolves the external issue ID to the internal task record.
    """
    comp_id = company_id or os.getenv("PANTEON_COMPANY_ID", DEFAULT_COMPANY_ID)
    url = f"{BASE_URL}/api/taskbyissue/{issue_id}/{comp_id}"

    response = _api_get(url, headers, context=f" when fetching task {issue_id}")
    return response.json()


def extract_task_id_from_data(task_data: Dict[str, Any]) -> int:
    """
    Extracts the underlying internal task_id required for timeline API calls.
    Follows exact fallback logic from the reference Chrome extension.
    """
    if isinstance(task_data, dict):
        if "task_id" in task_data and task_data["task_id"]:
            return int(task_data["task_id"])

        data_section = task_data.get("data", {})
        if isinstance(data_section, dict):
            if "task_id" in data_section and data_section["task_id"]:
                return int(data_section["task_id"])
            if "id" in data_section and data_section["id"]:
                return int(data_section["id"])

        if "id" in task_data and task_data["id"]:
            return int(task_data["id"])

    raise ValueError("Could not extract internal `task_id` from Panteon API response.")


def extract_task_meta(raw_task: Dict[str, Any]) -> Dict[str, Any]:
    """
    Pulls the task header (title, full description body, creator, timestamp, status,
    tags) out of the API-1 response.
    """
    data = raw_task.get("data") if isinstance(raw_task.get("data"), dict) else raw_task
    data = data or {}
    creator = data.get("task_creator") or {}
    tags = [t.get("name") for t in (data.get("task_tags") or []) if isinstance(t, dict) and t.get("name")]
    return {
        "issue_number": data.get("issue_number"),
        "title": data.get("title") or data.get("name") or "",
        "description": (data.get("description") or "").strip(),
        "creator": creator.get("name") if isinstance(creator, dict) else "",
        "created_at": data.get("created_at_string") or data.get("created_at") or "",
        "created_date": _normalize_date(data.get("created_at") or data.get("created_at_string") or ""),
        "status": data.get("task_status") or "",
        "tags": tags,
    }


def _normalize_date(value: str) -> str:
    """Reduces a timestamp to a YYYY-MM-DD date string. Accepts ISO (2026-06-26T..)
    or Panteon's `dd.mm.yyyy HH:MM` format. Returns '' if it can't be parsed."""
    value = (value or "").strip()
    if not value:
        return ""
    iso = re.match(r"(\d{4})-(\d{2})-(\d{2})", value)
    if iso:
        return iso.group(0)
    dmy = re.match(r"(\d{2})\.(\d{2})\.(\d{4})", value)
    if dmy:
        return f"{dmy.group(3)}-{dmy.group(2)}-{dmy.group(1)}"
    return value


def get_task_timeline(task_id: int, headers: Dict[str, str]) -> List[Dict[str, Any]]:
    """
    Calls Panteon API 2: /api/task/{task_id}/timeline
    Retrieves full timeline and comments for the task.
    """
    url = f"{BASE_URL}/api/task/{task_id}/timeline"
    response = _api_get(url, headers, context=f" when fetching timeline for task {task_id}")

    data = response.json()
    if isinstance(data, list):
        return data
    elif isinstance(data, dict) and isinstance(data.get("data"), list):
        return data["data"]
    return []


def _resolve_url(src: str) -> str:
    """Resolves a possibly-relative image src to an absolute Panteon URL. Inline
    `data:` URIs are already self-contained and returned untouched."""
    src = (src or "").strip()
    if src.startswith("data:"):
        return src
    if src.startswith("//"):
        return "https:" + src
    if src.startswith("/"):
        return BASE_URL + src
    if not src.startswith(("http://", "https://")):
        return f"{BASE_URL}/{src.lstrip('/')}"
    return src


def extract_images(description: str) -> List[str]:
    """
    Extracts every image referenced in a comment description and returns absolute URLs.
    Handles markdown (`![](src)`) and HTML (`<img src="">`) images. Relative
    `/storage/...` paths are resolved against the Panteon base URL. Non-image
    attachment links (plain markdown `[label](file.csv)`) are intentionally ignored.
    Order is preserved and duplicates removed.
    """
    urls: List[str] = []
    md_srcs = [src for _alt, src in _MD_IMAGE_RE.findall(description or "")]
    for match in md_srcs + _HTML_IMAGE_RE.findall(description or ""):
        src = _resolve_url(match)
        if src and src not in urls:
            urls.append(src)
    return urls


def collect_all_images(
    description: str,
    comments: List[Dict[str, Any]],
    extra_descriptions: Optional[List[str]] = None,
) -> List[str]:
    """
    Aggregates every image URL across the task description, optional extra
    context, and all comments, preserving order and removing duplicates.
    """
    all_images: List[str] = []
    for text in [description] + (extra_descriptions or []):
        for url in extract_images(text):
            if url not in all_images:
                all_images.append(url)
    for comment in comments:
        for url in comment.get("images", []):
            if url not in all_images:
                all_images.append(url)
    return all_images


def absolutize_markdown_images(description: str) -> str:
    """
    Rewrites markdown image srcs (`![alt](src)`) to absolute URLs so they render
    when the conversation is saved to a standalone markdown file. Non-image links
    are left untouched.
    """
    def _repl(match: "re.Match[str]") -> str:
        alt, src = match.group(1), match.group(2)
        return f"![{alt}]({_resolve_url(src)})"

    return _MD_IMAGE_RE.sub(_repl, description or "")


def parse_conversation_comments(timeline_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Filters timeline events for task comments and returns them chronologically,
    each with its author, timestamp, description text, and all embedded images
    (as absolute URLs).
    """
    comments: List[Dict[str, Any]] = []
    for item in timeline_items:
        if not isinstance(item, dict):
            continue

        item_type = item.get("type") or item.get("event") or item.get("event_type")
        has_comment = item.get("task_comment") or item.get("field_name") == "Comment Added"
        if not (item_type == "task_comment" or has_comment):
            continue

        employee = item.get("employee") or {}
        author = employee.get("name") if isinstance(employee, dict) else None
        if not author:
            author = item.get("employee_name", "Unknown")

        desc = ""
        if isinstance(item.get("task_comment"), dict):
            desc = item["task_comment"].get("description", "")
        if not desc:
            desc = item.get("description", "")
        desc = (desc or "").strip()

        images = extract_images(desc)

        # Skip empty timeline rows that carry neither text nor images.
        if not desc and not images:
            continue

        comments.append({
            "author": author,
            "created_at": item.get("created_at", ""),
            "description": desc,
            "images": images,
        })

    return comments


def _as_code_block(text: str) -> str:
    """
    Wraps the original (markdown) content in a fenced code block so it is shown
    literally and never collides with this file's own markdown structure. The fence
    length is chosen to be longer than any backtick run inside the content so that
    embedded code fences cannot break out.
    """
    longest = 0
    for run in re.findall(r"`+", text or ""):
        longest = max(longest, len(run))
    fence = "`" * max(3, longest + 1)
    return f"{fence}\n{text}\n{fence}"


def _is_same_person(a: Optional[str], b: Optional[str]) -> bool:
    """Case/whitespace-insensitive name match; empty names never match."""
    a, b = (a or "").strip().casefold(), (b or "").strip().casefold()
    return bool(a) and a == b


def render_task_markdown(
    issue_id: str,
    task_meta: Dict[str, Any],
    comments: List[Dict[str, Any]],
) -> str:
    """
    Renders the task as a `task.md` document:

        # Task {id}: {title}
        **ID / Title / Creator / Date Created / Status / Tags**
        ## Description
        ## User-Provided Context
        ## Conversation
        ## Acceptance Criteria
        ## Open Questions
        ## Images

    The file's own structure (heading, metadata, section headings) is plain markdown,
    while every piece of *original* content (the description and each comment) is
    placed inside a fenced code block so the two markdown layers never mix. Image
    references inside that content are rewritten to absolute URLs so the links remain
    usable.

    Comments written by the task creator are labelled "(task creator)" in their
    heading, so requirements can be told apart from discussion by other people.

    `## Acceptance Criteria` and `## Open Questions` need reasoning over the
    description and conversation, which this deterministic fetcher cannot do, so
    they are emitted as placeholders for an AI assistant to complete.
    """
    title = task_meta.get("title") or f"Issue {issue_id}"
    user_context = (task_meta.get("user_context") or "").strip()
    all_images = collect_all_images(
        task_meta.get("description", ""),
        comments,
        extra_descriptions=[user_context] if user_context else None,
    )

    creator = task_meta.get("creator") or ""
    tags = ", ".join(task_meta.get("tags") or []) or "—"

    lines = [
        f"# Task {issue_id}: {title}",
        "",
        f"**ID:** {issue_id}",
        f"**Title:** {title}",
        f"**Creator:** {creator or '—'}",
        f"**Date Created:** {task_meta.get('created_date') or task_meta.get('created_at') or '—'}",
        f"**Status:** {task_meta.get('status') or '(unknown)'}",
        f"**Tags:** {tags}",
        "",
    ]

    lines.append("## Description")
    lines.append("")
    description = absolutize_markdown_images(task_meta.get("description", ""))
    lines.append(_as_code_block(description) if description else "_(no description)_")
    lines.append("")

    if user_context:
        lines.append("## User-Provided Context")
        lines.append("")
        lines.append(_as_code_block(absolutize_markdown_images(user_context)))
        lines.append("")

    lines.append(f"## Conversation ({len(comments)} comment(s))")
    lines.append("")
    if not comments:
        lines.append("_(no comments)_")
        lines.append("")
    for comment in comments:
        header = comment["author"] or "Unknown"
        if _is_same_person(comment["author"], creator):
            header += " (task creator)"
        if comment.get("created_at"):
            header += f" — {comment['created_at']}"
        lines.append(f"### {header}")
        lines.append("")
        body = absolutize_markdown_images(comment["description"])
        lines.append(_as_code_block(body) if body else "_(no text)_")
        lines.append("")

    lines.append("## Acceptance Criteria")
    lines.append("")
    lines.append("_To be derived from the description above._")
    lines.append("")

    lines.append("## Open Questions")
    lines.append("")
    lines.append("_To be derived from the description and conversation above._")
    lines.append("")

    lines.append(f"## Images ({len(all_images)})")
    lines.append("")
    if not all_images:
        lines.append("_(no images)_")
    else:
        for i, url in enumerate(all_images, 1):
            lines.append(f"{i}. {url}")
            lines.append("")
            lines.append(f"   ![image {i}]({url})")
            lines.append("")
    lines.append("")
    return "\n".join(lines)


def task_markdown_path(issue_id: str, base_dir: Optional[str] = None) -> str:
    """
    Returns the absolute path where a task's markdown lives:
    `<base>/timeline/<issue_id>/task.md`.

    base_dir defaults to the PANTEON_TIMELINE_DIR env var, then the current working
    directory. Does not create anything on disk.
    """
    base = base_dir or os.getenv("PANTEON_TIMELINE_DIR") or os.getcwd()
    return os.path.abspath(os.path.join(base, "timeline", str(issue_id), "task.md"))


def save_task_markdown(
    issue_id: str,
    task_meta: Dict[str, Any],
    comments: List[Dict[str, Any]],
    base_dir: Optional[str] = None,
) -> str:
    """
    Writes the task to `<base_dir>/timeline/<issue_id>/task.md` and returns the
    absolute path of the written file. See `task_markdown_path` for how the base
    directory is resolved.
    """
    path = task_markdown_path(issue_id, base_dir)
    os.makedirs(os.path.dirname(path), exist_ok=True)

    with open(path, "w", encoding="utf-8") as fh:
        fh.write(render_task_markdown(issue_id, task_meta, comments))
    return path


def fetch_task_data(
    issue_identifier: str,
    headers: Dict[str, str],
) -> Dict[str, Any]:
    """
    Runs the full read pipeline for a single task — resolve the issue id, call the
    two Panteon APIs, and parse the results — and returns the parsed pieces:

        {"issue_id", "task_id", "task_meta", "comments"}

    This is the shared orchestration used by both the MCP tool and the CLI. It is
    synchronous and performs blocking network I/O, so async callers should offload
    it to a thread (see server.py).
    """
    issue_id = extract_issue_id(issue_identifier)
    raw_task = get_task_by_issue(issue_id, headers)
    task_id = extract_task_id_from_data(raw_task)
    task_meta = extract_task_meta(raw_task)

    timeline_items = get_task_timeline(task_id, headers)
    comments = parse_conversation_comments(timeline_items)

    return {
        "issue_id": issue_id,
        "task_id": task_id,
        "task_meta": task_meta,
        "comments": comments,
    }


def fetch_and_save(
    issue_identifier: str,
    headers: Optional[Dict[str, str]] = None,
    base_dir: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Convenience wrapper: fetch a task and write it to disk in one call, returning
    the parsed data plus the `saved_file` path. Builds headers from the environment
    if none are supplied. Does not perform any user elicitation (that lives in the
    MCP tool); intended for scripts and the CLI.
    """
    headers = headers or build_api_headers()
    result = fetch_task_data(issue_identifier, headers)
    result["saved_file"] = save_task_markdown(
        result["issue_id"], result["task_meta"], result["comments"], base_dir=base_dir
    )
    return result
