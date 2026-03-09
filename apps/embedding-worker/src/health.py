"""Minimal health HTTP server for the embedding worker.

Runs in a background thread so the main BRPOP consumer loop is not blocked.
Exposes /health (liveness), /livez (liveness), and /readyz (readiness).
"""
import json
import time
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

import redis
import psycopg2

from src.config import DATABASE_URL, REDIS_URL
from src.metrics import registry

SERVICE_NAME = "embedding-worker"
VERSION = "0.1.0"
HEALTH_PORT = int(__import__("os").environ.get("HEALTH_PORT", "3007"))


def _check_postgres() -> dict:
    start = time.monotonic()
    try:
        conn = psycopg2.connect(DATABASE_URL, connect_timeout=3)
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        finally:
            conn.close()
        return {"status": "ok", "latency_ms": round((time.monotonic() - start) * 1000)}
    except Exception as e:
        return {
            "status": "unavailable",
            "latency_ms": round((time.monotonic() - start) * 1000),
            "error": str(e),
        }


def _check_redis() -> dict:
    start = time.monotonic()
    try:
        client = redis.from_url(REDIS_URL, socket_connect_timeout=3)
        client.ping()
        client.close()
        return {"status": "ok", "latency_ms": round((time.monotonic() - start) * 1000)}
    except Exception as e:
        return {
            "status": "unavailable",
            "latency_ms": round((time.monotonic() - start) * 1000),
            "error": str(e),
        }


def _liveness_response() -> dict:
    return {
        "service": SERVICE_NAME,
        "status": "ok",
        "version": VERSION,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }


def _readiness_response() -> tuple[dict, int]:
    pg = _check_postgres()
    rd = _check_redis()
    deps = {"postgres": pg, "redis": rd}
    all_ok = all(d["status"] == "ok" for d in deps.values())
    body = {
        "service": SERVICE_NAME,
        "status": "ok" if all_ok else "degraded",
        "version": VERSION,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "dependencies": deps,
    }
    return body, 200 if all_ok else 503


class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path in ("/health", "/livez"):
            body = _liveness_response()
            self._respond(200, body)
        elif self.path == "/readyz":
            body, status = _readiness_response()
            self._respond(status, body)
        elif self.path == "/metrics":
            self._respond(200, registry.to_json())
        else:
            self._respond(404, {"error": "not found"})

    def _respond(self, status: int, body: dict):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):  # noqa: A002
        # Suppress default stderr logging
        pass


def start_health_server():
    """Start the health HTTP server in a daemon thread."""
    server = HTTPServer(("0.0.0.0", HEALTH_PORT), _HealthHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return HEALTH_PORT
