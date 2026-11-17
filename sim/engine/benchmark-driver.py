"""Sim driver: runs scripts/benchmark_models.py's run_backup offline.

The task bank, catalogs and chat endpoint are all scenario data; the endpoint
is replayed by patching urllib's urlopen in the benchmark module.
"""
import json
import sys
from pathlib import Path
from urllib.error import URLError

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import benchmark_models as b  # noqa: E402

scenario_path, out_path, workdir = sys.argv[1], sys.argv[2], sys.argv[3]
scenario = json.loads(Path(scenario_path).read_text())

tmp = Path(workdir) / "pipeline"
tmp.mkdir(parents=True, exist_ok=True)

tasks_path = tmp / "tasks.yaml"
if not tasks_path.exists():
    raise SystemExit(f"sim: no task bank at {tasks_path}")

routes = scenario.get("net") or []


class FakeResp:
    def __init__(self, body):
        self._body = body.encode()

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def fake_urlopen(req, timeout=None):
    url = getattr(req, "full_url", str(req))
    for r in routes:
        if r.get("match") in url:
            if r.get("fail"):
                raise URLError("simulated outage")
            return FakeResp(json.dumps(r.get("body", {})))
    raise URLError(f"no route for {url}")


b.ENDPOINT = scenario.get("endpoint", "http://127.0.0.1:1/v1/chat/completions")
b.urlopen = fake_urlopen

cache = b.run_backup(
    scenario.get("freeModels", []),
    scenario.get("goModels", []),
    scenario.get("livebench") or {"models": {}},
    max_models=scenario.get("maxModels", 5),
    dry_run=scenario.get("dryRun", False),
    api_key=scenario.get("apiKey"),
    tasks_path=tasks_path,
    cache_path=tmp / "cache.json",
)
(tmp / "cache.json").write_text(json.dumps(cache))

Path(out_path).write_text(json.dumps({"exit": 0, "files": {"cache.json": cache}}))
