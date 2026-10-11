import os
import hashlib
import io
import re
from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from pwdlib import PasswordHash
from openpyxl import Workbook, load_workbook
from fastapi.responses import StreamingResponse
from sqlalchemy import ForeignKey, String, UniqueConstraint, inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, Mapped, mapped_column

from .database import Base, SessionLocal
from .rate_limit import limiter

router = APIRouter(prefix="/auth", tags=["accounts"])
password_hash = PasswordHash.recommended()
SECRET_KEY = os.getenv("APP_SECRET_KEY", "local-development-key-change-before-deploy")
if os.getenv("APP_ENV") == "production":
    if SECRET_KEY == "local-development-key-change-before-deploy":
        raise RuntimeError("Set APP_SECRET_KEY to a unique secret before production.")
    if not os.getenv("DATABASE_URL", "").startswith(("postgres://", "postgresql://", "postgresql+psycopg://")):
        raise RuntimeError("Production requires a persistent PostgreSQL DATABASE_URL.")


class School(Base):
    __tablename__ = "schools"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    # Kept for compatibility with existing databases; new accounts do not use email.
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(500))
    role: Mapped[str] = mapped_column(String(20), default="staff")
    # Retained for compatibility with the existing users table.
    verified: Mapped[bool] = mapped_column(default=True)


class DutyHistory(Base):
    __tablename__ = "duty_history"
    __table_args__ = (UniqueConstraint("school_id", "teacher_name"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    teacher_name: Mapped[str] = mapped_column(String(200))
    total_duties: Mapped[int] = mapped_column(default=0)


class CompletedExam(Base):
    __tablename__ = "completed_exams"
    __table_args__ = (UniqueConstraint("school_id", "exam_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    exam_id: Mapped[str] = mapped_column(String(100))
    exam_name: Mapped[str] = mapped_column(String(200))
    completed_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))


class ExamDuty(Base):
    __tablename__ = "exam_duties"
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    exam_id: Mapped[str] = mapped_column(String(100), index=True)
    teacher_name: Mapped[str] = mapped_column(String(200))
    duty_count: Mapped[int] = mapped_column(default=0)


class DutyImport(Base):
    __tablename__ = "duty_imports"
    __table_args__ = (UniqueConstraint("school_id", "content_hash"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    content_hash: Mapped[str] = mapped_column(String(64))


class Registration(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=12, max_length=256)


class Credentials(BaseModel):
    username: str
    password: str = Field(min_length=1, max_length=256)


class HistoryRecord(BaseModel):
    exam_id: str = Field(min_length=1, max_length=100)
    exam_name: str = Field(min_length=1, max_length=200)
    teacher_counts: dict[str, int]


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def normalized_username(value: str) -> str:
    username = value.strip().lower()
    if not re.fullmatch(r"[a-z0-9_.-]{3,32}", username):
        raise HTTPException(
            status_code=422,
            detail="Username must be 3-32 characters using letters, numbers, dots, underscores, or hyphens.",
        )
    return username


def migrate_legacy_usernames(engine: Engine) -> None:
    columns = {column["name"] for column in inspect(engine).get_columns("users")}
    with engine.begin() as connection:
        if "username" not in columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN username VARCHAR(32)"))
        usernames = set(connection.execute(
            text("SELECT username FROM users WHERE username IS NOT NULL")
        ).scalars())
        legacy_users = connection.execute(
            text("SELECT id, email FROM users WHERE username IS NULL ORDER BY id")
        ).mappings().all()
        for user in legacy_users:
            local_part = str(user["email"]).split("@", 1)[0].lower()
            candidate = re.sub(r"[^a-z0-9_.-]+", "-", local_part).strip("._-")[:32]
            if len(candidate) < 3 or candidate in usernames:
                candidate = f"legacy-{user['id']}"
            suffix = 2
            base_name = candidate
            while candidate in usernames:
                suffix_text = f"-{suffix}"
                candidate = f"{base_name[:32 - len(suffix_text)]}{suffix_text}"
                suffix += 1
            connection.execute(
                text("UPDATE users SET username = :username WHERE id = :user_id"),
                {"username": candidate, "user_id": user["id"]},
            )
            usernames.add(candidate)
        connection.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username)"
        ))


def create_token(subject: str, purpose: str, expires: timedelta) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": subject, "purpose": purpose, "iat": now, "exp": now + expires},
        SECRET_KEY,
        algorithm="HS256",
    )


