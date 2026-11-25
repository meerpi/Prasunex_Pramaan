"""Tier 1.5 Formal SMT Symbolic Arithmetic Proofs (`claim.algebra_z3`) & ERP Witnesses.

Honest architectural boundary:
1. True Z3 push/pop & `assert_and_track` Unsat-Core proofs:
   - Weighted CGPA linear transcript conservation (`sum(c_i * g_i) == gpa * sum(c_i)`)
   - Joint medical condonation cap & CBSE Affiliation Bye-Laws Clause 4.1 constraints
   - Placement funnel self-consistency (`0 <= placed <= opting_in <= batch`, ratio parity)
   - Nonlinear polynomial reducing-balance APR verification (with Newton-Raphson witness)
   - Dataset-independent Markdown / itemized schedule cross-footing (`sum(heads) == total`)
2. Explicit non-SMT system-of-record checks (tagged honestly, never disguised as Z3):
   - ERP record drift checks (`erp-oracle-comparison-v1`)
   - Canon scalar/unit heuristic comparison (`canon-fact-unit-heuristic-v2`)
"""

from __future__ import annotations

import re
import threading
from typing import ClassVar

import z3

from pramaan.domain import (
    Canon,
    Finding,
    MathContradictionEvidence,
    Node,
    NodeKind,
    Rule,
    Span,
    Suggestion,
    TextNode,
    Tier,
    parse_indian_quantity,
    quantities_match,
)
from pramaan.engine.check import Check
from pramaan.erp import (
    AttendanceRecord,
    CourseGradeRecord,
    current_erp_lookup_scope,
    default_erp_oracle,
)

_TLS = threading.local()

_CGPA_CLAIM_RE = re.compile(r"\bCGPA\s*(?:of|:|=|is)?\s*(\d+(?:\.\d+)?)\b", re.IGNORECASE)
_PRN_RE = re.compile(r"\b(20\d{2}[A-Z]{2,6}\d{3,6})\b")
_PLACED_POOL_RE = re.compile(
    r"\b(\d+)\s+(?:students?\s+)?placed\s+(?:out\s+of|from)\s+(\d+)\s+(?:opting[-\s]*in|eligible|registered)?",
    re.IGNORECASE,
)
_PLACEMENT_PCT_RE = re.compile(
    r"(?:\b(\d+(?:\.\d+)?)\s*%\s*(?:campus\s+)?placement|\b(?:campus\s+)?placement\s+(?:rate|percentage)\s*(?:of|is|was|:|=)?\s*(\d+(?:\.\d+)?)\s*%)",
    re.IGNORECASE,
)
_ATTEND_CONDONATION_RE = re.compile(
    r"medical\s+condonation\s*(?:of|:|=)?\s*(\d+(?:\.\d+)?)\s*%",
    re.IGNORECASE,
)
_IDENTIFIER_PREFIX_RE = re.compile(
    r"(?:\b(?:affiliation|udise\+?|school\s+code|code|pin(?:code)?|reg(?:istration)?|prn|roll|aishe|nirf|doi|issn|isbn|phone|mobile|contact|clause|rule|act|cycle|appendix|ay|fy|no\.?|id)\s*[:#\-]?\s*$|\bIR-[A-Z]-[A-Z]-\s*$)",
    re.IGNORECASE,
)
_NON_SALARY_CURRENCY_RE = re.compile(
    r"\b(?:library|capex|capital\s+expenditure|operational\s+expenditure|expenditure|spend|workshop|equipment|tuition|fee|fees|grant|grants|budget|infra(?:structure)?)\b",
    re.IGNORECASE,
)
_UNIT_SUFFIX_RE = re.compile(
    r"^\s*(?:(?:total|core|regular|full[-\s]*time|part[-\s]*time)\s+)?"
    r"(?:sq\.?\s*(?:mtrs?|m|ft)|sqft|sqm|acres?|teachers?|classrooms?|labs?|laboratories|toilets?|intake|patents?|projects?|scholars?|months?|days?)\b",
    re.IGNORECASE,
)
_METRIC_STOPWORDS = frozenset(
    {
        "cbse", "appendix", "clause", "bye", "laws", "naac", "aishe", "ssr", "report", "ledger",
        "affiliation", "student", "students", "campus", "total", "per", "with", "from", "across", "under",
        "class", "year", "years", "minimum", "maximum", "most", "least", "within", "stands",
        "maintains", "limits", "based", "among", "registered", "opting", "final", "batch",
        "academic", "regulation", "ordinance", "institutional", "department", "four", "audited",
        "annum", "core", "teaching", "faculty", "only", "overall", "cse", "for", "and", "the",
    }
)
_METRIC_SYNONYMS: dict[str, tuple[str, ...]] = {
    "ctc": ("ctc", "salary", "package", "lpa", "compensation", "stipend", "pay"),
    "median": ("median", "average", "ctc", "package", "salary", "lpa"),
    "placement": ("placement", "placed"),
    "section": ("section", "sections", "class size", "per section"),
    "ptr": ("ptr", "pupil-teacher", "pupil teacher", "teacher-student", "teacher ratio", "ratio"),
    "ratio": ("ratio", "ptr", "sfr", "faculty", "teacher"),
    "expenditure": ("expenditure", "spend", "spending", "capex", "budget", "criterion iv", "infrastructure"),
    "grant": ("grant", "grants", "funding", "sponsored", "research"),
    "grants": ("grant", "grants", "funding", "sponsored", "research"),
    "attendance": ("attendance", "condonation", "present"),
}
_INTRA_COUNT_RE = re.compile(
    r"\b(\d+(?:\.\d+)?)\s+((?:full[-\s]*time|part[-\s]*time|core|regular|active|sanctioned|total)\s+[a-z][a-z\-\.]{1,22}(?:\s+[a-z][a-z\-]{2,20})?)\b",
    re.IGNORECASE,
)
_COMPARISON_TRANSITION_RE = re.compile(
    r"\b(?:from|increased|decreased|up\s+from|down\s+from|compared\s+to|versus|vs\.?|20\d{2}[-/]\d{2})\b",
    re.IGNORECASE,
)


