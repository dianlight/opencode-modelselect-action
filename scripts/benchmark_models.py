#!/usr/bin/env python3
"""Tiny backup benchmark used when a (free) model has no LiveBench,
static fallback, or secondary-source score.

This is a last resort. Scores are Pass/Fail results mapped to a known
reference model's sub-scores, so they are coarse and are tagged
"benchmark" with low confidence. They never overwrite LiveBench or
static-fallback scores; see opencode_maintenance for source precedence.
"""

import argparse
import json
import os
import time
from datetime import datetime, UTC
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import yaml

ROOT = Path(__file__).resolve().parent.parent
TASKS_PATH = ROOT / "config" / "benchmark-tasks.yaml"
CACHE_PATH = ROOT / "data" / "benchmark_scores.json"

REQUEST_TIMEOUT = 30
MAX_MODELS = 5

# 1x1 red PNG used by the vision task.
_RED_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1Pe"
    "AAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)

ENDPOINT = os.environ.get(
    "OPENCODE_ZEN_CHAT_URL",
    "https://opencode.ai/zen/v1/chat/completions",
)


def load_tasks(path: Path = TASKS_PATH) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = yaml.safe_load(path.read_text()) or {}
    except (OSError, yaml.YAMLError):
        return []
    return list(data.get("tasks") or [])


def _load_cache(path: Path = CACHE_PATH) -> dict[str, Any]:
    if path.exists():
        try:
            data = json.loads(path.read_text())
            if isinstance(data, dict):
                return data
        except (OSError, json.JSONDecodeError):
            pass
    return {"models": {}}


def _save_cache(cache: dict[str, Any], path: Path = CACHE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "timestamp": datetime.now(UTC).isoformat(),
        **cache,
    }
    path.write_text(json.dumps(payload, indent=2))


def _chat(
    model_id: str,
    messages: list[dict[str, Any]],
    api_key: str | None,
    *,
    timeout: int = REQUEST_TIMEOUT,
) -> tuple[str | None, str | None]:
    payload = {
        "model": model_id,
        "messages": messages,
        "temperature": 0,
        "max_tokens": 128,
    }
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        req = Request(
            ENDPOINT,
            data=json.dumps(payload).encode(),
            headers=headers,
            method="POST",
        )
        with urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
    except (URLError, HTTPError, TimeoutError, json.JSONDecodeError) as e:
        return None, str(e)
    choices = data.get("choices") or []
    if not choices:
        return None, "no choices returned"
    content = (choices[0].get("message") or {}).get("content")
    if content is None:
        return None, "empty content"
    return str(content), None


def _messages_for(task: dict[str, Any]) -> list[dict[str, Any]]:
    prompt = str(task.get("prompt", "")).strip()
    if task.get("vision"):
        content = [
            {"type": "text", "text": prompt},
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{_RED_PNG_B64}"},
            },
        ]
        return [{"role": "user", "content": content}]
    return [{"role": "user", "content": prompt}]


def validate(task: dict[str, Any], response: str | None) -> bool:
    if response is None:
        return False
    kind = str(task.get("kind", "exact")).lower()
    expected = task.get("expected")
    text = response.strip()
    if kind == "exact":
        return text.lower() == str(expected).strip().lower()
    if kind == "integer":
        try:
            return int(text) == int(expected)
        except (ValueError, TypeError):
            # Allow a trailing period/whitespace and floats like "10.0".
            try:
                return float(text) == float(expected)
            except (ValueError, TypeError):
                return False
    if kind == "float":
        try:
            return abs(float(text) - float(expected)) < 1e-6
        except (ValueError, TypeError):
            return False
    if kind == "json":
        try:
            got = json.loads(text)
        except json.JSONDecodeError:
            # Some models wrap JSON in code fences.
            cleaned = text.strip("`").strip()
            if cleaned.startswith("json"):
                cleaned = cleaned[4:].strip()
            try:
                got = json.loads(cleaned)
            except json.JSONDecodeError:
                return False
        return got == json.loads(str(expected))
    if kind == "contains":
        return str(expected).lower() in text.lower()
    return False


def run_battery(
    model_id: str,
    tasks: list[dict[str, Any]],
    api_key: str | None = None,
    *,
    timeout: int = REQUEST_TIMEOUT,
) -> dict[str, Any]:
    results: dict[str, Any] = {}
    for task in tasks:
        text, err = _chat(model_id, _messages_for(task), api_key, timeout=timeout)
        results[str(task.get("id"))] = {
            "passed": err is None and validate(task, text),
            "response": text,
            "error": err,
        }
    return results


def _passed_ids(results: dict[str, Any]) -> set[str]:
    return {tid for tid, r in results.items() if isinstance(r, dict) and r.get("passed")}


def _reference_known_score(model_id: str, livebench: Any, subscore: str) -> float | None:
    # Lazy import to avoid circular import at module load.
    try:
        from opencode_maintenance import get_model_score
    except Exception:  # noqa: BLE001
        return None
    try:
        return get_model_score(model_id, livebench or {}, subscore)
    except Exception:  # noqa: BLE001
        return None


