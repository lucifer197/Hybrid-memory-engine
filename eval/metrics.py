"""Retrieval quality metrics for the evaluation harness.

All functions are pure — they take result data structures and return
metric values.  No I/O or network calls happen in this module.
"""

from __future__ import annotations

from dataclasses import dataclass, field


# ── Data structures ──────────────────────────────────────────────


@dataclass
class QueryResult:
    """Outcome of a single evaluation query."""

    query_id: str
    category: str
    k: int
    returned_contents: list[str]
    debug_infos: list[dict]
    expected_phrases: list[str]
    expected_absent_phrases: list[str]
    expected_seed_ids: list[str]
    negative_seed_ids: list[str]
    seed_id_to_content: dict[str, str]

    # Fact-aware fields (optional)
    returned_facts: list[dict] = field(default_factory=list)
    expect_fact_first: bool = False
    superseded_seed_ids: list[str] = field(default_factory=list)


@dataclass
class MetricReport:
    """Aggregated metrics across all queries."""

    recall_at_k: float = 0.0
    precision_at_k: float = 0.0
    mrr: float = 0.0
    coverage: float = 0.0
    avg_vector_weight: float = 0.0
    avg_graph_weight: float = 0.0
    avg_recency_weight: float = 0.0
    avg_stability_weight: float = 0.0
    graph_expansion_utility: float = 0.0
    fact_first_rate: float = 0.0
    superseded_downrank_rate: float = 0.0
    per_category: dict[str, dict[str, float]] = field(default_factory=dict)
    per_query: list[dict] = field(default_factory=list)


# ── Relevance helpers ────────────────────────────────────────────


def is_relevant(content: str, expected_phrases: list[str]) -> bool:
    """A returned memory is relevant if ANY expected phrase appears in content."""
    if not expected_phrases:
        return False
    content_lower = content.lower()
    return any(phrase.lower() in content_lower for phrase in expected_phrases)


def has_absent_phrase(content: str, absent_phrases: list[str]) -> bool:
    """Check if content contains any phrase that should NOT be present."""
    if not absent_phrases:
        return False
    content_lower = content.lower()
    return any(phrase.lower() in content_lower for phrase in absent_phrases)


def content_matches_seed(content: str, seed_content: str) -> bool:
    """Check whether returned content likely came from a specific seed.

    Uses substring matching: memory content is stored as
    ``[role]: text\\n\\n[role]: text`` and retrieval returns chunk_text
    which is a chunk of that transcript.
    """
    content_lower = content.lower()
    seed_lower = seed_content.lower()
    # Check if the first 60 chars of one appear in the other
    return (
        seed_lower[:60] in content_lower
        or content_lower[:60] in seed_lower
    )


# ── Per-query metric functions ───────────────────────────────────


def _recall(result: QueryResult) -> float:
    """Fraction of expected seeds found in top-K results."""
    if not result.expected_seed_ids:
        return 1.0  # nothing expected → vacuously true

    found = 0
    for seed_id in result.expected_seed_ids:
        seed_content = result.seed_id_to_content.get(seed_id, "")
        for content in result.returned_contents:
            if content_matches_seed(content, seed_content):
                found += 1
                break

    return found / len(result.expected_seed_ids)


def _precision(result: QueryResult) -> float:
    """Fraction of returned results that are relevant."""
    if not result.returned_contents:
        return 0.0
    relevant = sum(
        1
        for c in result.returned_contents
        if is_relevant(c, result.expected_phrases)
    )
    return relevant / len(result.returned_contents)


def _reciprocal_rank(result: QueryResult) -> float:
    """1/rank of the first relevant result (0 if none found)."""
    for i, content in enumerate(result.returned_contents):
        if is_relevant(content, result.expected_phrases):
            return 1.0 / (i + 1)
    return 0.0


def _has_results(result: QueryResult) -> bool:
    return len(result.returned_contents) > 0


def _absent_violations(result: QueryResult) -> int:
    """Count results that contain phrases that should be absent."""
    return sum(
        1
        for c in result.returned_contents
        if has_absent_phrase(c, result.expected_absent_phrases)
    )


# ── Fact-aware metrics ──────────────────────────────────────────


def _fact_first(result: QueryResult) -> bool | None:
    """Check if facts appear before episodic memories when expected.

    Returns True if facts were returned and the query expects fact-first,
    False if fact-first was expected but no facts were returned,
    None if the query doesn't test fact-first behavior.
    """
    if not result.expect_fact_first:
        return None
    return len(result.returned_facts) > 0


def _superseded_downranked(result: QueryResult) -> bool | None:
    """Check if superseded seeds rank below the current/correct seed.

    Returns True if all superseded seeds rank below the expected seed,
    False if any superseded seed outranks the expected seed,
    None if the query doesn't test superseded behavior.
    """
    if not result.superseded_seed_ids or not result.expected_seed_ids:
        return None

    # Find rank of first expected seed
    expected_rank = None
    for seed_id in result.expected_seed_ids:
        seed_content = result.seed_id_to_content.get(seed_id, "")
        for i, content in enumerate(result.returned_contents):
            if content_matches_seed(content, seed_content):
                if expected_rank is None or i < expected_rank:
                    expected_rank = i
                break

    if expected_rank is None:
        return False  # expected seed not even found

    # Check all superseded seeds rank below expected
    for sup_id in result.superseded_seed_ids:
        sup_content = result.seed_id_to_content.get(sup_id, "")
        for i, content in enumerate(result.returned_contents):
            if content_matches_seed(content, sup_content):
                if i <= expected_rank:
                    return False  # superseded ranks at or above expected
                break

    return True


