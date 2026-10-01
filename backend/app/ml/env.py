"""Sample cached SST and vertical wind shear at storm fix times and positions (numpy only, no scipy).

SST   : NOAA OISST daily, bilinear in space. Land/ice cells are missing, so a fix over land gets NaN.
Shear : |V(200 hPa) - V(850 hPa)| in m/s from NCEP/NCAR Reanalysis 1 daily means, averaged over a
        +/-5 degree box around the fix (a standard, coarse stand-in for the 200-800 km annulus mean).
Both use the day of the fix, so they only ever contain information available at or before that time.
"""

from functools import lru_cache
from pathlib import Path

import numpy as np
import xarray as xr

from ..ingest.environment import ENV_DIR

SHEAR_BOX_DEG = 5.0
SST_MAX_GAP_DAYS = 2  # accept the nearest SST day if one is missing
WIND_MAX_GAP_DAYS = 1


def _day(t: np.ndarray) -> np.ndarray:
    return t.astype("datetime64[D]").astype("int64")


def _nearest_day(days: np.ndarray, want: np.ndarray, max_gap: int) -> np.ndarray:
    """Index of the nearest available day for each wanted day, or -1 beyond max_gap."""
    idx = np.clip(np.searchsorted(days, want), 1, len(days) - 1)
    pick = np.where(np.abs(days[idx - 1] - want) <= np.abs(days[idx] - want), idx - 1, idx)
    return np.where(np.abs(days[pick] - want) <= max_gap, pick, -1)


@lru_cache(maxsize=4)
def _load_sst(year: int, env_dir: Path):
    path = Path(env_dir) / f"oisst_{year}.nc"
    if not path.exists():
        return None
    with xr.open_dataset(path) as ds:
        sst = ds["sst"].squeeze("zlev", drop=True).load()
    return _day(sst["time"].values), sst["latitude"].values, sst["longitude"].values, sst.values


@lru_cache(maxsize=4)
def _load_wind(year: int, env_dir: Path):
    pu, pv = Path(env_dir) / f"ncep_uwnd_{year}.nc", Path(env_dir) / f"ncep_vwnd_{year}.nc"
    if not (pu.exists() and pv.exists()):
        return None
    with xr.open_dataset(pu) as du, xr.open_dataset(pv) as dv:
        u, v = du["uwnd"].load(), dv["vwnd"].load()  # (time, level[850,200], lat desc, lon)
    return _day(u["time"].values), u["lat"].values, u["lon"].values, u.values, v.values


class EnvFields:
    def __init__(self, env_dir: Path = ENV_DIR):
        self.dir = env_dir

    # ── SST ────────────────────────────────────────────────────────────────
    def _sst_year(self, year: int, t, lat, lon) -> np.ndarray:
        out = np.full(len(t), np.nan)
        loaded = _load_sst(year, self.dir)
        if loaded is None:
            return out
        days, glat, glon, field = loaded

        di = _nearest_day(days, _day(t), SST_MAX_GAP_DAYS)
        fi = (lat - glat[0]) / (glat[1] - glat[0])
        fj = (lon - glon[0]) / (glon[1] - glon[0])
        i0, j0 = np.floor(fi).astype(int), np.floor(fj).astype(int)
        ok = (di >= 0) & (i0 >= 0) & (i0 < len(glat) - 1) & (j0 >= 0) & (j0 < len(glon) - 1)
        for n in np.where(ok)[0]:
            wi, wj = fi[n] - i0[n], fj[n] - j0[n]
            vals = field[di[n], i0[n] : i0[n] + 2, j0[n] : j0[n] + 2]
            w = np.array([[(1 - wi) * (1 - wj), (1 - wi) * wj], [wi * (1 - wj), wi * wj]])
            valid = ~np.isnan(vals)
            if w[valid].sum() >= 0.5:  # mostly over water; renormalise over the wet corners
                out[n] = float((vals[valid] * w[valid]).sum() / w[valid].sum())
        return out

    # ── Shear ──────────────────────────────────────────────────────────────
    def _shear_year(self, year: int, t, lat, lon) -> np.ndarray:
        out = np.full(len(t), np.nan)
        loaded = _load_wind(year, self.dir)
        if loaded is None:
            return out
        days, glat, glon, uu, vv = loaded
        di = _nearest_day(days, _day(t), WIND_MAX_GAP_DAYS)
        for n in np.where(di >= 0)[0]:
            la = np.where(np.abs(glat - lat[n]) <= SHEAR_BOX_DEG)[0]
            lo = np.where(np.abs(glon - lon[n]) <= SHEAR_BOX_DEG)[0]
            if len(la) < 2 or len(lo) < 2:
                continue
            box = np.ix_(la, lo)
            u850, u200 = np.nanmean(uu[di[n], 0][box]), np.nanmean(uu[di[n], 1][box])
            v850, v200 = np.nanmean(vv[di[n], 0][box]), np.nanmean(vv[di[n], 1][box])
            out[n] = float(np.hypot(u200 - u850, v200 - v850))
        return out

    # ── public ─────────────────────────────────────────────────────────────
    def sample(self, t: np.ndarray, lat: np.ndarray, lon: np.ndarray):
        """-> (sst_c, shear_ms), each shape (N,), NaN wherever a field is unavailable."""
        t, lat, lon = np.asarray(t), np.asarray(lat, float), np.asarray(lon, float)
        sst = np.full(len(t), np.nan)
        shear = np.full(len(t), np.nan)
        years = t.astype("datetime64[Y]").astype(int) + 1970
        for year in np.unique(years):
            m = years == year
            sst[m] = self._sst_year(int(year), t[m], lat[m], lon[m])
            shear[m] = self._shear_year(int(year), t[m], lat[m], lon[m])
        return sst, shear