def decode_token(token: str, purpose: str) -> str:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError as error:
        raise HTTPException(status_code=401, detail="Your sign-in session is invalid or expired. Please sign in again.") from error
    if payload.get("purpose") != purpose or not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Your sign-in session is invalid or expired. Please sign in again.")
    return str(payload["sub"])


def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to continue.")
    user_id = decode_token(authorization[7:], "access")
    user = db.get(User, int(user_id)) if user_id.isdigit() else None
    if user is None:
        raise HTTPException(status_code=401, detail="Your account is not available. Sign in again.")
    return user


@router.post("/register", status_code=201)
@limiter.limit("5/hour")
def register(request: Request, payload: Registration, db: Session = Depends(get_db)):
    username = normalized_username(payload.username)
    if db.scalar(select(User).where(User.username == username)):
        raise HTTPException(status_code=409, detail="That username is already taken. Choose another one.")
    school = School(name=username)
    db.add(school)
    db.flush()
    user = User(
        school_id=school.id,
        username=username,
        email=f"{username}@accounts.invalid",
        password_hash=password_hash.hash(payload.password),
        role="admin",
        verified=True,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="That username is already taken. Choose another one.") from error
    db.refresh(user)
    return session_response(user)


@router.post("/login")
@limiter.limit("10/minute")
def login(request: Request, payload: Credentials, db: Session = Depends(get_db)):
    username = normalized_username(payload.username)
    user = db.scalar(select(User).where(User.username == username))
    if user is None or not password_hash.verify(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Username or password is incorrect.")
    return session_response(user)


def session_response(user: User) -> dict[str, str]:
    return {
        "access_token": create_token(str(user.id), "access", timedelta(hours=12)),
        "token_type": "bearer",
        "username": user.username,
        "school_name": user.username,
        "role": user.role,
    }


@router.get("/me")
def account_info(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {
        "username": user.username,
        "role": user.role,
        "school_name": db.get(School, user.school_id).name,
    }


@router.get("/history")
def duty_history(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(DutyHistory).where(DutyHistory.school_id == user.school_id)).all()
    return {row.teacher_name: row.total_duties for row in rows}


@router.post("/history/record")
def record_completed_exam(
    payload: HistoryRecord,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if any(count < 0 for count in payload.teacher_counts.values()):
        raise HTTPException(status_code=422, detail="Teacher duty counts cannot be negative.")
    if db.scalar(select(CompletedExam).where(
        CompletedExam.school_id == user.school_id,
        CompletedExam.exam_id == payload.exam_id,
    )):
        raise HTTPException(status_code=409, detail="This exam has already been added to history.")
    db.add(CompletedExam(school_id=user.school_id, exam_id=payload.exam_id, exam_name=payload.exam_name))
    for name, count in payload.teacher_counts.items():
        if name.strip() and count > 0:
            db.add(ExamDuty(
                school_id=user.school_id,
                exam_id=payload.exam_id,
                teacher_name=name.strip(),
                duty_count=count,
            ))
    for name, count in payload.teacher_counts.items():
        teacher_name = name.strip()
        if not teacher_name:
            continue
        row = db.scalar(select(DutyHistory).where(
            DutyHistory.school_id == user.school_id,
            DutyHistory.teacher_name == teacher_name,
        ))
        if row:
            row.total_duties += count
        else:
            db.add(DutyHistory(
                school_id=user.school_id,
                teacher_name=teacher_name,
                total_duties=count,
            ))
    db.commit()
    return {"message": "Exam duties added to this school's history."}


@router.post("/history/import")
@limiter.limit("5/hour")
async def import_duty_history(
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not (file.filename or "").lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Upload an .xlsx or .xlsm history workbook.")
    contents = await file.read(10 * 1024 * 1024 + 1)
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Workbook exceeds the 10 MB limit.")
    content_hash = hashlib.sha256(contents).hexdigest()
    if db.scalar(select(DutyImport).where(
        DutyImport.school_id == user.school_id,
        DutyImport.content_hash == content_hash,
    )):
        raise HTTPException(status_code=409, detail="This workbook has already been imported.")
    try:
        workbook = load_workbook(io.BytesIO(contents), read_only=True, data_only=True)
        rows = list(workbook.active.iter_rows(values_only=True))
        workbook.close()
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Could not read workbook: {error}") from error
    if not rows:
        raise HTTPException(status_code=400, detail="The workbook is empty.")
    headers = [str(value or "").strip().lower() for value in rows[0]]
    teacher_col = next((i for i, value in enumerate(headers) if value in {"teacher", "teacher name", "staff", "staff name"}), None)
    count_col = next((i for i, value in enumerate(headers) if value in {"total duties", "duties", "duty count", "total shifts"}), None)
    if teacher_col is None or count_col is None:
        raise HTTPException(status_code=400, detail="The first sheet needs 'Teacher Name' and 'Total Duties' columns.")
    imported: dict[str, int] = {}
    for row in rows[1:]:
        if teacher_col >= len(row) or count_col >= len(row) or not row[teacher_col]:
            continue
        teacher = str(row[teacher_col]).strip()
        try:
            count = int(row[count_col])
        except (TypeError, ValueError) as error:
            raise HTTPException(status_code=400, detail=f"Invalid duty total for {teacher}.") from error
        if count < 0:
            raise HTTPException(status_code=400, detail=f"Duty total cannot be negative for {teacher}.")
        imported[teacher] = imported.get(teacher, 0) + count
    if not imported:
        raise HTTPException(status_code=400, detail="No teacher duty totals were found.")
    for teacher, count in imported.items():
        row = db.scalar(select(DutyHistory).where(
            DutyHistory.school_id == user.school_id,
            DutyHistory.teacher_name == teacher,
        ))
        if row:
            row.total_duties += count
        else:
            db.add(DutyHistory(school_id=user.school_id, teacher_name=teacher, total_duties=count))
    db.add(DutyImport(school_id=user.school_id, content_hash=content_hash))
    db.commit()
    return {"message": f"Added past-duty totals for {len(imported)} teachers."}


@router.get("/history/export.xlsx")
def export_duty_history(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    totals = db.scalars(
        select(DutyHistory).where(DutyHistory.school_id == user.school_id).order_by(DutyHistory.teacher_name)
    ).all()
    exams = db.scalars(
        select(CompletedExam).where(CompletedExam.school_id == user.school_id).order_by(CompletedExam.completed_at)
    ).all()
    workbook = Workbook()
    totals_sheet = workbook.active
    totals_sheet.title = "Teacher Totals"
    totals_sheet.append(["Teacher Name", "Total Duties"])
    for row in totals:
        totals_sheet.append([row.teacher_name, row.total_duties])
    log_sheet = workbook.create_sheet("Exam Log")
    log_sheet.append(["Exam", "Teacher Name", "Duties"])
    duties = {exam.exam_id: [] for exam in exams}
    exam_ids = list(duties)
    if exam_ids:
        for duty in db.scalars(select(ExamDuty).where(
            ExamDuty.school_id == user.school_id,
            ExamDuty.exam_id.in_(exam_ids),
        )).all():
            duties[duty.exam_id].append(duty)
    for exam in exams:
        for duty in duties[exam.exam_id]:
            log_sheet.append([exam.exam_name, duty.teacher_name, duty.duty_count])
    stream = io.BytesIO()
    workbook.save(stream)
    stream.seek(0)
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="school-duty-history.xlsx"'},
    )
