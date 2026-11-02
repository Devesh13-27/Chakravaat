"""Turn the IBTrACS archive in PostGIS into supervised (history window -> future) samples."""

from dataclasses import dataclass, replace

import numpy as np
from sqlalchemy import text

from .. import db
from .env import EnvFields
from .geo import to_km

STEP_H = 6  # fixes are used on the 6-hourly synoptic grid (00/06/12/18 UTC)
HIST_STEPS = 6  # 36 h of history per sample
LEADS = [1, 2, 4, 8]  # forecast leads in steps -> +6, +12, +24, +48 h
LEAD_HOURS = [s * STEP_H for s in LEADS]

# Season-based split: nothing from a later period is ever seen in training.
TRAIN_SEASONS = (1980, 2015)  # satellite era; earlier positions are too uncertain to learn from
VAL_SEASONS = (2016, 2018)
TEST_SEASONS = (2019, 2100)

# Official-agency intensities only (IMD / the WMO-designated agency). JTWC ('usa') winds are 1-minute
# averages, not comparable with IMD's 3-minute winds, so they are excluded rather than mixed.
OFFICIAL_SOURCES = ("wmo", "newdelhi")

# North Indian Ocean domain. The IBTrACS NI file also contains storms from neighbouring basins that
# only grazed the region; a sample is kept only if its last observed fix lies inside this box.
REGION = {"lat": (-5.0, 35.0), "lon": (40.0, 110.0)}

BASE_FEATURES = 10  # position, motion, wind, pressure, season  (the 'no environment' model)
N_FEATURES = 14  # + SST, shear and a known-flag for each

FIXES_SQL_TEMPLATE = (
    """
    SELECT p.sid, s.season, p.observed_at,
           ST_Y(p.geom) AS lat, ST_X(p.geom) AS lon,
           CASE WHEN p.wind_source = ANY(:official) THEN p.wind_kt END AS wind,
           CASE WHEN p.pressure_source = ANY(:official) THEN p.pressure_hpa END AS pres
    FROM historical_track_points p
    JOIN historical_storms s USING (sid)
    WHERE p.track_type IN ('main', 'PROVISIONAL', 'US-PROVISIONAL')
      AND date_part('minute', p.observed_at) = 0
      AND date_part('hour', p.observed_at)::int % :step = 0
      {sid_filter}
    ORDER BY p.sid, p.observed_at
    """
)


@dataclass
class Samples:
    x: np.ndarray  # (N, H, F) model inputs
    win_lat: np.ndarray  # (N, H) raw history, for the baselines
    win_lon: np.ndarray
    win_wind: np.ndarray  # NaN where unknown
    win_sst: np.ndarray  # (N, H) deg C at each history fix, NaN where unknown (e.g. over land)
    win_shear: np.ndarray  # (N, H) 200-850 hPa shear in m/s, NaN where unknown
    tgt_lat: np.ndarray  # (N, L) truth at each lead, NaN where unavailable
    tgt_lon: np.ndarray
    tgt_wind: np.ndarray
    sid: np.ndarray  # (N,)
    season: np.ndarray
    time: np.ndarray  # (N,) datetime64[h] of the last observed fix

    @property
    def lat0(self):
        return self.win_lat[:, -1]

    @property
    def lon0(self):
        return self.win_lon[:, -1]

    @property
    def wind0(self):
        return self.win_wind[:, -1]

    @property
    def sst0(self):
        return self.win_sst[:, -1]

    @property
    def shear0(self):
        return self.win_shear[:, -1]

    def __len__(self):
        return len(self.sid)

    def with_features(self, n: int) -> "Samples":
        """Same samples exposing only the first n input features (n=BASE_FEATURES drops the environment)."""
        return replace(self, x=self.x[..., :n])

    def subset(self, mask: np.ndarray) -> "Samples":
        return Samples(**{k: getattr(self, k)[mask] for k in self.__dataclass_fields__})


def load_fixes(sid: str | None = None) -> dict:
    """6-hourly main-track fixes from PostGIS, for every storm or just one."""
    if db.engine is None:
        raise SystemExit("DATABASE_URL is not set (see backend/.env.example)")
    query = text(FIXES_SQL_TEMPLATE.format(sid_filter="AND p.sid = :sid" if sid else ""))
    params = {"official": list(OFFICIAL_SOURCES), "step": STEP_H}
    if sid:
        params["sid"] = sid
    with db.engine.connect() as conn:
        rows = conn.execute(query, params).all()

    storms: dict[str, dict] = {}
    for sid, season, t, lat, lon, wind, pres in rows:
        d = storms.setdefault(sid, {"season": season, "t": [], "lat": [], "lon": [], "wind": [], "pres": []})
        d["t"].append(np.datetime64(t.replace(tzinfo=None), "h"))
        d["lat"].append(lat)
        d["lon"].append(lon)
        d["wind"].append(np.nan if wind is None else wind)
        d["pres"].append(np.nan if pres is None else pres)
    attach_environment(storms)
    return storms


def attach_environment(storms: dict) -> None:
    """Add per-fix SST and shear (NaN where the cached fields don't cover a fix)."""
    sids = list(storms)
    t = np.concatenate([storms[s]["t"] for s in sids])
    lat = np.concatenate([storms[s]["lat"] for s in sids])
    lon = np.concatenate([storms[s]["lon"] for s in sids])
    sst, shear = EnvFields().sample(t, lat, lon)
    start = 0
    for sid in sids:
        n = len(storms[sid]["t"])
        storms[sid]["sst"] = sst[start : start + n].tolist()
        storms[sid]["shear"] = shear[start : start + n].tolist()
        start += n


