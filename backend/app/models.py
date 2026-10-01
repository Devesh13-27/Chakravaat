from geoalchemy2 import Geometry
from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, UniqueConstraint
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
