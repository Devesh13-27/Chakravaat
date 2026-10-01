"""Train the GRU forecaster ensemble and evaluate it honestly against baselines.

    python -m app.ml.train            # full run (grid search + 5-member ensemble)
    python -m app.ml.train --quick    # fast smoke run

The deployed model is a fixed 50/50 blend of the GRU ensemble and a ridge regression. Evaluation uses
seasons the model never saw (see data.py) and compares against persistence, constant-velocity
extrapolation, ridge and the GRU alone. Confidence intervals resample whole storms.
"""

import argparse
import copy
import json
import platform
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
from sqlalchemy import text
from torch import nn
from torch.nn import functional as F

from .. import db
from . import data
from .baselines import (
    Ridge,
    constant_velocity_km,
    persistence_track_km,
    track_error_km,
    wind_error_kt,
)
from .data import LEAD_HOURS, LEADS, Samples, track_targets_km, wind_targets
from .geo import from_km, haversine_km
from .infer import TRACK_SCALE, WIND_SCALE, blend, ensemble_predict, ridge_predict
from .model import GRUForecaster

ARTIFACTS = Path(__file__).resolve().parents[2] / "artifacts"
CASE_STORMS = [("BIPARJOY", 2023), ("MOCHA", 2023)]


# ── data preparation ─────────────────────────────────────────────────────────


def prepare(s: Samples) -> dict:
    base = constant_velocity_km(s, 2)  # the model learns a correction to this
    resid = track_targets_km(s) - base
    dw = wind_targets(s)
    return {
        "base": base,
        "x": torch.from_numpy(s.x),
        "y_tr": torch.tensor(np.nan_to_num(resid / TRACK_SCALE), dtype=torch.float32),
        "m_tr": torch.tensor(~np.isnan(resid[..., 0]), dtype=torch.float32),
        "y_w": torch.tensor(np.nan_to_num(dw / WIND_SCALE), dtype=torch.float32),
        "m_w": torch.tensor(~np.isnan(dw), dtype=torch.float32),
    }


def masked_loss(track, wind, y_tr, m_tr, y_w, m_w):
    lt = F.smooth_l1_loss(track, y_tr, reduction="none").sum(-1)
    lw = F.smooth_l1_loss(wind, y_w, reduction="none")
    return (lt * m_tr).sum() / m_tr.sum().clamp(min=1) + (lw * m_w).sum() / m_w.sum().clamp(min=1)


# ── GRU training ─────────────────────────────────────────────────────────────


def train_member(seed, hidden, weight_decay, tr, va, epochs, patience, batch=128, lr=2e-3):
    torch.manual_seed(seed)
    gen = torch.Generator().manual_seed(seed)
    model = GRUForecaster(tr["x"].shape[-1], len(LEADS), hidden=hidden)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    best_val, best_state, best_ep, bad = float("inf"), None, 0, 0
    n = len(tr["x"])

    for ep in range(1, epochs + 1):
        model.train()
        perm = torch.randperm(n, generator=gen)
        for i in range(0, n, batch):
            idx = perm[i : i + batch]
            track, wind = model(tr["x"][idx])
            loss = masked_loss(track, wind, tr["y_tr"][idx], tr["m_tr"][idx], tr["y_w"][idx], tr["m_w"][idx])
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()

        model.eval()
        with torch.no_grad():
            track, wind = model(va["x"])
            v = masked_loss(track, wind, va["y_tr"], va["m_tr"], va["y_w"], va["m_w"]).item()
        if v < best_val - 1e-5:
            best_val, best_state, best_ep, bad = v, copy.deepcopy(model.state_dict()), ep, 0
        else:
            bad += 1
            if bad >= patience:
                break
    return best_val, best_state, best_ep


# ── ridge baseline ───────────────────────────────────────────────────────────


