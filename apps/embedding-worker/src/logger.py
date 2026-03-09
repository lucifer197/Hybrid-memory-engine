"""Structured JSON logger for the embedding worker.

Mirrors the TypeScript @hybrid-memory/observability logger contract:
  { timestamp, level, service, component, event, trace_id?, tenant_id?, ... }

Usage:
    from src.logger import create_logger

    log = create_logger("consumer")
    log.info("job_received", memory_id="abc-123", chunk_count=5)

    # Bind persistent context fields
    job_log = log.with_context(memory_id="abc-123", trace_id="t-1")
    job_log.info("processing")
"""

import json
import sys
import time
from typing import Any

SERVICE = "embedding-worker"


class Logger:
    def __init__(self, component: str = "main", context: dict[str, Any] | None = None):
        self._component = component
        self._context: dict[str, Any] = context or {}

    def _emit(self, level: str, event: str, **kwargs: Any) -> None:
        entry: dict[str, Any] = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "level": level,
            "service": SERVICE,
            "component": self._component,
            "event": event,
        }
        # Merge bound context, then call-site kwargs (call-site wins)
        entry.update(self._context)
        entry.update({k: v for k, v in kwargs.items() if v is not None})

        line = json.dumps(entry)
        if level == "error":
            sys.stderr.write(line + "\n")
            sys.stderr.flush()
        else:
            sys.stdout.write(line + "\n")
            sys.stdout.flush()

    def debug(self, event: str, **kwargs: Any) -> None:
        self._emit("debug", event, **kwargs)

    def info(self, event: str, **kwargs: Any) -> None:
        self._emit("info", event, **kwargs)

    def warn(self, event: str, **kwargs: Any) -> None:
        self._emit("warn", event, **kwargs)

    def error(self, event: str, **kwargs: Any) -> None:
        self._emit("error", event, **kwargs)

    def child(self, component: str) -> "Logger":
        return Logger(component, dict(self._context))

    def with_context(self, **ctx: Any) -> "Logger":
        merged = {**self._context, **{k: v for k, v in ctx.items() if v is not None}}
        return Logger(self._component, merged)


def create_logger(component: str = "main") -> Logger:
    return Logger(component)
