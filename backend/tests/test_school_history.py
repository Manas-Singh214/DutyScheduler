import asyncio
from io import BytesIO
import unittest

from fastapi import HTTPException
from pydantic import ValidationError
from openpyxl import Workbook
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile
from starlette.requests import Request

from app.auth import (
    Base,
    Credentials,
    HistoryRecord,
    Registration,
    User,
    duty_history,
    import_duty_history,
    login,
    migrate_legacy_usernames,
    record_completed_exam,
    register,
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

    def create_account(self, username):
        return register(
            self.request,
            Registration(username=username, password="long-enough-test-password"),
            self.db,
        )

    def test_username_account_creation_sign_in_and_history_isolation(self):
        first_session = self.create_account("NorthSchool")
        first_user = self.db.query(User).filter_by(username="northschool").one()
        self.assertEqual(first_session["username"], "northschool")

        logged_in = login(
            self.request,
            Credentials(username="NORTHSCHOOL", password="long-enough-test-password"),
            self.db,
        )
        self.assertEqual(logged_in["access_token"], first_session["access_token"])

        record_completed_exam(HistoryRecord(
            exam_id="north-exam",
            exam_name="Term exam",
            teacher_counts={"Teacher A": 2, "Teacher B": 1},
        ), first_user, self.db)

        self.create_account("SouthSchool")
        second_user = self.db.query(User).filter_by(username="southschool").one()
        self.assertEqual(duty_history(first_user, self.db), {"Teacher A": 2, "Teacher B": 1})
        self.assertEqual(duty_history(second_user, self.db), {})

    def test_duplicate_usernames_and_invalid_credentials_are_rejected(self):
        self.create_account("Scheduler")
        with self.assertRaises(HTTPException) as duplicate:
            self.create_account("scheduler")
        self.assertEqual(duplicate.exception.status_code, 409)

        with self.assertRaises(HTTPException) as invalid:
            login(self.request, Credentials(username="scheduler", password="wrong-password"), self.db)
        self.assertEqual(invalid.exception.status_code, 401)

        with self.assertRaises(ValidationError):
            self.create_account("a")

    def test_excel_history_import_adds_once_and_rejects_same_workbook_twice(self):
        self.create_account("NorthSchool")
        user = self.db.query(User).filter_by(username="northschool").one()

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

    def test_existing_email_accounts_receive_usable_migrated_usernames(self):
        legacy_engine = create_engine("sqlite:///:memory:")
        with legacy_engine.begin() as connection:
            connection.execute(text(
                "CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(320) NOT NULL)"
            ))
            connection.execute(text(
                "INSERT INTO users (id, email) VALUES (1, 'admin@north.example'), "
                "(2, 'admin@south.example')"
            ))

        migrate_legacy_usernames(legacy_engine)
        with legacy_engine.connect() as connection:
            usernames = connection.execute(
                text("SELECT username FROM users ORDER BY id")
            ).scalars().all()
        self.assertEqual(usernames, ["admin", "legacy-2"])
        legacy_engine.dispose()


if __name__ == "__main__":
    unittest.main()
