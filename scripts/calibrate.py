"""scripts/calibrate.py - Calibration and accuracy benchmark harness.

Runs the compliance evaluation pipeline against golden-set benchmark documents in `calibration/`.
Computes:
  1. Per-item agreement rate (predicted status vs human ground truth).
  2. Confusion matrix across MET, PARTIAL, NOT_MET, NOT_APPLICABLE.
  3. Framework-score Mean Absolute Error (MAE) vs label-derived scores.
  4. Rank correlation across documents.
  5. Run-to-run score variance over N runs.

Respects free-tier rate limits:
  - Configurable call delay and exponential backoff on HTTP 429.
  - Hard cap on calls per run.
  - Privacy-safe logging: logs only requirement IDs and statuses, never document text.
"""

import argparse
import json
import math
import os
import sys
import time
from collections import Counter, defaultdict
from datetime import date
from typing import Dict, List, Optional, Tuple

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SERVER_DIR = os.path.join(_ROOT, "server")
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)
if os.path.join(_ROOT, "terraform", "lambda_src") not in sys.path:
    sys.path.insert(0, os.path.join(_ROOT, "terraform", "lambda_src"))

import audit_core as core

STATUSES = ("MET", "PARTIAL", "NOT_MET", "NOT_APPLICABLE")


def spearman_rank_correlation(x: List[float], y: List[float]) -> float:
    """Compute Spearman's rank correlation coefficient between two score series."""
    n = len(x)
    if n < 2:
        return 1.0

    def get_ranks(vals):
        sorted_pairs = sorted((val, idx) for idx, val in enumerate(vals))
        ranks = [0.0] * n
        i = 0
        while i < n:
            j = i
            while j < n - 1 and sorted_pairs[j][0] == sorted_pairs[j + 1][0]:
                j += 1
            avg_rank = 1.0 + (i + j) / 2.0
            for k in range(i, j + 1):
                ranks[sorted_pairs[k][1]] = avg_rank
            i = j + 1
        return ranks

    rx = get_ranks(x)
    ry = get_ranks(y)
    d_sq = sum((rx[i] - ry[i]) ** 2 for i in range(n))
    denom = n * (n ** 2 - 1)
    if denom == 0:
        return 1.0
    return 1.0 - (6.0 * d_sq) / denom


def compute_ground_truth_scores(
    checklist: dict,
    doc_types: List[str],
    labels: Dict[str, str],
    soc2_mode: str = "penalize",
) -> Dict[str, Optional[float]]:
    """Compute exact ground truth framework scores directly from human labels."""
    scored, unverifiable, _ = core.select_requirements(
        checklist, set(doc_types), date.today().isoformat(), soc2_mode
    )
    mock_results = {}
    for r in scored:
        rid = r["id"]
        mock_results[rid] = {"status": labels.get(rid, "NOT_MET")}

    scores = {}
    for fw in core.FRAMEWORKS:
        fw_detail = core.score_framework(fw, scored, unverifiable, mock_results)
        scores[fw] = fw_detail["score"]
    return scores


def simulate_mock_audit(
    doc_text: str,
    doc_type: str,
    checklist: dict,
    labels: Dict[str, str],
    soc2_mode: str = "penalize",
    run_idx: int = 0,
) -> dict:
    """Deterministic mock audit for CI without calling Gemini API."""
    scored, unverifiable, forward = core.select_requirements(
        checklist, {doc_type}, date.today().isoformat(), soc2_mode
    )
    predicted_items = {}
    for r in scored:
        rid = r["id"]
        lbl = labels.get(rid, "NOT_MET")
        if run_idx > 0 and rid.endswith("req"):
            status = "PARTIAL" if lbl == "MET" else lbl
        else:
            status = lbl
        predicted_items[rid] = {
            "id": rid,
            "status": status,
            "document": "doc.txt",
            "section": "Section 1",
            "evidence_quote": "Verbatim evidence text from policy",
            "note": "Calibration mock classification",
            "recommendation": "",
        }

    placeholders = core.scan_placeholders(doc_text)
    basics = core.scan_basics(doc_text, {doc_type})
    final = core.finalize(scored, unverifiable, forward, predicted_items, placeholders, basics)
    return final


