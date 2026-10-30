"""Timeline's Socket.IO v2 listener. No network: a throwaway local WebSocket server plays Timeline."""
import json
import threading
import time

import pytest
from websockets.sync.server import serve

import dashboard
import timeline_socket as ts

TOKEN = "header.payload.signature"


def test_socket_url_quotes_the_token_like_the_browser():
    url = ts.socket_url("Bearer " + TOKEN, "https://timeline.panteon.no")
    assert url == f"wss://timeline.panteon.no/socket.io/?token=%22{TOKEN}%22&EIO=3&transport=websocket"
    assert ts.socket_url(TOKEN, "http://localhost:9").startswith("ws://localhost:9/")


def test_parse_packets():
    assert ts.parse_packet('0{"sid":"a","pingInterval":25000,"pingTimeout":5000}') == {
        "type": "open", "ping_interval": 25.0, "ping_timeout": 5.0}
    assert ts.parse_packet("2")["type"] == "ping" and ts.parse_packet("3")["type"] == "pong"
    assert ts.parse_packet("40")["type"] == "connect" and ts.parse_packet("41")["type"] == "disconnect"
    assert ts.parse_packet('42["task.updated",{"id":5}]') == {"type": "event", "event": "task.updated", "args": [{"id": 5}]}
    assert ts.parse_packet('42/chat,7["msg","hi"]')["event"] == "msg"  # namespace and ack id
    assert ts.parse_packet('44"Authentication error"')["type"] == "error"
    assert ts.parse_packet("451-[\"bin\"]")["type"] == "other" and ts.parse_packet("")["type"] == "other"
    assert ts.parse_packet('42{"not":"a list"}')["type"] == "other"


def test_event_filter():
    assert ts.parse_event_filter(None) is None and ts.parse_event_filter("*") is None
    assert ts.parse_event_filter("a, b") == {"a", "b"}


def test_shape_hides_values():
    shaped = ts._shape({"id": 5, "title": "secret", "items": [{"x": 1}, {"x": 2}]})
    assert shaped == {"id": "int", "title": "str", "items": [{"x": "int"}, "… 2 items"]}


def test_log_event_writes_shape_not_payload(tmp_path, monkeypatch):
    monkeypatch.setenv("PANTEON_REQUEST_LOG_DIR", str(tmp_path))
    ts.log_event("task.updated", [{"title": "customer data"}])
    line = next(tmp_path.glob("timeline-socket-*.jsonl")).read_text()
    assert "customer data" not in line and json.loads(line)["payload"] == [{"title": "str"}]
    ts.log_event("task.updated", [{"title": "customer data"}], full=True)
    assert "customer data" in next(tmp_path.glob("timeline-socket-*.jsonl")).read_text()


def test_enabled_by_default_and_switchable():
    assert ts.socket_enabled({}) and ts.socket_enabled({"TIMELINE_SOCKET": "1"})
    assert not ts.socket_enabled({"TIMELINE_SOCKET": "0"}) and not ts.socket_enabled({"TIMELINE_SOCKET": "Off"})