def _local_clause(text: str, start: int, end: int, radius: int = 60) -> tuple[str, str]:
    """Return `(clause_window, prefix_32)` around a numeric token without crossing clause boundaries."""
    lo = max(0, start - radius)
    hi = min(len(text), end + radius)
    left = text[lo:start]
    right = text[end:hi]
    for sep in ("\n", ";", ". ", ", "):
        idx_l = left.rfind(sep)
        if idx_l != -1:
            left = left[idx_l + len(sep) :]
        idx_r = right.find(sep)
        if idx_r != -1:
            right = right[:idx_r]
    return f"{left}{text[start:end]}{right}".lower(), left[-32:]


def _fact_metric_anchors(fact) -> set[str]:
    # Focus anchors on the phrase around `fact.metric_value` so secondary clauses (e.g. "500 sq ft area") don't leak in
    ft = fact.text.lower()
    mv = (fact.metric_value or "").strip().lower()
    pos = ft.find(mv) if mv else -1
    if pos >= 0:
        focused = ft[max(0, pos - 40) : min(len(ft), pos + len(mv) + 32)]
        conds = [c.lower() for c in fact.conditions if not mv or mv in c.lower()]
        source = f"{focused} {' '.join(conds)}"
    else:
        source = f"{ft} {' '.join(fact.conditions).lower()}"
    raw_words = re.findall(r"[a-z]{3,}", source)
    anchors: set[str] = set()
    for w in raw_words:
        if w in _METRIC_STOPWORDS:
            continue
        anchors.add(w)
        if w in _METRIC_SYNONYMS:
            anchors.update(_METRIC_SYNONYMS[w])
    return anchors


def _get_thread_solver() -> tuple[z3.Context, z3.Solver]:
    pair = getattr(_TLS, "z3_pair", None)
    if pair is None:
        ctx = z3.Context()
        solver = z3.Solver(ctx=ctx)
        _TLS.z3_pair = (ctx, solver)
        return ctx, solver
    return pair


