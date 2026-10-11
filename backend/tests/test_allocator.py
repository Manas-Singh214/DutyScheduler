import unittest

from app.allocator import generate_allocation
from app.models import AllocationRequest, SessionInput


class AllocationTests(unittest.TestCase):
    def test_lower_historical_totals_receive_next_duties(self):
        request = AllocationRequest(
            school_name="Example",
            exam_name="Exam",
            teachers=["A", "B", "C", "D"],
            rooms=["101", "102"],
            sessions=[SessionInput(date="2026-10-12", time_slot="AM")],
            history_totals={"A": 9, "B": 3, "C": 3, "D": 1},
        )

        result = generate_allocation(request)
        assigned = {assignment.teacher for assignment in result.schedule[0].assignments}

        self.assertIn("D", assigned)
        self.assertTrue({"B", "C"} & assigned)
        self.assertEqual(len(assigned), 2)
        self.assertIn("A", result.standby_teachers)

    def test_seven_exam_runs_balance_the_cumulative_school_history(self):
        teachers = [f"Teacher {index:02}" for index in range(15)]
        history = {teacher: 0 for teacher in teachers}
        request_data = {
            "school_name": "Example",
            "exam_name": "Exam",
            "teachers": teachers,
            "rooms": [f"Room {index:02}" for index in range(6)],
            "sessions": [
                SessionInput(date="2026-10-12", time_slot=f"Shift {index}")
                for index in range(4)
            ],
        }

        for _ in range(7):
            result = generate_allocation(AllocationRequest(**request_data, history_totals=history))
            for duty in result.fairness_matrix:
                history[duty.teacher] += duty.total_duties

        totals = list(history.values())
        self.assertEqual(sum(totals), 7 * 4 * 6)
        self.assertLessEqual(max(totals) - min(totals), 1)

    def test_randomized_ties_keep_one_duty_per_room_and_balance_large_staff(self):
        teachers = [f"Teacher {index:03}" for index in range(100)]
        request = AllocationRequest(
            school_name="Example",
            exam_name="Exam",
            teachers=teachers,
            rooms=[f"Room {index:02}" for index in range(1, 6)],
            sessions=[
                SessionInput(date="2026-10-12", time_slot="AM"),
                SessionInput(date="2026-10-12", time_slot="PM"),
            ],
        )

        result = generate_allocation(request)
        duties = [item.total_duties for item in result.fairness_matrix]

        self.assertEqual(result.total_shifts, 10)
        self.assertEqual(max(duties) - min(duties), 1)
        self.assertEqual(len(result.standby_teachers), 90)
        self.assertEqual(len({item.teacher for session in result.schedule for item in session.assignments}), 10)
        selected_sets = set()
        for _ in range(6):
            repeated = generate_allocation(request)
            selected_sets.add(tuple(sorted(
                assignment.teacher
                for session in repeated.schedule
                for assignment in session.assignments
            )))
        self.assertGreater(len(selected_sets), 1)


if __name__ == "__main__":
    unittest.main()