def ridge_targets(p: dict):
    n = len(p["x"])
    y = np.concatenate([p["y_tr"].numpy().reshape(n, -1) * TRACK_SCALE, p["y_w"].numpy() * WIND_SCALE], axis=1)
    m = np.concatenate([np.repeat(p["m_tr"].numpy(), 2, axis=1), p["m_w"].numpy()], axis=1).astype(bool)
    return y, m


# ── statistics ───────────────────────────────────────────────────────────────


def cluster_bootstrap_ci(diff: np.ndarray, groups: np.ndarray, n_boot=2000, seed=0):
    """95% CI of mean(diff), resampling whole storms (samples within a storm are highly correlated)."""
    ok = ~np.isnan(diff)
    diff, groups = diff[ok], groups[ok]
    if len(diff) == 0:
        return float("nan"), float("nan"), float("nan")
    uniq, inv = np.unique(groups, return_inverse=True)
    sums = np.bincount(inv, weights=diff)
    cnts = np.bincount(inv).astype(float)
    pick = np.random.default_rng(seed).integers(0, len(uniq), size=(n_boot, len(uniq)))
    boot = sums[pick].sum(1) / cnts[pick].sum(1)
    return float(diff.mean()), float(np.percentile(boot, 2.5)), float(np.percentile(boot, 97.5))


def spearman(a: np.ndarray, b: np.ndarray) -> float:
    ok = ~(np.isnan(a) | np.isnan(b))
    if ok.sum() < 3:
        return float("nan")
    ra, rb = np.argsort(np.argsort(a[ok])), np.argsort(np.argsort(b[ok]))
    return float(np.corrcoef(ra, rb)[0, 1])


def calibrate(val_err: np.ndarray, test_err: np.ndarray, qs=(0.67, 0.90)) -> dict:
    """Error radius per lead = quantile of validation errors; coverage = share of unseen test errors inside it."""
    out = {}
    for q in qs:
        rad, cov = [], []
        for k in range(val_err.shape[1]):
            r = float(np.nanquantile(val_err[:, k], q))
            ok = np.isfinite(test_err[:, k])
            rad.append(r)
            cov.append(float((test_err[ok, k] <= r).mean()))
        out[str(q)] = {"radius": rad, "test_coverage": cov}
    return out


def nm(x):  # nan-safe mean
    return float(np.nanmean(x)) if np.isfinite(x).any() else float("nan")


# ── evaluation ───────────────────────────────────────────────────────────────


def evaluate(test: Samples, preds: dict) -> dict:
    """preds: method -> {'track': (N,L,2) km displacement, 'wind': (N,L) kt change}."""
    res = {"leads_h": LEAD_HOURS, "track": {}, "wind": {}, "n_samples": len(test), "n_storms": len(set(test.sid))}
    terr = {m: track_error_km(test, p["track"]) for m, p in preds.items() if "track" in p}
    werr = {m: wind_error_kt(test, p["wind"]) for m, p in preds.items() if "wind" in p}
    res["track"] = {
        m: {"mean_km": [nm(e[:, k]) for k in range(len(LEADS))], "median_km": [float(np.nanmedian(e[:, k])) for k in range(len(LEADS))],
            "n": [int(np.isfinite(e[:, k]).sum()) for k in range(len(LEADS))]}
        for m, e in terr.items()
    }
    res["wind"] = {
        m: {"mae_kt": [nm(e[:, k]) for k in range(len(LEADS))], "n": [int(np.isfinite(e[:, k]).sum()) for k in range(len(LEADS))]}
        for m, e in werr.items()
    }
    res["vs"] = {"track": {}, "wind": {}}
    for ref in ("const_vel_12h", "ridge", "gru"):
        res["vs"]["track"][ref] = [cluster_bootstrap_ci(terr["blend"][:, k] - terr[ref][:, k], test.sid) for k in range(len(LEADS))]
    for ref in ("persistence", "ridge", "gru"):
        res["vs"]["wind"][ref] = [cluster_bootstrap_ci(werr["blend"][:, k] - werr[ref][:, k], test.sid) for k in range(len(LEADS))]
    return res, terr, werr