def _grid(d: dict):
    """Place a storm's fixes on a regular 6 h grid, NaN where a fix is missing."""
    t = np.array(d["t"])
    idx = ((t - t[0]) / np.timedelta64(STEP_H, "h")).astype(int)
    n = idx[-1] + 1
    out = {}
    for key in ("lat", "lon", "wind", "pres", "sst", "shear"):
        arr = np.full(n, np.nan)
        arr[idx] = d.get(key, [np.nan] * len(idx))
        out[key] = arr
    return t[0], out


def _features(lat, lon, wind, pres, sst, shear, t_hours):
    """(H, F) feature block for one window. Missing wind/pressure -> 0 plus an explicit mask flag."""
    dlat = np.concatenate([[0.0], np.diff(lat)])
    dlon = np.concatenate([[0.0], np.diff(lon)])
    wmask = ~np.isnan(wind)
    pmask = ~np.isnan(pres)
    smask = ~np.isnan(sst)
    hmask = ~np.isnan(shear)
    doy = (t_hours.astype("datetime64[D]") - t_hours.astype("datetime64[Y]").astype("datetime64[D]")).astype(float)
    ang = 2 * np.pi * doy / 365.25
    return np.stack(
        [
            lat / 30.0,
            (lon - 80.0) / 30.0,
            dlat,
            dlon,
            np.where(wmask, wind, 0.0) / 100.0,
            wmask.astype(float),
            np.where(pmask, pres - 1000.0, 0.0) / 50.0,
            pmask.astype(float),
            np.sin(ang),
            np.cos(ang),
            np.where(smask, sst - 28.0, 0.0) / 3.0,  # warm-water supply, centred on 28 C
            smask.astype(float),
            np.where(hmask, shear, 0.0) / 10.0,  # 10 m/s ~ the usual "hostile" shear threshold
            hmask.astype(float),
        ],
        axis=1,
    )


def build_samples(storms: dict | None = None, require_targets: bool = True) -> Samples:
    storms = storms if storms is not None else load_fixes()
    cols = {k: [] for k in ("x", "win_lat", "win_lon", "win_wind", "win_sst", "win_shear", "tgt_lat", "tgt_lon", "tgt_wind", "sid", "season", "time")}
    h, max_lead = HIST_STEPS, max(LEADS)

    for sid, d in storms.items():
        if len(d["t"]) < h:
            continue
        t0, g = _grid(d)
        n = len(g["lat"])
        for i in range(h - 1, n):
            win = slice(i - h + 1, i + 1)
            if np.isnan(g["lat"][win]).any():  # need an unbroken position history
                continue
            if not (
                REGION["lat"][0] <= g["lat"][i] <= REGION["lat"][1]
                and REGION["lon"][0] <= g["lon"][i] <= REGION["lon"][1]
            ):
                continue
            targets = [i + s for s in LEADS]
            tl = np.array([g["lat"][j] if j < n else np.nan for j in targets])
            if require_targets and np.isnan(tl).all():  # nothing to learn from
                continue
            t_hours = t0 + np.arange(i - h + 1, i + 1) * np.timedelta64(STEP_H, "h")
            cols["x"].append(_features(g["lat"][win], g["lon"][win], g["wind"][win], g["pres"][win], g["sst"][win], g["shear"][win], t_hours))
            cols["win_lat"].append(g["lat"][win])
            cols["win_lon"].append(g["lon"][win])
            cols["win_wind"].append(g["wind"][win])
            cols["win_sst"].append(g["sst"][win])
            cols["win_shear"].append(g["shear"][win])
            cols["tgt_lat"].append(tl)
            cols["tgt_lon"].append(np.array([g["lon"][j] if j < n else np.nan for j in targets]))
            cols["tgt_wind"].append(np.array([g["wind"][j] if j < n else np.nan for j in targets]))
            cols["sid"].append(sid)
            cols["season"].append(d["season"])
            cols["time"].append(t_hours[-1])

    return Samples(
        x=np.array(cols["x"], dtype=np.float32),
        win_lat=np.array(cols["win_lat"]),
        win_lon=np.array(cols["win_lon"]),
        win_wind=np.array(cols["win_wind"]),
        win_sst=np.array(cols["win_sst"]),
        win_shear=np.array(cols["win_shear"]),
        tgt_lat=np.array(cols["tgt_lat"]),
        tgt_lon=np.array(cols["tgt_lon"]),
        tgt_wind=np.array(cols["tgt_wind"]),
        sid=np.array(cols["sid"]),
        season=np.array(cols["season"]),
        time=np.array(cols["time"]),
    )


def split(samples: Samples) -> dict[str, Samples]:
    def pick(lo, hi):
        return samples.subset((samples.season >= lo) & (samples.season <= hi))

    return {"train": pick(*TRAIN_SEASONS), "val": pick(*VAL_SEASONS), "test": pick(*TEST_SEASONS)}


def track_targets_km(s: Samples) -> np.ndarray:
    """(N, L, 2) true (east, north) displacement in km from the last fix; NaN where unavailable."""
    east, north = to_km(s.lat0[:, None], s.lon0[:, None], s.tgt_lat, s.tgt_lon)
    return np.stack([east, north], axis=-1)


def wind_targets(s: Samples) -> np.ndarray:
    """(N, L) wind change in kt relative to the last fix; NaN unless both ends are known."""
    return s.tgt_wind - s.wind0[:, None]


def split_of_season(season: int) -> str:
    """Which role a storm's season played: 'train', 'val' (used for tuning/calibration), 'test' or 'outside'."""
    for name, (lo, hi) in (("train", TRAIN_SEASONS), ("val", VAL_SEASONS), ("test", TEST_SEASONS)):
        if lo <= season <= hi:
            return name
    return "outside"
