import json
import time
import traceback
import redis
from src.config import REDIS_URL, QUEUE_KEY, DLQ_KEY, JOB_MAX_ATTEMPTS
from src.jobs.embed_memory import process_embed_job
from src.retry_policy import stamp_retry_meta, retry_or_dlq, compute_backoff_sec
from src.dead_letter import persist_dead_letter
from src.logger import create_logger
from src.metrics import (
    embedding_jobs_total,
    embedding_job_failures_total,
    job_retry_total,
    job_dlq_total,
    job_poison_total,
    queue_depth,
    dlq_depth,
)

log = create_logger("consumer")


def create_redis_client():
    client = redis.from_url(REDIS_URL, decode_responses=True)
    # Verify connection
    client.ping()
    log.info("redis_connected", url=REDIS_URL)
    return client


def consume_loop():
    """Blocking loop — pulls jobs from Redis list and processes them."""
    client = create_redis_client()
    log.info("listening", queue=QUEUE_KEY, dlq=DLQ_KEY,
             max_attempts=JOB_MAX_ATTEMPTS)

    while True:
        # Sample queue depths
        queue_depth.set(client.llen(QUEUE_KEY))
        dlq_depth.set(client.llen(DLQ_KEY))

        # BRPOP blocks until a job is available (timeout 5s)
        result = client.brpop(QUEUE_KEY, timeout=5)
        if result is None:
            continue

        _key, raw = result

        # ── Parse job ────────────────────────────────────
        try:
            job = json.loads(raw)
        except json.JSONDecodeError as e:
            # Poison message — unparseable JSON → DLQ immediately
            log.error("invalid_json", error=str(e))
            job_poison_total.inc()
            try:
                client.lpush(DLQ_KEY, raw)
            except Exception as dlq_err:
                log.error("dlq_push_failed", error=str(dlq_err))
            continue

        trace_id = job.get("trace_id")
        memory_id = job.get("memory_id")
        job_log = log.with_context(trace_id=trace_id, memory_id=memory_id)
        embedding_jobs_total.inc()

        # ── Process job ──────────────────────────────────
        try:
            job_log.info("job_received",
                         chunk_count=len(job.get("chunk_ids", [])))
            count = process_embed_job(job)
            job_log.info("job_complete", embeddings_created=count)
        except Exception as e:
            embedding_job_failures_total.inc()
            job_log.error("job_failed",
                          error=str(e),
                          stack=traceback.format_exc())

            # Stamp retry metadata (includes stack trace)
            stamp_retry_meta(job, e)
            decision = retry_or_dlq(job, JOB_MAX_ATTEMPTS)

            if decision == "retry":
                attempt = job.get("_attempt_count", 1)
                delay_sec = compute_backoff_sec(attempt - 1)
                job_retry_total.inc()
                job_log.warn("job_retry",
                             attempt=attempt,
                             backoff_sec=round(delay_sec, 2))
                time.sleep(delay_sec)
                try:
                    client.lpush(QUEUE_KEY, json.dumps(job))
                except Exception as push_err:
                    job_log.error("retry_push_failed", error=str(push_err))
            else:
                attempt = job.get("_attempt_count", 0)
                stack = job.get("_last_stack", traceback.format_exc())
                job_dlq_total.inc()
                job_log.error("job_sent_to_dlq",
                              attempt=attempt,
                              error_message=str(e))
                # Push structured entry to Redis DLQ
                dlq_entry = {
                    "job_type": "embedding",
                    "queue_name": QUEUE_KEY,
                    "payload": job,
                    "error_message": str(e),
                    "stack_trace": stack,
                    "attempt_count": attempt,
                    "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                }
                try:
                    client.lpush(DLQ_KEY, json.dumps(dlq_entry))
                except Exception as dlq_err:
                    job_log.error("dlq_push_failed", error=str(dlq_err))
                # Persist to DB
                persist_dead_letter(
                    job_type="embedding",
                    queue_name=QUEUE_KEY,
                    payload=job,
                    error_message=str(e),
                    stack_trace=stack,
                    attempt_count=attempt,
                )