def case_study(test: Samples, sid: str, preds: dict, spread_tr: np.ndarray) -> list[str]:
    rows = np.where(test.sid == sid)[0]
    full = [i for i in rows if not np.isnan(test.tgt_lat[i]).any()]
    if len(full) < 3:
        return [f"  (not enough samples for {sid})"]
    lines = []
    for q in (0.25, 0.5, 0.75):
        i = full[int(q * (len(full) - 1))]
        lat_p, lon_p = from_km(test.lat0[i], test.lon0[i], preds["blend"]["track"][i, :, 0], preds["blend"]["track"][i, :, 1])
        lat_c, lon_c = from_km(test.lat0[i], test.lon0[i], preds["const_vel_12h"]["track"][i, :, 0], preds["const_vel_12h"]["track"][i, :, 1])
        e_g = haversine_km(lat_p, lon_p, test.tgt_lat[i], test.tgt_lon[i])
        e_c = haversine_km(lat_c, lon_c, test.tgt_lat[i], test.tgt_lon[i])
        w0 = test.wind0[i]
        lines.append(f"  init {str(test.time[i])[:13]}Z at {test.lat0[i]:.1f}N {test.lon0[i]:.1f}E" + (f", wind {w0:.0f} kt" if not np.isnan(w0) else ", wind unknown"))
        for k in (2, 3):
            wtxt = ""
            if not np.isnan(w0) and not np.isnan(test.tgt_wind[i, k]):
                wtxt = f" | wind pred {w0 + preds['blend']['wind'][i, k]:.0f} vs actual {test.tgt_wind[i, k]:.0f} kt"
            lines.append(
                f"     +{LEAD_HOURS[k]}h: pred {lat_p[k]:.1f}N {lon_p[k]:.1f}E | actual {test.tgt_lat[i, k]:.1f}N {test.tgt_lon[i, k]:.1f}E"
                f" | error blend {e_g[k]:.0f} km (const-vel {e_c[k]:.0f}) +/-{spread_tr[i, k]:.0f} km spread{wtxt}"
            )
    return lines