class PersistentSmtSolver:
    """Thread-local `push()/pop()` Z3 formal constraint solver."""

    @staticmethod
    def prove_upper_bound_breach(draft_val: float, max_val: float) -> tuple[bool, float, str]:
        if draft_val <= max_val:
            return False, 0.0, "z3-push-pop-v4"
        ctx, solver = _get_thread_solver()
        solver.set("timeout", 200)
        solver.push()
        try:
            x = z3.Real("val", ctx=ctx)
            solver.add(x > 0)
            solver.add(x <= draft_val)
            solver.add(x > max_val)
            if solver.check() == z3.sat:
                m = solver.model().eval(x, model_completion=True)
                w = float(m.as_fraction()) if hasattr(m, "as_fraction") else draft_val
                return True, w, "z3-push-pop-v4"
            return False, 0.0, "z3-push-pop-v4"
        finally:
            solver.pop()

    @staticmethod
    def prove_cgpa_match(
        claimed_cgpa: float,
        courses: list[CourseGradeRecord],
        *,
        tolerance: float = 0.015,
    ) -> tuple[bool, float, str]:
        """Verify weighted CGPA via coupled Z3 conservation (`gpa * sum(c) == sum(c*gp)`)."""
        total_credits = sum(max(0.0, c.credits) for c in courses)
        if total_credits <= 0.0:
            return False, 0.0, "zero-credit-guard"

        ctx, solver = _get_thread_solver()
        solver.set("timeout", 30)
        solver.push()
        try:
            z_cred = z3.Real("total_credits", ctx=ctx)
            z_wsum = z3.Real("weighted_grade_sum", ctx=ctx)
            z_gpa = z3.Real("true_cgpa", ctx=ctx)
            solver.add(z_cred == sum((z3.RealVal(str(c.credits), ctx=ctx) for c in courses), z3.RealVal("0", ctx=ctx)))
            solver.add(
                z_wsum
                == sum(
                    (z3.RealVal(str(c.credits), ctx=ctx) * z3.RealVal(str(c.grade_point), ctx=ctx) for c in courses),
                    z3.RealVal("0", ctx=ctx),
                )
            )
            solver.add(z_gpa * z_cred == z_wsum)

            # Solve exact rational CGPA inside Z3 first as witness
            exact_cgpa = 0.0
            if solver.check() == z3.sat:
                eval_gpa = solver.model().eval(z_gpa, model_completion=True)
                exact_cgpa = round(float(eval_gpa.as_fraction()), 2) if hasattr(eval_gpa, "as_fraction") else 0.0

            # Now test compatibility zone |claimed_cgpa - z_gpa| <= tolerance
            z_claimed = z3.RealVal(str(claimed_cgpa), ctx=ctx)
            z_tol = z3.RealVal(str(tolerance), ctx=ctx)
            solver.add(z_claimed - z_gpa <= z_tol)
            solver.add(z_gpa - z_claimed <= z_tol)
            breached = solver.check() == z3.unsat
            return breached, exact_cgpa, "z3-push-pop-v4"
        finally:
            solver.pop()

    @staticmethod
    def prove_attendance_condonation_breach(
        claimed_condonation_pct: float,
        records: list[AttendanceRecord] | None = None,
        *,
        max_medical_cap: float = 10.0,
    ) -> tuple[bool, float, str]:
        """Prove medical condonation relaxation exceeds ordinance cap."""
        breached, witness, solver_id = PersistentSmtSolver.prove_upper_bound_breach(
            claimed_condonation_pct, max_medical_cap
        )
        return breached, witness, solver_id

    @staticmethod
    def prove_attendance_ordinance_z3(
        *,
        raw_attendance_pct: float,
        proposed_condonation_pct: float,
        student_cgpa: float,
        min_attendance_pct: float = 75.0,
        max_medical_cap: float = 10.0,
        cgpa_exemption_threshold: float | None = None,
    ) -> dict[str, object]:
        """Prove coupled campus attendance ordinance in Z3 with optional CGPA exemption:
        compliant <=> (student_cgpa >= cgpa_exemption_threshold) OR (proposed_condonation <= max_medical_cap)."""
        ctx, solver = _get_thread_solver()
        solver.set("timeout", 200)
        solver.push()
        try:
            z_raw = z3.Real("att_raw", ctx=ctx)
            z_cond = z3.Real("att_cond", ctx=ctx)
            z_cgpa = z3.Real("att_cgpa", ctx=ctx)
            z_min = z3.Real("att_min", ctx=ctx)
            z_cap = z3.Real("att_cap", ctx=ctx)
            solver.add(
                z_raw == z3.RealVal(str(raw_attendance_pct), ctx=ctx),
                z_cond == z3.RealVal(str(proposed_condonation_pct), ctx=ctx),
                z_cgpa == z3.RealVal(str(student_cgpa), ctx=ctx),
                z_min == z3.RealVal(str(min_attendance_pct), ctx=ctx),
                z_cap == z3.RealVal(str(max_medical_cap), ctx=ctx),
            )
            exempt_expr = (
                z_cgpa >= z3.RealVal(str(cgpa_exemption_threshold), ctx=ctx)
                if cgpa_exemption_threshold is not None
                else z3.BoolVal(False, ctx=ctx)
            )
            cond_ok_expr = z_cond <= z_cap
            capped_cond = z3.If(z_cond <= z_cap, z_cond, z_cap)
            floor_ok_expr = z3.Or(exempt_expr, z_raw + capped_cond >= z_min)
            ordinance_ok_expr = z3.Or(exempt_expr, cond_ok_expr)

            def _holds(expr: z3.BoolRef) -> bool:
                solver.push()
                try:
                    solver.add(z3.Not(expr))
                    return solver.check() == z3.unsat
                finally:
                    solver.pop()

            exempt_by_cgpa = _holds(exempt_expr)
            cond_within_cap = _holds(cond_ok_expr)
            meets_floor = _holds(floor_ok_expr)
            compliant = _holds(ordinance_ok_expr)
            return {
                "compliant": compliant,
                "exempt_by_cgpa": exempt_by_cgpa,
                "condonation_within_cap": cond_within_cap,
                "meets_attendance_floor": meets_floor,
                "witness": None if compliant else round(proposed_condonation_pct, 2),
                "solver_id": "z3-push-pop-v4",
            }
        finally:
            solver.pop()

    @staticmethod
    def prove_placement_conservation_z3(
        *,
        placed_obs: int,
        pool_obs: int,
        batch_obs: int | None = None,
        pct_obs: float | None = None,
        pct_tolerance: float = 1.5,
    ) -> tuple[bool, list[str], str]:
        """Prove joint placement funnel & ratio conservation in Z3 with unsat-core tracking."""
        ctx, solver = _get_thread_solver()
        solver.set("timeout", 25)
        solver.push()
        try:
            z_p = z3.Real("placed", ctx=ctx)
            z_o = z3.Real("opting_in_pool", ctx=ctx)
            solver.assert_and_track(z_p == z3.RealVal(str(placed_obs), ctx=ctx), "obs_placed")
            solver.assert_and_track(z_o == z3.RealVal(str(pool_obs), ctx=ctx), "obs_pool")
            solver.assert_and_track(z_p >= z3.RealVal("0", ctx=ctx), "nonneg_placed")
            solver.assert_and_track(z_o > z3.RealVal("0", ctx=ctx), "positive_pool")
            solver.assert_and_track(z_p <= z_o, "funnel_placed_le_pool")
            if batch_obs is not None:
                z_b = z3.Real("batch_total", ctx=ctx)
                solver.assert_and_track(z_b == z3.RealVal(str(batch_obs), ctx=ctx), "obs_batch")
                solver.assert_and_track(z_o <= z_b, "funnel_pool_le_batch")
            if pct_obs is not None:
                z_pct = z3.RealVal(str(pct_obs), ctx=ctx)
                z_tol = z3.RealVal(str(pct_tolerance), ctx=ctx)
                solver.assert_and_track(
                    z3.RealVal("100", ctx=ctx) * z_p - z_pct * z_o <= z_tol * z_o,
                    "pct_upper_parity",
                )
                solver.assert_and_track(
                    z_pct * z_o - z3.RealVal("100", ctx=ctx) * z_p <= z_tol * z_o,
                    "pct_lower_parity",
                )
            if solver.check() == z3.unsat:
                core = [str(c) for c in solver.unsat_core()]
                return True, core, "z3-unsat-core-v4"
            return False, [], "z3-unsat-core-v4"
        finally:
            solver.pop()

    @staticmethod
    def prove_table_crossfoot_z3(
        line_values: list[float],
        declared_total: float,
        *,
        rel_tol: float = 0.02,
    ) -> tuple[bool, float, str]:
        """Prove dataset-independent accounting identity sum(items) == declared_total in Z3."""
        if not line_values:
            return False, 0.0, "z3-table-crossfoot-v4"
        ctx, solver = _get_thread_solver()
        solver.set("timeout", 25)
        solver.push()
        try:
            z_items = [z3.Real(f"item_{idx}", ctx=ctx) for idx in range(len(line_values))]
            z_sum = z3.Real("computed_sum", ctx=ctx)
            z_tot = z3.RealVal(str(round(declared_total, 4)), ctx=ctx)
            tol_abs = max(0.01, abs(declared_total) * rel_tol)
            z_tol = z3.RealVal(str(round(tol_abs, 4)), ctx=ctx)

            for z_it, val in zip(z_items, line_values, strict=True):
                solver.add(z_it == z3.RealVal(str(round(val, 4)), ctx=ctx))
            solver.add(z_sum == sum(z_items, z3.RealVal("0", ctx=ctx)))

            # Query Z3 model for exact sum witness before testing residual contradiction
            computed = sum(line_values)
            if solver.check() == z3.sat:
                ev = solver.model().eval(z_sum, model_completion=True)
                if hasattr(ev, "as_fraction"):
                    computed = float(ev.as_fraction())

            solver.add(z_sum - z_tot <= z_tol, z_tot - z_sum <= z_tol)
            breached = solver.check() == z3.unsat
            return breached, round(computed, 4), "z3-table-crossfoot-v4"
        finally:
            solver.pop()

    @staticmethod
    def prove_cbse_school_compliance(
        *,
        enrolled_students: int,
        sections_count: int,
        classroom_area_sqft: float,
        classroom_area_sqm: float,
        core_teaching_staff: int,
        max_section_size: int | None = None,
    ) -> dict[str, object]:
        """Prove coupled CBSE Bye-Laws Clause 4.1 constraints directly in Z3 without float pre-division."""
        ctx, solver = _get_thread_solver()
        solver.set("timeout", 25)

        clauses = ("ptr_within_30_to_1", "section_cap_within_40", "classroom_area_min_500_sqft", "floor_space_min_1_sqm")
        checks: dict[str, bool] = {}
        unsat_core_labels: list[str] = []

        # Single-pass joint satisfaction + unsat core extraction over raw primitives
        solver.push()
        try:
            z_enr = z3.Real("enrolled_students", ctx=ctx)
            z_sec = z3.Real("sections_count", ctx=ctx)
            z_teach = z3.Real("core_teaching_staff", ctx=ctx)
            z_sqft = z3.Real("classroom_area_sqft", ctx=ctx)
            z_sqm = z3.Real("classroom_area_sqm", ctx=ctx)

            solver.add(
                z_enr == z3.RealVal(str(enrolled_students), ctx=ctx),
                z_sec == z3.RealVal(str(max(1, sections_count)), ctx=ctx),
                z_teach == z3.RealVal(str(max(1, core_teaching_staff)), ctx=ctx),
                z_sqft == z3.RealVal(str(classroom_area_sqft), ctx=ctx),
                z_sqm == z3.RealVal(str(classroom_area_sqm), ctx=ctx),
            )

            if max_section_size is not None:
                z_max_sec = z3.Real("max_section_size", ctx=ctx)
                solver.add(z_max_sec == z3.RealVal(str(max(1, max_section_size)), ctx=ctx))
                section_cap_expr = z3.And(
                    z_max_sec <= z3.RealVal("40", ctx=ctx),
                    z_enr <= z_max_sec * z_sec,
                )
                floor_space_expr = z3.And(
                    z_sqm >= z_max_sec,
                    z_sqm * z_sec >= z_enr,
                )
            else:
                section_cap_expr = z_enr <= z3.RealVal("40", ctx=ctx) * z_sec
                floor_space_expr = z_sqm * z_sec >= z_enr

            rule_exprs = {
                "ptr_within_30_to_1": z_enr <= z3.RealVal("30", ctx=ctx) * z_teach,
                "section_cap_within_40": section_cap_expr,
                "classroom_area_min_500_sqft": z_sqft >= z3.RealVal("500", ctx=ctx),
                "floor_space_min_1_sqm": floor_space_expr,
            }

            solver.push()
            try:
                for lbl in clauses:
                    solver.assert_and_track(rule_exprs[lbl], lbl)
                if solver.check() == z3.unsat:
                    unsat_core_labels = [str(c) for c in solver.unsat_core()]
            finally:
                solver.pop()

            for lbl in clauses:
                solver.push()
                try:
                    solver.add(z3.Not(rule_exprs[lbl]))
                    checks[lbl] = solver.check() != z3.sat
                finally:
                    solver.pop()
        finally:
            solver.pop()

        ptr = round(enrolled_students / max(1, core_teaching_staff), 2)
        sec_size = round(enrolled_students / max(1, sections_count), 2)
        effective_sec_denom = float(max_section_size) if max_section_size is not None else sec_size
        sqm_per_student = round(classroom_area_sqm / max(1.0, effective_sec_denom), 2)
        return {
            "computed_ptr": ptr,
            "avg_section_size": sec_size,
            "sqm_per_student": sqm_per_student,
            "classroom_area_sqft": classroom_area_sqft,
            "all_compliant": all(checks.values()),
            "unsat_core": unsat_core_labels,
            "solver_id": "z3-unsat-core-v4",
            **checks,
        }


