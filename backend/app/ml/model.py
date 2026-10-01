import torch
from torch import nn


class GRUForecaster(nn.Module):
    """GRU encoder over the history window -> joint track-correction and intensity-change heads.

    Outputs are in scaled units: track in 100 km, wind change in 10 kt. The track head predicts a
    *correction* to constant-velocity extrapolation, so an untrained model already equals that baseline.
    """

    def __init__(self, n_features: int, n_leads: int, hidden: int = 32, layers: int = 1, dropout: float = 0.1):
        super().__init__()
        self.n_leads = n_leads
        self.gru = nn.GRU(
            n_features, hidden, num_layers=layers, batch_first=True, dropout=dropout if layers > 1 else 0.0
        )
        self.head = nn.Sequential(nn.Linear(hidden, hidden), nn.ReLU(), nn.Dropout(dropout), nn.Linear(hidden, n_leads * 3))
        nn.init.zeros_(self.head[-1].weight)  # start exactly at the constant-velocity baseline
        nn.init.zeros_(self.head[-1].bias)

    def forward(self, x: torch.Tensor):
        out, _ = self.gru(x)
        y = self.head(out[:, -1])
        track = y[:, : self.n_leads * 2].reshape(-1, self.n_leads, 2)
        wind = y[:, self.n_leads * 2 :]
        return track, wind
