from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import store
from .schemas import (
    DataSource,
    Environment,
    MapLayer,
    SatFeed,
    Storm,
    Timeline,
)

app = FastAPI(
    title="Chakravaat API",
    description="Tropical cyclone intelligence: active storms, forecasts, environment and feeds.",
    version="0.1.0",
)

# The static frontend is served from a different origin during development.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["GET"],
    allow_headers=["*"],
)

API = "/api/v1"


@app.get(f"{API}/health", tags=["meta"])
def health():
    return {"status": "ok"}


@app.get(f"{API}/storms/active", response_model=list[Storm], response_model_exclude_none=True, tags=["storms"])
def active_storms():
    return store.STORMS


@app.get(f"{API}/storms/{{storm_id}}", response_model=Storm, response_model_exclude_none=True, tags=["storms"])
def get_storm(storm_id: str):
    storm = next((s for s in store.STORMS if s["id"] == storm_id), None)
    if storm is None:
        raise HTTPException(status_code=404, detail=f"Storm '{storm_id}' not found")
    return storm


@app.get(f"{API}/sat-feeds", response_model=list[SatFeed], response_model_exclude_none=True, tags=["feeds"])
def sat_feeds():
    return store.SAT_FEEDS


@app.get(f"{API}/layers", response_model=list[MapLayer], response_model_exclude_none=True, tags=["map"])
def layers():
    return store.LAYERS


@app.get(f"{API}/environment", response_model=Environment, response_model_exclude_none=True, tags=["environment"])
def environment(storm: str = Query(..., description="Storm id, e.g. 'biparjoy'")):
    env = store.ENVIRONMENT.get(storm)
    if env is None:
        raise HTTPException(status_code=404, detail=f"No environment data for storm '{storm}'")
    return env


@app.get(f"{API}/data-sources", response_model=list[DataSource], response_model_exclude_none=True, tags=["meta"])
def data_sources():
    return store.DATA_SOURCES


@app.get(f"{API}/timeline", response_model=Timeline, response_model_exclude_none=True, tags=["map"])
def timeline():
    return store.TIMELINE