def fmt_report(meta, ev, spear, member_stats, cases, cone, ab) -> str:
    L = []
    add = L.append
    add("CHAKRAVAAT - TRACK & INTENSITY FORECAST MODEL: EVALUATION REPORT")
    add("=" * 74)
    add(f"Trained: {meta['trained_at']}   |   data: {meta['source']}")
    add(f"Split by season (no overlap): train {meta['splits']['train']['seasons']} ({meta['splits']['train']['storms']} storms, {meta['splits']['train']['samples']} samples) | "
        f"val {meta['splits']['val']['seasons']} ({meta['splits']['val']['storms']} storms) | test {meta['splits']['test']['seasons']} ({meta['splits']['test']['storms']} storms, {meta['splits']['test']['samples']} samples)")
    add(f"Deployed model: 50/50 blend of a {meta['ensemble_size']}-member GRU ensemble and a ridge regression. GRU: hidden={meta['hidden']}, weight_decay={meta['weight_decay']}, ridge lambda={meta['ridge_lambda']}; inputs=last {data.HIST_STEPS * data.STEP_H} h of 6-hourly fixes")
    add(f"Intensity: official-agency winds only (IMD/WMO); trained and scored only where the storm's current wind is known.")
    add("")
    add("TRACK ERROR on the held-out test seasons, mean great-circle km (lower is better)")
    hdr = "lead     n  persistence  const-vel6h  const-vel12h        ridge          GRU  BLEND (deployed)"
    add(hdr)
    for k, h in enumerate(LEAD_HOURS):
        t = ev["track"]
        add(f"+{h:>2}h {t['gru']['n'][k]:>5}  {t['persistence']['mean_km'][k]:>11.0f}  {t['const_vel_6h']['mean_km'][k]:>11.0f}  {t['const_vel_12h']['mean_km'][k]:>12.0f}  {t['ridge']['mean_km'][k]:>11.0f}  {t['gru']['mean_km'][k]:>11.0f}  {t['blend']['mean_km'][k]:>16.0f}")
    add("")
    add("BLEND minus reference, mean km with 95% CI from resampling storms (negative = blend better)")
    for ref in ("const_vel_12h", "ridge", "gru"):
        for k, h in enumerate(LEAD_HOURS):
            m, lo, hi = ev["vs"]["track"][ref][k]
            verdict = "blend better" if hi < 0 else ("blend worse" if lo > 0 else "no clear difference")
            add(f"  vs {ref:<14} +{h:>2}h: {m:+7.1f} km  [{lo:+7.1f}, {hi:+7.1f}]  -> {verdict}")
    add("")
    add("INTENSITY ERROR on the held-out test seasons, mean absolute kt (lower is better)")
    add("lead     n  persistence        ridge          GRU  BLEND (deployed)")
    for k, h in enumerate(LEAD_HOURS):
        w = ev["wind"]
        add(f"+{h:>2}h {w['gru']['n'][k]:>5}  {w['persistence']['mae_kt'][k]:>11.1f}  {w['ridge']['mae_kt'][k]:>11.1f}  {w['gru']['mae_kt'][k]:>11.1f}  {w['blend']['mae_kt'][k]:>16.1f}")
    add("")
    add("BLEND minus reference, mean kt with 95% CI from resampling storms (negative = blend better)")
    for ref in ("persistence", "ridge", "gru"):
        for k, h in enumerate(LEAD_HOURS):
            m, lo, hi = ev["vs"]["wind"][ref][k]
            verdict = "blend better" if hi < 0 else ("blend worse" if lo > 0 else "no clear difference")
            add(f"  vs {ref:<12} +{h:>2}h: {m:+6.2f} kt  [{lo:+6.2f}, {hi:+6.2f}]  -> {verdict}")
    add("")
    for line in fmt_ab(ab):
        add(line)
    add("")
    add("UNCERTAINTY CONE: error radius per lead, set from validation-season errors, then checked on the unseen test seasons")
    add("  target 67% / 90% of true positions inside; 'got' is the share actually inside on the test seasons")
    for key, unit, fmt in (("track_km", "km", "{:>5.0f}"), ("wind_kt", "kt", "{:>5.1f}")):
        for q in ("0.67", "0.9"):
            c = cone[key][q]
            add(f"  {key[:-3]:<5} {int(float(q) * 100)}%: " + "   ".join(
                f"+{h}h " + fmt.format(c['radius'][k]) + f" {unit} (got {c['test_coverage'][k] * 100:.0f}%)" for k, h in enumerate(LEAD_HOURS)))
    add("")
    add("DIAGNOSTIC: rank correlation between raw ensemble spread and actual error (0 = spread says nothing, 1 = perfect).")
    add("  The cone above uses calibrated historical errors, not this spread.")
    add("  track: " + "  ".join(f"+{h}h {spear['track'][k]:+.2f}" for k, h in enumerate(LEAD_HOURS)))
    add("  wind:  " + "  ".join(f"+{h}h {spear['wind'][k]:+.2f}" for k, h in enumerate(LEAD_HOURS)))
    add("")
    add(f"TRAINING VARIANCE: single-member +24h track error across {meta['ensemble_size']} seeds = {member_stats['mean']:.0f} +/- {member_stats['std']:.0f} km")
    add("")
    for name, lines in cases.items():
        add(f"CASE STUDY - {name} (test seasons; model never trained on this storm)")
        L.extend(lines)
        add("")
    add("CAVEATS")
    add("  * Small data: a few hundred training storms. Treat differences inside the confidence intervals as noise.")
    add("  * Forecasts are issued from best-track positions (post-analysed), not real-time advisories, so real-time skill will be lower.")
    add("  * Environment inputs are coarse (SST 0.5 deg daily; shear from 2.5 deg daily reanalysis means), not ERA5; steering flow is not used.")
    add("  * Not an operational forecast; does not replace IMD advisories.")
    return "\n".join(L)


# ── main ─────────────────────────────────────────────────────────────────────


