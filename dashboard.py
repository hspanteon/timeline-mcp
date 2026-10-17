#!/usr/bin/env python3
"""
Local web dashboard for Panteon Timeline: your planner board, planner changes
over time, release state of any tasks, and a readable task view.

Serves only on 127.0.0.1 and accepts only 127.0.0.1, localhost and
timeline.localhost as Host headers, because the
pages show customer data. Credentials come from the same .env as the MCP server.

Examples:
    python3 dashboard.py                 # http://timeline.localhost:8765
    python3 dashboard.py --port 9000
    python3 dashboard.py --user-id 135
"""
import argparse
import os
import threading
from typing import Any, Callable, Dict, Optional

import requests
from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.middleware import Middleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

# Importing panteon_client loads the .env next to it (see panteon_client.py).
import panteon_client
import release_check
import work_session

WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
# *.localhost names resolve to loopback without /etc/hosts (RFC 6761), so
# timeline.localhost works out of the box in browsers and systemd-resolved.
HOSTNAME = "timeline.localhost"
ALLOWED_HOSTS = ["127.0.0.1", "localhost", HOSTNAME]
MAX_STATUS_IDS = 100


class _FreshStaticFiles(StaticFiles):
    """web/ files with Cache-Control: no-cache, so an edit shows on the next reload (still 304 when unchanged)."""

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache"
        return response


