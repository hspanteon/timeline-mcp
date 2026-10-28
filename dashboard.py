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
import random
import re
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Optional

import requests
from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.middleware import Middleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

# Importing panteon_client loads the .env next to it (see panteon_client.py).
import panteon_client
import release_check
import task_events
import work_session

WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
# *.localhost names resolve to loopback without /etc/hosts (RFC 6761), so
# timeline.localhost works out of the box in browsers and systemd-resolved.
HOSTNAME = "timeline.localhost"
ALLOWED_HOSTS = ["127.0.0.1", "localhost", HOSTNAME]
MAX_STATUS_IDS = 100
# Polling is tiered so it feels live without spikes. Every HEARTBEAT the `now`
# planner period (1 request) and the watched tasks' timelines (1 each) are read;
# the full planner check (3 periods) runs when the heartbeat sees `now` change, or
# at least every DEFAULT_SNAPSHOT_MINUTES. Stage lookups (1 request per task) run
# only when something changed, or every STAGE_REFRESH_MINUTES. Outside the active
# hours (weekdays, TIMELINE_ACTIVE_HOURS "7-19"; "all" turns it off) there is one
# full check per OFF_HOURS_MINUTES.
DEFAULT_HEARTBEAT_MINUTES = 3
DEFAULT_SNAPSHOT_MINUTES = 15
STAGE_REFRESH_MINUTES = 60
OFF_HOURS_MINUTES = 60
DEFAULT_ACTIVE_HOURS = "7-19"
JITTER = 0.1


PLANNER_CACHE_SECONDS = 300


class PlannerCache:
    """The latest raw planner ({period: planner}) kept in memory, so opening or
    refreshing a page reads it instead of calling Timeline again. The scheduler
    keeps it current; the Refresh button forces a new fetch."""

    def __init__(self, ttl: float = PLANNER_CACHE_SECONDS, clock: Callable[[], float] = time.monotonic):
        self.ttl, self.clock = ttl, clock
        self.lock = threading.Lock()
        self.data: Optional[Dict[str, Any]] = None
        self.at = 0.0

    def get(self, fetch: Callable[[], Dict[str, Any]], force: bool = False) -> Dict[str, Any]:
        with self.lock:
            if force or self.data is None or self.clock() - self.at >= self.ttl:
                self.data, self.at = fetch(), self.clock()
            return self.data

    def put(self, planners: Dict[str, Any]) -> None:
        with self.lock:
            self.data, self.at = planners, self.clock()

    def update(self, period: str, planner: Any) -> None:
        """Replaces one period (a heartbeat's fresh `now`) without making the rest look fresher."""
        with self.lock:
            if self.data is not None:
                self.data = {**self.data, period: planner}


class _FreshStaticFiles(StaticFiles):
    """web/ files with Cache-Control: no-cache, so an edit shows on the next reload (still 304 when unchanged)."""

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache"
        return response