def fit_variant(name, n_feat, parts, grid, n_seeds, epochs, patience):
    """Train the full pipeline (GRU grid search + ensemble + ridge) on the first n_feat input features."""
    print(f"\n=== variant '{name}' ({n_feat} input features)")
    train, val = parts["train"].with_features(n_feat), parts["val"].with_features(n_feat)
    p_tr, p_va = prepare(train), prepare(val)

    scores = []
    for hidden, wd in grid:
        v, _, ep = train_member(100, hidden, wd, p_tr, p_va, epochs, patience)
        scores.append((v, hidden, wd))
        print(f"  grid hidden={hidden:<3} wd={wd:g}: val loss {v:.4f} (best epoch {ep})")
    _, hidden, wd = min(scores)
    print(f"  selected hidden={hidden}, weight_decay={wd:g}")

    states = []
    for seed in range(n_seeds):
        v, st, ep = train_member(seed, hidden, wd, p_tr, p_va, epochs, patience)
        states.append(st)
        print(f"  member {seed}: val loss {v:.4f} (best epoch {ep})")

    y_tr, m_tr = ridge_targets(p_tr)
    best = None
    for lam in (1, 10, 100, 1000, 10000):
        r = Ridge(lam).fit(train.x, y_tr, m_tr)
        t_pred, w_pred = ridge_predict(r, val, p_va["base"])
        score = nm(track_error_km(val, t_pred)) / TRACK_SCALE + nm(wind_error_kt(val, w_pred)) / WIND_SCALE
        if best is None or score < best[0]:
            best = (score, lam, r)
    print(f"  ridge lambda={best[1]}")
    return {"name": name, "n_feat": n_feat, "hidden": hidden, "wd": wd, "states": states, "ridge": best[2], "lam": best[1]}


def predict_variant(fit, s_full: Samples) -> dict:
    s = s_full.with_features(fit["n_feat"])
    base = constant_velocity_km(s, 2)
    tr_m, w_m = ensemble_predict(fit["states"], fit["hidden"], s, base)
    r_t, r_w = ridge_predict(fit["ridge"], s, base)
    b_t, b_w = blend(tr_m.mean(0), w_m.mean(0), r_t, r_w)
    return {"tr_members": tr_m, "w_members": w_m, "gru": (tr_m.mean(0), w_m.mean(0)), "ridge": (r_t, r_w), "blend": (b_t, b_w), "base": base}