def local_server(handler):
    server = serve(handler, "127.0.0.1", 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"ws://127.0.0.1:{server.socket.getsockname()[1]}/socket.io/?token=x&EIO=3&transport=websocket"


def test_listen_once_replies_to_pings_and_reports_events():
    got, received = [], []

    def handler(ws):
        ws.send('0{"sid":"s","pingInterval":25000,"pingTimeout":5000}')
        ws.send("40")
        ws.send("2")
        ws.send('42["comment.created",{"task":5461}]')
        ws.send('45-["binary"]')
        ws.send(b"\x00")
        try:
            received.append(ws.recv(timeout=2))
        except TimeoutError:
            pass
        ws.send("41")

    server, url = local_server(handler)
    try:
        ts.listen_once(url, lambda name, args: got.append((name, args)), threading.Event())
    finally:
        server.shutdown()
    assert got == [("comment.created", [{"task": 5461}])]
    assert received == ["3"]  # the server's ping was answered
    assert ts.STATUS["state"] == "connected"


def test_listener_wakes_the_scheduler_and_filters_events(tmp_path, monkeypatch):
    monkeypatch.setenv("PANTEON_REQUEST_LOG_DIR", str(tmp_path))

    def handler(ws):
        ws.send('0{"sid":"s","pingInterval":25000,"pingTimeout":5000}')
        ws.send('42["typing",{}]')
        time.sleep(0.3)
        assert not wake.is_set()  # ignored by the filter
        ws.send('42["comment.created",{}]')
        time.sleep(0.3)

    wake, stop = threading.Event(), threading.Event()
    server, url = local_server(handler)
    monkeypatch.setattr(ts, "socket_url", lambda token: url)
    thread = threading.Thread(target=ts.run_socket_listener, args=(wake, stop), daemon=True, kwargs={
        "token_fn": lambda: TOKEN, "events": {"comment.created"}})
    thread.start()
    try:
        assert wake.wait(5)
        assert ts.STATUS["last_event"] == "comment.created" and ts.STATUS["events"] >= 2
    finally:
        stop.set()
        thread.join(5)
        server.shutdown()


def test_rejected_token_stops_the_listener_without_retrying(monkeypatch):
    attempts = []

    class Rejected(Exception):
        response = type("R", (), {"status_code": 401})()

    def connect(*a, **kw):
        attempts.append(1)
        raise Rejected(f"server rejected {TOKEN}")

    ts.run_socket_listener(threading.Event(), threading.Event(), token_fn=lambda: TOKEN, connect=connect,
                           sleep=lambda s: pytest.fail("must not retry"))
    assert len(attempts) == 1 and ts.STATUS["state"] == "stopped" and TOKEN not in ts.STATUS["error"]


def test_connection_errors_back_off_and_hide_the_token(monkeypatch, capsys):
    pauses = []
    stop = threading.Event()

    def sleep(seconds):
        pauses.append(seconds)
        if len(pauses) == 4:
            stop.set()
        return stop.is_set()

    def connect(*a, **kw):
        raise OSError(f"unreachable {TOKEN}")

    ts.run_socket_listener(threading.Event(), stop, token_fn=lambda: TOKEN, connect=connect, sleep=sleep)
    assert pauses == [5, 10, 20, 40]
    assert TOKEN not in capsys.readouterr().out and TOKEN not in (ts.STATUS["error"] or "")


def test_no_token_means_no_listener():
    ts.run_socket_listener(threading.Event(), threading.Event(), token_fn=lambda: "")
    assert ts.STATUS["state"] == "off" and not ts.STATUS["enabled"]


class TestSchedulerWake:
    def test_an_event_ends_the_wait_early(self):
        stop, wake, calls = threading.Event(), threading.Event(), []
        wake.set()

        def take(full, stages):
            calls.append(time.monotonic())
            if len(calls) == 2:
                stop.set()

        from datetime import datetime
        weekday = datetime(2026, 10, 28, 10, 0)
        dashboard.run_snapshot_scheduler(take, stop, heartbeat_seconds=60, full_seconds=600, jitter=0,
                                         now=lambda: weekday, wake=wake, wake_gap_seconds=0, wake_debounce_seconds=0)
        assert len(calls) == 2 and calls[1] - calls[0] < 5  # not 60 s later

    def test_events_outside_active_hours_are_ignored(self):
        from datetime import datetime
        stop, wake, calls = threading.Event(), threading.Event(), []
        wake.set()
        night = datetime(2026, 10, 28, 3, 0)
        threading.Timer(0.5, stop.set).start()
        dashboard.run_snapshot_scheduler(lambda full, stages: calls.append(1), stop, off_hours_seconds=60, jitter=0,
                                         active_hours=(7, 19), now=lambda: night, wake=wake)
        assert len(calls) == 1  # only the startup check
