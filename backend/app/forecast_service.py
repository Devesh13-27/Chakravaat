"""Forecast endpoints' logic. Imports torch, so main.py loads this lazily and degrades to a 503 without it."""

from datetime import datetime, timezone

import numpy as np

from .ml import data
from .ml.geo import haversine_km
from .ml.infer import ARTIFACT, Forecaster

LEAD_HOURS = data.LEAD_HOURS
_forecaster: Forecaster | None = None


class ModelUnavailable(Exception):
    pass


def get_forecaster() -> Forecaster:
    global _forecaster
    if _forecaster is None:
        if not ARTIFACT.exists():
            raise ModelUnavailable("No trained model found. Run `npm run ml:train` first.")
        _forecaster = Forecaster.load()
    return _forecaster


def _num(x) -> float | None:
    return None if x is None or not np.isfinite(x) else round(float(x), 2)


def _iso(t) -> str:
    return np.datetime_as_string(t, unit="s") + "Z"


def _frame(f: Forecaster, s: data.Samples, pred: dict, i: int) -> dict:
    """One forecast issued at sample i, with calibrated radii and (for hindcasts) the observed outcome."""
    r_track = {p: f.radius("track_km", p) for p in ("0.67", "0.9")}
    r_wind = {p: f.radius("wind_kt", p) for p in ("0.67", "0.9")}
    has_truth = not np.isnan(s.tgt_lat[i]).all()

    leads, actual, errors = [], [], []
    for k, h in enumerate(LEAD_HOURS):
        leads.append(
            {
                "lead_h": h,
                "lat": round(float(pred["lat"][i, k]), 3),
                "lon": round(float(pred["lon"][i, k]), 3),
                "wind_kt": _num(pred["wind_kt"][i, k]),
                "track_radius_km_67": round(r_track["0.67"][k], 1),
                "track_radius_km_90": round(r_track["0.9"][k], 1),
                "wind_radius_kt_67": round(r_wind["0.67"][k], 1),
                "wind_radius_kt_90": round(r_wind["0.9"][k], 1),
            }
        )
        if has_truth and np.isfinite(s.tgt_lat[i, k]):
            actual.append(
                {
                    "lead_h": h,
                    "lat": round(float(s.tgt_lat[i, k]), 3),
                    "lon": round(float(s.tgt_lon[i, k]), 3),
                    "wind_kt": _num(s.tgt_wind[i, k]),
                }
            )
            errors.append(round(float(haversine_km(pred["lat"][i, k], pred["lon"][i, k], s.tgt_lat[i, k], s.tgt_lon[i, k])), 1))
        else:
            actual.append(None)
            errors.append(None)

    return {
        "init_time": _iso(s.time[i]),
        "lat": round(float(s.lat0[i]), 3),
        "lon": round(float(s.lon0[i]), 3),
        "wind_kt": _num(s.wind0[i]),
        "sst_c": _num(s.sst0[i]),
        "shear_ms": _num(s.shear0[i]),
        "forecast": leads,
        "actual": actual if has_truth else None,
        "track_error_km": errors if has_truth else None,
    }


def hindcast(sid: str, summary: dict) -> dict | None:
    """Forecasts issued at every valid time of a past storm, next to what actually happened."""
    f = get_forecaster()
    storms = data.load_fixes(sid)
    if sid not in storms:
        return None
    s = data.build_samples(storms)
    frames = []
    if len(s):
        pred = f.predict(s)
        frames = [_frame(f, s, pred, i) for i in range(len(s))]

    d = storms[sid]
    observed = [
        {"time": _iso(t), "lat": round(float(la), 3), "lon": round(float(lo), 3), "wind_kt": _num(w)}
        for t, la, lo, w in zip(d["t"], d["lat"], d["lon"], d["wind"])
    ]
    split = data.split_of_season(summary["season"])
    return {
        "sid": sid,
        "name": summary["name"],
        "season": summary["season"],
        "data_split": split,
        "out_of_sample": split == "test",
        "model": f.info["model"],
        "uses_environment": bool(f.info.get("uses_environment", False)),
        "observed": observed,
        "frames": frames,
    }


def forecast_from_fixes(fixes: list[dict]) -> dict:
    """Real-time forecast from the latest 6-hourly fixes (no future truth). Raises ValueError on bad input."""
    f = get_forecaster()
    fixes = sorted(fixes, key=lambda x: x["time"])
    times = [x["time"].astimezone(timezone.utc).replace(tzinfo=None) for x in fixes]
    gaps = {int((b - a).total_seconds() // 60) for a, b in zip(times, times[1:])}
    if gaps != {data.STEP_H * 60}:
        raise ValueError(f"Fixes must be consecutive and exactly {data.STEP_H} hours apart.")

    storm = {
        "season": times[-1].year,
        "t": [np.datetime64(t, "h") for t in times],
        "lat": [x["lat"] for x in fixes],
        "lon": [x["lon"] for x in fixes],
        "wind": [np.nan if x.get("wind_kt") is None else x["wind_kt"] for x in fixes],
        "pres": [np.nan if x.get("pressure_hpa") is None else x["pressure_hpa"] for x in fixes],
        "sst": [np.nan if x.get("sst_c") is None else x["sst_c"] for x in fixes],
        "shear": [np.nan if x.get("shear_ms") is None else x["shear_ms"] for x in fixes],
    }
    s = data.build_samples({"live": storm}, require_targets=False)
    if len(s) == 0:
        reg = data.REGION
        raise ValueError(
            f"Latest fix is outside the North Indian Ocean domain the model was trained on "
            f"(lat {reg['lat'][0]} to {reg['lat'][1]}, lon {reg['lon'][0]} to {reg['lon'][1]})."
        )
    i = len(s) - 1  # the window ending at the newest fix
    return _frame(f, s, f.predict(s), i)


def model_card() -> dict:
    f = get_forecaster()
    uses_env = bool(f.info.get("uses_environment", False))
    env_note = (
        "In real-time requests, supply sst_c and shear_ms when available; when omitted the model treats them as unknown."
        if uses_env
        else "sst_c and shear_ms are accepted but ignored: a version trained with them did not beat the one without "
        "on the validation seasons, so the deployed model does not use them."
    )
    return {
        "model": f.info["model"],
        "uses_environment": bool(f.info.get("uses_environment", False)),
        "trained_at": f.info["trained_at"],
        "source": f.info["source"],
        "splits": f.info["splits"],
        "leads_h": f.info["leads_h"],
        "test_track_error_km": f.info["test_track_km"],
        "test_wind_error_kt": f.info["test_wind_kt"],
        "cone": f.cone_data,
        "caveats": [
            "Scored on post-analysed best-track positions, so real-time accuracy will be lower.",
            "Trained on a few hundred storms. Environment inputs (SST, shear) are coarse daily fields, not ERA5.",
            env_note,
            "Rapid intensification is not captured; intensity forecasts regress toward typical values.",
            "Central pressure is a model input: forecasts change materially when pressure_hpa is supplied vs omitted, so include it whenever known.",
            "Error radii are historical, calibrated on 2016-2018, and slightly overconfident on newer data.",
            "Not an operational forecast; does not replace IMD advisories.",
        ],
    }
