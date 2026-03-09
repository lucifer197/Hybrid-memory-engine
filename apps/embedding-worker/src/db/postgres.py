import psycopg2
from psycopg2.extras import execute_values
from pgvector.psycopg2 import register_vector
from src.config import DATABASE_URL, EMBEDDING_MODEL, EMBEDDING_DIM

# DB statement timeout (ms) — prevents writes from hanging indefinitely
DB_STATEMENT_TIMEOUT_MS = int(__import__("os").getenv("DB_STATEMENT_TIMEOUT_MS", "15000"))


def get_connection():
    conn = psycopg2.connect(DATABASE_URL, options=f"-c statement_timeout={DB_STATEMENT_TIMEOUT_MS}")
    register_vector(conn)
    return conn


def fetch_chunks(conn, chunk_ids: list[str]) -> list[dict]:
    """Load chunk texts by IDs."""
    # Cast to text[] for UUID comparison
    with conn.cursor() as cur:
        cur.execute(
            "SELECT chunk_id::text, chunk_text FROM memory_chunks WHERE chunk_id = ANY(%s::uuid[]) ORDER BY chunk_index",
            (chunk_ids,),
        )
        rows = cur.fetchall()
        print(f"  [db] Fetched {len(rows)} chunks from DB for {len(chunk_ids)} requested IDs")
        return [{"chunk_id": row[0], "chunk_text": row[1]} for row in rows]


def upsert_embeddings(
    conn,
    rows: list[dict],
) -> int:
    """Bulk upsert embeddings into chunk_embeddings using execute_values.

    Each row: { chunk_id, tenant_id, workspace_id, embedding }
    Returns number of rows upserted.
    """
    if not rows:
        return 0

    values = []
    for r in rows:
        vec_str = "[" + ",".join(str(v) for v in r["embedding"]) + "]"
        values.append((
            r["chunk_id"],
            r["tenant_id"],
            r["workspace_id"],
            EMBEDDING_MODEL,
            EMBEDDING_DIM,
            vec_str,
        ))

    with conn.cursor() as cur:
        execute_values(
            cur,
            """INSERT INTO chunk_embeddings
                 (chunk_id, tenant_id, workspace_id, embedding_model, embedding_dim, embedding)
               VALUES %s
               ON CONFLICT (chunk_id) DO UPDATE
                 SET embedding = EXCLUDED.embedding,
                     embedding_model = EXCLUDED.embedding_model,
                     embedding_dim = EXCLUDED.embedding_dim""",
            values,
        )
    conn.commit()
    print(f"  [db] Committed {len(rows)} embedding rows to chunk_embeddings")
    return len(rows)
