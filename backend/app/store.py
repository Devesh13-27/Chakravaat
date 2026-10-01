import json
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"


def _load(name: str):
    return json.loads((DATA_DIR / f"{name}.json").read_text(encoding="utf-8"))


# Seed data in JSON files, loaded once at startup. Swap these for database queries in step 3.
STORMS = _load("storms")
SAT_FEEDS = _load("sat_feeds")
LAYERS = _load("layers")
ENVIRONMENT = _load("environment")
DATA_SOURCES = _load("data_sources")
TIMELINE = {
    "dates": _load("timeline_dates"),
    "tick_labels": _load("timeline_tick_labels"),
}
