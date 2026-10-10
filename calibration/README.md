# Calibration Golden Sets

This directory contains human-labeled calibration suites used to benchmark, calibrate, and prevent regression in the compliance scoring engine.

---

## Purpose

The compliance scoring engine uses an LLM to extract verbatim evidence and classify regulatory requirements, while computing all scores deterministically in code (`audit_core.py`).

To ensure that scores remain realistic, reproducible, and calibrated against legal reality, we evaluate the system against golden-set benchmark documents where expert human auditors have manually classified each assessable requirement.

---

## Directory Structure

```
calibration/
├── README.md
├── set_01_privacy_notice/
│   ├── doc.txt          # Benchmark document text
│   └── labels.json      # Human ground-truth classifications
├── set_02_dpa/
│   ├── doc.txt
│   └── labels.json
└── set_03_security_policy/
    ├── doc.txt
    └── labels.json
```

---

## Label Format (`labels.json`)

Each `labels.json` file is a JSON object mapping requirement IDs to their authoritative human assessment status:

```json
{
  "requirement_id": "MET" | "PARTIAL" | "NOT_MET" | "NOT_APPLICABLE"
}
```

### Classification Criteria:
- **`MET`**: The document contains clear, unambiguous language satisfying all elements of the requirement.
- **`PARTIAL`**: The document addresses the topic but omits key statutory elements, uses vague commitments, or lacks required operational details.
- **`NOT_MET`**: The document completely omits the required clause or explicitly contradicts the requirement.
- **`NOT_APPLICABLE`**: The requirement does not apply to this specific processing arrangement (only valid when `na_allowed: true` in `checklists.json`).

---

## Running Calibration

Use the calibration harness script:

```bash
# Run in CI mode (simulated LLM, fast & free, zero API calls)
python scripts/calibrate.py --mock

# Run real evaluation against Gemini models (respects free-tier rate limits)
python scripts/calibrate.py --runs 3 --delay 2.5
```

The script reports:
1. **Per-item Agreement Rate**: Percentage of items where model classification matches ground truth.
2. **Confusion Matrix**: Classification breakdown across `MET`, `PARTIAL`, `NOT_MET`, `NOT_APPLICABLE`.
3. **Framework Score MAE**: Mean absolute difference between pipeline scores and human-derived ground truth scores.
4. **Rank Correlation**: Spearman's rank correlation across benchmark documents.
5. **Run-to-run Variance**: Standard deviation of scores across multiple passes.

---

## Human Labeling Guidelines

When adding a new benchmark:
1. Create a new directory `calibration/set_XX_<name>/`.
2. Add the complete document text as `doc.txt` (plain text UTF-8).
3. Do not include confidential customer or company data; use synthetic or public agreements.
4. Run an initial pass or inspect applicable requirements from `checklists.json` for that document type.
5. Have a privacy attorney or qualified compliance analyst review and record ground truth in `labels.json`.
6. Ensure every assessable requirement is assigned an explicit status.
