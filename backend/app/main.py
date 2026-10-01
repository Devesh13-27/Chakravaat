import logging
import threading
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import history, repo
from .schemas import (
    DataSource,
    Environment,
    ForecastFrame,
    ForecastRequest,
    HistoricalStormDetail,
    HindcastResponse,
    HistoricalStormPage,
    HistoryStats,
    MapLayer,
    ModelCard,
    NearbyStorm,
    SatFeed,
    Storm,
    Timeline,
)

log = logging.getLogger("uvicorn.error")


def _warm_forecast_model():
    """Import PyTorch and load the model off the request path so the first forecast isn't slow."""
    try:
        from . import forecast_service

        forecast_service.get_forecaster()
        log.info("Forecast model loaded.")
    except Exception as exc:  # optional feature: the rest of the API must still start
        log.info("Forecast model not loaded (%s); /forecast endpoints will return 503.", exc)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    threading.Thread(target=_warm_forecast_model, daemon=True).start()
    yield


app = FastAPI(
    lifespan=lifespan,
    title="Chakravaat API",
    description="Tropical cyclone intelligence: active storms, forecasts, environment and feeds.",
    version="0.1.0",
)

# The static frontend is served from a different origin during development.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

API = "/api/v1"


@app.get(f"{API}/health", tags=["meta"])
def health():
    return {"status": "ok", "storage": repo.storage_name()}


@app.get(f"{API}/storms/active", response_model=list[Storm], response_model_exclude_none=True, tags=["storms"])
def active_storms():
    return repo.storms()


@app.get(f"{API}/storms/{{storm_id}}", response_model=Storm, response_model_exclude_none=True, tags=["storms"])
def get_storm(storm_id: str):
    storm = repo.storm(storm_id)
    if storm is None:
        raise HTTPException(status_code=404, detail=f"Storm '{storm_id}' not found")
    return storm


@app.get(f"{API}/sat-feeds", response_model=list[SatFeed], response_model_exclude_none=True, tags=["feeds"])
def sat_feeds():
    return repo.sat_feeds()


@app.get(f"{API}/layers", response_model=list[MapLayer], response_model_exclude_none=True, tags=["map"])
def layers():
    return repo.layers()


@app.get(f"{API}/environment", response_model=Environment, response_model_exclude_none=True, tags=["environment"])
def environment(storm: str = Query(..., description="Storm id, e.g. 'biparjoy'")):
    env = repo.environment(storm)
    if env is None:
        raise HTTPException(status_code=404, detail=f"No environment data for storm '{storm}'")
    return env


@app.get(f"{API}/data-sources", response_model=list[DataSource], response_model_exclude_none=True, tags=["meta"])
def data_sources():
    return repo.data_sources()


@app.get(f"{API}/timeline", response_model=Timeline, response_model_exclude_none=True, tags=["map"])
def timeline():
    return repo.timeline()


# ── Historical archive (IBTrACS) ─────────────────────────────────────────────

ImdStage = Literal["d", "dd", "cs", "scs", "vscs", "escs", "sucs"]


def _require_db():
    if not repo.USING_DB:
        raise HTTPException(
            status_code=503,
            detail="The historical archive needs the PostGIS database (set DATABASE_URL and run "
            "`python -m app.ingest.ibtracs`).",
        )


@app.get(f"{API}/history/stats", response_model=HistoryStats, tags=["history"])
def history_stats():
    _require_db()
    return history.stats()


@app.get(f"{API}/history/storms", response_model=HistoricalStormPage, tags=["history"])
def history_storms(
    season_from: int | None = Query(None, ge=1800, le=2100),
    season_to: int | None = Query(None, ge=1800, le=2100),
    q: str | None = Query(None, max_length=60, description="Name contains (case-insensitive)"),
    min_wind_kt: float | None = Query(None, ge=0, le=250, description="Peak wind at least this (knots)"),
    min_imd_stage: ImdStage | None = Query(None, description="Reached at least this IMD stage"),
    landfall: bool | None = Query(None, description="Made landfall (true) / stayed at sea (false)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    _require_db()
    return history.list_storms(
        season_from=season_from,
        season_to=season_to,
        q=q,
        min_wind_kt=min_wind_kt,
        min_imd_stage=min_imd_stage,
        landfall=landfall,
        limit=limit,
        offset=offset,
    )


@app.get(f"{API}/history/storms/near", response_model=list[NearbyStorm], tags=["history"])
def history_storms_near(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=360),
    radius_km: float = Query(200, gt=0, le=2000),
    season_from: int | None = Query(None, ge=1800, le=2100),
    season_to: int | None = Query(None, ge=1800, le=2100),
    limit: int = Query(25, ge=1, le=100),
):
    """Historical storms whose main track passed within `radius_km` of a point, nearest first."""
    _require_db()
    return history.storms_near(
        lat=lat, lon=lon, radius_km=radius_km, season_from=season_from, season_to=season_to, limit=limit
    )


@app.get(f"{API}/history/storms/{{sid}}", response_model=HistoricalStormDetail, tags=["history"])
def history_storm(sid: str, main_only: bool = Query(True, description="Only 'main' track fixes")):
    _require_db()
    storm = history.storm_detail(sid, main_only)
    if storm is None:
        raise HTTPException(status_code=404, detail=f"Historical storm '{sid}' not found")
    return storm


# ── Forecast model (blend of GRU ensemble + ridge) ───────────────────────────


def _forecast_service():
    """Imported lazily so the rest of the API still runs on a machine without PyTorch."""
    try:
        from . import forecast_service
    except ImportError as exc:
        raise HTTPException(
            status_code=503, detail="The forecast model needs PyTorch: pip install -r backend/requirements-ml.txt"
        ) from exc
    return forecast_service


@app.get(f"{API}/forecast/model", response_model=ModelCard, tags=["forecast"])
def forecast_model():
    """What the deployed model is, how it scored on unseen seasons, and its calibrated error radii."""
    svc = _forecast_service()
    try:
        return svc.model_card()
    except svc.ModelUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post(f"{API}/forecast", response_model=ForecastFrame, tags=["forecast"])
def forecast(body: ForecastRequest):
    """Forecast +6/+12/+24/+48 h from the latest consecutive 6-hourly fixes (newest = start time)."""
    svc = _forecast_service()
    try:
        return svc.forecast_from_fixes([f.model_dump() for f in body.fixes])
    except svc.ModelUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get(f"{API}/history/storms/{{sid}}/hindcast", response_model=HindcastResponse, tags=["forecast"])
def history_hindcast(sid: str):
    """Replay a past storm: the model's forecast from every valid time, next to what actually happened.

    `out_of_sample` is true only for 2019+ storms; earlier storms were used for training or tuning."""
    _require_db()
    summary = history.storm_summary(sid)
    if summary is None:
        raise HTTPException(status_code=404, detail=f"Historical storm '{sid}' not found")
    svc = _forecast_service()
    try:
        result = svc.hindcast(sid, summary)
    except svc.ModelUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail=f"No 6-hourly fixes for storm '{sid}'")
    return result
