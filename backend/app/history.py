"""Queries over the IBTrACS archive (requires the PostGIS database)."""

import math

from sqlalchemy import func, select, text

from . import db
from .ingest.ibtracs import IMD_ORDER
from .models import HistoricalStorm, HistoricalTrackPoint


def _summary(s: HistoricalStorm) -> dict:
    return {
        "sid": s.sid,
        "name": s.name,
        "season": s.season,
        "basin": s.basin,
        "start_time": s.start_time,
        "end_time": s.end_time,
        "n_points": s.n_points,
        "max_wind_kt": s.max_wind_kt,
        "min_pressure_hpa": s.min_pressure_hpa,
        "max_imd_stage": s.max_imd_stage,
        "made_landfall": s.made_landfall,
    }


def stats() -> dict:
    with db.SessionLocal() as session:
        row = session.execute(
            select(
                func.count(HistoricalStorm.sid),
                func.min(HistoricalStorm.season),
                func.max(HistoricalStorm.season),
                func.coalesce(func.sum(HistoricalStorm.n_points), 0),
                func.count(HistoricalStorm.max_wind_kt),
                func.max(HistoricalStorm.end_time),
            )
        ).one()
    return {
        "storms": row[0],
        "first_season": row[1],
        "last_season": row[2],
        "track_points": int(row[3]),
        "storms_with_intensity": row[4],
        "latest_fix": row[5],
        "source": "NOAA IBTrACS v04r01 (North Indian Ocean file)",
    }


def list_storms(
    *,
    season_from: int | None,
    season_to: int | None,
    q: str | None,
    min_wind_kt: float | None,
    min_imd_stage: str | None,
    landfall: bool | None,
    limit: int,
    offset: int,
) -> dict:
    conditions = []
    if season_from is not None:
        conditions.append(HistoricalStorm.season >= season_from)
    if season_to is not None:
        conditions.append(HistoricalStorm.season <= season_to)
    if q:
        conditions.append(HistoricalStorm.name.ilike(f"%{q}%"))
    if min_wind_kt is not None:
        conditions.append(HistoricalStorm.max_wind_kt >= min_wind_kt)
    if min_imd_stage:
        conditions.append(HistoricalStorm.max_imd_stage.in_(IMD_ORDER[IMD_ORDER.index(min_imd_stage) :]))
    if landfall is not None:
        conditions.append(HistoricalStorm.made_landfall == landfall)

    with db.SessionLocal() as session:
        total = session.scalar(select(func.count(HistoricalStorm.sid)).where(*conditions))
        rows = session.scalars(
            select(HistoricalStorm)
            .where(*conditions)
            .order_by(HistoricalStorm.start_time.desc())
            .limit(limit)
            .offset(offset)
        ).all()
    return {"total": total, "items": [_summary(s) for s in rows]}


def storm_detail(sid: str, main_only: bool) -> dict | None:
    with db.SessionLocal() as session:
        storm = session.get(HistoricalStorm, sid)
        if storm is None:
            return None
        query = select(
            HistoricalTrackPoint,
            func.ST_Y(HistoricalTrackPoint.geom),
            func.ST_X(HistoricalTrackPoint.geom),
        ).where(HistoricalTrackPoint.sid == sid)
        if main_only:
            query = query.where(HistoricalTrackPoint.track_type == "main")
        rows = session.execute(query.order_by(HistoricalTrackPoint.observed_at)).all()

    points = [
        {
            "observed_at": p.observed_at,
            "lat": lat,
            "lon": lon,
            "wind_kt": p.wind_kt,
            "wind_source": p.wind_source,
            "pressure_hpa": p.pressure_hpa,
            "pressure_source": p.pressure_source,
            "imd_grade": p.imd_grade,
            "imd_stage": p.imd_stage,
            "nature": p.nature,
            "track_type": p.track_type,
            "storm_speed_kt": p.storm_speed_kt,
            "storm_dir_deg": p.storm_dir_deg,
            "dist2land_km": p.dist2land_km,
        }
        for p, lat, lon in rows
    ]
    return {**_summary(storm), "points": points}


NEAR_SQL = text(
    """
    WITH target AS (SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS g),
    hits AS (
      SELECT p.sid, min(ST_Distance(p.geom::geography, t.g::geography)) / 1000.0 AS min_km
      FROM historical_track_points p, target t
      WHERE p.track_type = 'main'
        AND p.geom && ST_Expand(t.g, :expand_deg)                           -- uses the GiST index
        AND ST_DWithin(p.geom::geography, t.g::geography, :radius_m)        -- exact distance
      GROUP BY p.sid
    )
    SELECT s.sid, h.min_km
    FROM hits h JOIN historical_storms s USING (sid)
    WHERE (CAST(:season_from AS int) IS NULL OR s.season >= :season_from)
      AND (CAST(:season_to AS int) IS NULL OR s.season <= :season_to)
    ORDER BY h.min_km
    LIMIT :limit
    """
)


def storms_near(
    *, lat: float, lon: float, radius_km: float, season_from: int | None, season_to: int | None, limit: int
) -> list[dict]:
    # Bounding-box prefilter in degrees (generous at high latitude), then exact geodesic distance.
    expand_deg = radius_km / 111.0 / max(math.cos(math.radians(abs(lat))), 0.2)
    with db.SessionLocal() as session:
        hits = session.execute(
            NEAR_SQL,
            {
                "lat": lat,
                "lon": lon,
                "radius_m": radius_km * 1000.0,
                "expand_deg": expand_deg,
                "season_from": season_from,
                "season_to": season_to,
                "limit": limit,
            },
        ).all()
        if not hits:
            return []
        storms = {
            s.sid: s
            for s in session.scalars(select(HistoricalStorm).where(HistoricalStorm.sid.in_([h.sid for h in hits])))
        }
    return [{**_summary(storms[h.sid]), "min_distance_km": round(h.min_km, 1)} for h in hits]


def storm_summary(sid: str) -> dict | None:
    with db.SessionLocal() as session:
        storm = session.get(HistoricalStorm, sid)
    return _summary(storm) if storm else None
