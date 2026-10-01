import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

# e.g. postgresql+psycopg://postgres@127.0.0.1:5433/chakravaat
# Unset -> the API serves the JSON seed files instead (no database needed).
DATABASE_URL = os.getenv("DATABASE_URL")

# Pin the session to UTC so timestamptz values are returned as UTC ('Z'), not the server's local offset.
engine = (
    create_engine(DATABASE_URL, pool_pre_ping=True, connect_args={"options": "-c timezone=UTC"})
    if DATABASE_URL
    else None
)
SessionLocal = sessionmaker(engine, expire_on_commit=False) if engine else None
