"""Retry policy with exponential backoff for the embedding worker."""
import math
import random
import time
import traceback

from src.config import JOB_MAX_ATTEMPTS

# Default retry config
MAX_ATTEMPTS = JOB_MAX_ATTEMPTS
BASE_DELAY_SEC = 1.0
MAX_DELAY_SEC = 30.0


def compute_backoff_sec(attempt: int) -> float:
    """Calculate exponential backoff with full jitter."""
    exp_delay = min(MAX_DELAY_SEC, BASE_DELAY_SEC * math.pow(2, attempt))
    return random.random() * exp_delay


def stamp_retry_meta(job: dict, error: Exception) -> None:
    """Stamp retry metadata including stack trace onto job dict."""
    job["_attempt_count"] = job.get("_attempt_count", 0) + 1
    job["_last_failed_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    job["_last_error"] = str(error)
    job["_last_stack"] = traceback.format_exc()


def retry_or_dlq(job: dict, max_attempts: int = MAX_ATTEMPTS) -> str:
    """Return 'retry' or 'dlq' based on attempt count."""
    return "retry" if job.get("_attempt_count", 0) < max_attempts else "dlq"
