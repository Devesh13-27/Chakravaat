"""Model inference shared by training/evaluation and the API (one code path, no drift)."""

from pathlib import Path

import numpy as np
import torch

from . import data
from .baselines import Ridge, constant_velocity_km
from .data import LEADS, Samples
from .geo import from_km
from .model import GRUForecaster

TRACK_SCALE = 100.0  # km per model unit
WIND_SCALE = 10.0  # kt per model unit
ARTIFACT = Path(__file__).resolve().parents[2] / "artifacts" / "gru_ensemble.pt"


def ensemble_predict(states, hidden, s: Samples, base: np.ndarray):
    """-> track displacement (M,N,L,2) km, wind change (M,N,L) kt, one slice per ensemble member."""
    tracks, winds = [], []
    x = torch.from_numpy(s.x)
    with torch.no_grad():
        for st in states:
            m = GRUForecaster(s.x.shape[-1], len(LEADS), hidden=hidden)
            m.load_state_dict(st)
            m.eval()
            t, w = m(x)
            tracks.append(t.numpy() * TRACK_SCALE + base)
            winds.append(w.numpy() * WIND_SCALE)
    return np.stack(tracks), np.stack(winds)


def ridge_predict(model: Ridge, s: Samples, base: np.ndarray):
    out = model.predict(s.x)
    n_leads = len(LEADS)
    return out[:, : 2 * n_leads].reshape(-1, n_leads, 2) + base, out[:, 2 * n_leads :]


def blend(gru_track, gru_wind, ridge_track, ridge_wind):
    """The deployed model: a fixed 50/50 average of the GRU ensemble mean and the ridge regression."""
    return 0.5 * (gru_track + ridge_track), 0.5 * (gru_wind + ridge_wind)


class Forecaster:
    """Loads the trained artifact and turns history windows into forecasts with calibrated error radii."""

    def __init__(self, ckpt: dict):
        self.ckpt = ckpt
        self.states = ckpt["states"]
        self.hidden = ckpt["hidden"]
        self.ridge = Ridge.from_state(ckpt["ridge"])
        self.cone_data = ckpt["cone"]
        self.info = ckpt["info"]
        self.n_features = ckpt["n_features"]  # 14 = with environment inputs, 10 = without

    @classmethod
    def load(cls, path: Path = ARTIFACT) -> "Forecaster":
        return cls(torch.load(path, weights_only=False))

    def predict(self, s: Samples) -> dict:
        s = s.with_features(self.n_features)
        base = constant_velocity_km(s, 2)
        tr_members, w_members = ensemble_predict(self.states, self.hidden, s, base)
        r_track, r_wind = ridge_predict(self.ridge, s, base)
        track, wind = blend(tr_members.mean(0), w_members.mean(0), r_track, r_wind)

        lat, lon = from_km(s.lat0[:, None], s.lon0[:, None], track[..., 0], track[..., 1])
        wind_kt = np.where(np.isnan(s.wind0)[:, None], np.nan, np.maximum(s.wind0[:, None] + wind, 0.0))
        return {"lat": lat, "lon": lon, "wind_kt": wind_kt, "track_km": track}

    def radius(self, kind: str, prob: str) -> list[float]:
        """Calibrated error radius per lead: kind 'track_km' | 'wind_kt', prob '0.67' | '0.9'."""
        return self.cone_data[kind][prob]["radius"]
