"""Reset the database schema and load the demo data from app/data/*.json.

    python -m app.seed

Only the demo tables are dropped and recreated; ingested historical data
(historical_storms / historical_track_points) is left untouched.
"""

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from . import db, store
from .models import (
    Base,
    DataSource,
    Environment,
    MapLayer,
    SatFeed,
    Storm,
    TimelineConfig,
    TrackPoint,
)


def _point(lat: float, lon: float):
    return func.ST_SetSRID(func.ST_MakePoint(lon, lat), 4326)


def seed() -> None:
    if db.engine is None:
        raise SystemExit("DATABASE_URL is not set (see backend/.env.example)")

    with db.engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
    demo_tables = [
        t for name, t in Base.metadata.tables.items() if not name.startswith("historical_")
    ]
    Base.metadata.drop_all(db.engine, tables=demo_tables)
    Base.metadata.create_all(db.engine)

    with Session(db.engine) as session:
        for i, s in enumerate(store.STORMS):
            session.add(
                Storm(
                    id=s["id"],
                    position=i,
                    name=s["name"],
                    category=s["category"],
                    category_label=s["categoryLabel"],
                    location=_point(s["lat"], s["lon"]),
                    wind=s["wind"],
                    pressure=s["pressure"],
                    direction=s["direction"],
                    speed=s["speed"],
                    intensity_steps=s["intensitySteps"],
                    active_steps=s["activeSteps"],
                    is_warning=s["isWarning"],
                    intensity_conf=s["intensityConf"],
                    detection=s["detection"],
                    classification=s["classification"],
                    forecast=s["forecast"],
                    uncertainty=s["uncertainty"],
                    alerts=s["alerts"],
                    features=s["features"],
                    model_stack=s["modelStack"],
                )
            )
        session.flush()  # storms must exist before their FK rows

        for s in store.STORMS:
            for kind in ("historical", "predicted"):
                for seq, p in enumerate(s["track"][kind]):
                    session.add(
                        TrackPoint(
                            storm_id=s["id"],
                            kind=kind,
                            seq=seq,
                            label=p.get("label"),
                            uncertain=p.get("uncertain"),
                            geom=_point(p["lat"], p["lon"]),
                        )
                    )

        for i, f in enumerate(store.SAT_FEEDS):
            session.add(SatFeed(position=i, name=f["name"], freq=f["freq"], status=f["status"]))

        for i, l in enumerate(store.LAYERS):
            session.add(
                MapLayer(
                    id=l["id"],
                    position=i,
                    label=l["label"],
                    color=l["color"],
                    border=l.get("border"),
                    on=l["on"],
                )
            )

        for storm_id, env in store.ENVIRONMENT.items():
            session.add(Environment(storm_id=storm_id, data=env))

        for i, d in enumerate(store.DATA_SOURCES):
            session.add(DataSource(position=i, icon=d["icon"], name=d["name"], description=d["desc"]))

        session.add(TimelineConfig(key="dates", value=store.TIMELINE["dates"]))
        session.add(TimelineConfig(key="tick_labels", value=store.TIMELINE["tick_labels"]))

        session.commit()

    print(
        f"Seeded {len(store.STORMS)} storms, {len(store.SAT_FEEDS)} feeds, "
        f"{len(store.LAYERS)} layers, {len(store.DATA_SOURCES)} sources."
    )


if __name__ == "__main__":
    seed()
