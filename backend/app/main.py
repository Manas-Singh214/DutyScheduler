import re
import urllib.parse
import os
from io import BytesIO
from pathlib import Path
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openpyxl import load_workbook
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from .models import AllocationRequest, AllocationResponse, ExportRequest
from .allocator import generate_allocation
from .exporter import generate_docx
from .auth import (
    DutyHistory,
    get_current_user,
    get_db,
    migrate_legacy_usernames,
    router as auth_router,
    User,
)
from .database import Base, engine
from .rate_limit import limiter
from sqlalchemy import select
from sqlalchemy.orm import Session

app = FastAPI(
    title="Exam Duty Allocator API",
    description="Backend service for automated, fair invigilation scheduling and Word document generation.",
    version="1.0.0"
)
Base.metadata.create_all(bind=engine)
migrate_legacy_usernames(engine)
app.include_router(auth_router)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

cors_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]
if not cors_origins:
    raise ValueError("CORS_ORIGINS must contain at least one allowed origin.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    expose_headers=["Content-Disposition"],
)

STATIC_DIR = Path(__file__).resolve().parents[1] / "static"

@app.get("/")
def read_root():
    if (STATIC_DIR / "index.html").is_file():
        return FileResponse(STATIC_DIR / "index.html")
    return {
        "status": "online",
        "service": "Exam Duty Allocator API",
        "version": "1.0.0",
        "endpoints": ["/allocate", "/export"]
    }

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/allocate", response_model=AllocationResponse)
def allocate_duties(
    payload: AllocationRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Generate a schedule using the signed-in user's saved totals.
    """
    try:
        history = db.scalars(select(DutyHistory).where(DutyHistory.school_id == user.school_id)).all()
        payload.history_totals = {item.teacher_name: item.total_duties for item in history}
        result = generate_allocation(payload)
        return result
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred during allocation: {str(e)}"
        )


@app.post("/import-list")
async def import_list(file: UploadFile = File(...)):
    """Read the first worksheet of an uploaded Excel workbook for the input form."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".xlsx", ".xlsm"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload an .xlsx or .xlsm workbook.")

    contents = await file.read(10 * 1024 * 1024 + 1)
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Workbook exceeds the 10 MB limit.")

    try:
        workbook = load_workbook(BytesIO(contents), read_only=True, data_only=True)
        worksheet = workbook.active
        rows = [["" if value is None else str(value) for value in row] for row in worksheet.iter_rows(values_only=True)]
        rows = [row for row in rows if any(value.strip() for value in row)]
        workbook.close()
        return {"rows": rows}
    except Exception as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Could not read workbook: {error}")

@app.post("/export")
def export_schedule(payload: ExportRequest):
    """
    Accepts current (or edited/swapped) schedule state and outputs a formatted
    Word Document (.docx) for download.
    """
    try:
        docx_stream = generate_docx(payload)
        safe_name = re.sub(r'[^\w\s-]', '', payload.school_name).strip() or "Exam"
        filename = f"{safe_name.replace(' ', '_')}_Exam_Schedule.docx"
        ascii_filename = urllib.parse.quote(filename)

        return StreamingResponse(
            docx_stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"; filename*=UTF-8\'\'{ascii_filename}',
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate Word Document: {str(e)}"
        )

if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
