"""Download ERA5 (Copernicus CDS) fields for the North Indian Ocean and cache a compact copy per year.

Needs a free Copernicus account; see RUNNING.txt ("ERA5 setup"). Typical use:

    python -m app.ingest.era5 --check                       # verify credentials + request format, download nothing
    python -m app.ingest.era5 --years 2023 --months 6       # one small test download
    python -m app.ingest.era5                               # 1990 - now (long: requests queue at Copernicus)

Fetched (6-hourly 00/06/12/18 UTC, area N40 W35 S-10 E115):
  * pressure levels 850/700/200 hPa: u, v wind and relative humidity  -> era5_pl_YYYY.nc
      kept: u850 v850 u200 v200 rh700 (for deep-layer shear and mid-level moisture), regridded to 1 degree
  * single level: sea_surface_temperature -> era5_sst_YYYY.nc  (deg C, regridded to 0.5 degree)

Raw downloads are deleted after the compact copy is written. Resumable: finished years are skipped.
"""

import argparse
import shutil
import time
import urllib.request
import json
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import xarray as xr

from .environment import ENV_DIR

AREA = [40, 35, -10, 115]  # N, W, S, E (CDS order)
TIMES = ["00:00", "06:00", "12:00", "18:00"]
PL_DATASET = "reanalysis-era5-pressure-levels"
SL_DATASET = "reanalysis-era5-single-levels"
PL_VARS = ["u_component_of_wind", "v_component_of_wind", "relative_humidity"]
PL_LEVELS = ["200", "700", "850"]
PL_GRID = [1.0, 1.0]
SST_GRID = [0.5, 0.5]
FIRST_YEAR = 1990  # intensity labels for this basin are sparse earlier
CATALOGUE = "https://cds.climate.copernicus.eu/api/catalogue/v1/collections/{ds}/form.json"

SETUP_HELP = """No Copernicus CDS credentials found. One-time setup (about 5 minutes, free):
  1. Register at https://cds.climate.copernicus.eu  (sign in / create account).
  2. Open https://cds.climate.copernicus.eu/how-to-api and copy your personal access token (the 'key' line).
  3. Accept the dataset licence ONCE on each of these pages (scroll to 'Terms of use' and click Accept):
       https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels?tab=download
       https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels?tab=download
  4. Create the file  C:\\Users\\<you>\\.cdsapirc  containing exactly these two lines:
       url: https://cds.climate.copernicus.eu/api
       key: <your-personal-access-token>
  (Keep the token out of git and out of chat; this file lives in your home folder, not the repo.)
Then re-run this command."""


def pl_path(year: int) -> Path:
    return ENV_DIR / f"era5_pl_{year}.nc"


def sst_path(year: int) -> Path:
    return ENV_DIR / f"era5_sst_{year}.nc"


# ── requests ───────────────────────────────────────────────────────────────


def months_for(year: int, wanted: list[int] | None) -> list[int]:
    now = datetime.now(timezone.utc)
    if wanted:
        return wanted
    if year < now.year:
        return list(range(1, 13))
    return list(range(1, now.month))  # ERA5 lags ~5 days; skip the in-progress month


def build_request(kind: str, year: int, months: list[int]) -> tuple[str, dict]:
    base = {
        "product_type": ["reanalysis"],
        "year": [str(year)],
        "month": [f"{m:02d}" for m in months],
        "day": [f"{d:02d}" for d in range(1, 32)],  # invalid day/month combinations are ignored by CDS
        "time": TIMES,
        "area": AREA,
        "data_format": "netcdf",
        "download_format": "unarchived",
    }
    if kind == "pl":
        return PL_DATASET, {**base, "variable": PL_VARS, "pressure_level": PL_LEVELS, "grid": PL_GRID}
    return SL_DATASET, {**base, "variable": ["sea_surface_temperature"], "grid": SST_GRID}


