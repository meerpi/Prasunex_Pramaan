"""Pramaan CLI: `pramaan verify` pre-publish gate & `pramaan serve` API launcher."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pramaan.canon import default_canon_registry
from pramaan.engine import default_calibrator, run_checks_sync
from pramaan.parsers import default_bundle_parser


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pramaan", description="Pramaan Campus Governance CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)

    v = sub.add_parser("verify", help="Verify a document/folder against a Canon playbook")
    v.add_argument("path", type=str, help="File or directory to verify")
    v.add_argument("--canon", default="pramaan-campus-placement", help="Canon ID")
    v.add_argument("--alpha", type=float, default=0.10, help="Conformal FNR risk budget")

    s = sub.add_parser("serve", help="Run the FastAPI server")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)

    m = sub.add_parser("migrate", help="Apply or inspect versioned database migrations")
    m.add_argument("--status", action="store_true", help="Print migration status without applying")

    args = parser.parse_args(argv)
    if args.cmd == "serve":
        import uvicorn

        uvicorn.run("pramaan.api:app", host=args.host, port=args.port, reload=False)
        return 0
    if args.cmd == "migrate":
        import asyncio

        from pramaan.store import configure_database
        from pramaan.store.migrations import get_migration_status, run_migrations

        async def _do_migrate() -> dict[str, object]:
            engine = configure_database()
            applied = [] if args.status else await run_migrations(engine)
            status = await get_migration_status(engine)
            await engine.dispose()
            return {"applied_now": applied, **status}

        print(json.dumps(asyncio.run(_do_migrate()), indent=2))
        return 0

    target = Path(args.path)
    if not target.exists():
        print(f"Path not found: {target}", file=sys.stderr)
        return 2
    canon = default_canon_registry.get(args.canon)
    targets = sorted(p for p in target.rglob("*") if p.is_file()) if target.is_dir() else [target]
    blockers = 0
    total_findings = 0
    for fpath in targets:
        ast = default_bundle_parser.parse_one((fpath.name, fpath.read_bytes()))
        cal = default_calibrator.filter_and_calibrate_findings(run_checks_sync(ast, canon), alpha=args.alpha)
        total_findings += len(cal)
        blockers += sum(1 for f in cal if f.severity >= 50)
    print(json.dumps({"canon_id": canon.id, "files": len(targets), "total_findings": total_findings, "blockers": blockers}, indent=2))
    return 1 if blockers else 0


if __name__ == "__main__":
    raise SystemExit(main())