STORAGE_NAME = re.compile(r"[A-Za-z0-9_-]+\.(?:jpe?g|png|gif|webp)")
IMAGE_TYPES = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif", "webp": "image/webp"}
# Timeline names these files after a timestamp and never rewrites them, so a copy
# is good forever: browsers keep it for a year and the server keeps one on disk.
IMMUTABLE = {"Cache-Control": "private, max-age=31536000, immutable"}


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
    planner_cache: Optional[PlannerCache] = None,
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
    planners = planner_cache or PlannerCache()
    image_dir = Path(panteon_client.planner_db_path(base_dir)).parent / "images"

    def headers():
        return panteon_client.build_api_headers()

    def resolved_user() -> int:
        return panteon_client.resolve_user_id(user_id)

    def index(request: Request):
        return FileResponse(os.path.join(WEB_DIR, "index.html"), headers={"Cache-Control": "no-cache"})

    def api_planner(request: Request):
        force = request.query_params.get("refresh") == "1"
        return _respond(lambda: panteon_client.planner_overview(
            planners.get(lambda: panteon_client.fetch_all_planners(headers()), force), resolved_user()
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
                headers(), user_id=resolved_user(), base_dir=base_dir, save=True, with_stages=True
            )
            return {"taken_at": result["snapshot"]["taken_at"], "tasks": len(result["snapshot"]["tasks"])}
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

    def storage_proxy(folder: str):
        # Timeline's profile photos and attachments are public, but the page
        # loads nothing external, so they are proxied: no credentials sent,
        # bare filename only, fixed folder, no redirects.
        def proxy(request: Request):
            name = request.path_params["name"]
            if not STORAGE_NAME.fullmatch(name):
                return JSONResponse({"error": "Not found."}, status_code=404)
            cached = image_dir / folder / name
            if cached.is_file():
                return Response(cached.read_bytes(), media_type=IMAGE_TYPES[name.rsplit(".", 1)[1].lower()], headers=IMMUTABLE)
            url = f"{panteon_client.BASE_URL}/storage/{folder}/{name}"
            try:
                upstream = panteon_client.timed_request(
                    "GET", url, lambda: requests.get(url, timeout=10, allow_redirects=False))
            except requests.RequestException:
                return JSONResponse({"error": "Image unavailable."}, status_code=502)
            content_type = upstream.headers.get("content-type", "").split(";")[0]
            if upstream.status_code != 200 or not content_type.startswith("image/") or "svg" in content_type:
                return JSONResponse({"error": "Not found."}, status_code=404)
            try:  # best effort: a failed write only means asking Timeline again next time
                cached.parent.mkdir(parents=True, exist_ok=True)
                temp = cached.with_name(f".{name}.{os.getpid()}.tmp")
                temp.write_bytes(upstream.content)
                temp.replace(cached)
            except OSError:
                pass
            return Response(upstream.content, media_type=content_type, headers=IMMUTABLE)
        return proxy

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

    def api_project_tasks(request: Request):
        # Only projects listed (with an "id") in timeline-desk.json can be read.
        def load():
            try:
                wanted = int(request.path_params["project"])
            except ValueError:
                raise LookupError("Unknown project.")
            projects = {p["id"]: p for p in work_session.public_config(work_config())["projects"]}
            if wanted not in projects:
                raise LookupError("Unknown project.")
            return panteon_client.fetch_project_tasks(
                wanted, headers(), resolved_user(), code=projects[wanted]["code"],
                tab=request.query_params.get("tab") or None)
        return _respond(load)

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

    def api_events(request: Request):
        params = request.query_params
        split = lambda key: [v for v in params.get(key, "").replace(",", " ").split() if v]
        return _respond(lambda: {
            **task_events.list_events(base_dir, split("issues"), split("kinds"),
                                      int(params.get("limit") or 200), params.get("before") or None),
            "watchlist": task_events.list_watchlist(base_dir),
        })

    def api_events_sync(request: Request):
        denied = guarded(request)
        if denied:
            return denied
        return _respond(lambda: task_events.sync_watchlist(headers(), base_dir))

    async def api_watch(request: Request):
        denied = guarded(request)
        if denied:
            return denied
        body = await json_body(request)

        def watch():
            issue = str(body.get("issue") or "").strip()
            if not issue.isdigit():
                raise ValueError("Issue ID must be a number.")
            # Only the user's own open tasks can be watched.
            task = task_events.find_my_open_task(issue, headers(), work_session.public_config(work_config())["projects"],
                                                 resolved_user())
            if not task:
                raise LookupError(f"Task #{issue} isn't one of your open tasks.")
            task_events.watch_task(issue, task["code"], task["title"], base_dir)
            return {"sync": task_events.sync_watchlist(headers(), base_dir, [issue]),
                    "watchlist": task_events.list_watchlist(base_dir)}
        return await run_in_threadpool(_respond, watch)

    def api_unwatch(request: Request):
        denied = guarded(request)
        if denied:
            return denied

        def unwatch():
            if not task_events.unwatch_task(request.path_params["issue"], base_dir):
                raise LookupError("That task isn't being watched.")
            return {"watchlist": task_events.list_watchlist(base_dir)}
        return _respond(unwatch)

    routes = [
        Route("/", index),
        Route("/api/events", api_events),
        Route("/api/events/sync", api_events_sync, methods=["POST"]),
        Route("/api/watchlist", lambda request: _respond(lambda: {"watchlist": task_events.list_watchlist(base_dir)})),
        Route("/api/watchlist", api_watch, methods=["POST"]),
        Route("/api/watchlist/{issue}", api_unwatch, methods=["DELETE"]),
        Route("/api/planner", api_planner),
        Route("/api/changes", api_changes),
        Route("/api/snapshot", api_snapshot, methods=["POST"]),
        Route("/api/statuses", api_statuses),
        Route("/api/task/{issue}", api_task),
        Route("/api/photo/{name}", storage_proxy("users")),
        Route("/api/attachment/{name}", storage_proxy("attachments")),
        Route("/api/release", api_release),
        Route("/api/release", api_release_refresh, methods=["POST"]),
        Route("/api/project/{project}/tasks", api_project_tasks),
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


def parse_active_hours(text: Optional[str]) -> Optional[tuple]:
    """"7-19" -> (7, 19); "all"/"" -> None (always active)."""
    text = (text or "").strip().lower()
    if text in ("", "all", "always"):
        return None
    match = re.fullmatch(r"(\d{1,2})\s*-\s*(\d{1,2})", text)
    if not match or not (0 <= int(match[1]) < int(match[2]) <= 24):
        raise ValueError(f"Active hours must look like 7-19 or 'all', not {text!r}.")
    return int(match[1]), int(match[2])


def is_active(moment: datetime, hours: Optional[tuple]) -> bool:
    return hours is None or (moment.weekday() < 5 and hours[0] <= moment.hour < hours[1])


def run_snapshot_scheduler(
    take: Callable[..., Any],
    stop: threading.Event,
    heartbeat_seconds: float = DEFAULT_HEARTBEAT_MINUTES * 60,
    full_seconds: float = DEFAULT_SNAPSHOT_MINUTES * 60,
    stage_seconds: float = STAGE_REFRESH_MINUTES * 60,
    off_hours_seconds: float = OFF_HOURS_MINUTES * 60,
    active_hours: Optional[tuple] = None,
    clock: Callable[[], float] = time.monotonic,
    now: Callable[[], datetime] = datetime.now,
    jitter: float = JITTER,
) -> None:
    """Calls `take(full=…, stages=…)` at startup and then every heartbeat (hourly
    outside the active hours) until `stop` is set; each call says whether a full
    planner check and stage lookups are due. `take` may return {"full", "stages"}
    for what it actually did (a heartbeat that saw a change upgrades itself).
    A failed attempt (offline, expired token) is logged and the loop carries on.
    Waits are jittered so the calls never land on a fixed beat."""
    last_full = last_stages = None
    while True:
        active = is_active(now(), active_hours)
        t = clock()
        full = not active or last_full is None or t - last_full >= full_seconds
        stages = active and (last_stages is None or t - last_stages >= stage_seconds)
        try:
            done = take(full=full, stages=stages) or {"full": full, "stages": stages}
            if done.get("full"):
                last_full = t
            if done.get("stages"):
                last_stages = t
        except Exception as exc:  # keep the scheduler alive whatever fails
            print(f"Planner check failed: {exc}", flush=True)
        wait = heartbeat_seconds if active else off_hours_seconds
        if stop.wait(wait * (1 + random.uniform(-jitter, jitter))):
            return


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8765, help="Port on 127.0.0.1 (default 8765).")
    parser.add_argument("--user-id", default=None, help="Planner user id; defaults to PANTEON_USER_ID, then the bearer token's `sub`.")
    parser.add_argument("--repo-dir", default=None, help="duell-admin checkout for the Release view; defaults to DUELL_ADMIN_DIR, then ../duell-admin.")
    parser.add_argument("--base-dir", default=None, help="Where database/timeline_task.db (the planner snapshots) lives; defaults to PANTEON_TIMELINE_DIR or the current directory.")
    parser.add_argument("--interval", type=float, default=float(os.getenv("TIMELINE_SNAPSHOT_MINUTES") or DEFAULT_SNAPSHOT_MINUTES),
                        help=f"Most minutes between full planner checks (default {DEFAULT_SNAPSHOT_MINUTES}, or TIMELINE_SNAPSHOT_MINUTES).")
    parser.add_argument("--heartbeat", type=float, default=float(os.getenv("TIMELINE_HEARTBEAT_MINUTES") or DEFAULT_HEARTBEAT_MINUTES),
                        help=f"Minutes between cheap change checks (default {DEFAULT_HEARTBEAT_MINUTES}, or TIMELINE_HEARTBEAT_MINUTES).")
    parser.add_argument("--active-hours", default=os.getenv("TIMELINE_ACTIVE_HOURS") or DEFAULT_ACTIVE_HOURS,
                        help="Weekday hours to poll at the heartbeat, e.g. 7-19, or 'all' (default 7-19, or TIMELINE_ACTIVE_HOURS).")
    args = parser.parse_args(argv)

    import uvicorn

    print(f"Timeline desk: http://{HOSTNAME}:{args.port}  (or http://127.0.0.1:{args.port})", flush=True)
    last_now = {"fingerprint": None}

    planner_cache = PlannerCache()

    def take_snapshot(full: bool, stages: bool) -> Dict[str, bool]:
        headers = panteon_client.build_api_headers()
        user = panteon_client.resolve_user_id(args.user_id)
        known = {}
        if not full:  # heartbeat: one request decides whether the rest is worth making
            known["now"] = panteon_client.get_priority_tasks(headers, "now")
            planner_cache.update("now", known["now"])
            if panteon_client.planner_fingerprint(known["now"], user) != last_now["fingerprint"]:
                full = stages = True
        if full:
            planners = panteon_client.fetch_all_planners(headers, known)
            result = panteon_client.fetch_my_planner_changes(
                headers, user_id=user, base_dir=args.base_dir, save=True, with_stages=stages, planners=planners)
            planner_cache.put(planners)
            last_now["fingerprint"] = panteon_client.planner_fingerprint(planners["now"], user)
            print(f"{result['snapshot']['taken_at']} planner checked: {len(result['snapshot']['tasks'])} tasks"
                  + (" (with stages)" if stages else ""), flush=True)
        try:
            synced = task_events.sync_watchlist(headers, args.base_dir, refresh_meta=full)
            if synced["new_events"] or synced["errors"]:
                print(f"watchlist synced: {synced['tasks']} tasks, {synced['new_events']} new events"
                      + (f", errors: {synced['errors']}" if synced["errors"] else ""), flush=True)
        except Exception as exc:  # the planner check above already succeeded
            print(f"Watchlist sync failed: {exc}", flush=True)
        return {"full": full, "stages": stages}

    stop = threading.Event()
    threading.Thread(target=run_snapshot_scheduler, args=(take_snapshot, stop), daemon=True, kwargs={
        "heartbeat_seconds": max(args.heartbeat, 1) * 60,
        "full_seconds": max(args.interval, args.heartbeat, 1) * 60,
        "active_hours": parse_active_hours(args.active_hours),
    }).start()
    try:
        uvicorn.run(create_app(args.user_id, args.base_dir, args.repo_dir, planner_cache=planner_cache), host="127.0.0.1", port=args.port, log_level="warning")
    finally:
        stop.set()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
