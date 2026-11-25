"""Bounded-Concurrency Batch Governance Runner with Per-Asset Bulkhead Isolation."""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Literal

from pramaan.canon import default_canon_registry
from pramaan.domain import Canon, ContentAST, Finding, content_hash
from pramaan.engine import default_calibrator, run_checks_collect
from pramaan.erp import default_erp_oracle
from pramaan.parsers import default_bundle_parser

GateDecision = Literal["allow", "needs_review", "block"]


@dataclass(slots=True)
class BatchItemResult:
    item_id: str
    filename: str
    status: Literal["completed", "failed"]
    decision: GateDecision
    findings_count: int
    blockers_count: int
    warnings_count: int
    findings: list[Finding] = field(default_factory=list)
    error: str | None = None


@dataclass(slots=True)
class BatchJob:
    job_id: str
    canon_id: str
    alpha: float
    status: Literal["running", "completed", "failed"]
    created_at: str
    tenant_id: str = "default"
    elapsed_ms: float = 0.0
    total_items: int = 0
    completed_items: int = 0
    items: list[BatchItemResult] = field(default_factory=list)


_MAX_BATCH_JOBS = 128
_MAX_BATCH_ITEMS = 100


class BatchGovernanceRunner:
    def __init__(self, *, max_concurrency: int = 4) -> None:
        self._sem = asyncio.Semaphore(max_concurrency)
        self.jobs: OrderedDict[str, BatchJob] = OrderedDict()

    @staticmethod
    def _serialize_job(job: BatchJob) -> str:
        return json.dumps(
            {
                "job_id": job.job_id,
                "canon_id": job.canon_id,
                "alpha": job.alpha,
                "status": job.status,
                "created_at": job.created_at,
                "tenant_id": job.tenant_id,
                "elapsed_ms": job.elapsed_ms,
                "total_items": job.total_items,
                "completed_items": job.completed_items,
                "items": [
                    {
                        "item_id": it.item_id,
                        "filename": it.filename,
                        "status": it.status,
                        "decision": it.decision,
                        "findings_count": it.findings_count,
                        "blockers_count": it.blockers_count,
                        "warnings_count": it.warnings_count,
                        "findings": [f.model_dump(mode="json") for f in it.findings],
                        "error": it.error,
                    }
                    for it in job.items
                ],
            }
        )

    @staticmethod
    def _deserialize_job(raw_json: str) -> BatchJob:
        d = json.loads(raw_json)
        items = [
            BatchItemResult(
                item_id=str(it["item_id"]),
                filename=str(it["filename"]),
                status=it["status"],
                decision=it["decision"],
                findings_count=int(it["findings_count"]),
                blockers_count=int(it["blockers_count"]),
                warnings_count=int(it["warnings_count"]),
                findings=[Finding.model_validate(f) for f in (it.get("findings") or [])],
                error=it.get("error"),
            )
            for it in (d.get("items") or [])
        ]
        return BatchJob(
            job_id=str(d["job_id"]),
            canon_id=str(d["canon_id"]),
            alpha=float(d["alpha"]),
            status=d["status"],
            created_at=str(d["created_at"]),
            tenant_id=str(d.get("tenant_id") or "default"),
            elapsed_ms=float(d.get("elapsed_ms") or 0.0),
            total_items=int(d.get("total_items") or len(items)),
            completed_items=int(d.get("completed_items") or len(items)),
            items=items,
        )

    def get_job(self, job_id: str, *, tenant_id: str) -> BatchJob | None:
        cached = self.jobs.get(job_id)
        if cached is not None and cached.tenant_id == tenant_id:
            return cached
        raw_json = default_erp_oracle().get_mcp_batch_job(job_id, tenant_id=tenant_id)
        if not raw_json:
            return None
        job = self._deserialize_job(raw_json)
        self.jobs[job_id] = job
        self.jobs.move_to_end(job_id)
        while len(self.jobs) > _MAX_BATCH_JOBS:
            self.jobs.popitem(last=False)
        return job

    async def run_batch(
        self,
        *,
        canon_id: str,
        assets: list[tuple[str, bytes | str]],
        alpha: float = 0.10,
        canon: Canon | None = None,
        tenant_id: str = "default",
    ) -> BatchJob:
        if not (0.01 <= alpha <= 0.50):
            raise ValueError("alpha must be between 0.01 and 0.50")
        if len(assets) > _MAX_BATCH_ITEMS:
            raise ValueError(f"Batch exceeds maximum of {_MAX_BATCH_ITEMS} items")
        resolved_canon = canon or default_canon_registry.get(canon_id)
        t0 = time.perf_counter()
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        job = BatchJob(
            job_id=job_id,
            canon_id=resolved_canon.id,
            alpha=alpha,
            status="running",
            created_at=dt.datetime.now(dt.UTC).isoformat(),
            tenant_id=tenant_id,
            total_items=len(assets),
        )
        self.jobs[job_id] = job
        self.jobs.move_to_end(job_id)
        while len(self.jobs) > _MAX_BATCH_JOBS:
            self.jobs.popitem(last=False)

        async def _audit_one(idx: int, name: str, raw: bytes | str) -> BatchItemResult:
            async with self._sem:
                raw_bytes = raw.encode("utf-8") if isinstance(raw, str) else raw
                try:
                    ast: ContentAST = await asyncio.to_thread(
                        default_bundle_parser.parse_one, (name, raw_bytes)
                    )
                    raw_f = await run_checks_collect(ast, resolved_canon)
                    cal_f = default_calibrator.filter_and_calibrate_findings(raw_f, alpha=alpha)
                    blk = sum(1 for f in cal_f if f.severity >= 50)
                    wrn = len(cal_f) - blk
                    dec: GateDecision = "block" if blk > 0 else ("needs_review" if wrn > 0 else "allow")
                    return BatchItemResult(
                        item_id=f"{content_hash(raw_bytes)[:8]}-{idx}",
                        filename=name,
                        status="completed",
                        decision=dec,
                        findings_count=len(cal_f),
                        blockers_count=blk,
                        warnings_count=wrn,
                        findings=cal_f,
                    )
                except Exception as exc:
                    return BatchItemResult(
                        item_id=f"err-{idx}",
                        filename=name,
                        status="failed",
                        decision="block",
                        findings_count=0,
                        blockers_count=1,
                        warnings_count=0,
                        error=str(exc),
                    )

        results = await asyncio.gather(*[_audit_one(i, n, r) for i, (n, r) in enumerate(assets)])
        job.items = list(results)
        job.completed_items = len(results)
        job.status = "completed"
        job.elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
        await asyncio.to_thread(
            default_erp_oracle().save_mcp_batch_job,
            job.job_id,
            tenant_id=tenant_id,
            payload_json=self._serialize_job(job),
            created_at=job.created_at,
            max_rows=_MAX_BATCH_JOBS,
        )
        return job


default_batch_runner = BatchGovernanceRunner()

