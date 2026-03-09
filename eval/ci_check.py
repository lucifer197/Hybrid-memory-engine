"""CI gate: fail if retrieval quality metrics drop below thresholds.

Usage:
    # Check existing results:
    python -m eval.ci_check

    # Custom results path:
    python -m eval.ci_check eval/results/raw_results.json

Exit codes:
    0 — all metrics above thresholds
    1 — one or more metrics below threshold (or results file missing)

Thresholds are configurable via environment variables:
    EVAL_MIN_RECALL      (default 0.70)
    EVAL_MIN_PRECISION   (default 0.40)
    EVAL_MIN_MRR         (default 0.50)
    EVAL_MIN_COVERAGE    (default 0.90)
    EVAL_MIN_FACT_FIRST  (default 0.50)
    EVAL_MIN_SUPERSEDED  (default 0.50)
"""

from __future__ import annotations

import json
import os
import sys

# ── Configurable thresholds ──────────────────────────────────────

THRESHOLDS = {
    "recall_at_k": float(os.getenv("EVAL_MIN_RECALL", "0.70")),
    "precision_at_k": float(os.getenv("EVAL_MIN_PRECISION", "0.40")),
    "mrr": float(os.getenv("EVAL_MIN_MRR", "0.50")),
    "coverage": float(os.getenv("EVAL_MIN_COVERAGE", "0.90")),
    "fact_first_rate": float(os.getenv("EVAL_MIN_FACT_FIRST", "0.50")),
    "superseded_downrank_rate": float(os.getenv("EVAL_MIN_SUPERSEDED", "0.50")),
}


def check(results_path: str) -> bool:
    """Check all metrics against thresholds.

    Returns True if all pass, False otherwise.
    """
    with open(results_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    metrics = data.get("metrics", {})
    passed = True

    print("\n=== CI Metric Check ===\n")

    for metric_name, threshold in THRESHOLDS.items():
        actual = metrics.get(metric_name, 0.0)
        ok = actual >= threshold
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {metric_name}: {actual:.4f} (threshold: {threshold:.4f})")
        if not ok:
            passed = False

    print()
    if passed:
        print("  All metrics above thresholds.\n")
    else:
        print("  One or more metrics BELOW threshold.\n")

    return passed


def main() -> None:
    results_path = sys.argv[1] if len(sys.argv) > 1 else "eval/results/raw_results.json"

    if not os.path.exists(results_path):
        print(f"ERROR: Results file not found: {results_path}")
        print("Run 'python -m eval.run_eval' first.")
        sys.exit(1)

    success = check(results_path)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