def validate_against_catalogue(dataset: str, request: dict) -> list[str]:
    """Compare the request with the public CDS form (no login). Returns a list of problems (empty = OK)."""
    try:
        with urllib.request.urlopen(CATALOGUE.format(ds=dataset), timeout=45) as resp:
            form = json.load(resp)
    except Exception as exc:  # offline / catalogue change: warn, don't block
        return [f"could not read the catalogue for {dataset}: {exc}"]

    allowed = {}
    for w in form:
        d = w.get("details", {})
        vals = d.get("values") or [v for g in d.get("groups", []) for v in g.get("values", [])]
        if vals:
            allowed[w["name"]] = set(map(str, vals))
    problems = []
    for key in ("variable", "pressure_level", "year", "time", "product_type"):
        if key in request and key in allowed:
            bad = [v for v in request[key] if str(v) not in allowed[key]]
            if bad:
                problems.append(f"{dataset}: {key} has unsupported values {bad}")
    for key in ("area", "data_format", "download_format"):
        if key in request and key not in {w["name"] for w in form}:
            problems.append(f"{dataset}: catalogue has no '{key}' option (API may have changed)")
    return problems


# ── credentials ────────────────────────────────────────────────────────────


def have_credentials() -> bool:
    import os

    return (Path.home() / ".cdsapirc").exists() or bool(os.environ.get("CDSAPI_KEY"))


# ── file handling ──────────────────────────────────────────────────────────


def _normalise(ds: xr.Dataset) -> xr.Dataset:
    """Smooth over CDS file-layout variants (new valid_time / pressure_level names, ERA5T expver)."""
    rename = {k: v for k, v in {"valid_time": "time", "pressure_level": "level", "lat": "latitude", "lon": "longitude"}.items() if k in ds.dims or k in ds.coords}
    ds = ds.rename(rename)
    if "expver" in ds.dims:  # recent months mix ERA5 (1) and ERA5T (5); take whichever exists
        ds = ds.sel(expver=1).combine_first(ds.sel(expver=5))
    return ds.drop_vars([v for v in ("number", "expver") if v in ds.coords])


def load_download(path: Path) -> xr.Dataset:
    """Open a CDS download whether it is a single NetCDF or a zip of several."""
    if zipfile.is_zipfile(path):
        tmp = path.parent / (path.name + ".unz")
        tmp.mkdir(exist_ok=True)
        try:
            with zipfile.ZipFile(path) as z:
                z.extractall(tmp)
            parts = []
            for f in sorted(tmp.glob("*.nc")):
                with xr.open_dataset(f) as d:
                    parts.append(d.load())
            ds = xr.merge(parts, compat="override")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    else:
        with xr.open_dataset(path) as d:
            ds = d.load()
    return _normalise(ds)


def _compress(ds: xr.Dataset, dest: Path) -> None:
    enc = {v: {"zlib": True, "complevel": 4, "dtype": "float32"} for v in ds.data_vars}
    tmp = dest.with_suffix(".part")
    ds.to_netcdf(tmp, encoding=enc)
    tmp.replace(dest)


def compact_pl(raw: Path, dest: Path) -> None:
    ds = load_download(raw)
    missing = [v for v in ("u", "v", "r") if v not in ds]
    if missing:
        raise ValueError(f"unexpected pressure-level variables {list(ds.data_vars)} (missing {missing})")
    out = xr.Dataset(
        {
            "u850": ds["u"].sel(level=850, drop=True),  # drop=True: no leftover scalar 'level' to conflict
            "v850": ds["v"].sel(level=850, drop=True),
            "u200": ds["u"].sel(level=200, drop=True),
            "v200": ds["v"].sel(level=200, drop=True),
            "rh700": ds["r"].sel(level=700, drop=True),
        }
    )
    _compress(out, dest)


def compact_sst(raw: Path, dest: Path) -> None:
    ds = load_download(raw)
    if "sst" not in ds:
        raise ValueError(f"unexpected single-level variables {list(ds.data_vars)}")
    out = xr.Dataset({"sst": (ds["sst"] - 273.15).assign_attrs(units="degC")})
    _compress(out, dest)