def _scores_from_results(
    results: dict[str, Any],
    tasks: list[dict[str, Any]],
    reference_results: dict[str, Any],
    livebench: Any,
    reference_model: str,
) -> dict[str, Any]:
    passed = _passed_ids(results)
    task_by_id = {str(t.get("id")): t for t in tasks}
    subscores: dict[str, float] = {}
    # Group passed tasks by subscore; if any pass, use the reference's
    # known sub-score for that category (coarse Pass/Fail mapping).
    for tid, task in task_by_id.items():
        sub = str(task.get("subscore", "overall"))
        known = _reference_known_score(reference_model, livebench, sub)
        if known is None:
            known = _reference_known_score(reference_model, livebench, "overall")
        if known is None:
            known = 50.0
        if tid in passed:
            # Average when multiple tasks share a subscore.
            subscores.setdefault(sub, 0.0)
            # Simple: keep max-ish by averaging passes.
        else:
            subscores.setdefault(sub, 0.0)

    # Compute per-subscore: reference known if at least one task in that
    # subscore passed, else 0.
    by_sub_passed: dict[str, bool] = {}
    for tid, task in task_by_id.items():
        sub = str(task.get("subscore", "overall"))
        if tid in passed:
            by_sub_passed[sub] = True
        by_sub_passed.setdefault(sub, False)

    final_subscores: dict[str, float] = {}
    for sub, did_pass in by_sub_passed.items():
        known = _reference_known_score(reference_model, livebench, sub)
        if known is None:
            known = _reference_known_score(reference_model, livebench, "overall")
        if known is None:
            known = 50.0
        final_subscores[sub] = round(float(known if did_pass else 0.0), 1)

    if not final_subscores:
        overall = 0.0
    else:
        overall = round(sum(final_subscores.values()) / len(final_subscores), 1)
    final_subscores["overall"] = overall

    return {
        "scores": final_subscores,
        "passed_task_ids": sorted(passed),
        "failed_task_ids": sorted(set(results) - passed),
        "raw_pass_count": len(passed),
        "task_count": len(tasks),
    }


def run_backup(
    free_models: list[dict[str, Any]],
    go_models: list[dict[str, Any]] | None = None,
    livebench: Any = None,
    *,
    max_models: int = MAX_MODELS,
    dry_run: bool = False,
    api_key: str | None = None,
    tasks_path: Path = TASKS_PATH,
    cache_path: Path = CACHE_PATH,
    reference_model: str = "big-pickle",
) -> dict[str, Any]:
    api_key = api_key or os.environ.get("OPENCODE_API_KEY") or os.environ.get("OPENCODE_API_TOKEN")
    tasks = load_tasks(tasks_path)
    cache = _load_cache(cache_path)
    cache.setdefault("models", {})

    # Identify still-missing free models.
    missing_ids: list[str] = []
    try:
        from opencode_maintenance import detect_coverage_issues

        free_ids = {str(m.get("id")) for m in free_models}
        coverage = detect_coverage_issues(
            free_models, go_models or [], livebench or {}, None
        )
        for item in coverage.get("missing_scores", []):
            mid = str(item.get("model"))
            if mid in free_ids and mid not in cache.get("models", {}):
                missing_ids.append(mid)
    except Exception as e:  # noqa: BLE001
        print(f"  w benchmark: coverage detection unavailable: {e}")

    missing_ids = missing_ids[:max_models]

    if not api_key:
        print("  w Backup benchmark skipped: no API key (OPENCODE_API_KEY)")
        missing_ids = []

    if not missing_ids:
        print("  v Backup benchmark: no missing free models to benchmark")
        if not dry_run:
            _save_cache(cache, cache_path)
        return cache

    if not tasks:
        print("  w Backup benchmark skipped: no task bank")
        return cache

    print(f"-> Backup benchmarking {len(missing_ids)} free model(s): {', '.join(missing_ids)}")

    # Reference run (cached).
    ref_cached = cache.get("_reference") or {}
    if ref_cached.get("model") != reference_model or not isinstance(
        ref_cached.get("results"), dict
    ):
        print(f"  -> Running reference battery on {reference_model}")
        ref_results = run_battery(reference_model, tasks, api_key)
        ref_cached = {
            "model": reference_model,
            "results": ref_results,
            "timestamp": datetime.now(UTC).isoformat(),
        }
        cache["_reference"] = ref_cached
    reference_results = ref_cached["results"]

    for mid in missing_ids:
        print(f"  -> Benchmarking {mid}")
        try:
            results = run_battery(mid, tasks, api_key)
            scored = _scores_from_results(
                results, tasks, reference_results, livebench, reference_model
            )
            cache["models"][mid] = {
                "scores": scored["scores"],
                "passed_task_ids": scored["passed_task_ids"],
                "failed_task_ids": scored["failed_task_ids"],
                "raw_pass_count": scored["raw_pass_count"],
                "task_count": scored["task_count"],
                "source": "benchmark",
                "confidence": "low (4-task backup benchmark)",
                "reference_model": reference_model,
                "timestamp": datetime.now(UTC).isoformat(),
            }
            print(
                f"     v {mid}: "
                + ", ".join(f"{k}={v}" for k, v in scored["scores"].items())
            )
        except Exception as e:  # noqa: BLE001
            print(f"     x {mid}: benchmark failed: {e}")
        time.sleep(0.5)

    if not dry_run:
        _save_cache(cache, cache_path)
        print(f"  v Benchmark cache saved to {cache_path}")
    return cache


def main() -> int:
    parser = argparse.ArgumentParser(description="Backup benchmark for missing free models")
    parser.add_argument("--max-models", type=int, default=MAX_MODELS)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    # Lazy load so the maintenance environment provides catalogs.
    try:
        from opencode_maintenance import fetch_opencode_models, fetch_livebench

        free_models, go_models = fetch_opencode_models()
        livebench = fetch_livebench()
    except Exception as e:  # noqa: BLE001
        print(f"Failed to load catalogs: {e}")
        # Allow callers to inject? CLI mode requires network catalogs.
        free_models, go_models, livebench = [], [], {"models": {}}

    run_backup(
        free_models,
        go_models,
        livebench,
        max_models=args.max_models,
        dry_run=args.dry_run,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
