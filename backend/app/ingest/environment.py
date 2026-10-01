"""Download and cache the environmental fields used as model inputs.

    python -m app.ingest.environment                 # 1980 - current year, resumable
    python -m app.ingest.environment --years 2023    # one year (or 2000-2005)

Free, no-login sources (ERA5 itself needs a Copernicus account, so it is not used here):
  * SST   NOAA OISST v2.1 daily, 0.25 deg (stored at 0.5 deg), via NOAA CoastWatch ERDDAP. From Sep 1981.
  * Winds NCEP/NCAR Reanalysis 1 daily means (2.5 deg) of u/v at 850 and 200 hPa, from NOAA PSL.
          Each year's file is ~150 MB; only the 850/200 hPa slice over the North Indian Ocean is kept.

Cached under backend/data/raw/env/ (git-ignored). Safe to re-run; finished years are skipped, and the
current (still growing) year is refreshed when older than 3 days.
"""

import argparse
import shutil
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import xarray as xr

ENV_DIR = Path(__file__).resolve().parents[2] / "data" / "raw" / "env"

# Region kept on disk (generous margin around the model domain lat -5..35, lon 40..110).
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = -10.0, 40.0, 35.0, 115.0
FIRST_SST_YEAR = 1982  # OISST starts 1 Sep 1981

ERDDAP = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ncdcOisst21Agg_LonPM180.nc"
PSL = "https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.dailyavgs/pressure/{var}.{year}.nc"


def sst_path(year: int) -> Path:
    return ENV_DIR / f"oisst_{year}.nc"


def wind_path(var: str, year: int) -> Path:
    return ENV_DIR / f"ncep_{var}_{year}.nc"


def _fresh(path: Path, year: int) -> bool:
    if not path.exists() or path.stat().st_size < 10_000:
        return False
    if year < datetime.now(timezone.utc).year:
        return True
    return time.time() - path.stat().st_mtime < 3 * 86400


def _retrying(fn, what: str, tries: int = 6):
    for attempt in range(1, tries + 1):
        try:
            return fn()
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
            wait = min(90, 5 * 2**attempt)
            print(f"  ! {what}: {exc} (attempt {attempt}/{tries}); retrying in {wait}s", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"giving up on {what}")


def _download(url: str, dest: Path, timeout: int = 180) -> None:
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url, timeout=timeout) as resp, open(tmp, "wb") as out:
        shutil.copyfileobj(resp, out, length=1 << 20)
    tmp.replace(dest)


def fetch_sst(year: int) -> str:
    dest = sst_path(year)
    if _fresh(dest, year):
        return f"SST   {year}: cached"
    end = "last" if year >= datetime.now(timezone.utc).year else f"{year}-12-31T12:00:00Z"
    time_sel = f"({year}-01-01T12:00:00Z):1:({end})"
    query = f"sst[{time_sel}][(0.0):1:(0.0)][({LAT_MIN + 5}):2:({LAT_MAX - 5})][({LON_MIN + 5}):2:({LON_MAX - 5})]"
    url = f"{ERDDAP}?{urllib.request.quote(query, safe='[]():,-')}"
    t0 = time.time()
    _retrying(lambda: _download(url, dest), f"SST {year}")
    return f"SST   {year}: {dest.stat().st_size / 1e6:.1f} MB in {time.time() - t0:.0f}s"


def fetch_wind(var: str, year: int) -> str:
    dest = wind_path(var, year)
    if _fresh(dest, year):
        return f"{var:<5} {year}: cached"
    big = ENV_DIR / f"_tmp_{var}_{year}.nc"
    t0 = time.time()
    _retrying(lambda: _download(PSL.format(var=var, year=year), big, timeout=300), f"{var} {year}")
    with xr.open_dataset(big) as ds:
        sub = ds[var].sel(level=[850, 200], lat=slice(LAT_MAX, LAT_MIN), lon=slice(LON_MIN, LON_MAX)).load()
    sub.to_dataset(name=var).to_netcdf(dest)
    big.unlink(missing_ok=True)
    return f"{var:<5} {year}: kept {dest.stat().st_size / 1e6:.1f} MB (from a big file) in {time.time() - t0:.0f}s"


def _run(label: str, jobs):
    for fn, args in jobs:
        try:
            print(f"[{label}] {fn(*args)}", flush=True)
        except Exception as exc:  # keep going; a re-run fills the gaps
            print(f"[{label}] FAILED {args}: {exc}", flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--years", default=f"1980-{datetime.now(timezone.utc).year}", help="e.g. 2023 or 1990-2005")
    args = ap.parse_args()
    lo, _, hi = args.years.partition("-")
    years = range(int(lo), int(hi or lo) + 1)

    ENV_DIR.mkdir(parents=True, exist_ok=True)
    sst_jobs = [(fetch_sst, (y,)) for y in years if y >= FIRST_SST_YEAR]
    u_jobs = [(fetch_wind, ("uwnd", y)) for y in years]
    v_jobs = [(fetch_wind, ("vwnd", y)) for y in years]
    # Three sequential streams: SST (ERDDAP), and u / v winds (PSL, so at most two requests at once).
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(lambda a: _run(*a), [("sst", sst_jobs), ("u", u_jobs), ("v", v_jobs)]))
    print("Done.", flush=True)


if __name__ == "__main__":
    main()
