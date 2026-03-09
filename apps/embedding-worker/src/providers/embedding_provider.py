import numpy as np
from openai import OpenAI
from src.config import (
    OPENAI_API_KEY,
    EMBEDDING_MODEL,
    EMBEDDING_DIM,
    MOCK_EMBEDDINGS,
    OPENAI_TIMEOUT_SEC,
    CB_EMBED_FAILURE_THRESHOLD,
    CB_EMBED_RESET_SEC,
)
from src.circuit_breaker import CircuitBreaker

_client = OpenAI(api_key=OPENAI_API_KEY, timeout=OPENAI_TIMEOUT_SEC)

_breaker = CircuitBreaker(
    name="openai_embeddings",
    failure_threshold=CB_EMBED_FAILURE_THRESHOLD,
    reset_timeout_sec=CB_EMBED_RESET_SEC,
)


def get_embeddings(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for a batch of texts."""
    if MOCK_EMBEDDINGS:
        return _mock_embeddings(texts)

    def _call() -> list[list[float]]:
        response = _client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=texts,
        )
        return [item.embedding for item in response.data]

    return _breaker.execute(_call)


def get_single_embedding(text: str) -> list[float]:
    """Generate embedding for a single text."""
    return get_embeddings([text])[0]


def _mock_embeddings(texts: list[str]) -> list[list[float]]:
    """Deterministic mock embeddings for testing (seeded by text hash)."""
    results = []
    for text in texts:
        seed = hash(text) % (2**31)
        rng = np.random.RandomState(seed)
        vec = rng.randn(EMBEDDING_DIM).astype(np.float32)
        vec = vec / np.linalg.norm(vec)  # normalize to unit vector
        results.append(vec.tolist())
    return results