# ── download ───────────────────────────────────────────────────────────────


class FatalCDSError(RuntimeError):
    """Problems retrying cannot fix (bad credentials, licence not accepted)."""


def _fresh(dest: Path, year: int) -> bool:
    if not dest.exists() or dest.stat().st_size < 10_000:
        return False
    if year < datetime.now(timezone.utc).year:
        return True
    return time.time() - dest.stat().st_mtime < 14 * 86400


def fetch(kind: str, year: int, months: list[int] | None, client_factory) -> str:
    dest = pl_path(year) if kind == "pl" else sst_path(year)
    if months is None and _fresh(dest, year):
        return f"{kind:<3} {year}: cached"
    dataset, request = build_request(kind, year, months_for(year, months))
    raw = ENV_DIR / f"_raw_era5_{kind}_{year}.nc"
    t0 = time.time()
    for attempt in range(1, 4):
        try:
            client_factory().retrieve(dataset, request, str(raw))
            break
        except Exception as exc:
            text = str(exc).lower()
            if any(s in text for s in ("licence", "license", "401", "403", "unauthorized", "forbidden", "not authenticated")):
                raise FatalCDSError(
                    f"{dataset}: {exc}\n  Check the token in ~/.cdsapirc and that you accepted the dataset licence (see --check)."
                ) from exc
            wait = 30 * attempt
            print(f"  ! {kind} {year}: {exc} (attempt {attempt}/3); retrying in {wait}s", flush=True)
            time.sleep(wait)
    else:
        raise RuntimeError(f"giving up on {kind} {year}")
    try:
        (compact_pl if kind == "pl" else compact_sst)(raw, dest)
    finally:
        raw.unlink(missing_ok=True)
    return f"{kind:<3} {year}: {dest.stat().st_size / 1e6:.1f} MB kept in {time.time() - t0:.0f}s"


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--years", default=f"{FIRST_YEAR}-{datetime.now(timezone.utc).year}", help="e.g. 2023 or 1990-2005")
    ap.add_argument("--months", default="", help="comma list for a small test, e.g. 6 or 5,6 (output is then marked partial)")
    ap.add_argument("--workers", type=int, default=3, help="requests in flight at once (Copernicus queues them)")
    ap.add_argument("--check", action="store_true", help="verify credentials and request format; download nothing")
    ap.add_argument("--dry-run", action="store_true", help="print the requests that would be sent")
    args = ap.parse_args()

    lo, _, hi = args.years.partition("-")
    years = list(range(int(lo), int(hi or lo) + 1))
    months = [int(m) for m in args.months.split(",") if m] or None

    if args.check or args.dry_run:
        for kind in ("pl", "sst"):
            ds, req = build_request("pl" if kind == "pl" else "sl", years[0], months_for(years[0], months))
            problems = validate_against_catalogue(ds, req)
            print(f"[{ds}] request check: " + ("OK, every variable/level/year/time option exists in the live catalogue" if not problems else "; ".join(problems)))
            if args.dry_run:
                print(json.dumps(req, indent=2))
        print(f"credentials: {'found' if have_credentials() else 'MISSING'}")
        if not have_credentials():
            print("\n" + SETUP_HELP)
        return

    if not have_credentials():
        raise SystemExit(SETUP_HELP)
    import cdsapi

    ENV_DIR.mkdir(parents=True, exist_ok=True)
    jobs = [(kind, y) for y in years for kind in ("pl", "sl")]

    def run(job):
        kind, year = job
        k = "pl" if kind == "pl" else "sst"
        try:
            print(f"[era5] {fetch(k, year, months, lambda: cdsapi.Client(quiet=True))}", flush=True)
        except FatalCDSError as exc:
            print(f"[era5] FATAL {exc}", flush=True)
            raise
        except Exception as exc:
            print(f"[era5] FAILED {kind} {year}: {exc}", flush=True)

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        list(pool.map(run, jobs))
    print("Done.", flush=True)


if __name__ == "__main__":
    main()
