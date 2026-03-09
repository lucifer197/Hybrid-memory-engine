import time
import numpy as np
from src.db.postgres import get_connection, fetch_chunks, upsert_embeddings
from src.providers.embedding_provider import get_embeddings
from src.queue.graph_producer import enqueue_graph_job
from src.logger import create_logger
from src.metrics import embedding_latency_ms, embeddings_inserted_total

log = create_logger("embed_memory")


def process_embed_job(job: dict) -> int:
    """Process a single embed job.

    Args:
        job: {
            tenant_id, workspace_id, memory_id,
            chunk_ids: [...], embedding_model,
            trace_id (optional)
        }

    Returns:
        Number of embeddings upserted.
    """
    start_ms = time.monotonic() * 1000
    tenant_id = job["tenant_id"]
    workspace_id = job["workspace_id"]
    memory_id = job["memory_id"]
    chunk_ids = job["chunk_ids"]
    embedding_model = job.get("embedding_model", "unknown")
    trace_id = job.get("trace_id")

    job_log = log.with_context(trace_id=trace_id, memory_id=memory_id)
    job_log.info("job_received", chunk_count=len(chunk_ids),
                 embedding_model=embedding_model)

    if not chunk_ids:
        job_log.warn("no_chunk_ids")
        return 0

    conn = get_connection()
    try:
        # 1. Load chunk texts
        chunks = fetch_chunks(conn, chunk_ids)
        if not chunks:
            job_log.warn("no_chunks_found", chunk_ids=chunk_ids)
            return 0

        # 2. Generate embeddings in batch
        texts = [c["chunk_text"] for c in chunks]
        job_log.info("generating_embeddings", count=len(texts))
        embeddings = get_embeddings(texts)
        job_log.info("embeddings_generated", count=len(embeddings),
                     dim=len(embeddings[0]) if embeddings else 0)

        # 3. Build rows for upsert
        rows = []
        for chunk, embedding in zip(chunks, embeddings):
            rows.append(
                {
                    "chunk_id": chunk["chunk_id"],
                    "tenant_id": tenant_id,
                    "workspace_id": workspace_id,
                    "embedding": np.array(embedding, dtype=np.float32).tolist(),
                }
            )

        # 4. Upsert into chunk_embeddings
        count = upsert_embeddings(conn, rows)
        embeddings_inserted_total.inc(count)
        job_log.info("embeddings_inserted", inserted_count=count,
                     chunk_count=len(chunks), embedding_model=embedding_model)

        # 5. Enqueue graph-building job (Trigger A: after embeddings exist)
        graph_job = {
            "tenant_id": tenant_id,
            "workspace_id": workspace_id,
            "memory_id": memory_id,
            "session_id": job.get("session_id"),
            "user_id": job.get("user_id", ""),
            "tags": job.get("tags", []),
        }
        if trace_id:
            graph_job["trace_id"] = trace_id
        enqueue_graph_job(graph_job, trace_id=trace_id)

        elapsed_ms = time.monotonic() * 1000 - start_ms
        embedding_latency_ms.observe(elapsed_ms)
        return count
    except Exception as e:
        job_log.error("job_failed", error=str(e))
        raise
    finally:
        conn.close()
