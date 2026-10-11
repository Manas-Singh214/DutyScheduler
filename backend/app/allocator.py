import random
from typing import Dict, List

from .models import AllocationRequest, AllocationResponse, Assignment, SessionSchedule, TeacherDutyCount


def generate_allocation(request: AllocationRequest) -> AllocationResponse:
    teachers = list(dict.fromkeys(t.strip() for t in request.teachers if t.strip()))
    rooms = list(dict.fromkeys(r.strip() for r in request.rooms if r.strip()))
    if not teachers:
        raise ValueError("At least one unique teacher must be provided.")
    if not rooms:
        raise ValueError("At least one unique room must be provided.")
    if not request.sessions:
        raise ValueError("At least one exam session must be provided.")

    history = {teacher: max(0, request.history_totals.get(teacher, 0)) for teacher in teachers}
    current = {teacher: 0 for teacher in teachers}
    rng = random.SystemRandom()
    schedules: List[SessionSchedule] = []
    assigned_any = set()

    for index, session in enumerate(request.sessions):
        assignments = []
        assigned_in_session = set()
        if len(rooms) > len(teachers):
            raise ValueError("Each session needs at least as many teachers as rooms.")
        for room in rooms:
            available = [teacher for teacher in teachers if teacher not in assigned_in_session]
            lowest_total = min(history[t] + current[t] for t in available)
            tied = [t for t in available if history[t] + current[t] == lowest_total]
            teacher = rng.choice(tied)
            assigned_in_session.add(teacher)
            assigned_any.add(teacher)
            current[teacher] += 1
            assignments.append(Assignment(room=room, teacher=teacher))

        schedules.append(SessionSchedule(
            session_id=session.id or f"session_{index + 1}",
            date=session.date,
            time_slot=session.time_slot,
            session_name=session.session_name or f"Session {index + 1}",
            assignments=assignments,
        ))

    return AllocationResponse(
        school_name=request.school_name,
        exam_name=request.exam_name,
        schedule=schedules,
        fairness_matrix=[
            TeacherDutyCount(teacher=teacher, total_duties=current[teacher])
            for teacher in teachers
        ],
        total_teachers=len(teachers),
        total_rooms=len(rooms),
        total_shifts=sum(current.values()),
        standby_teachers=[teacher for teacher in teachers if teacher not in assigned_any],
        history_totals=history,
    )
