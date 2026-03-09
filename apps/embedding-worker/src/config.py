import os
from dotenv import load_dotenv

load_dotenv()

# psycopg2 requires 'postgresql://' scheme, not 'postgres://'
_raw_db_url = os.getenv(
    "DATABASE_URL",
    "postgres://hybrid:hybrid@localhost:5432/hybrid_memory",
)
DATABASE_URL = _raw_db_url.replace("postgres://", "postgresql://", 1)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "1536"))
MOCK_EMBEDDINGS = os.getenv("MOCK_EMBEDDINGS", "false").lower() == "true"
QUEUE_KEY = "embed:jobs"
GRAPH_QUEUE_KEY = "graph:jobs"
DLQ_KEY = "embed:dlq"

# Reliability
JOB_MAX_ATTEMPTS = int(os.getenv("JOB_MAX_ATTEMPTS", "3"))
OPENAI_TIMEOUT_SEC = int(os.getenv("OPENAI_TIMEOUT_SEC", "30"))
CB_EMBED_FAILURE_THRESHOLD = int(os.getenv("CB_EMBED_FAILURE_THRESHOLD", "5"))
CB_EMBED_RESET_SEC = float(os.getenv("CB_EMBED_RESET_SEC", "30"))