def _respond(call: Callable[[], Any]) -> JSONResponse:
    """Runs a blocking client call and maps its failures to JSON errors."""
    try:
        return JSONResponse(call())
    except release_check.ReleaseCheckError as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)
    except PermissionError as exc:
        return JSONResponse({"error": str(exc)}, status_code=401)
    except LookupError as exc:
        return JSONResponse({"error": str(exc)}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except requests.HTTPError as exc:
        code = exc.response.status_code if exc.response is not None else None
        if code in (404, 422):
            return JSONResponse({"error": "Not found in Panteon Timeline."}, status_code=404)
        return JSONResponse({"error": f"Panteon API request failed (HTTP {code})."}, status_code=502)
    except requests.RequestException as exc:
        return JSONResponse({"error": f"Could not reach Panteon Timeline: {exc}"}, status_code=502)


def create_app(
    user_id: Optional[Any] = None,
    base_dir: Optional[str] = None,
    repo_dir: Optional[str] = None,
    release_builder: Callable[..., Any] = release_check.build_report,
    work_config: Callable[[], Dict[str, Any]] = work_session.load_config,
    work_runner: Any = None,
    work_launcher: Any = None,
) -> Starlette:
    """
    Builds the app. `user_id` and `base_dir` work as in fetch_my_day;
    `repo_dir` is the duell-admin checkout (default: DUELL_ADMIN_DIR, then
    ../duell-admin). `release_builder`, `work_config`, `work_runner` and
    `work_launcher` are swappable for tests; the work config is re-read on
    every request, so edits to timeline-desk.json need no restart.
    """
    git_kwargs = {"runner": work_runner} if work_runner else {}
    start_kwargs = {**git_kwargs, **({"launcher": work_launcher} if work_launcher else {})}
    release = {"report": None, "lock": threading.Lock()}

    def headers():
        return panteon_client.build_api_headers()

    def resolved_user() -> int:
        return panteon_client.resolve_user_id(user_id)

    def index(request: Request):
        return FileResponse(os.path.join(WEB_DIR, "index.html"), headers={"Cache-Control": "no-cache"})

    def api_planner(request: Request):
        return _respond(lambda: panteon_client.planner_overview(
            panteon_client.fetch_all_planners(headers()), resolved_user()
        ))

    def api_changes(request: Request):
        return _respond(lambda: panteon_client.planner_history(resolved_user(), base_dir))

    def api_snapshot(request: Request):
        # A cross-site form can POST here but can't set this header without a
        # CORS preflight, which this app never allows.
        if request.headers.get("x-timeline-desk") != "1":
            return JSONResponse({"error": "Missing X-Timeline-Desk header."}, status_code=403)

        def save():
            result = panteon_client.fetch_my_planner_changes(
                headers(), user_id=resolved_user(), base_dir=base_dir, save=True
            )
            return {"date": result["snapshot"]["date"], "tasks": len(result["snapshot"]["tasks"])}
        return _respond(save)

    def api_statuses(request: Request):
        ids = [i for i in request.query_params.get("ids", "").replace(",", " ").split() if i]

        def lookup():
            if not ids:
                raise ValueError("Add at least one issue ID.")
            if len(ids) > MAX_STATUS_IDS:
                raise ValueError(f"Check at most {MAX_STATUS_IDS} issues at a time.")
            return {"statuses": panteon_client.get_task_statuses(ids, headers())}
        return _respond(lookup)

    def api_task(request: Request):
        def load():
            data = panteon_client.fetch_task_data(request.path_params["issue"], headers())
            meta = data["task_meta"]
            return {
                "issue_id": data["issue_id"],
                "title": meta.get("title"),
                "creator": meta.get("creator"),
                "created_date": meta.get("created_date"),
                "status": meta.get("status"),
                "tags": meta.get("tags") or [],
                "description": meta.get("description") or "",
                "comments": data["comments"],
            }
        return _respond(load)

    def api_release(request: Request):
        return JSONResponse({"report": release["report"]})

    def api_release_refresh(request: Request):
        # Runs git fetch, so it is a POST with the same header guard as snapshots.
        if request.headers.get("x-timeline-desk") != "1":
            return JSONResponse({"error": "Missing X-Timeline-Desk header."}, status_code=403)

        def build():
            with release["lock"]:
                release["report"] = release_builder(
                    repo_dir=repo_dir,
                    status_lookup=lambda ids: panteon_client.get_task_statuses(ids, headers()),
                )
            return {"report": release["report"]}
        return _respond(build)

    def guarded(request: Request) -> Optional[JSONResponse]:
        if request.headers.get("x-timeline-desk") != "1":
            return JSONResponse({"error": "Missing X-Timeline-Desk header."}, status_code=403)
        return None

    async def json_body(request: Request) -> Dict[str, Any]:
        try:
            body = await request.json()
        except ValueError:
            body = None
        return body if isinstance(body, dict) else {}

    def api_work_config(request: Request):
        return _respond(lambda: work_session.public_config(work_config()))

    async def api_work_start(request: Request):
        denied = guarded(request)
        if denied:
            return denied
        body = await json_body(request)

        def start():
            issue, code = str(body.get("issue") or ""), str(body.get("code") or "")
            if not issue.isdigit():
                raise ValueError("Issue ID must be a number.")
            row = panteon_client.get_task_statuses([issue], headers())[0]
            if row.get("error"):
                raise LookupError(f"Task #{issue}: {row['error']}.")
            return work_session.start_session(work_config(), code, issue, row.get("title") or "",
                                              stages=row.get("stages"), **start_kwargs)
        return await run_in_threadpool(_respond, start)

    def api_work_list(request: Request):
        return _respond(lambda: {"worktrees": work_session.list_worktrees(work_config(), **git_kwargs)})

    async def api_work_remove(request: Request):
        denied = guarded(request)
        if denied:
            return denied
        body = await json_body(request)

        def remove():
            path = body.get("path")
            if not isinstance(path, str) or not path:
                raise ValueError("Which worktree? Pass its path.")
            return work_session.remove_worktree(work_config(), path, bool(body.get("delete_branch")), **git_kwargs)
        return await run_in_threadpool(_respond, remove)

    routes = [
        Route("/", index),
        Route("/api/planner", api_planner),
        Route("/api/changes", api_changes),
        Route("/api/snapshot", api_snapshot, methods=["POST"]),
        Route("/api/statuses", api_statuses),
        Route("/api/task/{issue}", api_task),
        Route("/api/release", api_release),
        Route("/api/release", api_release_refresh, methods=["POST"]),
        Route("/api/work/config", api_work_config),
        Route("/api/work/start", api_work_start, methods=["POST"]),
        Route("/api/work/worktrees", api_work_list),
        Route("/api/work/remove", api_work_remove, methods=["POST"]),
        Mount("/static", _FreshStaticFiles(directory=WEB_DIR), name="static"),
    ]
    middleware = [
        # Blocks DNS-rebinding: another site can't reach this API through a
        # hostname that resolves to 127.0.0.1.
        Middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS),
    ]
    return Starlette(routes=routes, middleware=middleware)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8765, help="Port on 127.0.0.1 (default 8765).")
    parser.add_argument("--user-id", default=None, help="Planner user id; defaults to PANTEON_USER_ID, then the bearer token's `sub`.")
    parser.add_argument("--repo-dir", default=None, help="duell-admin checkout for the Release view; defaults to DUELL_ADMIN_DIR, then ../duell-admin.")
    parser.add_argument("--base-dir", default=None, help="Where timeline/planner snapshots live; defaults to PANTEON_TIMELINE_DIR or the current directory.")
    args = parser.parse_args(argv)

    import uvicorn

    print(f"Timeline desk: http://{HOSTNAME}:{args.port}  (or http://127.0.0.1:{args.port})", flush=True)
    uvicorn.run(create_app(args.user_id, args.base_dir, args.repo_dir), host="127.0.0.1", port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
