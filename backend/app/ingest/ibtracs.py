"""Load the IBTrACS North Indian Ocean archive into PostGIS.

    python -m app.ingest.ibtracs                 # download (if needed) + load
    python -m app.ingest.ibtracs --file x.csv    # load a local copy

Idempotent: replaces the contents of historical_storms / historical_track_points.
Data: NOAA NCEI IBTrACS v04r01 (public domain). Knots / hPa / km / degrees are kept as in the source.
"""

import argparse
import csv
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text

from .. import db
from ..models import Base, HistoricalStorm, HistoricalTrackPoint

URL = (
    "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/"
    "v04r01/access/csv/ibtracs.NI.list.v04r01.csv"
)
RAW_DIR = Path(__file__).resolve().parents[2] / "data" / "raw"
DEFAULT_FILE = RAW_DIR / "ibtracs.NI.list.v04r01.csv"

# IMD classes ordered by severity. Anything else (e.g. 'SCS(H)') keeps its raw grade
# but gets no normalised stage rather than a guess.
IMD_ORDER = ["d", "dd", "cs", "scs", "vscs", "escs", "sucs"]

# (column, source tag) in priority order: the agency IBTrACS marks as official for the
# fix, then IMD New Delhi, then JTWC. JTWC winds are 1-minute, IMD's 3-minute - hence the tag.
WIND_SOURCES = [("WMO_WIND", "wmo"), ("NEWDELHI_WIND", "newdelhi"), ("USA_WIND", "usa")]
PRES_SOURCES = [("WMO_PRES", "wmo"), ("NEWDELHI_PRES", "newdelhi"), ("USA_PRES", "usa")]


def _clean(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def _num(value: str | None) -> float | None:
    value = _clean(value)
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _first_numeric(row: dict, sources) -> tuple[float | None, str | None]:
    for column, tag in sources:
        value = _num(row.get(column))
        if value is not None and value > 0:  # 0 / negatives are fill values in these columns
            return value, tag
    return None, None


def _imd_stage(grade: str | None) -> str | None:
    if grade is None:
        return None
    code = grade.lower()
    return code if code in IMD_ORDER else None


def download(dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {URL}")
    tmp = dest.with_suffix(".part")
    urllib.request.urlretrieve(URL, tmp)
    if tmp.stat().st_size < 1_000_000:
        tmp.unlink()
        raise SystemExit("Download looks truncated (<1 MB); aborting.")
    tmp.replace(dest)
    print(f"Saved {dest} ({dest.stat().st_size / 1e6:.1f} MB)")


def parse(path: Path) -> list[dict]:
    points = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        next(reader)  # second header row holds units, not data
        for row in reader:
            lat, lon = _num(row["LAT"]), _num(row["LON"])
            if lat is None or lon is None:
                continue
            wind, wind_src = _first_numeric(row, WIND_SOURCES)
            pres, pres_src = _first_numeric(row, PRES_SOURCES)
            grade = _clean(row.get("NEWDELHI_GRADE"))
            points.append(
                {
                    "sid": row["SID"].strip(),
                    "name": _clean(row["NAME"]) or "NOT_NAMED",
                    "season": int(row["SEASON"]),
                    "number": int(row["NUMBER"]) if _clean(row["NUMBER"]) else None,
                    "observed_at": datetime.strptime(row["ISO_TIME"].strip(), "%Y-%m-%d %H:%M:%S").replace(
                        tzinfo=timezone.utc
                    ),
                    "lat": lat,
                    "lon": lon,
                    "nature": _clean(row["NATURE"]),
                    "track_type": _clean(row["TRACK_TYPE"]),
                    "basin": _clean(row["BASIN"]),
                    "subbasin": _clean(row["SUBBASIN"]),
                    "wind_kt": wind,
                    "wind_source": wind_src,
                    "pressure_hpa": pres,
                    "pressure_source": pres_src,
                    "imd_grade": grade,
                    "imd_stage": _imd_stage(grade),
                    "storm_speed_kt": _num(row.get("STORM_SPEED")),
                    "storm_dir_deg": _num(row.get("STORM_DIR")),
                    "dist2land_km": _num(row.get("DIST2LAND")),
                    "landfall_km": _num(row.get("LANDFALL")),
                }
            )
    return points


def summarise(points: list[dict]) -> list[dict]:
    by_sid: dict[str, list[dict]] = defaultdict(list)
    for p in points:
        by_sid[p["sid"]].append(p)

    storms = []
    for sid, pts in by_sid.items():
        pts.sort(key=lambda p: p["observed_at"])
        winds = [p["wind_kt"] for p in pts if p["wind_kt"] is not None]
        pressures = [p["pressure_hpa"] for p in pts if p["pressure_hpa"] is not None]
        stages = [IMD_ORDER.index(p["imd_stage"]) for p in pts if p["imd_stage"]]
        storms.append(
            {
                "sid": sid,
                "name": pts[0]["name"],
                "season": pts[0]["season"],
                "number": pts[0]["number"],
                "basin": pts[0]["basin"] or "",
                "start_time": pts[0]["observed_at"],
                "end_time": pts[-1]["observed_at"],
                "n_points": len(pts),
                "max_wind_kt": max(winds) if winds else None,
                "min_pressure_hpa": min(pressures) if pressures else None,
                "max_imd_stage": IMD_ORDER[max(stages)] if stages else None,
                "made_landfall": any(p["landfall_km"] == 0 for p in pts),
            }
        )
    return storms


INSERT_POINT = text(
    """
    INSERT INTO historical_track_points
      (sid, observed_at, geom, nature, track_type, basin, subbasin, wind_kt, wind_source,
       pressure_hpa, pressure_source, imd_grade, imd_stage, storm_speed_kt, storm_dir_deg,
       dist2land_km, landfall_km)
    VALUES
      (:sid, :observed_at, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), :nature, :track_type,
       :basin, :subbasin, :wind_kt, :wind_source, :pressure_hpa, :pressure_source, :imd_grade,
       :imd_stage, :storm_speed_kt, :storm_dir_deg, :dist2land_km, :landfall_km)
    """
)


def load(points: list[dict]) -> None:
    if db.engine is None:
        raise SystemExit("DATABASE_URL is not set (see backend/.env.example)")

    storms = summarise(points)

    with db.engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
    Base.metadata.create_all(
        db.engine, tables=[HistoricalStorm.__table__, HistoricalTrackPoint.__table__]
    )

    with db.engine.begin() as conn:  # one transaction: all-or-nothing replace
        conn.execute(text("TRUNCATE historical_track_points, historical_storms RESTART IDENTITY CASCADE"))
        conn.execute(HistoricalStorm.__table__.insert(), storms)
        for i in range(0, len(points), 5000):
            conn.execute(INSERT_POINT, points[i : i + 5000])

    print(f"Loaded {len(storms)} storms and {len(points)} track points.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--file", type=Path, default=DEFAULT_FILE)
    args = parser.parse_args()

    if not args.file.exists():
        download(args.file)
    points = parse(args.file)
    print(f"Parsed {len(points)} rows from {args.file.name}")
    load(points)


if __name__ == "__main__":
    main()
