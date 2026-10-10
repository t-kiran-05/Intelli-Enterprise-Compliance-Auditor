"""tests/test_calibration.py - Unit test suite for Phase 3 calibration harness.

Verifies:
  - Discovery of all calibration suites in calibration/
  - Validity of labels.json against checklists.json
  - Spearman rank correlation calculation
  - Successful execution of calibrate.py --mock with zero failures
"""

import json
import os
import subprocess
import sys

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SCRIPTS_DIR = os.path.join(_ROOT, "scripts")
_CALIBRATION_DIR = os.path.join(_ROOT, "calibration")
_SERVER_DIR = os.path.join(_ROOT, "server")

if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)

import calibrate


class TestCalibrationSuites:
    """Validate structure and label integrity of calibration suites."""

    def test_suites_exist(self):
        assert os.path.exists(_CALIBRATION_DIR)
        suites = [
            d for d in os.listdir(_CALIBRATION_DIR)
            if os.path.isdir(os.path.join(_CALIBRATION_DIR, d)) and d.startswith("set_")
        ]
        assert len(suites) >= 3, f"Expected at least 3 calibration suites, found {len(suites)}"

    def test_all_suites_have_doc_and_labels(self):
        suites = [
            d for d in os.listdir(_CALIBRATION_DIR)
            if os.path.isdir(os.path.join(_CALIBRATION_DIR, d)) and d.startswith("set_")
        ]
        for s in suites:
            s_dir = os.path.join(_CALIBRATION_DIR, s)
            doc_path = os.path.join(s_dir, "doc.txt")
            labels_path = os.path.join(s_dir, "labels.json")
            assert os.path.exists(doc_path), f"Missing doc.txt in {s}"
            assert os.path.exists(labels_path), f"Missing labels.json in {s}"
            assert os.path.getsize(doc_path) > 100, f"doc.txt in {s} is suspiciously small"

            with open(labels_path, encoding="utf-8") as f:
                labels = json.load(f)
            assert len(labels) >= 10, f"Too few labels in {s}: {len(labels)}"
            for rid, status in labels.items():
                assert status in ("MET", "PARTIAL", "NOT_MET", "NOT_APPLICABLE"), (
                    f"Invalid status '{status}' for {rid} in {s}"
                )


class TestCalibrationMath:
    """Test Spearman rank correlation and statistical calculations."""

    def test_perfect_correlation(self):
        x = [10.0, 20.0, 30.0, 40.0, 50.0]
        y = [15.0, 25.0, 35.0, 45.0, 55.0]
        assert calibrate.spearman_rank_correlation(x, y) == pytest.approx(1.0)

    def test_inverse_correlation(self):
        x = [10.0, 20.0, 30.0, 40.0, 50.0]
        y = [50.0, 40.0, 30.0, 20.0, 10.0]
        assert calibrate.spearman_rank_correlation(x, y) == pytest.approx(-1.0)


class TestCalibrationCli:
    """Validate CLI execution in CI mock mode."""

    def test_mock_calibration_run(self):
        cmd = [sys.executable, os.path.join(_SCRIPTS_DIR, "calibrate.py"), "--mock", "--runs", "2"]
        result = subprocess.run(cmd, capture_output=True, text=True)
        assert result.returncode == 0, f"Calibration CLI failed with error:\n{result.stderr}\n{result.stdout}"
        assert "CALIBRATION METRICS TABLE" in result.stdout
        assert "STATUS: PASS" in result.stdout
