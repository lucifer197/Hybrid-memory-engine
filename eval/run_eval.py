"""Retrieval quality evaluation runner.

Usage:
    # Full run (seed + query + report):
    python -m eval.run_eval

    # Skip seeding (data already in DB from a prior run):
    python -m eval.run_eval --skip-seed

    # Custom dataset / output:
    python -m eval.run_eval --dataset eval/datasets/golden_memories.jsonl \\
                            --output-dir eval/results \\
                            --wait-timeout 120

Requires a running hybrid-memory stack (api-gateway, memory-service,
retrieval-orchestrator, embedding-worker, graph-worker, Postgres, Redis).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from eval import client
from eval.metrics import QueryResult, compute_metrics
from eval.report_writer import write_report
from eval.wait_ready import wait_for_pipeline

# ── Types ────────────────────────────────────────────────────────

SeedRecord = dict
QueryRecord = dict


# ── Helpers ──────────────────────────────────────────────────────


def build_transcript(messages: list[dict]) -> str:
    """Replicate the transcript format used by writeTurnService.ts:

        [role]: content\\n\\n[role]: content
    """
    return "\n\n".join(f"[{m['role']}]: {m['content']}" for m in messages)


def load_dataset(path: str) -> tuple[list[SeedRecord], list[QueryRecord]]:
    """Load a JSONL golden-test file into seed and query records."""
    seeds: list[SeedRecord] = []
    queries: list[QueryRecord] = []

    with open(path, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                print(f"  WARNING: Skipping malformed JSON at line {line_num}: {exc}")
                continue

            rtype = record.get("type")
            if rtype == "seed":
                seeds.append(record)
            elif rtype == "query":
                queries.append(record)
            else:
                print(f"  WARNING: Unknown record type '{rtype}' at line {line_num}")

    return seeds, queries


# ── Seed phase ───────────────────────────────────────────────────


def run_seed_phase(
    seeds: list[SeedRecord],
) -> dict[str, dict]:
    """Write all seed memories via the WriteTurn API.

    Returns a mapping: seed_id -> { response, created_at, session_id }.
    """
    print(f"\n=== Seed Phase ({len(seeds)} memories) ===\n")
    seed_results: dict[str, dict] = {}

    for seed in seeds:
        seed_id = seed["seed_id"]
        try:
            resp = client.write_turn(
                messages=seed["messages"],
                turn_id=seed["turn_id"],
                session_id=seed["session_id"],
                memory_hints=seed.get("memory_hints"),
                metadata=seed.get("metadata"),
            )
            seed_results[seed_id] = {
                "response": resp,
                "created_at": resp.get("created_at", ""),
                "session_id": seed["session_id"],
            }
            mem_ids = resp.get("memory_ids", [])
            print(f"  [{seed_id}] turn={seed['turn_id']} -> {len(mem_ids)} memory(ies)")
        except Exception as exc:
            print(f"  [{seed_id}] FAILED: {exc}")
            seed_results[seed_id] = {"response": None, "created_at": "", "session_id": seed["session_id"]}

    return seed_results


# ── Timestamp replacement ────────────────────────────────────────


def resolve_temporal_placeholders(
    queries: list[QueryRecord],
    seed_results: dict[str, dict],
    seeds: list[SeedRecord],
) -> list[QueryRecord]:
    """Replace temporal placeholder tokens with real timestamps.

    Placeholder format:
        __TIMESTAMP_AFTER_SESSION_X__  -> created_at of last seed in session X
        __TIMESTAMP_BEFORE_SESSION_X__ -> created_at of first seed in session X
    """
    # Build session -> sorted created_at list
    session_timestamps: dict[str, list[str]] = {}
    for seed in seeds:
        sid = seed["seed_id"]
        sr = seed_results.get(sid, {})
        ts = sr.get("created_at", "")
        session = seed["session_id"]
        if ts:
            session_timestamps.setdefault(session, []).append(ts)

    for sess in session_timestamps:
        session_timestamps[sess].sort()

    resolved: list[QueryRecord] = []
    for q in queries:
        q = dict(q)  # shallow copy
        filters = q.get("filters", {})
        if not filters:
            resolved.append(q)
            continue

        filters = dict(filters)

        for key in ("after", "before"):
            val = filters.get(key, "")
            if not isinstance(val, str) or not val.startswith("__TIMESTAMP_"):
                continue

            # Parse: __TIMESTAMP_AFTER_SESSION_4__ or __TIMESTAMP_BEFORE_SESSION_2__
            parts = val.strip("_").split("_")
            # ['TIMESTAMP', 'AFTER'|'BEFORE', 'SESSION', 'N']
            if len(parts) < 4:
                continue
            direction = parts[1].lower()  # "after" or "before"
            session_key = f"eval-s{parts[3]}"
            ts_list = session_timestamps.get(session_key, [])

            if direction == "after" and ts_list:
                # Use the last timestamp of that session
                filters[key] = ts_list[-1]
            elif direction == "before" and ts_list:
                # Use the first timestamp of that session
                filters[key] = ts_list[0]
            else:
                # No timestamps found — remove the filter
                del filters[key]

        q["filters"] = filters
        resolved.append(q)

    return resolved


# ── Query phase ──────────────────────────────────────────────────


def run_query_phase(
    queries: list[QueryRecord],
    seed_id_to_content: dict[str, str],
) -> list[QueryResult]:
    """Run all queries and build QueryResult objects."""
    print(f"\n=== Query Phase ({len(queries)} queries) ===\n")
    results: list[QueryResult] = []

    for q in queries:
        qid = q["query_id"]
        try:
            resp = client.retrieve(
                query=q["query"],
                k=q.get("k", 8),
                filters=q.get("filters") or None,
                debug=True,
            )

            memories = resp.get("memories", [])
            debug_infos = resp.get("debug_info", [])
            facts = resp.get("facts", [])

            returned_contents = [m.get("content", "") for m in memories]

            result = QueryResult(
                query_id=qid,
                category=q.get("category", "unknown"),
                k=q.get("k", 8),
                returned_contents=returned_contents,
                debug_infos=debug_infos,
                expected_phrases=q.get("expected_phrases", []),
                expected_absent_phrases=q.get("expected_absent_phrases", []),
                expected_seed_ids=q.get("expected_seed_ids", []),
                negative_seed_ids=q.get("negative_seed_ids", []),
                seed_id_to_content=seed_id_to_content,
                returned_facts=facts,
                expect_fact_first=q.get("fact_first", False),
                superseded_seed_ids=q.get("superseded_seed_ids", []),
            )
            results.append(result)

            relevant = sum(
                1
                for c in returned_contents
                if any(
                    p.lower() in c.lower()
                    for p in q.get("expected_phrases", [])
                )
            )
            fact_str = f", {len(facts)} facts" if facts else ""
            print(
                f"  [{qid}] {q['category']}: "
                f"{len(memories)} returned, {relevant} relevant{fact_str}"
            )

        except Exception as exc:
            print(f"  [{qid}] FAILED: {exc}")
            results.append(
                QueryResult(
                    query_id=qid,
                    category=q.get("category", "unknown"),
                    k=q.get("k", 8),
                    returned_contents=[],
                    debug_infos=[],
                    expected_phrases=q.get("expected_phrases", []),
                    expected_absent_phrases=q.get("expected_absent_phrases", []),
                    expected_seed_ids=q.get("expected_seed_ids", []),
                    negative_seed_ids=q.get("negative_seed_ids", []),
                    seed_id_to_content=seed_id_to_content,
                )
            )

    return results


# ── Main ─────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run retrieval quality evaluation against the hybrid-memory API."
    )
    parser.add_argument(
        "--dataset",
        default="eval/datasets/golden_memories.jsonl",
        help="Path to the golden JSONL dataset.",
    )
    parser.add_argument(
        "--output-dir",
        default="eval/results",
        help="Directory for report.md and raw_results.json.",
    )
    parser.add_argument(
        "--api-url",
        default=None,
        help="Override EVAL_API_URL env var.",
    )
    parser.add_argument(
        "--wait-timeout",
        type=int,
        default=120,
        help="Max seconds to wait for pipeline after seeding.",
    )
    parser.add_argument(
        "--skip-seed",
        action="store_true",
        help="Skip seeding (assume data already exists in DB).",
    )
    args = parser.parse_args()

    if args.api_url:
        client.API_URL = args.api_url

    # ── 1. Load dataset ───────────────────────────────────────
    print(f"Loading dataset: {args.dataset}")
    seeds, queries = load_dataset(args.dataset)
    print(f"  {len(seeds)} seeds, {len(queries)} queries")

    if not seeds or not queries:
        print("ERROR: Dataset must contain at least one seed and one query.")
        sys.exit(1)

    # Build seed_id -> transcript content map
    seed_id_to_content: dict[str, str] = {}
    for seed in seeds:
        seed_id_to_content[seed["seed_id"]] = build_transcript(seed["messages"])

    # ── 2. Seed phase ─────────────────────────────────────────
    pipeline_wait_sec = 0.0

    if args.skip_seed:
        print("\n=== Skipping seed phase (--skip-seed) ===")
        seed_results: dict[str, dict] = {}
    else:
        seed_results = run_seed_phase(seeds)

        # ── 3. Wait for async pipeline ────────────────────────
        print("\n=== Waiting for pipeline to process embeddings + graph ===\n")
        # Use last seed's content as canary
        last_seed = seeds[-1]
        canary = last_seed["messages"][0]["content"]
        wait_start = time.time()
        ready = wait_for_pipeline(
            canary_phrase=canary,
            max_wait_sec=args.wait_timeout,
        )
        pipeline_wait_sec = time.time() - wait_start

        if not ready:
            print(
                "WARNING: Pipeline may not be fully ready. "
                "Results might be incomplete."
            )

    # ── 4. Resolve temporal placeholders ──────────────────────
    queries = resolve_temporal_placeholders(queries, seed_results, seeds)

    # ── 5. Query phase ────────────────────────────────────────
    query_results = run_query_phase(queries, seed_id_to_content)

    # ── 6. Compute metrics ────────────────────────────────────
    print("\n=== Computing metrics ===\n")
    report = compute_metrics(query_results)

    print(f"  Recall@K:              {report.recall_at_k:.4f}")
    print(f"  Precision@K:           {report.precision_at_k:.4f}")
    print(f"  MRR:                   {report.mrr:.4f}")
    print(f"  Coverage:              {report.coverage:.4f}")
    print(f"  Graph util:            {report.graph_expansion_utility:.4f}")
    print(f"  Fact-first rate:       {report.fact_first_rate:.4f}")
    print(f"  Superseded downrank:   {report.superseded_downrank_rate:.4f}")

    # ── 7. Write report ───────────────────────────────────────
    print(f"\n=== Writing report to {args.output_dir} ===\n")
    dataset_name = Path(args.dataset).name
    write_report(
        report=report,
        output_dir=args.output_dir,
        dataset_name=dataset_name,
        seed_count=len(seeds),
        query_count=len(queries),
        api_url=client.API_URL,
        pipeline_wait_sec=pipeline_wait_sec,
    )

    print("\n=== Evaluation complete ===\n")


if __name__ == "__main__":
    main()
