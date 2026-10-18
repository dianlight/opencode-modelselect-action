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
) -> tuple[str | None, str | None, dict[str, Any] | None]:
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
        return None, str(e), None
    choices = data.get("choices") or []
    if not choices:
        return None, "no choices returned", data.get("usage")
    content = (choices[0].get("message") or {}).get("content")
    if content is None:
        return None, "empty content", data.get("usage")
    return str(content), None, data.get("usage")


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
        text, err, usage = _chat(model_id, _messages_for(task), api_key, timeout=timeout)
        results[str(task.get("id"))] = {
            "passed": err is None and validate(task, text),
            "response": text,
            "error": err,
            "usage": usage,
        }
    return results


def _passed_ids(results: dict[str, Any]) -> set[str]:
    return {tid for tid, r in results.items() if isinstance(r, dict) and r.get("passed")}


def _answered_count(results: dict[str, Any]) -> int:
    """Number of tasks the endpoint answered without a transport error.

    A battery that answered nothing (expired key, 403, outage) carries no
    signal about the model, so it must never be recorded as a score.
    """
    return sum(
        1
        for r in results.values()
        if isinstance(r, dict) and r.get("error") is None
    )


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
    """Aggregate Pass/Fail results into per-subscore estimates.

    Each subscore is scaled by the pass rate of its tasks, so extra tasks
    (when present) improve granularity instead of acting as a single
    all-or-nothing gate. Vision is bimodal: a model that passes at least
    one vision task gets the reference's vision score, a model that fails
    all of them keeps the text-only floor (5.0).
    """
    passed = _passed_ids(results)
    task_by_id = {str(t.get("id")): t for t in tasks}

    # Group tasks by subscore.
    by_sub: dict[str, list[str]] = {}
    for tid, task in task_by_id.items():
        by_sub.setdefault(str(task.get("subscore", "overall")), []).append(tid)

    final_subscores: dict[str, float] = {}
    for sub, tids in by_sub.items():
        total = len(tids)
        passes = sum(1 for tid in tids if tid in passed)
        known = _reference_known_score(reference_model, livebench, sub)
        if known is None:
            known = _reference_known_score(reference_model, livebench, "overall")
        if known is None:
            known = 50.0
        if sub == "vision":
            # Bimodal: any pass => baseline score, all fail => text-only floor.
            if passes > 0:
                score = float(known)
            else:
                score = 5.0
        else:
            rate = (passes / total) if total else 0.0
            score = float(known) * rate
        final_subscores[sub] = round(score, 1)

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

    # A cached reference that answered nothing (expired key, 403, outage)
    # anchors no score: drop it and every score derived against it, so those
    # models revert to "missing" and are re-benchmarked once the endpoint
    # answers again. Runs before the missing-model scan so they are retried.
    ref_cached = cache.get("_reference") or {}
    ref_results = ref_cached.get("results")
    if isinstance(ref_results, dict) and _answered_count(ref_results) == 0:
        dropped = sorted(cache.get("models", {}))
        if dropped:
            print(
                "  w Reference unusable — dropping stale benchmark scores: "
                + ", ".join(dropped)
            )
        cache["models"] = {}
        cache.pop("_reference", None)
        ref_cached = {}
        ref_results = None

    # Identify still-missing free models. Dedupe defensively: a free id can be
    # listed in both the free and Go catalogs, and benchmarking the same model
    # twice only burns requests.
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

    missing_ids = list(dict.fromkeys(missing_ids))[:max_models]

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

    # Reference run (cached). Run when absent or when the reference model
    # changed; an unusable cached reference was already dropped above.
    if (
        ref_cached.get("model") != reference_model
        or not isinstance(ref_results, dict)
    ):
        print(f"  -> Running reference battery on {reference_model}")
        ref_results = run_battery(reference_model, tasks, api_key)
        cache["_reference"] = {
            "model": reference_model,
            "results": ref_results,
            "timestamp": datetime.now(UTC).isoformat(),
        }

    if _answered_count(ref_results) == 0:
        print(
            f"  w Backup benchmark skipped: reference {reference_model} answered "
            f"0/{len(ref_results)} task(s) — models stay missing"
        )
        cache.pop("_reference", None)
        if not dry_run:
            _save_cache(cache, cache_path)
        return cache

    for mid in missing_ids:
        print(f"  -> Benchmarking {mid}")
        try:
            results = run_battery(mid, tasks, api_key)
            if _answered_count(results) == 0:
                # Nothing came back (403/timeout on every task): a score here
                # would be noise, so drop any stale entry and stay missing.
                print(
                    f"     x {mid}: 0/{len(results)} task(s) answered — "
                    "no score recorded, stays missing"
                )
                cache["models"].pop(mid, None)
            else:
                scored = _scores_from_results(
                    results, tasks, ref_results, livebench, reference_model
                )
                token_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
                for r in results.values():
                    u = r.get("usage") or {}
                    token_usage["prompt_tokens"] += int(u.get("prompt_tokens") or u.get("input_tokens") or 0)
                    token_usage["completion_tokens"] += int(u.get("completion_tokens") or u.get("output_tokens") or 0)
                    token_usage["total_tokens"] += int(u.get("total_tokens") or 0)
                if token_usage["total_tokens"] == 0 and (
                    token_usage["prompt_tokens"] or token_usage["completion_tokens"]
                ):
                    token_usage["total_tokens"] = (
                        token_usage["prompt_tokens"] + token_usage["completion_tokens"]
                    )
                cache["models"][mid] = {
                    "scores": scored["scores"],
                    "passed_task_ids": scored["passed_task_ids"],
                    "failed_task_ids": scored["failed_task_ids"],
                    "raw_pass_count": scored["raw_pass_count"],
                    "task_count": scored["task_count"],
                    "token_usage": token_usage,
                    "source": "benchmark",
                    "confidence": "low (backup benchmark)",
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
