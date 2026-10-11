import asyncio
import json
import os
from io import BytesIO
import unittest
from unittest.mock import patch

from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from fastapi import HTTPException
from starlette.datastructures import UploadFile
from starlette.requests import Request

from app.auth import (
    Base,
    Credentials,
    HistoryRecord,
    PasswordResetInput,
    PasswordResetRequest,
    Registration,
    School,
    TokenInput,
    User,
    confirm_password_reset,
    duty_history,
    import_duty_history,
    login,
    record_completed_exam,
    register,
    request_password_reset,
    send_email,
    verify_email,
)


class SchoolHistoryTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.request = Request({
            "type": "http",
            "method": "POST",
            "path": "/",
            "headers": [],
            "client": ("127.0.0.1", 12345),
        })

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_school_registration_verification_and_history_are_tenant_scoped(self):
        with patch("app.auth.send_email") as send_email:
            register(self.request, Registration(
                school_name="North School",
                email="admin@north.example",
                password="a-strong-password-123",
            ), self.db)
            token = send_email.call_args.args[2].rsplit("verify_token=", 1)[1]
        verify_email(self.request, TokenInput(token=token), self.db)
        session = login(self.request, Credentials(email="admin@north.example", password="a-strong-password-123"), self.db)
        first_user = self.db.query(User).filter_by(email="admin@north.example").one()
        record_completed_exam(HistoryRecord(
            exam_id="north-exam",
            exam_name="Term exam",
            teacher_counts={"Teacher A": 2, "Teacher B": 1},
        ), first_user, self.db)

        second_school = School(name="South School")
        self.db.add(second_school)
        self.db.flush()
        second_user = User(
            school_id=second_school.id,
            email="admin@south.example",
            password_hash="unused",
            role="admin",
            verified=True,
        )
        self.db.add(second_user)
        self.db.commit()

        self.assertEqual(session["role"], "admin")
        self.assertEqual(duty_history(first_user, self.db), {"Teacher A": 2, "Teacher B": 1})
        self.assertEqual(duty_history(second_user, self.db), {})

    def test_excel_history_import_adds_once_and_rejects_same_workbook_twice(self):
        school = School(name="North School")
        self.db.add(school)
        self.db.flush()
        user = User(
            school_id=school.id,
            email="admin@north.example",
            password_hash="unused",
            role="admin",
            verified=True,
        )
        self.db.add(user)
        self.db.commit()

        workbook = Workbook()
        sheet = workbook.active
        sheet.append(["Teacher Name", "Total Duties"])
        sheet.append(["Teacher A", 4])
        stream = BytesIO()
        workbook.save(stream)
        stream.seek(0)

        result = asyncio.run(import_duty_history(self.request, UploadFile(filename="history.xlsx", file=stream), user, self.db))
        self.assertIn("1 teachers", result["message"])
        self.assertEqual(duty_history(user, self.db), {"Teacher A": 4})

        stream.seek(0)
        with self.assertRaises(HTTPException):
            asyncio.run(import_duty_history(self.request, UploadFile(filename="history.xlsx", file=stream), user, self.db))

    def test_password_reset_link_is_single_use(self):
        school = School(name="North School")
        self.db.add(school)
        self.db.flush()
        user = User(
            school_id=school.id,
            email="admin@north.example",
            password_hash="unused",
            role="admin",
            verified=True,
        )
        self.db.add(user)
        self.db.commit()

        with patch("app.auth.send_email") as send_email:
            request_password_reset(self.request, PasswordResetRequest(email=user.email), self.db)
            token = send_email.call_args.args[2].rsplit("reset_token=", 1)[1]

        payload = PasswordResetInput(token=token, password="another-strong-password-456")
        result = confirm_password_reset(self.request, payload, self.db)
        self.assertIn("Password updated", result["message"])
        with self.assertRaises(HTTPException):
            confirm_password_reset(self.request, payload, self.db)

    def test_resend_delivery_uses_https_api_with_configured_sender(self):
        with patch.dict(os.environ, {
            "RESEND_API_KEY": "test-api-key",
            "EMAIL_FROM": "Exam Scheduler <noreply@example.org>",
        }), patch("app.auth.urlopen") as urlopen:
            urlopen.return_value.__enter__.return_value.status = 202
            send_email("teacher@example.org", "Verify account", "Open the verification link.")

        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.resend.com/emails")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-api-key")
        self.assertEqual(json.loads(request.data), {
            "from": "Exam Scheduler <noreply@example.org>",
            "to": ["teacher@example.org"],
            "subject": "Verify account",
            "text": "Open the verification link.",
        })


if __name__ == "__main__":
    unittest.main()