def fmt_ab(ab: dict) -> list[str]:
    out = ["ENVIRONMENT INPUTS A/B: does adding sea-surface temperature + wind shear help? (same data, splits and method)"]
    out.append("  Inputs added: SST (NOAA OISST) and 200-850 hPa shear (NCEP/NCAR Reanalysis 1), each with a 'known' flag.")
    out.append(f"  Known at the forecast start on the test seasons: SST {ab['coverage']['sst'] * 100:.0f}%, shear {ab['coverage']['shear'] * 100:.0f}% (SST is unknown over land).")
    out.append(f"  Chosen on VALIDATION seasons only (lower is better): without {ab['val_score']['no_env']:.4f}  with {ab['val_score']['env']:.4f}  -> deployed: {'WITH environment' if ab['deployed'] == 'env' else 'WITHOUT environment'}")
    out.append("")
    out.append("  TRACK, mean km (blend)        without        with   with minus without [95% CI, storms resampled]")
    for k, h in enumerate(LEAD_HOURS):
        m, lo, hi = ab["diff_track"][k]
        verdict = "with env better" if hi < 0 else ("with env worse" if lo > 0 else "no clear difference")
        out.append(f"  +{h:>2}h {ab['n_track'][k]:>5}  {ab['track']['no_env'][k]:>13.0f}  {ab['track']['env'][k]:>10.0f}   {m:+6.1f} km [{lo:+6.1f}, {hi:+6.1f}]  -> {verdict}")
    out.append("")
    out.append("  INTENSITY, mean abs kt (blend) without        with   with minus without [95% CI, storms resampled]")
    for k, h in enumerate(LEAD_HOURS):
        m, lo, hi = ab["diff_wind"][k]
        verdict = "with env better" if hi < 0 else ("with env worse" if lo > 0 else "no clear difference")
        out.append(f"  +{h:>2}h {ab['n_wind'][k]:>5}  {ab['wind']['no_env'][k]:>13.1f}  {ab['wind']['env'][k]:>10.1f}   {m:+6.2f} kt [{lo:+6.2f}, {hi:+6.2f}]  -> {verdict}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="2 seeds, short training, no grid search")
    ap.add_argument("--seeds", type=int, default=5)
    ap.add_argument("--no-save", action="store_true")
    args = ap.parse_args()
    n_seeds = 2 if args.quick else args.seeds
    epochs, patience = (15, 5) if args.quick else (120, 12)
    grid = [(32, 1e-3)] if args.quick else [(h, wd) for h in (16, 32, 64) for wd in (1e-4, 1e-3)]
    t_start = time.time()

    print("Loading fixes (with environment) and building samples ...")
    samples = data.build_samples()
    parts = data.split(samples)
    train, val, test = parts["train"], parts["val"], parts["test"]
    print(f"  train {len(train)} / val {len(val)} / test {len(test)} samples")

    def cov(s):
        return {"sst": float((~np.isnan(s.sst0)).mean()), "shear": float((~np.isnan(s.shear0)).mean())}

    print(f"  environment known at forecast start: train {cov(train)}  test {cov(test)}")

    # Same pipeline twice: without the environment (first 10 features) and with it (all 14).
    fits = {
        "no_env": fit_variant("no_env", data.BASE_FEATURES, parts, grid, n_seeds, epochs, patience),
        "env": fit_variant("env", data.N_FEATURES, parts, grid, n_seeds, epochs, patience),
    }
    pv = {k: predict_variant(f, val) for k, f in fits.items()}
    pt = {k: predict_variant(f, test) for k, f in fits.items()}

    # Choose which variant to deploy using VALIDATION seasons only; the test seasons stay untouched.
    val_score = {
        k: nm(track_error_km(val, pv[k]["blend"][0])) / TRACK_SCALE + nm(wind_error_kt(val, pv[k]["blend"][1])) / WIND_SCALE
        for k in fits
    }
    deployed = min(val_score, key=val_score.get)
    fit, P_t, P_v = fits[deployed], pt[deployed], pv[deployed]
    print(f"\nValidation scores {val_score} -> deploying '{deployed}'")

    zero_w = np.zeros((len(test), len(LEADS)))
    preds = {
        "persistence": {"track": persistence_track_km(test), "wind": zero_w},
        "const_vel_6h": {"track": constant_velocity_km(test, 1)},
        "const_vel_12h": {"track": P_t["base"]},
        "ridge": {"track": P_t["ridge"][0], "wind": P_t["ridge"][1]},
        "gru": {"track": P_t["gru"][0], "wind": P_t["gru"][1]},
        "blend": {"track": P_t["blend"][0], "wind": P_t["blend"][1]},
    }
    ev, terr, werr = evaluate(test, preds)

    cone = {
        "track_km": calibrate(track_error_km(val, P_v["blend"][0]), terr["blend"]),
        "wind_kt": calibrate(wind_error_kt(val, P_v["blend"][1]), werr["blend"]),
    }

    # A/B on the test seasons
    ab_t = {k: track_error_km(test, pt[k]["blend"][0]) for k in fits}
    ab_w = {k: wind_error_kt(test, pt[k]["blend"][1]) for k in fits}
    n_leads = len(LEADS)
    ab = {
        "deployed": deployed,
        "val_score": val_score,
        "coverage": cov(test),
        "track": {k: [nm(ab_t[k][:, j]) for j in range(n_leads)] for k in fits},
        "wind": {k: [nm(ab_w[k][:, j]) for j in range(n_leads)] for k in fits},
        "n_track": [int(np.isfinite(ab_t["env"][:, j]).sum()) for j in range(n_leads)],
        "n_wind": [int(np.isfinite(ab_w["env"][:, j]).sum()) for j in range(n_leads)],
        "diff_track": [cluster_bootstrap_ci(ab_t["env"][:, j] - ab_t["no_env"][:, j], test.sid) for j in range(n_leads)],
        "diff_wind": [cluster_bootstrap_ci(ab_w["env"][:, j] - ab_w["no_env"][:, j], test.sid) for j in range(n_leads)],
    }

    spread_tr = np.sqrt(P_t["tr_members"].var(0).sum(-1))
    spread_w = P_t["w_members"].std(0)
    spear = {
        "track": [spearman(spread_tr[:, k], terr["gru"][:, k]) for k in range(n_leads)],
        "wind": [spearman(spread_w[:, k], werr["gru"][:, k]) for k in range(n_leads)],
    }
    member_errs = [nm(track_error_km(test, P_t["tr_members"][m])[:, 2]) for m in range(n_seeds)]
    member_stats = {"mean": float(np.mean(member_errs)), "std": float(np.std(member_errs))}

    with db.engine.connect() as conn:
        sids = {f"{n} {y}": conn.execute(text("SELECT sid FROM historical_storms WHERE name=:n AND season=:y"), {"n": n, "y": y}).scalar() for n, y in CASE_STORMS}
    cases = {name: case_study(test, sid, preds, spread_tr) if sid else ["  (storm not found)"] for name, sid in sids.items()}

    meta = {
        "trained_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "source": "NOAA IBTrACS v04r01 + NOAA OISST v2.1 + NCEP/NCAR Reanalysis 1",
        "ensemble_size": n_seeds,
        "hidden": fit["hidden"],
        "weight_decay": fit["wd"],
        "ridge_lambda": fit["lam"],
        "deployed_variant": deployed,
        "n_features": fit["n_feat"],
        "quick_run": args.quick,
        "splits": {
            k: {"seasons": f"{v.season.min()}-{v.season.max()}", "storms": len(set(v.sid)), "samples": len(v)}
            for k, v in parts.items()
        },
        "torch": torch.__version__,
        "python": platform.python_version(),
        "runtime_s": round(time.time() - t_start),
    }
    report = fmt_report(meta, ev, spear, member_stats, cases, cone, ab)
    print("\n" + report)

    if args.no_save:
        return
    ARTIFACTS.mkdir(exist_ok=True)
    torch.save(
        {
            "states": fit["states"],
            "hidden": fit["hidden"],
            "n_features": fit["n_feat"],
            "leads": LEADS,
            "hist_steps": data.HIST_STEPS,
            "track_scale": TRACK_SCALE,
            "wind_scale": WIND_SCALE,
            "region": data.REGION,
            "official_sources": list(data.OFFICIAL_SOURCES),
            "cone": cone,
            "ridge": fit["ridge"].state(),
            "info": {
                "model": "50/50 blend of GRU ensemble and ridge regression"
                + (", with SST + wind-shear inputs" if deployed == "env" else ""),
                "uses_environment": deployed == "env",
                "trained_at": meta["trained_at"],
                "source": meta["source"],
                "splits": meta["splits"],
                "leads_h": LEAD_HOURS,
                "test_track_km": ev["track"]["blend"]["mean_km"],
                "test_wind_kt": ev["wind"]["blend"]["mae_kt"],
            },
        },
        ARTIFACTS / "gru_ensemble.pt",
    )
    (ARTIFACTS / "metrics.json").write_text(
        json.dumps({"meta": meta, "test": ev, "environment_ab": ab, "cone": cone, "spread_error_spearman": spear, "member_24h_track_km": member_stats}, indent=2, default=float),
        encoding="utf-8",
    )
    (ARTIFACTS / "report.txt").write_text(report + "\n", encoding="utf-8")
    print(f"\nSaved model, metrics.json and report.txt to {ARTIFACTS}")


if __name__ == "__main__":
    main()
