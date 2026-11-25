"""Bulk CSV Roster Parser & Dry-Run Validator for Students and Faculty ERP Registers.

Accepts standard UTF-8 / UTF-8-BOM CSV exports from campus SIS / Excel / Google Sheets,
validates every row against Pydantic `StudentRecord` / `FacultyRecord` bounds, detects
duplicate primary keys inside the upload, and returns a structured preview + row-numbered
error report prior to committing.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass

from pydantic import ValidationError

from pramaan.erp.oracle import (
    AttendanceRecord,
    CourseGradeRecord,
    FacultyRecord,
    StudentRecord,
)

BULK_CSV_MAX_BYTES = 5 * 1024 * 1024
BULK_CSV_MAX_ROWS = 5_000
_MAX_ERRORS_RETURNED = 100
_MAX_PREVIEW_ROWS = 10
_NORM_HEADER_RE = re.compile(r"[^a-z0-9]+")

STUDENTS_CSV_TEMPLATE = (
    "prn,full_name,program,department,batch_year,declared_cgpa,education_level,"
    "age_years,active_backlogs,degree_status,parent_username,disciplinary_standing,"
    "course_code,course_title,attended_classes,total_classes\n"
)

FACULTY_CSV_TEMPLATE = (
    "faculty_id,full_name,designation,department,biometric_days_present,"
    "working_days_total,sponsored_grant_inr_lakhs\n"
)

_STUDENT_ALIASES: dict[str, str] = {
    "prn": "prn",
    "student_prn": "prn",
    "roll_no": "prn",
    "roll_number": "prn",
    "registration_no": "prn",
    "full_name": "full_name",
    "name": "full_name",
    "student_name": "full_name",
    "program": "program",
    "program_grade": "program",
    "degree": "program",
    "grade": "program",
    "department": "department",
    "dept": "department",
    "branch": "department",
    "board": "department",
    "batch_year": "batch_year",
    "batch": "batch_year",
    "graduation_year": "batch_year",
    "year": "batch_year",
    "declared_cgpa": "declared_cgpa",
    "cgpa": "declared_cgpa",
    "gpa": "declared_cgpa",
    "education_level": "education_level",
    "level": "education_level",
    "age_years": "age_years",
    "age": "age_years",
    "active_backlogs": "active_backlogs",
    "backlogs": "active_backlogs",
    "degree_status": "degree_status",
    "status": "degree_status",
    "enrollment_status": "degree_status",
    "parent_username": "parent_username",
    "guardian_username": "parent_username",
    "guardian": "parent_username",
    "disciplinary_standing": "disciplinary_standing",
    "conduct": "disciplinary_standing",
    "course_code": "course_code",
    "course_title": "course_title",
    "credits": "credits",
    "grade_point": "grade_point",
    "semester": "semester",
    "attended_classes": "attended_classes",
    "total_classes": "total_classes",
}

_FACULTY_ALIASES: dict[str, str] = {
    "faculty_id": "faculty_id",
    "emp_id": "faculty_id",
    "employee_id": "faculty_id",
    "id": "faculty_id",
    "full_name": "full_name",
    "name": "full_name",
    "faculty_name": "full_name",
    "designation": "designation",
    "title": "designation",
    "department": "department",
    "dept": "department",
    "biometric_days_present": "biometric_days_present",
    "days_present": "biometric_days_present",
    "present_days": "biometric_days_present",
    "working_days_total": "working_days_total",
    "working_days": "working_days_total",
    "total_working_days": "working_days_total",
    "sponsored_grant_inr_lakhs": "sponsored_grant_inr_lakhs",
    "grants_lakhs": "sponsored_grant_inr_lakhs",
    "sponsored_grants": "sponsored_grant_inr_lakhs",
    "grants": "sponsored_grant_inr_lakhs",
}

_STUDENT_REQUIRED = ("prn", "full_name", "program", "department", "batch_year", "declared_cgpa")
_FACULTY_REQUIRED = (
    "faculty_id",
    "full_name",
    "designation",
    "department",
    "biometric_days_present",
    "working_days_total",
)


@dataclass(frozen=True, slots=True)
class BulkRowError:
    row: int
    identifier: str
    error: str


@dataclass(frozen=True, slots=True)
class ParsedBulkStudents:
    records: list[StudentRecord]
    total_rows: int
    error_rows: int
    errors: list[BulkRowError]


@dataclass(frozen=True, slots=True)
class ParsedBulkFaculty:
    records: list[FacultyRecord]
    total_rows: int
    error_rows: int
    errors: list[BulkRowError]


def _norm_col(raw: str) -> str:
    return _NORM_HEADER_RE.sub("_", (raw or "").strip().lower()).strip("_")


def _decode_csv_text(raw: bytes) -> str:
    if len(raw) > BULK_CSV_MAX_BYTES:
        raise ValueError(f"CSV file exceeds {BULK_CSV_MAX_BYTES // (1024 * 1024)} MB limit")
    if not raw.strip():
        raise ValueError("Uploaded CSV file is empty")
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("CSV file must be UTF-8 encoded") from exc


def _format_pydantic_error(exc: ValidationError) -> str:
    parts: list[str] = []
    for err in exc.errors()[:3]:
        loc = ".".join(str(p) for p in err.get("loc", ()))
        msg = str(err.get("msg", "Invalid value")).replace("Value error, ", "")
        parts.append(f"{loc}: {msg}" if loc else msg)
    return "; ".join(parts)


def _iter_normalized_rows(
    raw: bytes,
    aliases: dict[str, str],
    required_fields: tuple[str, ...],
) -> list[tuple[int, dict[str, str]]]:
    text_body = _decode_csv_text(raw)
    reader = csv.reader(io.StringIO(text_body, newline=""))
    try:
        raw_headers = next(reader)
    except StopIteration as exc:
        raise ValueError("CSV file has no header row") from exc

    col_map: list[str | None] = []
    present_canonical: set[str] = set()
    for h in raw_headers:
        canonical = aliases.get(_norm_col(h))
        col_map.append(canonical)
        if canonical:
            present_canonical.add(canonical)

    missing = [f for f in required_fields if f not in present_canonical]
    if missing:
        raise ValueError(f"Missing required CSV column(s): {', '.join(missing)}")

    rows: list[tuple[int, dict[str, str]]] = []
    for excel_row_num, raw_vals in enumerate(reader, start=2):
        if not any((cell or "").strip() for cell in raw_vals):
            continue
        if len(rows) >= BULK_CSV_MAX_ROWS:
            raise ValueError(f"CSV exceeds maximum of {BULK_CSV_MAX_ROWS} rows per upload")
        row_dict: dict[str, str] = {}
        for idx, canonical in enumerate(col_map):
            if canonical is None:
                continue
            val = raw_vals[idx].strip() if idx < len(raw_vals) else ""
            if canonical not in row_dict or val:
                row_dict[canonical] = val
        rows.append((excel_row_num, row_dict))

    if not rows:
        raise ValueError("CSV contains a header row but zero data rows")
    return rows


def parse_students_csv(raw: bytes) -> ParsedBulkStudents:
    rows = _iter_normalized_rows(raw, _STUDENT_ALIASES, _STUDENT_REQUIRED)
    records: list[StudentRecord] = []
    errors: list[BulkRowError] = []
    error_rows = 0
    seen_prns: dict[str, int] = {}

    for row_num, data in rows:
        prn = data.get("prn", "").strip()
        if not prn:
            error_rows += 1
            if len(errors) < _MAX_ERRORS_RETURNED:
                errors.append(BulkRowError(row=row_num, identifier="", error="prn is required"))
            continue
        prn_key = prn.upper()
        if prn_key in seen_prns:
            error_rows += 1
            if len(errors) < _MAX_ERRORS_RETURNED:
                errors.append(
                    BulkRowError(
                        row=row_num,
                        identifier=prn,
                        error=f"Duplicate PRN {prn!r} already appears on row {seen_prns[prn_key]}",
                    )
                )
            continue
        seen_prns[prn_key] = row_num

        try:
            level_raw = (data.get("education_level") or "HEI").strip().upper()
            if level_raw not in ("HEI", "K12"):
                raise ValueError("education_level must be 'HEI' or 'K12'")
            age_val = int(data["age_years"]) if data.get("age_years") else 21
            backlogs_val = int(data["active_backlogs"]) if data.get("active_backlogs") else 0
            cgpa_val = float(data["declared_cgpa"])
            batch_val = int(data["batch_year"])

            courses: list[CourseGradeRecord] = []
            attendance: list[AttendanceRecord] = []
            cc = data.get("course_code", "").strip()
            ct = data.get("course_title", "").strip()
            if cc and ct:
                courses.append(
                    CourseGradeRecord(
                        course_code=cc,
                        course_title=ct,
                        credits=float(data["credits"]) if data.get("credits") else 4.0,
                        grade_point=float(data["grade_point"]) if data.get("grade_point") else cgpa_val,
                        semester=int(data["semester"]) if data.get("semester") else 1,
                    )
                )
            att_raw = data.get("attended_classes", "").strip()
            tot_raw = data.get("total_classes", "").strip()
            if cc and (att_raw or tot_raw):
                if not (att_raw and tot_raw):
                    raise ValueError("Both attended_classes and total_classes are required when logging attendance")
                attendance.append(
                    AttendanceRecord(
                        course_code=cc,
                        course_title=ct or cc,
                        attended_classes=int(att_raw),
                        total_classes=int(tot_raw),
                    )
                )

            rec = StudentRecord(
                prn=prn,
                full_name=data.get("full_name", "").strip(),
                program=data.get("program", "").strip(),
                department=data.get("department", "").strip(),
                batch_year=batch_val,
                education_level=level_raw,
                age_years=age_val,
                is_minor=age_val < 18,
                declared_cgpa=cgpa_val,
                active_backlogs=backlogs_val,
                degree_status=data.get("degree_status", "").strip() or "Enrolled",
                parent_username=data.get("parent_username", "").strip(),
                disciplinary_standing=data.get("disciplinary_standing", "").strip(),
                courses=courses,
                attendance=attendance,
            )
            records.append(rec)
        except ValidationError as exc:
            error_rows += 1
            if len(errors) < _MAX_ERRORS_RETURNED:
                errors.append(BulkRowError(row=row_num, identifier=prn, error=_format_pydantic_error(exc)))
        except ValueError as exc:
            error_rows += 1
            if len(errors) < _MAX_ERRORS_RETURNED:
                errors.append(BulkRowError(row=row_num, identifier=prn, error=str(exc)))

    return ParsedBulkStudents(
        records=records,
        total_rows=len(rows),
        error_rows=error_rows,
        errors=errors,
    )


def parse_faculty_csv(raw: bytes) -> ParsedBulkFaculty:
    rows = _iter_normalized_rows(raw, _FACULTY_ALIASES, _FACULTY_REQUIRED)
    records: list[FacultyRecord] = []
    errors: list[BulkRowError] = []
    error_rows = 0
    seen_ids: dict[str, int] = {}

    for row_num, data in rows:
        fid = data.get("faculty_id", "").strip()
        if not fid:
            error_rows += 1
            if len(errors) < _MAX_ERRORS_RETURNED:
                errors.append(BulkRowError(row=row_num, identifier="", error="faculty_id is required"))
            continue
        fid_key = fid.upper()
        if fid_key in seen_ids:
            error_rows += 1
            if len(errors) < _MAX_ERRORS_RETURNED:
                errors.append(
                    BulkRowError(
                        row=row_num,
                        identifier=fid,
                        error=f"Duplicate faculty_id {fid!r} already appears on row {seen_ids[fid_key]}",
                    )
                )
            continue
        seen_ids[fid_key] = row_num

        try:
            rec = FacultyRecord(
                faculty_id=fid,
                full_name=data.get("full_name", "").strip(),
                designation=data.get("designation", "").strip(),
                department=data.get("department", "").strip(),
                biometric_days_present=int(data["biometric_days_present"]),
                working_days_total=int(data["working_days_total"]),
                sponsored_grant_inr_lakhs=(
                    float(data["sponsored_grant_inr_lakhs"])
                    if data.get("sponsored_grant_inr_lakhs")
                    else 0.0
                ),
                publications=[],
            )
            records.append(rec)
        except ValidationError as exc:
            error_rows += 1
            if len(errors) < _MAX_ERRORS_RETURNED:
                errors.append(BulkRowError(row=row_num, identifier=fid, error=_format_pydantic_error(exc)))
        except ValueError as exc:
            error_rows += 1
            if len(errors) < _MAX_ERRORS_RETURNED:
                errors.append(BulkRowError(row=row_num, identifier=fid, error=str(exc)))

    return ParsedBulkFaculty(
        records=records,
        total_rows=len(rows),
        error_rows=error_rows,
        errors=errors,
    )


def summarize_bulk_preview(records: list[StudentRecord] | list[FacultyRecord]) -> list[dict[str, object]]:
    return [r.model_dump() for r in records[:_MAX_PREVIEW_ROWS]]