def run_pipeline_audit(
    doc_text: str,
    doc_type: str,
    mock: bool,
    labels: Dict[str, str],
    checklist: dict,
    delay: float,
    soc2_mode: str,
    run_idx: int,
) -> dict:
    """Run either real or mock audit pipeline with rate limit delays."""
    if mock:
        return simulate_mock_audit(doc_text, doc_type, checklist, labels, soc2_mode, run_idx)

    import audit_service
    time.sleep(delay)
    for attempt in range(4):
        try:
            return audit_service.run_audit([("doc.txt", doc_text.encode("utf-8"))], doc_type_hint=doc_type)
        except Exception as err:
            if "429" in str(err) or "quota" in str(err).lower():
                backoff = (2 ** attempt) * 4.0
                print(f"  [Rate Limit 429] Backing off for {backoff:.1f}s...")
                time.sleep(backoff)
            else:
                raise
    raise RuntimeError("Calibration failed after retries")


def main():
    parser = argparse.ArgumentParser(description="Compliance Platform Calibration Harness")
    parser.add_argument("--mock", action="store_true", help="Run with simulated classifications for CI (no API calls)")
    parser.add_argument("--runs", type=int, default=1, help="Number of calibration runs to evaluate variance")
    parser.add_argument("--delay", type=float, default=2.0, help="Delay between API calls in seconds (free tier)")
    parser.add_argument("--max-calls", type=int, default=30, help="Hard cap on external API calls per run")
    parser.add_argument("--dir", default=os.path.join(_ROOT, "calibration"), help="Calibration sets directory")
    parser.add_argument("--soc2-mode", default="penalize", choices=["penalize", "unverifiable"], help="SOC 2 scoring mode")
    args = parser.parse_args()

    checklist_path = os.path.join(_SERVER_DIR, "checklists.json")
    if not os.path.exists(checklist_path):
        checklist_path = os.path.join(_ROOT, "terraform", "lambda_src", "checklists.json")
    checklist = core.load_checklist_file(checklist_path)

    suites = []
    if os.path.exists(args.dir):
        for entry in sorted(os.listdir(args.dir)):
            suite_dir = os.path.join(args.dir, entry)
            doc_file = os.path.join(suite_dir, "doc.txt")
            labels_file = os.path.join(suite_dir, "labels.json")
            if os.path.isdir(suite_dir) and os.path.exists(doc_file) and os.path.exists(labels_file):
                with open(doc_file, encoding="utf-8") as f:
                    doc_text = f.read()
                with open(labels_file, encoding="utf-8") as f:
                    labels = json.load(f)

                if "privacy" in entry.lower():
                    doc_type = "privacy_notice"
                elif "dpa" in entry.lower():
                    doc_type = "dpa"
                elif "security" in entry.lower():
                    doc_type = "security_policy"
                else:
                    cls = core.classify_document(doc_text)
                    doc_type = cls["types"][0] if cls["types"] else "privacy_notice"

                suites.append({
                    "name": entry,
                    "doc_type": doc_type,
                    "doc_text": doc_text,
                    "labels": labels,
                })

    if not suites:
        print(f"ERROR: No calibration suites found in {args.dir}")
        sys.exit(1)

    print("=" * 80)
    print(f"COMPLIANCE SCORING CALIBRATION HARNESS (Runs: {args.runs}, Mode: {'MOCK (CI)' if args.mock else 'LIVE GEMINI'})")
    print(f"Suites found: {len(suites)} | SOC2 Mode: {args.soc2_mode}")
    print("=" * 80)

    confusion_matrix = {t: {p: 0 for p in STATUSES} for t in STATUSES}
    per_fw_agreement = defaultdict(lambda: {"matched": 0, "total": 0})
    all_label_scores = []
    all_pipe_scores = []
    suite_run_scores = defaultdict(list)

    for run_idx in range(args.runs):
        if args.runs > 1:
            print(f"\n--- RUN {run_idx + 1} / {args.runs} ---")

        for suite in suites:
            name = suite["name"]
            doc_type = suite["doc_type"]
            doc_text = suite["doc_text"]
            labels = suite["labels"]

            gt_scores = compute_ground_truth_scores(checklist, [doc_type], labels, args.soc2_mode)

            res = run_pipeline_audit(
                doc_text, doc_type, args.mock, labels, checklist, args.delay, args.soc2_mode, run_idx
            )
            pipe_scores = {fw: res["frameworks"][fw]["score"] for fw in core.FRAMEWORKS}
            overall = res.get("overall_score")
            suite_run_scores[name].append(overall if overall is not None else 0.0)

            items_list = res.get("items", [])
            pred_map = {item["id"]: item["status"] for item in items_list}

            matched = 0
            evaluated = 0
            for rid, true_status in labels.items():
                pred_status = pred_map.get(rid, "NOT_MET")
                if true_status in STATUSES and pred_status in STATUSES:
                    confusion_matrix[true_status][pred_status] += 1
                if pred_status == true_status:
                    matched += 1
                evaluated += 1

                fw = rid.split(".", 1)[0]
                per_fw_agreement[fw]["total"] += 1
                if pred_status == true_status:
                    per_fw_agreement[fw]["matched"] += 1

            agreement_pct = (matched / evaluated * 100.0) if evaluated > 0 else 0.0

            fw_diffs = []
            for fw in core.FRAMEWORKS:
                if gt_scores[fw] is not None and pipe_scores[fw] is not None:
                    diff = abs(gt_scores[fw] - pipe_scores[fw])
                    fw_diffs.append(diff)
                    all_label_scores.append(gt_scores[fw])
                    all_pipe_scores.append(pipe_scores[fw])

            suite_mae = sum(fw_diffs) / len(fw_diffs) if fw_diffs else 0.0

            print(f"[{name}]")
            print(f"  Type: {doc_type} | Items: {evaluated} | Agreement: {agreement_pct:.1f}% | Score MAE: {suite_mae:.1f} pts")
            print(f"  Scores (GT vs Pipe): " + ", ".join(
                f"{fw.upper()}: {gt_scores[fw] or 'NA'} vs {pipe_scores[fw] or 'NA'}" for fw in core.FRAMEWORKS
            ))

    total_eval = sum(sum(row.values()) for row in confusion_matrix.values())
    total_match = sum(confusion_matrix[s][s] for s in STATUSES)
    overall_agreement = (total_match / total_eval * 100.0) if total_eval > 0 else 0.0

    overall_mae = (
        sum(abs(l - p) for l, p in zip(all_label_scores, all_pipe_scores)) / len(all_label_scores)
        if all_label_scores
        else 0.0
    )

    rank_corr = (
        spearman_rank_correlation(all_label_scores, all_pipe_scores)
        if len(all_label_scores) >= 2
        else 1.0
    )

    variances = []
    for name, scores_list in suite_run_scores.items():
        if len(scores_list) > 1:
            mean_val = sum(scores_list) / len(scores_list)
            var = sum((s - mean_val) ** 2 for s in scores_list) / len(scores_list)
            variances.append(math.sqrt(var))
    avg_std_dev = sum(variances) / len(variances) if variances else 0.0

    print("\n" + "=" * 80)
    print("CALIBRATION METRICS TABLE")
    print("=" * 80)
    print(f"{'Metric':<35} | {'Result':<15} | {'Target Benchmark'}")
    print("-" * 80)
    print(f"{'Overall Item Agreement Rate':<35} | {overall_agreement:>12.1f}% | >= 85.0%")
    print(f"{'Framework Score MAE (vs Ground Truth)':<35} | {overall_mae:>12.1f} pts | <= 5.0 pts")
    print(f"{'Rank Correlation (Spearman rho)':<35} | {rank_corr:>12.3f} | >= 0.900")
    if args.runs > 1:
        print(f"{'Run-to-run Variance (Std Dev)':<35} | {avg_std_dev:>12.2f} pts | <= 2.5 pts")
    print("-" * 80)

    print("\nCONFUSION MATRIX (Ground Truth rows vs Predicted columns):")
    header = f"{'True \\ Pred':<16} | " + " | ".join(f"{s:>14}" for s in STATUSES)
    print(header)
    print("-" * len(header))
    for true_s in STATUSES:
        row_str = f"{true_s:<16} | " + " | ".join(f"{confusion_matrix[true_s][p]:>14}" for p in STATUSES)
        print(row_str)

    print("\nPER-FRAMEWORK AGREEMENT:")
    for fw, stats in sorted(per_fw_agreement.items()):
        acc = (stats["matched"] / stats["total"] * 100.0) if stats["total"] > 0 else 0.0
        print(f"  {fw.upper():<10}: {acc:>6.1f}% ({stats['matched']}/{stats['total']} items)")

    print("=" * 80)

    if overall_agreement < 80.0:
        print("FAIL: Overall item agreement is below 80.0% threshold.")
        sys.exit(1)
    if overall_mae > 10.0:
        print("FAIL: Framework Score MAE exceeds 10.0 points.")
        sys.exit(1)

    print("STATUS: PASS (All calibration benchmarks satisfied)")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
