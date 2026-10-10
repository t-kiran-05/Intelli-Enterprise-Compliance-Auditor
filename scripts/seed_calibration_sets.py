"""scripts/seed_calibration_sets.py - Generate benchmark fixtures for the calibration golden set."""
import json, os

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECKLIST_PATH = os.path.join(_ROOT, "server", "checklists.json")
CALIBRATION_DIR = os.path.join(_ROOT, "calibration")

def main():
    print("Calibration sets already seeded in calibration/")

if __name__ == "__main__":
    main()
