from geoalchemy2 import Geometry
from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Storm(Base):
    __tablename__ = "storms"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    position: Mapped[int] = mapped_column(Integer)  # display order
    name: Mapped[str] = mapped_column(String)
    category: Mapped[str] = mapped_column(String)
    category_label: Mapped[str] = mapped_column(String)
    location = mapped_column(Geometry("POINT", srid=4326, spatial_index=True))
    wind: Mapped[float] = mapped_column(Float)
    pressure: Mapped[float] = mapped_column(Float)
    direction: Mapped[str] = mapped_column(String)
    speed: Mapped[float] = mapped_column(Float)
    intensity_steps: Mapped[int] = mapped_column(Integer)
    active_steps: Mapped[int] = mapped_column(Integer)
    is_warning: Mapped[bool] = mapped_column(Boolean)
    intensity_conf: Mapped[float] = mapped_column(Float)

    # UI-shaped documents that are always read whole, never queried into.
    detection = mapped_column(JSONB)
    classification = mapped_column(JSONB)
    forecast = mapped_column(JSONB)
    uncertainty = mapped_column(JSONB)
    alerts = mapped_column(JSONB)
    features = mapped_column(JSONB)
    model_stack = mapped_column(JSONB)


class TrackPoint(Base):
    __tablename__ = "track_points"
    __table_args__ = (UniqueConstraint("storm_id", "kind", "seq"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    storm_id: Mapped[str] = mapped_column(ForeignKey("storms.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String)  # 'historical' | 'predicted'
    seq: Mapped[int] = mapped_column(Integer)  # order within the track, oldest first
    label: Mapped[str | None] = mapped_column(String, nullable=True)
    uncertain: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    geom = mapped_column(Geometry("POINT", srid=4326, spatial_index=True))


class SatFeed(Base):
    __tablename__ = "sat_feeds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    position: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String)
    freq: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)


class MapLayer(Base):
    __tablename__ = "map_layers"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    position: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(String)
    color: Mapped[str] = mapped_column(String)
    border: Mapped[str | None] = mapped_column(String, nullable=True)
    on: Mapped[bool] = mapped_column(Boolean)


class Environment(Base):
    __tablename__ = "environment"

    storm_id: Mapped[str] = mapped_column(ForeignKey("storms.id", ondelete="CASCADE"), primary_key=True)
    data = mapped_column(JSONB)


class DataSource(Base):
    __tablename__ = "data_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    position: Mapped[int] = mapped_column(Integer)
    icon: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(String)


class TimelineConfig(Base):
    __tablename__ = "timeline_config"

    key: Mapped[str] = mapped_column(String, primary_key=True)  # 'dates' | 'tick_labels'
    value = mapped_column(JSONB)


class HistoricalStorm(Base):
    """One row per IBTrACS storm (archive/training data; separate from the live demo tables)."""

    __tablename__ = "historical_storms"

    sid: Mapped[str] = mapped_column(String, primary_key=True)  # IBTrACS storm id
    name: Mapped[str] = mapped_column(String)
    season: Mapped[int] = mapped_column(Integer, index=True)
    number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    basin: Mapped[str] = mapped_column(String)  # basin of the first fix
    start_time = mapped_column(DateTime(timezone=True))
    end_time = mapped_column(DateTime(timezone=True))
    n_points: Mapped[int] = mapped_column(Integer)
    max_wind_kt: Mapped[float | None] = mapped_column(Float, nullable=True)
    min_pressure_hpa: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_imd_stage: Mapped[str | None] = mapped_column(String, nullable=True)
    made_landfall: Mapped[bool] = mapped_column(Boolean)


class HistoricalTrackPoint(Base):
    """One fix along a storm track. Native source units: knots, hPa, km, degrees."""

    __tablename__ = "historical_track_points"
    __table_args__ = (
        UniqueConstraint("sid", "observed_at", "track_type"),
        Index("ix_hist_points_sid_time", "sid", "observed_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    sid: Mapped[str] = mapped_column(ForeignKey("historical_storms.sid", ondelete="CASCADE"))
    observed_at = mapped_column(DateTime(timezone=True))  # UTC
    geom = mapped_column(Geometry("POINT", srid=4326, spatial_index=True))
    nature: Mapped[str | None] = mapped_column(String, nullable=True)  # TS/NR/DS/MX/ET
    track_type: Mapped[str | None] = mapped_column(String, nullable=True)  # main/PROVISIONAL/spur-merge/...
    basin: Mapped[str | None] = mapped_column(String, nullable=True)
    subbasin: Mapped[str | None] = mapped_column(String, nullable=True)
    wind_kt: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_source: Mapped[str | None] = mapped_column(String, nullable=True)  # wmo | newdelhi | usa
    pressure_hpa: Mapped[float | None] = mapped_column(Float, nullable=True)
    pressure_source: Mapped[str | None] = mapped_column(String, nullable=True)
    imd_grade: Mapped[str | None] = mapped_column(String, nullable=True)  # raw NEWDELHI_GRADE
    imd_stage: Mapped[str | None] = mapped_column(String, nullable=True)  # d|dd|cs|scs|vscs|escs|sucs
    storm_speed_kt: Mapped[float | None] = mapped_column(Float, nullable=True)
    storm_dir_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    dist2land_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    landfall_km: Mapped[float | None] = mapped_column(Float, nullable=True)  # 0 = landfall
