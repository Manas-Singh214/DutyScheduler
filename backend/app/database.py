import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import DeclarativeBase, sessionmaker


PROJECT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_DIR / "data"
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DATABASE_URL = URL.create("sqlite", database=str(DATA_DIR / "exam_duty.db"))
if isinstance(DATABASE_URL, str) and DATABASE_URL.startswith(("postgresql://", "postgres://")):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg://", 1)
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)

IS_SQLITE_DATABASE = (
    DATABASE_URL.drivername == "sqlite"
    if isinstance(DATABASE_URL, URL)
    else DATABASE_URL.startswith("sqlite")
)

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if IS_SQLITE_DATABASE else {},
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass
