"""Read access for the API. Uses PostGIS when DATABASE_URL is set, else the JSON seed files."""

from sqlalchemy import func, select

from . import db, store
from .models import DataSource, Environment, MapLayer, SatFeed, Storm, TimelineConfig, TrackPoint

USING_DB = db.SessionLocal is not None


def storage_name() -> str:
    return "postgis" if USING_DB else "json"


def storms() -> list[dict]:
    if not USING_DB:
        return store.STORMS

    with db.SessionLocal() as session:
        storm_rows = session.execute(
            select(Storm, func.ST_X(Storm.location), func.ST_Y(Storm.location)).order_by(Storm.position)
        ).all()
        point_rows = session.execute(
            select(TrackPoint, func.ST_X(TrackPoint.geom), func.ST_Y(TrackPoint.geom)).order_by(
                TrackPoint.storm_id, TrackPoint.kind, TrackPoint.seq
            )
        ).all()

    tracks: dict[str, dict[str, list[dict]]] = {}
    for tp, lon, lat in point_rows:
        point = {"lat": lat, "lon": lon}
        if tp.label is not None:
            point["label"] = tp.label
        if tp.uncertain is not None:
            point["uncertain"] = tp.uncertain
        tracks.setdefault(tp.storm_id, {"historical": [], "predicted": []})[tp.kind].append(point)

    return [
        {
            "id": s.id,
            "name": s.name,
            "category": s.category,
            "categoryLabel": s.category_label,
            "lat": lat,
            "lon": lon,
            "wind": s.wind,
            "pressure": s.pressure,
            "direction": s.direction,
            "speed": s.speed,
            "intensitySteps": s.intensity_steps,
            "activeSteps": s.active_steps,
            "isWarning": s.is_warning,
            "detection": s.detection,
            "classification": s.classification,
            "intensityConf": s.intensity_conf,
            "track": tracks.get(s.id, {"historical": [], "predicted": []}),
            "forecast": s.forecast,
            "uncertainty": s.uncertainty,
            "alerts": s.alerts,
            "features": s.features,
            "modelStack": s.model_stack,
        }
        for s, lon, lat in storm_rows
    ]


def storm(storm_id: str) -> dict | None:
    return next((s for s in storms() if s["id"] == storm_id), None)


def sat_feeds() -> list[dict]:
    if not USING_DB:
        return store.SAT_FEEDS
    with db.SessionLocal() as session:
        rows = session.scalars(select(SatFeed).order_by(SatFeed.position)).all()
    return [{"name": r.name, "freq": r.freq, "status": r.status} for r in rows]


def layers() -> list[dict]:
    if not USING_DB:
        return store.LAYERS
    with db.SessionLocal() as session:
        rows = session.scalars(select(MapLayer).order_by(MapLayer.position)).all()
    out = []
    for r in rows:
        layer = {"id": r.id, "label": r.label, "color": r.color, "on": r.on}
        if r.border is not None:
            layer["border"] = r.border
        out.append(layer)
    return out


def environment(storm_id: str) -> dict | None:
    if not USING_DB:
        return store.ENVIRONMENT.get(storm_id)
    with db.SessionLocal() as session:
        row = session.get(Environment, storm_id)
    return row.data if row else None


def data_sources() -> list[dict]:
    if not USING_DB:
        return store.DATA_SOURCES
    with db.SessionLocal() as session:
        rows = session.scalars(select(DataSource).order_by(DataSource.position)).all()
    return [{"icon": r.icon, "name": r.name, "desc": r.description} for r in rows]


def timeline() -> dict:
    if not USING_DB:
        return store.TIMELINE
    with db.SessionLocal() as session:
        rows = {r.key: r.value for r in session.scalars(select(TimelineConfig)).all()}
    return {"dates": rows.get("dates", []), "tick_labels": rows.get("tick_labels", [])}
