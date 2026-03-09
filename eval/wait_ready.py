"""Wait for the async pipeline (embeddings + graph) to complete after seeding.

After writing memories via the WriteTurn API, the embedding-worker and
graph-worker process jobs asynchronously via Redis queues.  This module
polls the retrieval endpoint until a canary phrase appears in results,
indicating the full pipeline has flushed.
"""

from __future__ import annotations

import time

from eval.client import retrieve


def wait_for_pipeline(
    canary_phrase: str,
    max_wait_sec: int = 120,
    poll_interval_sec: float = 2.0,
) -> bool:
    """Poll retrieval until *canary_phrase* appears in returned content.

    Args:
        canary_phrase: A distinctive substring from the last seeded memory.
        max_wait_sec: Maximum seconds to wait before giving up.
        poll_interval_sec: Seconds between poll attempts.

    Returns:
        True if the pipeline became ready, False on timeout.
    """
    start = time.time()
    attempt = 0

    while time.time() - start < max_wait_sec:
        attempt += 1
        try:
            result = retrieve(query=canary_phrase, k=5, debug=False)
            memories = result.get("memories", [])
            for mem in memories:
                content = mem.get("content", "")
                if canary_phrase.lower() in content.lower():
                    elapsed = time.time() - start
                    print(f"  Pipeline ready after {elapsed:.1f}s ({attempt} polls)")
                    return True
        except Exception:
            pass  # Service may not be fully up yet

        time.sleep(poll_interval_sec)

    elapsed = time.time() - start
    print(f"  WARNING: Pipeline did not become ready within {elapsed:.0f}s ({attempt} polls)")
    return False
