"""Sim driver: runs scripts/opencode_maintenance.py's main() fully offline.

Every path constant is pointed at a temp dir, every network helper is
replayed from the scenario's `net` routes, and the produced files are
written back to the output path as JSON for the adapter to assert on.
"""
import io
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import opencode_maintenance as m  # noqa: E402

scenario_path, out_path, workdir = sys.argv[1], sys.argv[2], sys.argv[3]
scenario = json.loads(Path(scenario_path).read_text())

tmp = Path(workdir) / "pipeline"
data = tmp / "data"
config = tmp / "config"
docs = tmp / "docs"
for d in (data, config, docs):
    d.mkdir(parents=True, exist_ok=True)

m.ROOT = tmp
m.DATA_DIR = data
m.CONFIG_DIR = config
m.DOCS_DIR = docs
m.README_PATH = tmp / "README.md"
m.MODELS_DOC_PATH = docs / "models.md"
m.PROVIDERS_DOC_PATH = docs / "providers.md"
m.TASK_TYPES_PATH = config / "task-types.yaml"
m.MODEL_SCORES_PATH = config / "model-scores.yaml"
m.PROVIDERS_CONFIG_PATH = config / "providers.yaml"
m.MODEL_CAPABILITIES_PATH = config / "model-capabilities.yaml"
m.ZEN_MODELS_PATH = data / "zen_models.json"
m.GO_MODELS_PATH = data / "go_models.json"
m.LIVEBENCH_PATH = data / "livebench.json"
m.AUDIT_RESULTS_PATH = data / "audit_results.json"
m.BENCHMARK_PATH = data / "benchmark_scores.json"
m.COVERAGE_ISSUES_PATH = data / "coverage_issues.json"
m.MODEL_CONFIG_PATH = data / "model-config.json"
m.MODEL_CONFIG_V2_PATH = data / "model-config-v2.json"
m.PROVIDER_CATALOG_PATH = data / "provider-catalog.json"
m.MODEL_REGISTRY_PATH = data / "model-registry-v2.json"
m.TASK_TYPES_JSON_PATH = data / "task-types.json"

for rel, content in (scenario.get("seedFiles") or {}).items():
    p = tmp / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content if isinstance(content, str) else json.dumps(content))

routes = scenario.get("net") or []


def fake_fetch_text(url, timeout=15, **kw):
    for r in routes:
        if r["match"] in url:
            return None if r.get("fail") else r.get("body", "")
    return None


def fake_fetch_json(url, timeout=15, **kw):
    body = fake_fetch_text(url, timeout)
    if body is None:
        return None
    return body if isinstance(body, (dict, list)) else json.loads(body)


m.fetch_text = fake_fetch_text
m.fetch_json = fake_fetch_json

out = io.StringIO()
exit_code = 0
try:
    with redirect_stdout(out):
        m.main()
except SystemExit as e:
    exit_code = e.code or 0
except Exception as e:  # noqa: BLE001
    exit_code = 1
    out.write(f"\nDRIVER ERROR: {e!r}\n")

files = {}
for rel in scenario.get("expectFiles") or []:
    p = tmp / rel
    files[rel] = p.read_text() if p.exists() else None

Path(out_path).write_text(json.dumps({"exit": exit_code, "stdout": out.getvalue(), "files": files}))
