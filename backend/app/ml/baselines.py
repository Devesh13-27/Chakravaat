"""Reference forecasters the neural model must beat, plus the shared error metrics."""

import numpy as np

from .data import LEADS, Samples, track_targets_km, wind_targets
from .geo import from_km, haversine_km, to_km


def persistence_track_km(s: Samples) -> np.ndarray:
    return np.zeros((len(s), len(LEADS), 2))


def constant_velocity_km(s: Samples, back_steps: int) -> np.ndarray:
    """Extrapolate the mean motion over the last `back_steps` fixes. Returns (N, L, 2) km (east, north)."""
    past_e, past_n = to_km(s.lat0, s.lon0, s.win_lat[:, -1 - back_steps], s.win_lon[:, -1 - back_steps])
    vel = -np.stack([past_e, past_n], axis=-1) / back_steps  # km per 6 h step
    return vel[:, None, :] * np.array(LEADS)[None, :, None]


def track_error_km(s: Samples, pred_km: np.ndarray) -> np.ndarray:
    """(N, L) great-circle error of predicted displacement vs the true position; NaN where no truth."""
    lat, lon = from_km(s.lat0[:, None], s.lon0[:, None], pred_km[..., 0], pred_km[..., 1])
    return haversine_km(lat, lon, s.tgt_lat, s.tgt_lon)


def wind_error_kt(s: Samples, pred_delta: np.ndarray) -> np.ndarray:
    """(N, L) absolute intensity error; NaN unless current and future wind are both known."""
    return np.abs(wind_targets(s) - pred_delta)


class Ridge:
    """Per-output ridge regression on the flattened input window (masked targets)."""

    def __init__(self, lam: float):
        self.lam = lam

    def fit(self, x: np.ndarray, y: np.ndarray, mask: np.ndarray):
        flat = x.reshape(len(x), -1)
        self.mu, self.sd = flat.mean(0), np.maximum(flat.std(0), 1e-6)
        z = np.hstack([(flat - self.mu) / self.sd, np.ones((len(flat), 1))])
        reg = self.lam * np.eye(z.shape[1])
        reg[-1, -1] = 0.0  # don't penalise the intercept
        self.w = np.zeros((z.shape[1], y.shape[1]))
        for k in range(y.shape[1]):
            rows = mask[:, k]
            if rows.sum() < z.shape[1]:
                continue
            self.w[:, k] = np.linalg.solve(z[rows].T @ z[rows] + reg, z[rows].T @ y[rows, k])
        return self

    def predict(self, x: np.ndarray) -> np.ndarray:
        flat = x.reshape(len(x), -1)
        return np.hstack([(flat - self.mu) / self.sd, np.ones((len(flat), 1))]) @ self.w
