"""Persistent dead-letter storage for the embedding worker."""
import json
import time
import psycopg2
from src.config import DATABASE_URL


def _log(level: str, event: str, **kwargs):
    entry = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "level": level,
        "service": "embedding-worker",
        "component": "dead_letter",
        "event": event,
    }
    entry.update(kwargs)
    print(json.dumps(entry), flush=True)


def persist_dead_letter(
    job_type: str,
    queue_name: str,
    payload: dict,
    error_message: str,
    stack_trace: str,
    attempt_count: int,
) -> None:
    """Write a dead-letter entry to the Postgres dead_letter_jobs table."""
    try:
        conn = psycopg2.connect(DATABASE_URL, connect_timeout=5)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO dead_letter_jobs
                       (job_type, queue_name, payload, error_message, stack_trace, attempt_count, created_at)
                       VALUES (%s, %s, %s, %s, %s, %s, now())""",
                    (
                        job_type,
                        queue_name,
                        json.dumps(payload),
                        error_message,
                        stack_trace,
                        attempt_count,
                    ),
                )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        _log("error", "persist_dead_letter_failed", error=str(e), job_type=job_type)