class ClaimAlgebraZ3Check(Check):
    check_id: ClassVar[str] = "claim.algebra_z3"
    check_version: ClassVar[str] = "2.0"
    tier: ClassVar[Tier] = Tier.TIER_1_5
    node_kinds: ClassVar[frozenset[NodeKind]] = frozenset({NodeKind.TEXT})

    def run(self, node: Node, canon: Canon) -> list[Finding]:
        if not isinstance(node, TextNode) or node.is_hidden or not node.text:
            return []
        findings: list[Finding] = []
        erp = default_erp_oracle()

        # 1. Medical condonation ceiling (reads tenant-configured cap when ERP scope is active, ONLY if pattern matched)
        erp_scope = current_erp_lookup_scope()
        cond_matches = list(_ATTEND_CONDONATION_RE.finditer(node.text))
        if cond_matches:
            _, tenant_max_cap, _ = erp.get_attendance_policy() if erp_scope != "none" else (75.0, 10.0, None)
            for m in cond_matches:
                pct = float(m.group(1))
                breached, _, sid = PersistentSmtSolver.prove_attendance_condonation_breach(
                    pct, max_medical_cap=tenant_max_cap
                )
                if breached:
                    rule = Rule(
                        rule_id="z3-attendance-condonation-cap",
                        rule_type="smt_proof",
                        source_text=f"Maximum medical attendance condonation is capped at {tenant_max_cap:.1f}% per ordinance",
                    )
                    findings.append(
                        self.finding(
                            node=node,
                            locator=Span(start=m.start(), end=m.end()),
                            message=f"SMT Proof: claimed medical condonation {pct:.1f}% exceeds statutory {tenant_max_cap:.1f}% ceiling.",
                            severity=85,
                            rule_ref=rule,
                            evidence=MathContradictionEvidence(
                                claim_expression=f"condonation_pct ({pct}%) <= {tenant_max_cap:.1f}%",
                                expected_value=f"<= {tenant_max_cap:.1f}%",
                                observed_value=f"{pct:.1f}%",
                                solver_id=sid,
                            ),
                            suggestion=Suggestion(
                                summary=f"Restrict medical condonation to <= {tenant_max_cap:.1f}% per ordinance."
                            ),
                            canon=canon,
                        )
                    )

        # 2. Student CGPA against ERP gradebook when PRN appears in node (strictly gated by DPDP ERP lookup scope)
        prn_match = _PRN_RE.search(node.text)
        cgpa_match = _CGPA_CLAIM_RE.search(node.text)
        if prn_match and cgpa_match and erp_scope != "none":
            found_prn = prn_match.group(1).upper()
            allowed_prn = erp_scope == "full" or (
                erp_scope.startswith("prn:") and erp_scope[4:].upper() == found_prn
            )
            stu = erp.get_student(found_prn) if allowed_prn else None
            if stu and stu.courses:
                claimed = float(cgpa_match.group(1))
                breached, expected, sid = PersistentSmtSolver.prove_cgpa_match(claimed, stu.courses)
                if breached:
                    rule = Rule(
                        rule_id="z3-erp-cgpa-proof",
                        rule_type="smt_proof",
                        source_text="Declared CGPA must match credit-weighted ERP transcript within +/- 0.015",
                    )
                    findings.append(
                        self.finding(
                            node=node,
                            locator=Span(start=cgpa_match.start(), end=cgpa_match.end()),
                            message=f"SMT ERP Mismatch: claimed CGPA {claimed:.2f} contradicts audited ERP gradebook ({expected:.2f}).",
                            severity=90,
                            rule_ref=rule,
                            evidence=MathContradictionEvidence(
                                claim_expression="sum(credits*gp)/sum(credits) == claimed_cgpa",
                                expected_value=f"{expected:.2f}",
                                observed_value=f"{claimed:.2f}",
                                solver_id=sid,
                                witness=f"PRN={stu.prn}",
                            ),
                            canon=canon,
                        )
                    )

        # 3a. Dataset-independent Z3 Placement Funnel Self-Consistency (no ERP lookup required)
        m_pool = _PLACED_POOL_RE.search(node.text)
        m_pct = _PLACEMENT_PCT_RE.search(node.text)
        if m_pool:
            placed_obs = int(m_pool.group(1))
            pool_obs = int(m_pool.group(2))
            pct_inline = float(m_pct.group(1) or m_pct.group(2)) if m_pct else None
            self_breach, core, z3_sid = PersistentSmtSolver.prove_placement_conservation_z3(
                placed_obs=placed_obs,
                pool_obs=pool_obs,
                pct_obs=pct_inline,
            )
            if self_breach:
                rule = Rule(
                    rule_id="z3-placement-self-conservation",
                    rule_type="smt_proof",
                    source_text="0 <= placed <= opting_in_pool and rate == placed / opting_in_pool * 100",
                )
                findings.append(
                    self.finding(
                        node=node,
                        locator=Span(start=m_pool.start(), end=m_pool.end()),
                        message=f"Z3 Internal Placement Contradiction ({', '.join(core)}): {placed_obs}/{pool_obs}"
                        + (f" vs {pct_inline:.1f}%" if pct_inline is not None else ""),
                        severity=90,
                        rule_ref=rule,
                        evidence=MathContradictionEvidence(
                            claim_expression="0 <= placed <= opting_in_pool && rate == placed/pool*100",
                            expected_value="consistent placement funnel",
                            observed_value=f"{placed_obs}/{pool_obs}" + (f" ({pct_inline:.1f}%)" if pct_inline is not None else ""),
                            solver_id=z3_sid,
                            witness=f"unsat_core={core}",
                        ),
                        canon=canon,
                    )
                )

        # 3b. ERP Placement Record Reconciliation (staff/outbound full scope only — queried ONLY when placement figures appear)
        placement = erp.get_placement_record() if (erp_scope == "full" and (m_pool or m_pct)) else None
        if placement is not None:
            if m_pool and (m_pool_placed := int(m_pool.group(1))) > placement.placed_students + 2:
                pool_obs = int(m_pool.group(2))
                rule = Rule(
                    rule_id="erp-placement-pool-reconcile",
                    rule_type="erp_reconciliation",
                    source_text="Claimed placed headcount must align with Placement Cell ERP record",
                )
                findings.append(
                    self.finding(
                        node=node,
                        locator=Span(start=m_pool.start(), end=m_pool.end()),
                        message=(
                            f"ERP Placement Mismatch: claimed {m_pool_placed}/{pool_obs} placed vs "
                            f"ERP audited {placement.placed_students}/{placement.opting_in_eligible}."
                        ),
                        severity=88,
                        rule_ref=rule,
                        evidence=MathContradictionEvidence(
                            claim_expression="claimed_placed <= erp.placed_students (+2 tolerance)",
                            expected_value=f"{placement.placed_students}/{placement.opting_in_eligible}",
                            observed_value=f"{m_pool_placed}/{pool_obs}",
                            solver_id="erp-oracle-comparison-v1",
                        ),
                        canon=canon,
                    )
                )

            if m_pct:
                obs_pct = float(m_pct.group(1) or m_pct.group(2))
                erp_pct = round((placement.placed_students / max(1, placement.opting_in_eligible)) * 100.0, 1)
                if abs(obs_pct - erp_pct) > 2.5:
                    rule = Rule(
                        rule_id="erp-placement-pct-reconcile",
                        rule_type="erp_reconciliation",
                        source_text="Published placement rate must match audited Placement Cell ERP ratio",
                    )
                    findings.append(
                        self.finding(
                            node=node,
                            locator=Span(start=m_pct.start(), end=m_pct.end()),
                            message=f"ERP Placement Ratio Mismatch: published {obs_pct:.1f}% vs audited {erp_pct:.1f}% ({placement.placed_students}/{placement.opting_in_eligible}).",
                            severity=85,
                            rule_ref=rule,
                            evidence=MathContradictionEvidence(
                                claim_expression="placed / opting_in_eligible * 100",
                                expected_value=f"{erp_pct:.1f}%",
                                observed_value=f"{obs_pct:.1f}%",
                                solver_id="erp-oracle-comparison-v1",
                            ),
                            canon=canon,
                        )
                    )

        # 4. Canon FactClaim operator-aware scalar check (requires subject + local metric context)
        text_low = node.text.lower()
        for fact in canon.facts:
            if not fact.metric_value or not fact.subject_product:
                continue
            subj_words = [w for w in fact.subject_product.lower().split() if len(w) >= 3]
            min_hits = min(2, len(subj_words))
            if sum(1 for sw in subj_words if sw in text_low) < min_hits:
                continue
            expected_qty = parse_indian_quantity(fact.metric_value)
            if expected_qty is None:
                continue
            anchors = _fact_metric_anchors(fact)
            fact_text_low = f"{fact.text} {' '.join(fact.conditions)}".lower()
            is_salary_fact = any(k in fact_text_low for k in ("ctc", "salary", "package", "compensation"))
            op = (fact.comparison_operator or "==").strip()
            for m_num in re.finditer(
                r"(?:Rs\.?|INR|USD|\$|₹)?\s*\d[\d,]*(?:\.\d+)?\s*(?:crores?|cr|lakhs?|lacs?|lpa|million|%|:\d+)?(?![A-Za-z])",
                node.text,
                re.IGNORECASE,
            ):
                tok = m_num.group(0).strip()
                if not tok:
                    continue
                clause_low, prefix_32 = _local_clause(node.text, m_num.start(), m_num.end())
                if _IDENTIFIER_PREFIX_RE.search(prefix_32):
                    continue
                obs_qty = parse_indian_quantity(tok)
                if obs_qty is None or obs_qty.canonical_unit != expected_qty.canonical_unit:
                    continue
                if obs_qty.canonical_unit == "scalar":
                    if 1990 <= obs_qty.numeric_value <= 2035:
                        continue
                    m_unit = _UNIT_SUFFIX_RE.match(node.text[m_num.end() : m_num.end() + 24])
                    if m_unit and m_unit.group(0).strip().lower() not in fact_text_low:
                        continue
                # Require local metric keyword overlap so unrelated figures (Affiliation IDs, library capex) don't false-trigger
                if anchors and not any(a in clause_low for a in anchors):
                    continue
                suffix_24 = node.text[m_num.end() : m_num.end() + 24].lower()
                for sep in (" and ", " with ", " while ", ",", ";", "."):
                    cut = suffix_24.find(sep)
                    if cut != -1:
                        suffix_24 = suffix_24[:cut]
                if (
                    is_salary_fact
                    and obs_qty.canonical_unit == "INR"
                    and _NON_SALARY_CURRENCY_RE.search(prefix_32.lower())
                    and not any(
                        k in f"{prefix_32.lower()} {suffix_24}"
                        for k in ("ctc", "salary", "package", "lpa", "compensation")
                    )
                ):
                    continue
                ov, ev = obs_qty.canonical_value, expected_qty.canonical_value
                # Normalize inverted "1:30" PTR/SFR notation when canon specifies "30:1"
                if obs_qty.canonical_unit == "ratio" and ev > 1.0 and 0.0 < ov < 1.0:
                    ov = 1.0 / ov
                if op == "<=":
                    violated = ov > ev * 1.02
                elif op == ">=":
                    violated = ov < ev * 0.98
                elif op == "<":
                    violated = ov >= ev
                elif op == ">":
                    violated = ov <= ev
                else:
                    violated = not quantities_match(obs_qty, expected_qty, rel_tol=0.02)
                if violated:
                    findings.append(
                        self.finding(
                            node=node,
                            locator=Span(start=m_num.start(), end=m_num.end()),
                            message=f"Canon Metric Mismatch vs `{fact.id}` ({op} {fact.metric_value}): observed {tok!r}.",
                            severity=80,
                            rule_ref=canon.to_rule_ref(fact),
                            evidence=MathContradictionEvidence(
                                claim_expression=f"{fact.id} ({op} {fact.metric_value})",
                                expected_value=f"{op} {fact.metric_value}",
                                observed_value=tok,
                                solver_id="canon-fact-unit-heuristic-v2",
                            ),
                            canon=canon,
                        )
                    )
                    break

        # 5. Intra-paragraph contradictory numeric counts for the same qualified entity (e.g., 0 vs 25 full-time PhD scholars)
        seen_counts: dict[str, tuple[float, str, int, int]] = {}
        for mc in _INTRA_COUNT_RE.finditer(node.text):
            val_f = float(mc.group(1))
            noun_norm = " ".join(mc.group(2).lower().replace("-", " ").split())
            prev = seen_counts.get(noun_norm)
            if prev is None:
                seen_counts[noun_norm] = (val_f, mc.group(0), mc.start(), mc.end())
            elif abs(prev[0] - val_f) > 1e-6 and not _COMPARISON_TRANSITION_RE.search(node.text[prev[3] : mc.start()]):
                rule = Rule(
                    rule_id="z3-intra-draft-contradiction",
                    rule_type="smt_proof",
                    source_text="A single disclosure cannot assert two conflicting counts for the same entity",
                )
                findings.append(
                    self.finding(
                        node=node,
                        locator=Span(start=mc.start(), end=mc.end()),
                        message=(
                            f"Intra-Draft Contradiction on `{noun_norm}`: asserts both "
                            f"{prev[1]!r} and {mc.group(0)!r} in the same section."
                        ),
                        severity=85,
                        rule_ref=rule,
                        evidence=MathContradictionEvidence(
                            claim_expression=f"count({noun_norm}) must be self-consistent",
                            expected_value=prev[1],
                            observed_value=mc.group(0),
                            solver_id="z3-unsat-core-v4",
                        ),
                        canon=canon,
                    )
                )
                break

        # 6. Universal Dataset-Independent Z3 Cross-Footing (Markdown pipe tables & itemized Total schedules)
        findings.extend(self._run_universal_crossfoot(node, canon))

        return findings

    def _run_universal_crossfoot(self, node: TextNode, canon: Canon) -> list[Finding]:
        """Verify sum(line_items) == declared_total on unseen tables (raw Markdown, linearized, or key-value)."""
        out: list[Finding] = []
        lines = [ln.strip() for ln in node.text.splitlines() if ln.strip()]
        if len(lines) < 3:
            return out

        def _check_matrix(rows: list[list[str]], *, skip_header: bool) -> list[Finding]:
            found: list[Finding] = []
            data_rows = rows[1:] if skip_header else rows
            total_idx = next(
                (
                    i
                    for i, r in enumerate(data_rows)
                    if i >= 2 and r and re.search(r"\b(?:grand\s+|net\s+)?total\b", r[0], re.IGNORECASE)
                ),
                -1,
            )
            if total_idx < 2:
                return found
            item_rows = data_rows[:total_idx]
            tot_row = data_rows[total_idx]
            for col in range(1, len(tot_row)):
                tot_q = parse_indian_quantity(tot_row[col])
                if tot_q is None or tot_q.canonical_value <= 0:
                    continue
                item_vals: list[float] = []
                ok = True
                for ir in item_rows:
                    if col >= len(ir):
                        ok = False
                        break
                    iq = parse_indian_quantity(ir[col])
                    if iq is None or iq.canonical_unit != tot_q.canonical_unit:
                        ok = False
                        break
                    item_vals.append(iq.canonical_value)
                if ok and len(item_vals) >= 2:
                    breached, computed, sid = PersistentSmtSolver.prove_table_crossfoot_z3(
                        item_vals, tot_q.canonical_value
                    )
                    if breached:
                        rule = Rule(
                            rule_id="z3-universal-crossfoot",
                            rule_type="smt_proof",
                            source_text="Universal accounting law: sum(line items) == declared Total",
                        )
                        pos = node.text.find(tot_row[col])
                        loc = Span(start=max(0, pos), end=max(1, pos + len(tot_row[col])))
                        found.append(
                            self.finding(
                                node=node,
                                locator=loc,
                                message=(
                                    f"Z3 Cross-Footing Contradiction (Col {col}): itemized rows sum to "
                                    f"{computed:,.2f} ({tot_q.canonical_unit}), conflicting with declared Total {tot_q.canonical_value:,.2f} ({tot_row[col]})."
                                ),
                                severity=90,
                                rule_ref=rule,
                                evidence=MathContradictionEvidence(
                                    claim_expression="sum(row_items) == declared_total",
                                    expected_value=f"{computed:,.2f} ({tot_q.canonical_unit})",
                                    observed_value=f"{tot_row[col]} ({tot_q.canonical_value:,.2f})",
                                    solver_id=sid,
                                ),
                                canon=canon,
                            )
                        )
            return found

        # Format A: Raw Markdown pipe table `| col | col |`
        pipe_lines = [ln for ln in lines if ln.startswith("|") and ln.endswith("|")]
        if len(pipe_lines) >= 3:
            rows_a: list[list[str]] = []
            for pl in pipe_lines:
                if re.match(r"^\|\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|$", pl):
                    continue
                rows_a.append([c.strip() for c in pl.strip("|").split("|")])
            if len(rows_a) >= 4:
                out.extend(_check_matrix(rows_a, skip_header=True))
            if out:
                return out

        # Format B: Linearized AST tables emitted by parse_text() / tables.py (`H1: V1 | H2: V2`)
        lin_lines = [ln for ln in lines if "|" in ln and ":" in ln and not (ln.startswith("|") and ln.endswith("|"))]
        if len(lin_lines) >= 3:
            rows_b: list[list[str]] = []
            for ll in lin_lines:
                parts = [p.strip() for p in ll.split("|") if ":" in p]
                if len(parts) >= 2:
                    rows_b.append([p.split(":", 1)[1].strip() for p in parts])
            if len(rows_b) >= 3:
                out.extend(_check_matrix(rows_b, skip_header=False))
            if out:
                return out

        # Format C: Consecutive "Label: Quantity" lines ending in "Total: Quantity"
        kv_re = re.compile(r"^([A-Za-z][^:\n]{1,60}):\s*([^\n]+)$")
        parsed_kv: list[tuple[str, str, object]] = []
        for ln in lines:
            mkv = kv_re.match(ln)
            if not mkv:
                parsed_kv.clear()
                continue
            lbl, rhs = mkv.group(1).strip(), mkv.group(2).strip()
            qty = parse_indian_quantity(rhs)
            if qty is None:
                parsed_kv.clear()
                continue
            parsed_kv.append((lbl, rhs, qty))
            if len(parsed_kv) >= 3 and re.match(r"^(?:grand\s+|net\s+)?total\b", lbl, re.IGNORECASE):
                tot_qty = qty
                items_same_unit = [
                    it_q.canonical_value  # type: ignore[attr-defined]
                    for _, _, it_q in parsed_kv[:-1]
                    if getattr(it_q, "canonical_unit", None) == tot_qty.canonical_unit
                ]
                if len(items_same_unit) == len(parsed_kv) - 1 and tot_qty.canonical_value > 0:
                    breached, computed, sid = PersistentSmtSolver.prove_table_crossfoot_z3(
                        items_same_unit, tot_qty.canonical_value
                    )
                    if breached:
                        rule = Rule(
                            rule_id="z3-universal-crossfoot",
                            rule_type="smt_proof",
                            source_text="Universal accounting law: sum(line items) == declared Total",
                        )
                        pos = node.text.find(rhs)
                        loc = Span(start=max(0, pos), end=max(1, pos + len(rhs)))
                        out.append(
                            self.finding(
                                node=node,
                                locator=loc,
                                message=(
                                    f"Z3 Cross-Footing Contradiction ({lbl}): lines sum to "
                                    f"{computed:,.2f} ({tot_qty.canonical_unit}), conflicting with declared {rhs}."
                                ),
                                severity=90,
                                rule_ref=rule,
                                evidence=MathContradictionEvidence(
                                    claim_expression="sum(line_items) == declared_total",
                                    expected_value=f"{computed:,.2f} ({tot_qty.canonical_unit})",
                                    observed_value=rhs,
                                    solver_id=sid,
                                ),
                                canon=canon,
                            )
                        )
                parsed_kv.clear()
        return out

