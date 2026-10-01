from pydantic import BaseModel, ConfigDict


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