# ── Contribution breakdown ───────────────────────────────────────


def _contribution_breakdown(
    all_debug_infos: list[list[dict]],
) -> dict[str, float]:
    """Average score contributions across all retrieved memories."""
    keys = ["vector", "graph", "recency", "stability"]
    totals = {k: 0.0 for k in keys}
    count = 0

    for query_debugs in all_debug_infos:
        for d in query_debugs:
            totals["vector"] += d.get("vector_score", 0)
            totals["graph"] += d.get("graph_score", 0)
            totals["recency"] += d.get("recency_score", 0)
            totals["stability"] += d.get("stability_score", 0)
            count += 1

    if count == 0:
        return {k: 0.0 for k in keys}
    return {k: v / count for k, v in totals.items()}


def _graph_expansion_utility(results: list[QueryResult]) -> float:
    """Fraction of relevant results that came via graph expansion (hop >= 1)."""
    graph_relevant = 0
    total_relevant = 0

    for r in results:
        for i, content in enumerate(r.returned_contents):
            if is_relevant(content, r.expected_phrases):
                total_relevant += 1
                if i < len(r.debug_infos):
                    hop = r.debug_infos[i].get("hop_depth", 0)
                    if hop is not None and hop >= 1:
                        graph_relevant += 1

    return graph_relevant / total_relevant if total_relevant > 0 else 0.0


# ── Main aggregation ────────────────────────────────────────────


def compute_metrics(results: list[QueryResult]) -> MetricReport:
    """Compute all metrics from a list of query results."""
    if not results:
        return MetricReport()

    # Per-query scores
    recalls: list[float] = []
    precisions: list[float] = []
    rrs: list[float] = []
    has_results_list: list[bool] = []
    fact_first_results: list[bool] = []
    superseded_results: list[bool] = []
    per_query: list[dict] = []

    for r in results:
        rec = _recall(r)
        prec = _precision(r)
        rr = _reciprocal_rank(r)
        has_res = _has_results(r)
        absent_viols = _absent_violations(r)
        ff = _fact_first(r)
        sd = _superseded_downranked(r)

        recalls.append(rec)
        precisions.append(prec)
        rrs.append(rr)
        has_results_list.append(has_res)

        if ff is not None:
            fact_first_results.append(ff)
        if sd is not None:
            superseded_results.append(sd)

        # Top result info
        top_content = r.returned_contents[0] if r.returned_contents else ""
        top_score = (
            r.debug_infos[0].get("final_score", 0) if r.debug_infos else 0
        )

        pq_entry: dict = {
            "query_id": r.query_id,
            "category": r.category,
            "recall": round(rec, 4),
            "precision": round(prec, 4),
            "reciprocal_rank": round(rr, 4),
            "returned_count": len(r.returned_contents),
            "relevant_count": sum(
                1
                for c in r.returned_contents
                if is_relevant(c, r.expected_phrases)
            ),
            "absent_violations": absent_viols,
            "top_result_content": top_content[:120],
            "top_result_score": round(top_score, 4) if top_score else 0,
            "debug_info": r.debug_infos[:3],  # first 3 for brevity
        }

        if ff is not None:
            pq_entry["fact_first"] = ff
            pq_entry["facts_returned"] = len(r.returned_facts)
        if sd is not None:
            pq_entry["superseded_downranked"] = sd

        per_query.append(pq_entry)

    # Aggregate
    n = len(results)
    recall_at_k = sum(recalls) / n
    precision_at_k = sum(precisions) / n
    mrr = sum(rrs) / n
    coverage = sum(1 for h in has_results_list if h) / n

    # Fact-aware aggregates
    fact_first_rate = (
        sum(1 for f in fact_first_results if f) / len(fact_first_results)
        if fact_first_results else 0.0
    )
    superseded_downrank_rate = (
        sum(1 for s in superseded_results if s) / len(superseded_results)
        if superseded_results else 0.0
    )

    # Contribution breakdown
    all_debugs = [r.debug_infos for r in results]
    contrib = _contribution_breakdown(all_debugs)
    graph_util = _graph_expansion_utility(results)

    # Per-category breakdown
    categories: dict[str, list[int]] = {}
    for i, r in enumerate(results):
        categories.setdefault(r.category, []).append(i)

    per_category: dict[str, dict[str, float]] = {}
    for cat, indices in categories.items():
        cat_n = len(indices)
        per_category[cat] = {
            "recall_at_k": round(sum(recalls[i] for i in indices) / cat_n, 4),
            "precision_at_k": round(
                sum(precisions[i] for i in indices) / cat_n, 4
            ),
            "mrr": round(sum(rrs[i] for i in indices) / cat_n, 4),
            "count": cat_n,
        }

    return MetricReport(
        recall_at_k=round(recall_at_k, 4),
        precision_at_k=round(precision_at_k, 4),
        mrr=round(mrr, 4),
        coverage=round(coverage, 4),
        avg_vector_weight=round(contrib["vector"], 4),
        avg_graph_weight=round(contrib["graph"], 4),
        avg_recency_weight=round(contrib["recency"], 4),
        avg_stability_weight=round(contrib["stability"], 4),
        graph_expansion_utility=round(graph_util, 4),
        fact_first_rate=round(fact_first_rate, 4),
        superseded_downrank_rate=round(superseded_downrank_rate, 4),
        per_category=per_category,
        per_query=per_query,
    )
