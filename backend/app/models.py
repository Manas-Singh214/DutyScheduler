from typing import Dict, List, Optional
from pydantic import BaseModel, Field

class SessionInput(BaseModel):
    id: Optional[str] = None
    date: str = Field(..., description="Date of the exam session e.g. YYYY-MM-DD")
    time_slot: str = Field(..., description="Time range e.g. 09:00 AM - 12:00 PM")
    session_name: Optional[str] = Field(default="Standard Shift", description="Name/Label of session")

class AllocationRequest(BaseModel):
    school_name: str = Field(..., example="St. Xavier High School")
    exam_name: str = Field(..., example="Final Term Examinations 2026")
    sessions: List[SessionInput]
    teachers: List[str] = Field(..., min_items=1, description="List of available teachers")
    rooms: List[str] = Field(..., min_items=1, description="List of examination rooms")
    history_totals: Dict[str, int] = Field(default_factory=dict)

class Assignment(BaseModel):
    room: str
    teacher: str

class SessionSchedule(BaseModel):
    session_id: str
    date: str
    time_slot: str
    session_name: str
    assignments: List[Assignment]

class TeacherDutyCount(BaseModel):
    teacher: str
    total_duties: int

class AllocationResponse(BaseModel):
    school_name: str
    exam_name: str
    schedule: List[SessionSchedule]
    fairness_matrix: List[TeacherDutyCount]
    total_teachers: int
    total_rooms: int
    total_shifts: int
    standby_teachers: List[str] = Field(default_factory=list)
    history_totals: Dict[str, int] = Field(default_factory=dict)

class ExportRequest(BaseModel):
    school_name: str
    exam_name: str
    schedule: List[SessionSchedule]
    fairness_matrix: List[TeacherDutyCount] = Field(default_factory=list)
