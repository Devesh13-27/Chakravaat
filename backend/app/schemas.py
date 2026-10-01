from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class _Base(BaseModel):
    # Seed data carries UI-only fields (e.g. CSS colour tokens); keep them through.
    model_config = ConfigDict(extra="allow")


class Detection(_Base):
    status: str
    confidence: float
    center: str
    model: str


class ClassificationItem(_Base):
    label: str
    pct: float
    color: str


class TrackPoint(_Base):
    lat: float
    lon: float
    label: str | None = None
    uncertain: bool | None = None


class Track(_Base):
    historical: list[TrackPoint]
    predicted: list[TrackPoint]


class TrackForecastRow(_Base):
    time: str
    lat: str
    lon: str
    dist: str
    isCurrent: bool | None = None


class IntensityForecastRow(_Base):
    time: str
    wind: str
    pressure: str
    cls: str
    isCurrent: bool | None = None
    trend: str | None = None


class Forecast(_Base):
    track: list[TrackForecastRow]
    intensity: list[IntensityForecastRow]


class LabelValue(_Base):
    label: str
    value: str


class Alert(_Base):
    type: str
    icon: str
    title: str
    body: str


class Feature(_Base):
    name: str
    pct: float
    color: str


class ModelStackItem(_Base):
    name: str
    pct: float
    color: str | None = None


class Storm(_Base):
    id: str
    name: str
    category: str
    categoryLabel: str
    lat: float
    lon: float
    wind: float
    pressure: float
    direction: str
    speed: float
    intensitySteps: int
    activeSteps: int
    isWarning: bool
    detection: Detection
    classification: list[ClassificationItem]
    intensityConf: float
    track: Track
    forecast: Forecast
    uncertainty: list[LabelValue]
    alerts: list[Alert]
    features: list[Feature]
    modelStack: list[ModelStackItem]


class SatFeed(_Base):
    name: str
    freq: str
    status: str


class MapLayer(_Base):
    id: str
    label: str
    color: str
    on: bool


class EnvCard(_Base):
    label: str
    value: str
    unit: str
    trend: str
    trendColor: str


class Environment(_Base):
    cards: list[EnvCard]
    era5: list[LabelValue]
    era5Timestamp: str


class DataSource(_Base):
    icon: str
    name: str
    desc: str


class Timeline(_Base):
    dates: list[str]
    tick_labels: list[str]


class HistoricalStormSummary(BaseModel):
    sid: str
    name: str
    season: int
    basin: str
    start_time: datetime
    end_time: datetime
    n_points: int
    max_wind_kt: float | None = None
    min_pressure_hpa: float | None = None
    max_imd_stage: str | None = None
    made_landfall: bool


class HistoricalStormPage(BaseModel):
    total: int
    items: list[HistoricalStormSummary]


class NearbyStorm(HistoricalStormSummary):
    min_distance_km: float


class HistoricalPoint(BaseModel):
    observed_at: datetime
    lat: float
    lon: float
    wind_kt: float | None = None
    wind_source: str | None = None
    pressure_hpa: float | None = None
    pressure_source: str | None = None
    imd_grade: str | None = None
    imd_stage: str | None = None
    nature: str | None = None
    track_type: str | None = None
    storm_speed_kt: float | None = None
    storm_dir_deg: float | None = None
    dist2land_km: float | None = None


class HistoricalStormDetail(HistoricalStormSummary):
    points: list[HistoricalPoint]


class HistoryStats(BaseModel):
    storms: int
    first_season: int | None
    last_season: int | None
    track_points: int
    storms_with_intensity: int
    latest_fix: datetime | None
    source: str


# ── Forecast model ───────────────────────────────────────────────────────────


class ForecastLead(BaseModel):
    lead_h: int
    lat: float
    lon: float
    wind_kt: float | None = None  # null when the current wind is unknown
    track_radius_km_67: float
    track_radius_km_90: float
    wind_radius_kt_67: float
    wind_radius_kt_90: float


class ActualLead(BaseModel):
    lead_h: int
    lat: float
    lon: float
    wind_kt: float | None = None


class ForecastFrame(BaseModel):
    init_time: datetime
    lat: float
    lon: float
    wind_kt: float | None = None
    sst_c: float | None = None  # sea-surface temperature at the storm centre when the forecast was issued
    shear_ms: float | None = None  # 200-850 hPa wind shear (m/s)
    forecast: list[ForecastLead]
    actual: list[ActualLead | None] | None = None  # present for hindcasts
    track_error_km: list[float | None] | None = None


class ObservedFix(BaseModel):
    time: datetime
    lat: float
    lon: float
    wind_kt: float | None = None


class HindcastResponse(BaseModel):
    sid: str
    name: str
    season: int
    data_split: str  # train | val | test | outside
    out_of_sample: bool  # true only for test seasons (never seen in training or tuning)
    model: str
    uses_environment: bool  # whether the model was given SST / shear as inputs
    observed: list[ObservedFix]
    frames: list[ForecastFrame]


class FixIn(BaseModel):
    time: datetime  # timezone-aware, UTC recommended
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=360)
    wind_kt: float | None = Field(None, ge=0, le=250, description="Official-agency (IMD/WMO) sustained wind")
    pressure_hpa: float | None = Field(None, ge=800, le=1100)
    sst_c: float | None = Field(
        None, ge=-5, le=40, description="Sea-surface temperature at the centre, deg C. Only used if the deployed model uses environment inputs (see GET /forecast/model: uses_environment)."
    )
    shear_ms: float | None = Field(
        None, ge=0, le=100, description="200-850 hPa wind shear, m/s. Only used if the deployed model uses environment inputs."
    )

    @field_validator("time")
    @classmethod
    def _tz_aware(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("time must include a timezone, e.g. 2026-09-24T00:00:00Z")
        return v


class ForecastRequest(BaseModel):
    fixes: list[FixIn] = Field(min_length=6, max_length=48,
                               description="Consecutive 6-hourly fixes, oldest first; the newest is the forecast start. "
                                           "Include wind_kt and pressure_hpa (official agency) whenever known: "
                                           "omitting pressure changes the forecast materially.")


class ModelCard(BaseModel):
    model: str
    uses_environment: bool
    trained_at: str
    source: str
    splits: dict
    leads_h: list[int]
    test_track_error_km: list[float]
    test_wind_error_kt: list[float]
    cone: dict
    caveats: list[str]
