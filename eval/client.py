"""HTTP client for the hybrid-memory API.

Wraps the WriteTurn and RetrieveContext endpoints with the
correct payload shapes. Config is driven by environment variables
so the eval can target any running instance.
"""

from __future__ import annotations

import os

import requests

API_URL = os.getenv("EVAL_API_URL", "http://localhost:3000")
TENANT_ID = os.getenv("EVAL_TENANT_ID", "eval-tenant")
WORKSPACE_ID = os.getenv("EVAL_WORKSPACE_ID", "eval-workspace")
USER_ID = os.getenv("EVAL_USER_ID", "eval-user")
TIMEOUT = int(os.getenv("EVAL_HTTP_TIMEOUT", "30"))


def write_turn(
    messages: list[dict],
    turn_id: str,
    session_id: str,
    memory_hints: list[str] | None = None,
    metadata: dict | None = None,
) -> dict:
    """Write a conversation turn via POST /v1/memory/turn.

    Returns the WriteTurnResponse dict:
      { turn_id, memory_ids, created_at }
    """
    payload: dict = {
        "tenant_id": TENANT_ID,
        "workspace_id": WORKSPACE_ID,
        "user_id": USER_ID,
        "session_id": session_id,
        "turn_id": turn_id,
        "messages": messages,
    }
    if memory_hints:
        payload["memory_hints"] = memory_hints
    if metadata:
        payload["metadata"] = metadata

    resp = requests.post(
        f"{API_URL}/v1/memory/turn",
        json=payload,
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def retrieve(
    query: str,
    k: int = 8,
    filters: dict | None = None,
    debug: bool = True,
    session_id: str | None = None,
) -> dict:
    """Retrieve memories via POST /v1/memory/retrieve.

    Returns the RetrieveContextResponse dict:
      { context_blocks, memories, debug_info? }
    """
    payload: dict = {
        "tenant_id": TENANT_ID,
        "workspace_id": WORKSPACE_ID,
        "user_id": USER_ID,
        "query": query,
        "k": k,
        "debug": debug,
    }
    if filters:
        payload["filters"] = filters
    if session_id:
        payload["session_id"] = session_id

    resp = requests.post(
        f"{API_URL}/v1/memory/retrieve",
        json=payload,
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()
