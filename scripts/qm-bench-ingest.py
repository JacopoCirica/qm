# /// script
# requires-python = ">=3.12"
# dependencies = ["chz", "httpx", "python-dotenv"]
# ///
"""Push one qm-bench run to the platform's public /v1 eval API.

The benchmark itself lives in YC's repo (yc-software/qm, `npm run bench:qm`);
this script only reads a run directory it wrote:

    uv run scripts/qm-bench-ingest.py run_dir=/path/to/qm/runs/qm-bench/<run_id>            # dry run (default)
    uv run scripts/qm-bench-ingest.py run_dir=... dry_run=false reference_label=anthropic/fable-5

Shape follows docs/workflow-taxonomy.md (feature/workflow-taxonomy): one eval
group per task FAMILY, one task per benchmark task carrying a `workflow`
definition, and one run per task per push with the bench cases as `cases[]`.
Task slugs are the benchmark's own ids and never change.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import chz
import httpx
from dotenv import load_dotenv

API_KEY_ENV = "TRAINLOOP_API_KEY"
TAXONOMY_VERSION = "2026-09-06"
SOURCE = "github:yc-software/qm src/bench"
TARGET_SYSTEMS = ["qm"]
FAMILY_DISPLAY = {
    "founder-support": "Founder support",
    "office-hours": "Office hours",
    "portfolio": "Portfolio",
    "network": "Network",
    "events": "Events",
    "finance": "Finance",
    "legal": "Legal",
    "knowledge": "Knowledge",
}

load_dotenv(Path(__file__).parent / ".env")


@chz.chz
class Config:
    run_dir: str = ""
    api_base: str = "https://api-test.trainloop.ai"
    dry_run: bool = True
    reference_label: str = ""  # non-empty marks the run as a level to beat (frontier baseline)
    variant: str = "Score"


def group_payload(family: str) -> dict[str, object]:
    return {
        "slug": family,
        "display_name": FAMILY_DISPLAY[family],
        "score_format": "percent",
        "score_aggregation": "mean",
        "source": SOURCE,
    }


def task_payload(slug: str, row: dict[str, object]) -> dict[str, object]:
    outputs = row["outputs"]
    checks = row["checks"]
    if not isinstance(outputs, list) or not isinstance(checks, list):
        raise TypeError(f"{slug}: summary.json task rows need outputs and checks lists")
    return {
        "slug": slug,
        "display_name": slug.replace("-", " ").capitalize(),
        "group_slug": str(row["family"]),
        "task": f"{row['prompt']}\n\nDeliverables: {', '.join(str(o) for o in outputs)}",
        "workflow": {
            "taxonomy_version": TAXONOMY_VERSION,
            "source_reference": f"{SOURCE}/families ({slug})",
            "external_id": slug,
            "origin": str(row["origin"]),
            "readiness": "synthetic_fixtures",
            "evidence": str(row["evidence"]),
            "sources": list(row["sources"]) if isinstance(row["sources"], list) else [],
            "target_systems": TARGET_SYSTEMS,
            "skills": [],
        },
        "criteria": [{"id": str(c), "question": f"Check `{c}` in the task's verifier scores 1.0"} for c in checks],
    }


def run_payload(slug: str, row: dict[str, object], summary: dict[str, object], run_dir: Path, cfg: Config) -> dict[str, object]:
    bench_cases = row["cases"]
    if not isinstance(bench_cases, list):
        raise TypeError(f"{slug}: summary.json cases must be a list")
    cases = []
    for bench_case in bench_cases:
        record = json.loads((run_dir / slug / f"{bench_case['case']}.json").read_text())
        if record.get("error") is not None:
            raise ValueError(f"{bench_case['case']} is an execution failure; summary.json must not list it under cases")
        final = [m for m in record["messages"] if m.get("role") == "assistant"]
        cases.append(
            {
                "input_preview": str(row["prompt"]),
                "response_text": str(final[-1].get("content") or "") if final else "",
                "score": bench_case["reward"],
                "scores": {c["id"]: c["score"] for c in record["checks"]},
                "trace_id": f"{run_dir.name}/{slug}/{bench_case['case']}",
            }
        )
    # dataset/metric/grading are constant across tasks so the family rollup
    # is "comparable" (services/workflows.family_summary).
    return {
        "model": str(summary["model"])[:64],
        "overall_score": row["pass_rate"],
        "status": "completed",
        "variant": cfg.variant,
        "reference_label": cfg.reference_label,
        "dataset_eval": f"qm-bench@{TAXONOMY_VERSION}",
        "grading": "qm-bench verifier check mean",
        "metric": "check mean",
        "output_location": str(run_dir),
        "metrics": {
            "cases": len(cases),
            "execution_failures": len(row["execution_failures"]),
            "base_url": summary["base_url"],
            "run_id": run_dir.name,
        },
        "source": SOURCE,
        "finished_at": summary["finished_at"],
        "cases": cases,
    }


def main(cfg: Config) -> None:
    run_dir = Path(cfg.run_dir)
    if not (run_dir / "summary.json").exists():
        raise SystemExit(f"no summary.json in {run_dir}; pass run_dir=<qm repo>/runs/qm-bench/<run_id>")
    summary = json.loads((run_dir / "summary.json").read_text())
    api_key = os.environ.get(API_KEY_ENV, "")
    if not cfg.dry_run and not api_key:
        raise SystemExit(f"{API_KEY_ENV} is required for a live push")
    tasks = summary["tasks"]
    if not isinstance(tasks, dict):
        raise TypeError("summary.json: tasks must be an object")
    scored = {slug: row for slug, row in tasks.items() if row.get("pass_rate") is not None}
    posts: list[tuple[str, dict[str, object]]] = []
    for family in sorted({str(row["family"]) for row in scored.values()}):
        posts.append(("/v1/eval-groups", group_payload(family)))
    for slug, row in scored.items():
        posts.append(("/v1/evals", task_payload(slug, row)))
    for slug, row in scored.items():
        posts.append((f"/v1/evals/{slug}/runs", run_payload(slug, row, summary, run_dir, cfg)))
    mode = "DRY RUN" if cfg.dry_run else "LIVE"
    print(f"{mode} -> {cfg.api_base}: {len(scored)} tasks, model={summary['model']}, reference_label={cfg.reference_label!r}")
    for path, body in posts:
        print(f"  POST {path} {json.dumps(body)[:160]}")
    if cfg.dry_run:
        return
    with httpx.Client(base_url=cfg.api_base, headers={"Authorization": f"Bearer {api_key}"}, timeout=60) as client:
        for path, body in posts:
            resp = client.post(path, json=body)
            if resp.status_code >= 400:
                raise SystemExit(f"POST {path} failed: HTTP {resp.status_code} {resp.text}")
    print("done")


if __name__ == "__main__":
    chz.nested_entrypoint(main)
