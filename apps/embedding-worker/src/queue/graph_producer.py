import json
import time
import redis
from src.config import REDIS_URL, GRAPH_QUEUE_KEY


_client = None


def _log(level: str, event: str, trace_id: str | None = None, **kwargs):
    """Structured JSON log line to stdout."""
    entry = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "level": level,
        "service": "embedding-worker",
        "component": "graph_producer",
        "event": event,
    }
    if trace_id:
        entry["trace_id"] = trace_id
    entry.update(kwargs)
    print(json.dumps(entry), flush=True)


def _get_redis():
    global _client
    if _client is None:
        _client = redis.from_url(REDIS_URL, decode_responses=True)
        _client.ping()
        _log("info", "redis_connected", url=REDIS_URL)
    return _client


def enqueue_graph_job(job: dict, *, trace_id: str | None = None) -> None:
    """Enqueue a graph-building job. Fire-and-forget — embedding
    must succeed even if this fails."""
    try:
        client = _get_redis()
        client.lpush(GRAPH_QUEUE_KEY, json.dumps(job))
        _log("info", "graph_job_enqueued", trace_id,
             memory_id=job.get("memory_id"), queue=GRAPH_QUEUE_KEY)
    except Exception as e:
        # Log but never fail the embedding path
        _log("warn", "enqueue_failed", trace_id,
             memory_id=job.get("memory_id"), error=str(e))
