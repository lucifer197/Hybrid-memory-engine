"""Generate a human-readable markdown report from evaluation metrics."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

from tabulate import tabulate

from eval.metrics import MetricReport


def write_report(
    report: MetricReport,
    output_dir: str,
    dataset_name: str,
    seed_count: int,
    query_count: int,
    api_url: str,
    pipeline_wait_sec: float,
) -> None:
    """Write results/report.md and results/raw_results.json."""
    os.makedirs(output_dir, exist_ok=True)

    _write_markdown(
        report, output_dir, dataset_name, seed_count, query_count, api_url
    )
    _write_json(
        report,
        output_dir,
        dataset_name,
        seed_count,
        query_count,
        api_url,
        pipeline_wait_sec,
    )


def _write_markdown(
    report: MetricReport,
    output_dir: str,
    dataset_name: str,
    seed_count: int,
    query_count: int,
    api_url: str,
) -> None:
    lines: list[str] = []
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    lines.append("# Retrieval Quality Report\n")
    lines.append(f"**Date**: {now}  ")
    lines.append(
        f"**Dataset**: {dataset_name} ({seed_count} seeds, {query_count} queries)  "
    )
    lines.append(f"**API URL**: {api_url}  \n")

    # ── Summary table ─────────────────────────────────────────
    lines.append("## Summary\n")
    summary_data = [
        ["Recall@K", f"{report.recall_at_k:.4f}"],
        ["Precision@K", f"{report.precision_at_k:.4f}"],
        ["MRR", f"{report.mrr:.4f}"],
        ["Coverage", f"{report.coverage:.4f}"],
    ]
    lines.append(tabulate(summary_data, headers=["Metric", "Value"], tablefmt="github"))
    lines.append("")

    # ── Contribution breakdown ────────────────────────────────
    lines.append("\n## Score Contribution Breakdown\n")
    contrib_data = [
        ["Vector", f"{report.avg_vector_weight:.4f}"],
        ["Graph", f"{report.avg_graph_weight:.4f}"],
        ["Recency", f"{report.avg_recency_weight:.4f}"],
        ["Stability", f"{report.avg_stability_weight:.4f}"],
    ]
    lines.append(
        tabulate(contrib_data, headers=["Signal", "Avg Score"], tablefmt="github")
    )
    lines.append("")
    pct = report.graph_expansion_utility * 100
    lines.append(
        f"\nGraph expansion utility: **{pct:.1f}%** of relevant results came via graph neighbors.\n"
    )

    # ── Truth & Fact-Aware Metrics ────────────────────────────
    lines.append("## Truth-Aware Metrics\n")
    truth_data = [
        ["Fact-first rate", f"{report.fact_first_rate:.4f}",
         "Fraction of fact-first queries that returned facts"],
        ["Superseded downrank", f"{report.superseded_downrank_rate:.4f}",
         "Fraction of queries where superseded content ranked below current"],
    ]
    lines.append(
        tabulate(truth_data, headers=["Metric", "Value", "Description"], tablefmt="github")
    )
    lines.append("")

    # ── Per-category breakdown ────────────────────────────────
    lines.append("\n## Per-Category Breakdown\n")
    cat_rows = []
    for cat, vals in sorted(report.per_category.items()):
        cat_rows.append(
            [
                cat,
                f"{vals['recall_at_k']:.4f}",
                f"{vals['precision_at_k']:.4f}",
                f"{vals['mrr']:.4f}",
                int(vals["count"]),
            ]
        )
    lines.append(
        tabulate(
            cat_rows,
            headers=["Category", "Recall@K", "Precision@K", "MRR", "Queries"],
            tablefmt="github",
        )
    )
    lines.append("")

    # ── Per-query details ─────────────────────────────────────
    lines.append("\n## Per-Query Details\n")
    for pq in report.per_query:
        lines.append(f"### {pq['query_id']}: {pq['category']}")
        lines.append(f"- **Returned**: {pq['returned_count']} memories")
        lines.append(f"- **Relevant**: {pq['relevant_count']}")
        lines.append(f"- **Recall**: {pq['recall']:.4f}")
        lines.append(f"- **Precision**: {pq['precision']:.4f}")
        lines.append(f"- **RR**: {pq['reciprocal_rank']:.4f}")
        if pq.get("absent_violations", 0) > 0:
            lines.append(f"- **Absent violations**: {pq['absent_violations']}")
        if "fact_first" in pq:
            status = "YES" if pq["fact_first"] else "NO"
            lines.append(f"- **Fact-first**: {status} ({pq.get('facts_returned', 0)} facts)")
        if "superseded_downranked" in pq:
            status = "YES" if pq["superseded_downranked"] else "NO"
            lines.append(f"- **Superseded downranked**: {status}")
        if pq.get("top_result_content"):
            lines.append(f"- **Top result**: `{pq['top_result_content']}...`")
            lines.append(f"- **Top score**: {pq['top_result_score']:.4f}")
        if pq.get("debug_info"):
            d = pq["debug_info"][0]
            parts = []
            for key in ("vector_score", "graph_score", "recency_score", "stability_score"):
                if key in d:
                    parts.append(f"{key.replace('_score', '')}={d[key]:.4f}")
            if parts:
                lines.append(f"- **Debug**: {', '.join(parts)}")
        lines.append("")

    md_path = os.path.join(output_dir, "report.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    # Also write to reports/latest_report.md
    reports_dir = os.path.join(os.path.dirname(output_dir), "reports")
    os.makedirs(reports_dir, exist_ok=True)
    latest_path = os.path.join(reports_dir, "latest_report.md")
    with open(latest_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"  Report written to {md_path}")
    print(f"  Latest report at  {latest_path}")


def _write_json(
    report: MetricReport,
    output_dir: str,
    dataset_name: str,
    seed_count: int,
    query_count: int,
    api_url: str,
    pipeline_wait_sec: float,
) -> None:
    data = {
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataset": dataset_name,
        "api_url": api_url,
        "seed_count": seed_count,
        "query_count": query_count,
        "pipeline_wait_sec": round(pipeline_wait_sec, 1),
        "metrics": {
            "recall_at_k": report.recall_at_k,
            "precision_at_k": report.precision_at_k,
            "mrr": report.mrr,
            "coverage": report.coverage,
            "avg_vector_weight": report.avg_vector_weight,
            "avg_graph_weight": report.avg_graph_weight,
            "avg_recency_weight": report.avg_recency_weight,
            "avg_stability_weight": report.avg_stability_weight,
            "graph_expansion_utility": report.graph_expansion_utility,
            "fact_first_rate": report.fact_first_rate,
            "superseded_downrank_rate": report.superseded_downrank_rate,
        },
        "per_category": report.per_category,
        "per_query": report.per_query,
    }

    json_path = os.path.join(output_dir, "raw_results.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)

    print(f"  Raw results written to {json_path}")
