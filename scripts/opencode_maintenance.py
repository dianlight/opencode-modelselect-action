#!/usr/bin/env python3
"""
OpenCode Maintenance Script
- Fetches OpenCode model catalogs (Zen free + Go paid)
- Fetches LiveBench leaderboard data (newest snapshot from livebench.ai,
  merged with models from older snapshots; snapshot dates are discovered
  from the official LiveBench/livebench.github.io repo)
- Classifies workflows by task type
- Scores and recommends optimal models per task type
- Updates README.md with recommendation tables
- Audits workflows for model optimality
"""

import csv
import io
import json
import re
import sys
from html.parser import HTMLParser
from datetime import datetime, timedelta, UTC
from pathlib import Path
from typing import Any, override
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import yaml

# --- Paths ---
ROOT = Path(__file__).parent.parent
CONFIG_DIR = ROOT / "config"
DATA_DIR = ROOT / "data"
WORKFLOWS_DIR = ROOT / ".github" / "workflows"
README_PATH = ROOT / "README.md"

TASK_TYPES_PATH = CONFIG_DIR / "task-types.yaml"
WORKFLOW_MAP_PATH = CONFIG_DIR / "workflow-task-map.yaml"
MODEL_SCORES_PATH = CONFIG_DIR / "model-scores.yaml"

# Data files
ZEN_MODELS_PATH = DATA_DIR / "zen_models.json"
GO_MODELS_PATH = DATA_DIR / "go_models.json"
LIVEBENCH_PATH = DATA_DIR / "livebench.json"
WORKFLOW_SCAN_PATH = DATA_DIR / "workflow_scan.json"
AUDIT_RESULTS_PATH = DATA_DIR / "audit_results.json"
COVERAGE_ISSUES_PATH = DATA_DIR / "coverage_issues.json"
# Central model config consumed by downstream workflows at startup
# (see action.yml / src/index.js). This is real configuration: the
# maintenance run never overwrites it — changes go through issue + PR review.
MODEL_CONFIG_PATH = DATA_DIR / "model-config.json"
# Proposed config written when the run recommends a change (gitignored).
MODEL_CONFIG_PROPOSED_PATH = DATA_DIR / "model-config.proposed.json"

# --- Constants ---
ZEN_URL = "https://opencode.ai/zen/v1/models"
GO_URL = "https://opencode.ai/zen/go/v1/models"
# Zen docs pricing page: the #pricing anchor is client-side, so the page itself
# is fetched and its pricing table parsed for per-model prices. The docs also
# list models published as "Free" that do NOT carry the `-free` suffix
# (e.g. `big-pickle`); those must be treated as usable free models.
ZEN_PRICING_URL = "https://opencode.ai/docs/it/zen#pricing"
LIVEBENCH_BASE = "https://livebench.ai"
# LiveBench/LiveBench changelog is a secondary date hint (lags the live site)
LIVEBENCH_CHANGELOG_URL = (
    "https://raw.githubusercontent.com/LiveBench/LiveBench/main/changelog.md"
)
# The live site (livebench.ai) is GitHub Pages from LiveBench/livebench.github.io;
# its git tree is the authoritative, machine-readable list of published snapshots.
LIVEBENCH_GITHUB_IO_TREE_URL = (
    "https://api.github.com/repos/LiveBench/livebench.github.io/git/trees/main?recursive=1"
)
# Mirror host for the same CSVs (used if livebench.ai is unreachable)
LIVEBENCH_GITHUB_IO_RAW_BASE = (
    "https://raw.githubusercontent.com/LiveBench/livebench.github.io/main/public"
)

FREE_FIRST_THRESHOLD_PCT = 5  # % within best paid to prefer free

# Map LiveBench fine-grained task columns to subscore categories
LIVEBENCH_COLUMN_CATEGORIES = {
    "coding": [
        "code_completion",
        "code_generation",
        "javascript",
        "python",
        "typescript",
    ],
    "reasoning": [
        "AMPS_Hard",
        "math_comp",
        "olympiad",
        "integrals_with_game",
        "simplify",
        "logic_with_navigation",
        "consecutive_events",
        "zebra_puzzle",
        "theory_of_mind",
        "connections",
        "spatial",
    ],
    "vision": [
        "plot_unscrambling",
    ],
    "instruction_following": [
        "paraphrase",
        "summarize",
        "story_generation",
        "typos",
        "tablejoin",
        "tablereformat",
    ],
}

# Static fallback scores cache (loaded from config/model-scores.yaml)
_FALLBACK_CACHE: dict[str, Any] | None = None


def _get_fallback_scores() -> dict[str, dict[str, float]]:
    """Load static fallback scores for models not on LiveBench.
    Returns a normalized lookup: strips the '-free' suffix so
    that both "mimo-v2.5-free" and "mimo-v2.5" resolve correctly.
    If both foo-free and foo exist, foo-free values take priority."""
    global _FALLBACK_CACHE
    if _FALLBACK_CACHE is not None:
        return _FALLBACK_CACHE
    path = CONFIG_DIR / "model-scores.yaml"
    if path.exists():
        data = load_yaml(path)
        raw = data.get("model_scores") or {}
    else:
        raw = {}
    _FALLBACK_CACHE = {}
    SFX = "-free"
    for name, scores in raw.items():
        norm = name.strip().lower()
        if norm.endswith(SFX):
            wf = norm[: -len(SFX)]
            _FALLBACK_CACHE[norm] = scores
            if wf not in _FALLBACK_CACHE:
                _FALLBACK_CACHE[wf] = scores
        else:
            _FALLBACK_CACHE[norm] = scores
            nsfx = norm + SFX
            if nsfx not in _FALLBACK_CACHE:
                _FALLBACK_CACHE[nsfx] = scores
    return _FALLBACK_CACHE


def format_model_with_score(
    model_id: str | None,
    score: float | None,
    *,
    score_suffix: str = "",
) -> str:
    """Format a model cell as "Model (score)".

    If score_suffix is provided (e.g. "+15%"), it's appended after the score.
    """
    if not model_id:
        return "\u2014"
    return f"`{model_id}` ({score}{score_suffix})" if score is not None else f"`{model_id}`"


def _add_model_prefix(
    model_id: str,
    go_ids: set[str] | None = None,
    engine: str | None = None,
) -> str:
    """Add the engine prefix to a model ID for display.

    Args:
        model_id: The raw model ID (e.g. "kimi-k3").
        go_ids: Set of Go model IDs for auto-detection.
        engine: Explicit engine prefix ("opencode" or "opencode-go").
                If None, auto-detect based on model tier.

    Auto-detection rules:
        - Free models (ending in -free) get `opencode/` prefix.
        - Go (paid) models get `opencode-go/` prefix.
        - Zen-only paid models get `opencode/` prefix.
    If the model already has a prefix, return as-is.
    """
    if not model_id:
        return model_id
    if "/" in model_id:
        return model_id  # already has a prefix
    if engine:
        return f"{engine}/{model_id}"
    if model_id.endswith("-free"):
        return f"opencode/{model_id}"
    if go_ids and model_id in go_ids:
        return f"opencode-go/{model_id}"
    return f"opencode/{model_id}"


# --- Utils ---
def fetch_json(url: str, timeout: int = 15) -> dict[str, Any] | None:
    """Fetch JSON from URL with timeout."""
    try:
        req = Request(url, headers={"User-Agent": "opencode-maintenance/1.0"})
        with urlopen(req, timeout=timeout) as resp:
            return json.load(resp)
    except (URLError, HTTPError, json.JSONDecodeError, TimeoutError) as e:
        print(f"  x Failed to fetch {url}: {e}")
        return None


def fetch_text(url: str, timeout: int = 15) -> str | None:
    """Fetch text from URL with timeout."""
    try:
        req = Request(url, headers={"User-Agent": "opencode-maintenance/1.0"})
        with urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8")
    except (URLError, HTTPError, TimeoutError) as e:
        print(f"  x Failed to fetch {url}: {e}")
        return None


def fetch_livebench_csv(date_str: str) -> str | None:
    """Try to fetch LiveBench CSV for a specific date.

    Tries livebench.ai first, then falls back to the raw CSV in the
    LiveBench/livebench.github.io repo (the site's GitHub Pages source).
    """
    text = fetch_text(f"{LIVEBENCH_BASE}/table_{date_str}.csv")
    if text:
        return text
    return fetch_text(f"{LIVEBENCH_GITHUB_IO_RAW_BASE}/table_{date_str}.csv")


def _to_float(v: Any) -> float | None:
    try:
        return float(v) if v is not None and v != "" else None
    except (ValueError, TypeError):
        return None


def parse_livebench_csv(csv_text: str) -> dict[str, dict[str, float]]:
    """Parse LiveBench CSV into model_name -> {overall, coding, reasoning, vision, instruction_following}.

    LiveBench CSV columns are fine-grained per-task scores (e.g. `code_completion`,
    `python`, `math_comp`). We aggregate them into subscore categories using
    `LIVEBENCH_COLUMN_CATEGORIES`.
    """
    result = {}
    try:
        reader = csv.DictReader(io.StringIO(csv_text))
        # Normalise column names to lowercase for lookup
        for row in reader:
            row_lc = {k.lower(): v for k, v in row.items() if k}
            model = row_lc.get("model") or row_lc.get("name")
            if not model:
                continue

            subscores = {}
            all_values = []
            for category, cols in LIVEBENCH_COLUMN_CATEGORIES.items():
                vals = []
                for col in cols:
                    v = _to_float(row_lc.get(col.lower()))
                    if v is not None:
                        vals.append(v)
                if vals:
                    subscores[category] = round(sum(vals) / len(vals), 1)
                    all_values.extend(vals)

            # Overall = mean of all numeric task scores (excluding model column)
            if all_values:
                subscores["overall"] = round(sum(all_values) / len(all_values), 1)
                result[model] = subscores
    except (csv.Error, KeyError, ValueError, TypeError) as e:
        print(f"  x CSV parse error: {e}")
    return result


def load_yaml(path: Path) -> dict[str, Any]:
    with open(path) as f:
        return yaml.safe_load(f) or {}


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def load_json(path: Path) -> Any:
    with open(path) as f:
        return json.load(f)


# --- Zen Pricing ---


class _HtmlTableParser(HTMLParser):
    """Extract all <table> elements from an HTML page as rows of cell strings."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._table: list[list[str]] | None = None
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    @override
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table":
            self._table = []
        elif tag == "tr" and self._table is not None:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    @override
    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self._cell is not None:
            if self._row is not None:
                self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._table is not None:
                self._table.append(self._row)
            self._row = None
        elif tag == "table" and self._table is not None:
            self.tables.append(self._table)
            self._table = None

    @override
    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)


def _parse_price_cell(cell: str) -> str | None:
    """Normalise a pricing cell: '-'/empty cells become None, everything else
    keeps the published string value (e.g. "Free" or "$0.30")."""
    value = cell.strip()
    if not value or value == "-":
        return None
    return value


def _pricing_display_to_id(display: str, name_to_id: dict[str, str]) -> str | None:
    """Map a pricing-table display name to a Zen model ID.

    Per-context ranges in parentheses (e.g. "GPT 5.6 Sol (≤ 272K tokens)") are
    stripped first, then the name is looked up in the endpoint table (which has
    an explicit Model ID column). As a fallback the name is slugified
    (lowercase, spaces -> hyphens, dots kept).
    """
    name = re.sub(r"\s*\([^)]*\)", "", display).strip()
    if name in name_to_id:
        return name_to_id[name]
    slug = re.sub(r"[^a-z0-9.]+", "-", name.lower()).strip("-")
    return slug or None


def fetch_zen_pricing() -> dict[str, dict[str, Any]] | None:
    """Fetch Zen model prices from the docs pricing page.

    Returns {model_id: {"input": ..., "output": ..., "cached_read": ...,
    "cached_write": ..., "free": bool, "tiers": [...]}}.
    Price cells keep the published string value ("Free" or "$0.30"); "-"/empty
    cells become None. Models with per-context-range prices (e.g. GPT 5.6 Sol)
    get the default (first) tier at the top level plus every tier under
    "tiers". Returns None if the page could not be fetched.
    """
    page_url = ZEN_PRICING_URL.split("#", 1)[0]
    html = fetch_text(page_url)
    if not html:
        print(f"  x Failed to fetch Zen pricing page {page_url}")
        return None

    parser = _HtmlTableParser()
    parser.feed(html)
    tables = parser.tables

    # Build display-name -> model-id map from the endpoint table (has a
    # "Model ID" column with the explicit id for every model display name).
    name_to_id: dict[str, str] = {}
    for table in tables:
        if not table:
            continue
        header = [c.lower() for c in table[0]]
        if "model id" in header:
            idx = header.index("model id")
            for row in table[1:]:
                if len(row) > idx and row[0]:
                    name_to_id[row[0]] = row[idx]
            break

    # Locate the pricing table via its price-ish header columns.
    pricing_table = None
    for table in tables:
        if not table:
            continue
        header = [c.lower() for c in table[0]]
        if any(h in header for h in ("input", "output")) or any(
            "cached" in h for h in header
        ):
            pricing_table = table
            break
    if not pricing_table:
        print("  x Zen pricing: pricing table not found on the docs page")
        return {}

    pricing: dict[str, dict[str, Any]] = {}
    for row in pricing_table[1:]:
        if len(row) < 3 or not row[0].strip():
            continue
        model_id = _pricing_display_to_id(row[0], name_to_id)
        if not model_id:
            continue
        entry: dict[str, Any] = {
            "input": _parse_price_cell(row[1]),
            "output": _parse_price_cell(row[2]),
            "cached_read": _parse_price_cell(row[3]) if len(row) > 3 else None,
            "cached_write": _parse_price_cell(row[4]) if len(row) > 4 else None,
        }
        if model_id not in pricing:
            entry["free"] = entry["input"] == "Free" or entry["output"] == "Free"
            pricing[model_id] = entry
        range_m = re.search(r"\(([^)]*)\)", row[0])
        if range_m:
            tier = {"range": range_m.group(1).strip(), **entry}
            pricing[model_id].setdefault("tiers", []).append(tier)

    return pricing


# --- Model Fetching ---
def fetch_opencode_models() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Fetch Zen (free) and Go (paid) model catalogs.

    Prices are fetched from the Zen docs pricing page and attached to each
    Zen model. The usable free list is the union of `-free`-suffixed models
    and any model the pricing page publishes as "Free" (e.g. `big-pickle`,
    which has no `-free` suffix).
    """
    print("-> Fetching OpenCode model catalogs...")

    # Fetch Zen models (all)
    zen_data = fetch_json(ZEN_URL)
    if not zen_data:
        print("  x Failed to fetch Zen models")
        return [], []

    all_zen = zen_data.get("data", [])

    # Fetch prices from the Zen docs pricing page and attach them to models.
    pricing = fetch_zen_pricing()
    if pricing is None:
        # Reuse prices from the last successful run so zen_models.json stays
        # populated even while the docs page is unreachable.
        prev = load_json(ZEN_MODELS_PATH) if ZEN_MODELS_PATH.exists() else {}
        pricing = {
            m["id"]: m["pricing"]
            for m in prev.get("all", [])
            if m.get("pricing")
        }
        print("  w Zen pricing: reusing previously fetched prices")
    free_by_pricing: set[str] = set()
    for m in all_zen:
        info = pricing.get(m["id"])
        if info:
            m["pricing"] = info
            if info.get("free"):
                free_by_pricing.add(m["id"])

    free_models = [
        m for m in all_zen
        if m.get("id", "").endswith("-free") or m["id"] in free_by_pricing
    ]
    save_json(
        ZEN_MODELS_PATH,
        {"all": all_zen, "free": free_models, "pricing_source": ZEN_PRICING_URL},
    )
    print(
        f"  v Zen: {len(all_zen)} total, {len(free_models)} free "
        + f"({len(free_by_pricing)} via pricing page)"
    )

    # Fetch Go models (paid)
    go_data = fetch_json(GO_URL)
    if not go_data:
        print("  x Failed to fetch Go models")
        go_models = []
    else:
        go_models = go_data.get("data", [])
        save_json(GO_MODELS_PATH, {"data": go_models})
        print(f"  v Go: {len(go_models)} paid models")

    return free_models, go_models


def _discover_dates_from_tree() -> list[str]:
    """List every published snapshot date from the LiveBench site repo's git tree.

    Queries the GitHub API for the recursive git tree of
    LiveBench/livebench.github.io and regexes every `table_YYYY_MM_DD.csv`
    file under `public/`. This is the authoritative, machine-readable source of
    all snapshots available on livebench.ai (the changelog lags the live site).
    Returns dates as `YYYY_MM_DD` strings, newest first.
    """
    data = fetch_json(LIVEBENCH_GITHUB_IO_TREE_URL)
    if not data:
        return []
    dates: set[str] = set()
    for entry in data.get("tree", []):
        path = entry.get("path", "")
        m = re.search(r"table_(\d{4}_\d{2}_\d{2})\.csv$", path)
        if m:
            dates.add(m.group(1))
    return sorted(dates, reverse=True)


def _parse_changelog_dates() -> list[str]:
    """Parse snapshot dates from the LiveBench changelog (newest first).

    The changelog uses `### YYYY-MM-DD` headers. It is a secondary hint only:
    it often lags the snapshots actually published on livebench.ai.
    """
    text = fetch_text(LIVEBENCH_CHANGELOG_URL)
    if not text:
        return []
    matches = re.findall(r"^###\s+(\d{4}-\d{2}-\d{2})\s*$", text, re.MULTILINE)
    return [d.replace("-", "_") for d in matches]


def _probe_recent_dates(days_back: int = 180) -> list[str]:
    """Last-resort discovery: probe daily CSV URLs on livebench.ai.

    Walks back from today until a snapshot responds, returning at most one
    date. Used only when the git tree and changelog sources are unavailable.
    """
    today = datetime.now(UTC).date()
    for i in range(days_back):
        date_str = (today - timedelta(days=i)).strftime("%Y_%m_%d")
        if fetch_livebench_csv(date_str):
            return [date_str]
    return []


def get_livebench_snapshot_dates() -> list[str]:
    """Discover all LiveBench snapshot dates available on livebench.ai, newest first.

    The git tree of LiveBench/livebench.github.io is the primary source: it is
    exactly the set of CSVs the live site can serve (livebench.ai is GitHub
    Pages deployed from that repo). The LiveBench/LiveBench changelog is only
    used as a fallback when the tree API is unreachable, and direct URL probing
    as a last resort.
    """
    dates = _discover_dates_from_tree()
    if dates:
        return dates
    dates = _parse_changelog_dates()
    if dates:
        return dates
    return _probe_recent_dates()


def fetch_livebench() -> dict[str, Any]:
    """Fetch and parse LiveBench leaderboard data.

    Snapshot dates are discovered from the LiveBench/livebench.github.io git
    tree (the source of the livebench.ai site), so the newest published data is
    always used instead of the stale changelog. The newest snapshot is fetched
    from `https://livebench.ai/table_YYYY_MM_DD.csv`, then any models missing
    from it are filled in from older snapshots so all available data from
    livebench.ai is retained (newest snapshot wins on conflicts).
    """
    print("-> Fetching LiveBench leaderboard...")

    dates = get_livebench_snapshot_dates()
    if not dates:
        print("  w No LiveBench data available, using empty scores")
        save_json(LIVEBENCH_PATH, {"models": {}})
        return {"models": {}}
    print(f"  v Discovered {len(dates)} LiveBench snapshot(s); newest: {dates[0]}")

    # 1. Primary snapshot: newest date whose CSV parses (livebench.ai first,
    #    github.io raw mirror as fallback).
    primary = None
    for date_str in dates:
        csv_text = fetch_livebench_csv(date_str)
        if not csv_text:
            continue
        scores = parse_livebench_csv(csv_text)
        if scores:
            primary = (date_str, scores)
            break

    if not primary:
        print("  w No LiveBench CSV parseable, using empty scores")
        save_json(LIVEBENCH_PATH, {"models": {}})
        return {"models": {}}

    snapshot_date, scores = primary
    # 2. Merge models missing from the newest snapshot from older snapshots.
    merged = dict(scores)
    merged_from: list[tuple[str, int]] = []
    for date_str in dates:
        if date_str == snapshot_date:
            continue
        older_text = fetch_livebench_csv(date_str)
        if not older_text:
            continue
        older = parse_livebench_csv(older_text)
        if not older:
            continue
        missing = {name for name in older if name not in merged}
        for name in missing:
            merged[name] = older[name]
        if missing:
            merged_from.append((date_str, len(missing)))

    result = {
        "_snapshot_date": snapshot_date,
        "_source": f"{LIVEBENCH_BASE}/table_{snapshot_date}.csv",
        "models": merged,
    }
    save_json(LIVEBENCH_PATH, result)
    print(f"  v LiveBench CSV ({snapshot_date}): {len(scores)} models parsed")
    for date_str, count in merged_from:
        print(f"  v  + merged {count} model(s) from {date_str}")
    if merged_from:
        print(f"  v Total models after merge: {len(merged)}")
    return result


# --- Workflow Scanning ---
# Conditional `model:` inputs look like:
#   ${{ <expr> == 'free' && 'FREE_MODEL' || 'GO_MODEL' }}
# The Go model is the primary (fallback side); the free model is the /ocf tier.
MODEL_EXPR_RE = re.compile(
    r"\$\{\{[^}]*&&\s*'([^']+)'\s*\|\|\s*'([^']+)'\s*\}\}"
)
# Resolver reference: model: ${{ steps.<id>.outputs.model }} — the model is
# preselected at workflow runtime from the central config
# (data/model-config.json) via the select-model action (action.yml).
AUTO_MODEL_RE = re.compile(r"\$\{\{\s*steps\.[^}]*\.outputs\.[^}]*\}\}")


def _parse_model_expression(model: str) -> tuple[str, str | None]:
    """Split a conditional `model:` input into (go_model, free_model).

    Workflows with the /oc (Go) and /ocf (free) split express the model as
    `${{ <tier> == 'free' && '<FREE>' || '<GO>' }}`. This extracts the Go
    model (the primary, used for auditing) and the free model. Plain literal
    model pins are returned unchanged with free_model=None.

    Steps that preselect the model at runtime from the central config
    (`${{ steps.<id>.outputs.model }}`) return ("__auto__", "__auto__");
    the caller resolves them from data/model-config.json by task type.
    """
    m = MODEL_EXPR_RE.search(model)
    if m:
        return m.group(2), m.group(1)
    if AUTO_MODEL_RE.search(model):
        return "__auto__", "__auto__"
    return model, None


def scan_workflows() -> list[dict[str, Any]]:
    """Scan all workflows for anomalyco/opencode usage."""
    print("-> Scanning workflows for OpenCode usage...")

    results = []
    if not WORKFLOWS_DIR.exists():
        save_json(WORKFLOW_SCAN_PATH, [])
        return []

    workflow_config = load_yaml(WORKFLOW_MAP_PATH)
    workflow_map = workflow_config.get("workflow_task_map") or {}
    job_task_overrides = workflow_config.get("job_task_overrides") or {}
    task_types = load_yaml(TASK_TYPES_PATH).get("task_types") or []

    for wf_file in sorted(
        list(WORKFLOWS_DIR.glob("*.yml")) + list(WORKFLOWS_DIR.glob("*.yaml"))
    ):
        stem = wf_file.stem

        try:
            content = wf_file.read_text(encoding="utf-8")
            if "anomalyco/opencode" not in content:
                continue

            wf = yaml.safe_load(content) or {}
            wf_name = wf.get("name", wf_file.name)

            # Determine task type from workflow map or auto-classify
            mapped_task = workflow_map.get(stem)

            for job_id, job in (wf.get("jobs") or {}).items():
                steps = job.get("steps") or []
                for idx, step in enumerate(steps):
                    uses = step.get("uses") or ""
                    if "anomalyco/opencode" not in uses:
                        continue

                    with_block = step.get("with") or {}
                    model, model_free = _parse_model_expression(
                        str(with_block.get("model") or "NOT_SET")
                    )
                    auto = model == "__auto__"
                    agent = str(with_block.get("agent") or "")
                    prompt = str(with_block.get("prompt") or "")[:500]

                    # Task type first: action-preselected steps resolve
                    # their model from the central config by task type.
                    # Check job-level override first
                    job_override_key = f"{stem}/{job_id}"
                    if job_override_key in job_task_overrides:
                        task_type = job_task_overrides[job_override_key]
                    elif mapped_task:
                        task_type = mapped_task
                    else:
                        task_type = classify_task_type(
                            wf_name,
                            job.get("name") or job_id,
                            step.get("name") or f"step-{idx}",
                            prompt,
                            task_types,
                        )

                    if auto:
                        resolved_go, resolved_free = resolve_auto_models(
                            task_type
                        )
                        if resolved_go:
                            model, model_free = resolved_go, resolved_free
                        else:
                            model_free = None

                    results.append(
                        {
                            "file": str(wf_file.relative_to(ROOT)),
                            "workflow_name": wf_name,
                            "job_id": job_id,
                            "job_name": job.get("name") or job_id,
                            "step_index": idx,
                            "step_name": step.get("name") or f"step-{idx}",
                            "action_ref": uses,
                            "model": model,
                            "model_free": model_free,
                            "auto": auto,
                            "agent": agent,
                            "prompt_preview": prompt,
                            "task_type": task_type,
                            "mapped": bool(mapped_task),
                        }
                    )

        except (yaml.YAMLError, KeyError, ValueError, OSError) as e:
            results.append(
                {
                    "file": str(wf_file.relative_to(ROOT)),
                    "workflow_name": wf_file.name,
                    "error": str(e),
                    "task_type": "other",
                }
            )

    save_json(WORKFLOW_SCAN_PATH, results)
    print(f"  v Found {len(results)} OpenCode step(s) across workflows")
    return results


# Central Model Config ---
# The maintenance run writes data/model-config.json — the single source of
# truth for which model each task-type runs. Downstream workflows preselect it
# at startup via the select-model action (action.yml), which fails closed: no
# default models exist, so an unreachable or missing config aborts the step.
_MODEL_CONFIG_CACHE: dict[str, Any] | None = None


def _load_model_config() -> dict[str, Any]:
    """Load the committed central model config (cached per run)."""
    global _MODEL_CONFIG_CACHE
    if _MODEL_CONFIG_CACHE is None:
        _MODEL_CONFIG_CACHE = {}
        if MODEL_CONFIG_PATH.exists():
            try:
                _MODEL_CONFIG_CACHE = load_json(MODEL_CONFIG_PATH)
            except (OSError, json.JSONDecodeError) as e:
                print(f"  w Failed to read {MODEL_CONFIG_PATH}: {e}")
    assert _MODEL_CONFIG_CACHE is not None
    return _MODEL_CONFIG_CACHE


def resolve_auto_models(task_type: str) -> tuple[str | None, str | None]:
    """Resolve the (go, free) models for an action-preselected workflow step
    from the central config by task type (matched case-insensitively).
    Returns (None, None) when no entry exists (e.g. on the first run before
    the config has been generated)."""
    table = _load_model_config().get("task-types") or {}
    entry = next(
        (v for k, v in table.items() if k.lower() == task_type.lower()),
        None,
    )
    if not entry:
        return None, None
    return entry.get("go"), entry.get("free")


def generate_model_config(
    free_models: list[dict[str, Any]],
    go_models: list[dict[str, Any]],
    livebench: dict[str, Any],
    task_types: list[dict[str, Any]],
    threshold_pct: float,
    go_ids: set[str],
) -> bool:
    """Compute the proposed central model config — without applying it.

    The committed data/model-config.json is the actual configuration and is
    only changed through an issue + PR review, never automatically. It is
    keyed by task-type only, so any downstream workflow can preselect a model
    with the select-model action. Each entry uses the best free/paid models
    for the task type (prefixed, e.g. `opencode-go/kimi-k3`) after the
    free-first policy.

    Returns True when the proposal differs from the committed config (the
    proposal is saved to data/model-config.proposed.json so the workflow can
    open a review issue, and the committed file is left untouched).
    """
    task_map: dict[str, Any] = {}
    for tt in task_types:
        name = tt["name"]
        priority = tt.get("priority", "overall")
        best_free, best_go = get_best_models_for_task(
            name, free_models, go_models, livebench, task_types
        )
        best_free, best_go = apply_free_first_rule(
            best_free, best_go, livebench, priority, threshold_pct
        )
        task_map[name] = {
            "go": _add_model_prefix(best_go, go_ids) if best_go else None,
            "free": _add_model_prefix(best_free, go_ids) if best_free else None,
        }

    proposed = {
        "timestamp": datetime.now(UTC).isoformat(),
        "livebench_snapshot": livebench.get("_snapshot_date")
        if isinstance(livebench, dict)
        else None,
        "task-types": task_map,
    }

    if not MODEL_CONFIG_PATH.exists():
        # No committed config yet: the action fails closed without one, so
        # the proposal must land via PR too — never write it in place.
        save_json(MODEL_CONFIG_PROPOSED_PATH, proposed)
        print(f"  ! No committed config found — proposal saved to {MODEL_CONFIG_PROPOSED_PATH} (add via issue + PR review)")
        return True

    current = _load_model_config()
    current_task_types = current.get("task-types") or {}
    if current_task_types == proposed["task-types"]:
        print("  v Central model config unchanged")
        return False

    save_json(MODEL_CONFIG_PROPOSED_PATH, proposed)
    print(f"  ! Model config drift detected — NOT applied; proposal saved to {MODEL_CONFIG_PROPOSED_PATH}")
    print("  ! Committed data/model-config.json changes only via issue + PR review")
    return True


def classify_task_type(
    wf_name: str, job_name: str, step_name: str, prompt: str, task_types: list[dict[str, Any]]
) -> str:
    """Classify workflow step into task type based on signals."""
    text = f"{wf_name} {job_name} {step_name} {prompt}".lower()

    for tt in task_types:
        for signal in tt.get("signals", []):
            if signal.lower() in text:
                return tt["name"]

    return "other"


# --- Scoring & Recommendations ---
# LiveBench data is stored as {"models": {name: {subscores...}}, "_source": ...}
# This helper unwraps it for the scoring functions.
def _lb_models(livebench: object) -> dict[str, dict[str, float]]:
    # livebench comes from JSON/YAML data and may not be a dict at runtime
    if not isinstance(livebench, dict):
        return {}
    if "models" in livebench and isinstance(livebench["models"], dict):
        return livebench["models"]
    # Backwards-compat: treat dict itself as the model map
    return {k: v for k, v in livebench.items() if not k.startswith("_")}


def _normalise_model_for_lookup(model_name: str) -> str:
    """Normalise a model name for LiveBench lookup.

    Strips the provider prefix (e.g. `opencode/`, `opencode-go/`) and the `-free`
    suffix that OpenCode uses for free-tier variants but LiveBench doesn't include.
    Also normalises case and trims whitespace.
    """
    name = model_name.strip().lower()
    # Strip provider prefix (e.g. opencode/deepseek-v4-flash -> deepseek-v4-flash)
    if "/" in name and not name.startswith("http"):
        name = name.rsplit("/", 1)[-1]
    # Strip -free suffix (OpenCode free version indicator, not part of model name)
    name = name.removesuffix("-free")
    return name


def get_model_score(model_name: str, livebench: dict[str, Any], subscore: str) -> float | None:
    """Get a model's subscore from LiveBench data or static fallback (case-insensitive, suffix-stripped)."""
    s = _get_model_score_and_source(model_name, livebench, subscore)
    return s[0] if s else None


def _get_model_score_and_source(
    model_name: str, livebench: dict, subscore: str
) -> tuple[float | None, str] | None:
    """Like get_model_score but returns (score, source) where source is 'livebench' or 'fallback'."""
    models = _lb_models(livebench)
    target = _normalise_model_for_lookup(model_name)

    # 1. Try LiveBench data
    for k, v in models.items():
        if _normalise_model_for_lookup(k) == target:
            return (v.get(subscore), "livebench")
    for k, v in models.items():
        k_norm = _normalise_model_for_lookup(k)
        if target and (target in k_norm or k_norm in target):
            return (v.get(subscore), "livebench")

    # 2. Try static fallback config
    fallback = _get_fallback_scores()
    name_lc = model_name.strip().lower()
    if name_lc in fallback:
        return (fallback[name_lc].get(subscore), "fallback")
    for name, scores in fallback.items():
        if _normalise_model_for_lookup(name) == target:
            return (scores.get(subscore), "fallback")
    for name, scores in fallback.items():
        k_norm = _normalise_model_for_lookup(name)
        if target and (target in k_norm or k_norm in target):
            return (scores.get(subscore), "fallback")
    return None


def get_model_source(model_name: str, livebench: dict[str, Any]) -> str:
    """Determine the data source for a model: 'livebench', 'fallback', or 'missing'."""
    s = _get_model_score_and_source(model_name, livebench, "overall")
    if s:
        return s[1]
    return "missing"


def get_best_models_for_task(
    task_type: str,
    free_models: list[dict[str, Any]],
    go_models: list[dict[str, Any]],
    livebench: dict[str, Any],
    task_types: list[dict[str, Any]],
) -> tuple[Any, Any]:
    """Find best free and best paid model for a task type."""
    tt = next((t for t in task_types if t["name"] == task_type), None)
    if not tt:
        return None, None

    priority = tt.get("priority", "overall")

    # Filter models by tier
    free_ids = [m["id"] for m in free_models]
    go_ids = [m["id"] for m in go_models]

    # Score all models
    scored = []
    for model_id in free_ids + go_ids:
        score = get_model_score(model_id, livebench, priority)
        if score is not None:
            tier = "free" if model_id in free_ids else "go"
            scored.append((model_id, tier, score))

    # Fallback to config defaults if no scores
    defaults = {
        # Standard OpenCode task types
        "Plan": ("mimo-v2.5-free", "mimo-v2.5-pro"),
        "Ask": ("hy3-free", "hy3-preview"),
        "Code": ("north-mini-code-free", "kimi-k2.7-code"),
        # GitHub workflow-specific task types
        "issue-triage": ("deepseek-v4-flash-free", "deepseek-v4-flash"),
        "issue-implementation": ("north-mini-code-free", "kimi-k2.7-code"),
        "pr-review": ("nemotron-3-ultra-free", "deepseek-v4-pro"),
        "code-implementation": ("north-mini-code-free", "kimi-k2.7-code"),
        "frontend-design": ("mimo-v2.5-free", "mimo-v2-omni"),
        "frontend-testing": ("north-mini-code-free", "kimi-k2.7-code"),
        "api-testing": ("deepseek-v4-flash-free", "deepseek-v4-flash"),
    }

    if not scored:
        return defaults.get(task_type, (None, None))

    # Sort by score descending
    scored.sort(key=lambda x: x[2], reverse=True)

    best_free = next((m for m, t, _s in scored if t == "free"), None)
    best_go = next((m for m, t, _s in scored if t == "go"), None)

    # If no scored free/go found, try config defaults
    if not best_free and not best_go:
        return defaults.get(task_type, (None, None))

    return best_free, best_go


def get_best_zen_model_for_task(
    task_type: str,
    zen_models: list[dict[str, Any]],
    livebench: dict[str, Any],
    task_types: list[dict[str, Any]],
    go_ids: set[str] | None = None,
) -> tuple[Any, Any, Any]:
    """Find best model across ALL Zen models (free + paid) for a task type.

    Returns (model_id, score, subscore_used) or (None, None, None).
    This is the overall best model available via the `opencode/` engine,
    used as the benchmark reference in recommendation and audit tables.
    Models that are only available via `opencode-go/` (Go) are excluded.
    """
    tt = next((t for t in task_types if t["name"] == task_type), None)
    if not tt:
        return None, None, None

    priority = tt.get("priority", "overall")

    zen_ids = [m["id"] for m in zen_models]
    scored = []
    for model_id in zen_ids:
        # Exclude Go-only models from Best Zen consideration
        if go_ids and model_id in go_ids:
            continue
        score = get_model_score(model_id, livebench, priority)
        if score is not None:
            scored.append((model_id, score))

    if not scored:
        return None, None, None

    scored.sort(key=lambda x: x[1], reverse=True)
    best_id, best_score = scored[0]
    return best_id, best_score, priority


def score_all_zen_models(
    zen_models: list[dict[str, Any]],
    livebench: dict[str, Any],
    task_types: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Score every Zen model across all task types.

    Returns: {
        task_type_name: [
            {"model": id, "score": float, "source": str, "rank": int},
            ...
        ]
    }
    """
    zen_ids = [m["id"] for m in zen_models]
    result = {}
    for tt in task_types:
        name = tt["name"]
        priority = tt.get("priority", "overall")
        scored = []
        for model_id in zen_ids:
            score = get_model_score(model_id, livebench, priority)
            source = get_model_source(model_id, livebench)
            if score is not None:
                scored.append({
                    "model": model_id,
                    "score": score,
                    "source": source,
                })
        scored.sort(key=lambda x: x["score"], reverse=True)
        for i, entry in enumerate(scored, 1):
            entry["rank"] = i
        result[name] = scored
    return result


def get_benchmark_summary(
    zen_models: list[dict[str, Any]],
    go_models: list[dict[str, Any]],
    livebench: dict[str, Any],
    task_types: list[dict[str, Any]],
) -> dict[str, Any]:
    """Generate a benchmark summary with best models per task type.

    This creates the data for data/benchmark_results.json:
    - best_zen_per_task: best overall Zen model for each task type
    - best_go_per_task: best Go (paid) model for each task type (= benchmark ceiling)
    - all_zen_ranked: full ranking of all Zen models per task type
    """
    go_ids = {m["id"] for m in go_models}

    best_zen_per_task = {}
    best_go_per_task = {}
    for tt in task_types:
        name = tt["name"]
        priority = tt.get("priority", "overall")

        # Best Zen
        zid, zscore, _ = get_best_zen_model_for_task(
            name, zen_models, livebench, task_types
        )
        best_zen_per_task[name] = {
            "model": zid,
            "score": zscore,
            "subscore": priority,
        }

        # Best Go (paid) = benchmark ceiling
        zen_ids = [m["id"] for m in zen_models]
        go_scored = []
        for model_id in zen_ids:
            if model_id not in go_ids:
                continue
            score = get_model_score(model_id, livebench, priority)
            if score is not None:
                go_scored.append((model_id, score))
        if go_scored:
            go_scored.sort(key=lambda x: x[1], reverse=True)
            gid, gscore = go_scored[0]
            best_go_per_task[name] = {
                "model": gid,
                "score": gscore,
                "subscore": priority,
            }
        else:
            best_go_per_task[name] = {
                "model": None,
                "score": None,
                "subscore": priority,
            }

    all_zen_ranked = score_all_zen_models(zen_models, livebench, task_types)

    return {
        "best_zen_per_task": best_zen_per_task,
        "best_go_per_task": best_go_per_task,
        "all_zen_ranked": all_zen_ranked,
    }


def apply_free_first_rule(
    best_free: str,
    best_go: str,
    livebench: dict[str, Any],
    priority: str,
    threshold_pct: float = 5.0,
) -> tuple[str, str]:
    """Apply free-first policy: if free within threshold% of paid, prefer free."""
    if not best_free or not best_go:
        return best_free, best_go

    free_score = get_model_score(best_free, livebench, priority)
    go_score = get_model_score(best_go, livebench, priority)

    if free_score is not None and go_score is not None and go_score > 0:
        pct_diff = ((go_score - free_score) / go_score) * 100
        if pct_diff <= threshold_pct:
            return best_free, best_free  # Free is close enough, use it for both

    return best_free, best_go


def _strip_model_prefix(model: str) -> str:
    """Strip common prefixes like `opencode/` from model names for comparison."""
    if not model:
        return model
    name = model.strip()
    # Strip `opencode/` or any other provider prefix
    if "/" in name and not name.startswith("http"):
        name = name.rsplit("/", 1)[-1]
    return name


def classify_model_status(
    current: str, recommended_free: str, recommended_go: str,
    free_ids: set[str] | None = None,
) -> str:
    """Classify model status with a 5-tier system.

    Rules:
      \u2705 OK       - current matches best model (after free-first)
      \u26a0\ufe0f Warn  - current is a free model but not the best
      \u2757 Alert   - free-first chose free but current is a paid model
      \u274c Error   - current exists but doesn't fit any other rule
      \U0001f480 Fatal   - current is falsy or "NOT_SET"

    Accepts an optional set of free model IDs (models with a `-free` suffix OR
    published as "Free" on the Zen docs pricing page, e.g. `big-pickle`).
    """
    if not current or current == "NOT_SET":
        return "\U0001f480"  # Fatal

    # Normalize model names for comparison (strip opencode/ prefix, lowercase)
    curr = _strip_model_prefix(current).lower().strip()
    rec_free = (
        _strip_model_prefix(recommended_free).lower().strip()
        if recommended_free
        else ""
    )
    rec_go = (
        _strip_model_prefix(recommended_go).lower().strip() if recommended_go else ""
    )

    # Free tier: `-free` suffix OR listed as "Free" on the pricing page.
    free_ids_norm = {_strip_model_prefix(f).lower().strip() for f in (free_ids or ())}

    # Free-first rule: if rec_free == rec_go, free won
    free_won = bool(rec_free and rec_go and rec_free == rec_go)
    best = rec_free if free_won else rec_go

    if curr == best:
        return "\u2705"  # OK - matches best model

    # Not the best model
    is_free_model = curr.endswith("-free") or curr in free_ids_norm
    if not is_free_model:
        # Paid model
        if free_won:
            return "\u2757"  # Alert - paying when free is preferred
        return "\u274c"  # Error - wrong model

    # Free model, not the best
    return "\u26a0\ufe0f"  # Warn - free but not optimal


# --- README Generation ---


# --- Coverage Checks ---
def detect_coverage_issues(free_models: list[dict[str, Any]], go_models: list[dict[str, Any]], livebench: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Detect stale fallback entries and models missing scores entirely.

    Returns: {
        "stale_fallback": [{"model": str, "livebench_scores": {...}}],
        "missing_scores": [{"model": str, "tier": str}],
    }
    """
    issues = {"stale_fallback": [], "missing_scores": []}
    lb_models = _lb_models(livebench)
    fallback = _get_fallback_scores()

    # Normalise LiveBench model names for quick lookup
    lb_set = set()
    for k in lb_models:
        lb_set.add(_normalise_model_for_lookup(k))

    # Check fallback entries that are now in LiveBench
    for name in fallback:
        norm = _normalise_model_for_lookup(name)
        if norm in lb_set:
            lb_scores = {
                k: v
                for k, v in lb_models.items()
                if _normalise_model_for_lookup(k) == norm
            }
            issues["stale_fallback"].append(
                {
                    "model": name,
                    "livebench_scores": lb_scores.get(
                        norm, next(iter(lb_scores.values()), {})
                    ),
                }
            )

    # Check all OpenCode models for missing scores
    free_ids = {m["id"] for m in free_models}
    all_ids = [m["id"] for m in free_models] + [m["id"] for m in go_models]
    for model_id in sorted(all_ids):
        source = get_model_source(model_id, livebench)
        if source == "missing":
            tier = "Free" if model_id in free_ids else "Go (Paid)"
            issues["missing_scores"].append({"model": model_id, "tier": tier})

    return issues


def generate_model_recommendation_table(
    task_types: list[dict[str, Any]],
    free_models: list[dict[str, Any]],
    go_models: list[dict[str, Any]],
    livebench: dict[str, Any],
    threshold_pct: float,
    zen_models: list[dict[str, Any]] | None = None,
) -> str:
    """Generate the task-type model recommendation table.

    Columns: Task Type | Description | Best Zen | Best Free | Best Go
    Each cell shows "Model (score)".
    """
    models = _lb_models(livebench)
    snapshot_date = (
        livebench.get("_snapshot_date") if isinstance(livebench, dict) else None
    )
    source = livebench.get("_source") if isinstance(livebench, dict) else None

    header_lines = [
        "## Model Recommendations by Task Type",
        "",
        "> Automatically updated by `opencode-maintenance` workflow.",
        f"> Last updated: **{datetime.now(UTC).strftime('%Y-%m-%d %H:%M UTC')}**.",
        f"> LiveBench data: **{len(models)} models scored**.",
    ]
    if snapshot_date:
        header_lines.append(f"> LiveBench snapshot: **{snapshot_date}**.")
    if source:
        header_lines.append(f"> Source: {source}")
    header_lines.extend(
        [
            f"> Free-first threshold: **{threshold_pct}%**.",
            "",
            "| Task Type | Description | Best Zen | Best Free | Best Go |",
            "|-----------|-------------|----------|-----------|---------|",
        ]
    )
    lines = header_lines

    all_zen = zen_models or []
    go_ids = {m["id"] for m in go_models}

    for tt in task_types:
        name = tt["name"]
        desc = tt.get("description", "")
        priority = tt.get("priority", "overall")

        best_free, best_go = get_best_models_for_task(
            name, free_models, go_models, livebench, task_types
        )
        best_free, best_go = apply_free_first_rule(
            best_free, best_go, livebench, priority, threshold_pct
        )

        # Best Zen model (overall best from all Zen models, excluding Go-only)
        zen_id, zen_score, _ = get_best_zen_model_for_task(
            name, all_zen, livebench, task_types, go_ids=go_ids
        )

        free_score = (
            get_model_score(best_free, livebench, priority) if best_free else None
        )
        go_score = get_model_score(best_go, livebench, priority) if best_go else None

        # Prefix model IDs for display
        zen_id_disp = _add_model_prefix(zen_id, engine="opencode") if zen_id else None
        best_free_disp = _add_model_prefix(best_free, engine="opencode") if best_free else None
        best_go_disp = _add_model_prefix(best_go, engine="opencode-go") if best_go else None

        # Highlight the winner based on free-first policy
        # Winner gets trophy emoji
        if best_free_disp and best_go_disp and best_free_disp == best_go_disp:
            # Same model (free model wins due to free-first rule)
            free_display = "\U0001f3c6 " + format_model_with_score(
                best_free_disp, free_score,
            )
            go_display = format_model_with_score(best_go_disp, go_score)
        elif best_go and best_free:
            # Different models - go model wins (free wasn't within threshold)
            free_display = format_model_with_score(
                best_free_disp, free_score,
            )
            go_display = "\U0001f3c6 " + format_model_with_score(
                best_go_disp, go_score,
            )
        elif best_go:
            free_display = "\u2014"
            go_display = "\U0001f3c6 " + format_model_with_score(
                best_go_disp, go_score,
            )
        elif best_free:
            free_display = "\U0001f3c6 " + format_model_with_score(
                best_free_disp, free_score,
            )
            go_display = "\u2014"
        else:
            free_display = "\u2014"
            go_display = "\u2014"

        zen_display = format_model_with_score(
            zen_id_disp, zen_score,
        )

        lines.append(
            f"| `{name}` | {desc} | {zen_display} | {free_display} | {go_display} |"
        )

    return "\n".join(lines)


def generate_score_reference_table(
    livebench: dict[str, Any],
    free_models: list[dict[str, Any]],
    go_models: list[dict[str, Any]],
    zen_models: list[dict[str, Any]] | None = None,
    task_types: list[dict[str, Any]] | None = None,
) -> str:
    """Generate the detailed score reference table with source indicators.

    Adds a "Best For" column that shows which task type each model is
    best suited for, based on its highest-scoring subscore relative to
    task_type priorities. Uses emoji badges for visual distinction.
    """
    _ = zen_models  # kept for API compatibility
    all_model_ids = [m["id"] for m in free_models] + [m["id"] for m in go_models]
    free_ids = {m["id"] for m in free_models}

    # Build a reverse map: model -> list of task types it's best suited for.
    # For each model, find the top 2 task types whose priority subscore the
    # model scores highest on, so the "Best For" column shows top 2.
    best_for_map = {}
    if task_types:
        for model_id in all_model_ids:
            task_scores = []
            for tt in task_types:
                priority = tt.get("priority", "overall")
                score = get_model_score(model_id, livebench, priority)
                if score is not None:
                    task_scores.append((tt["name"], score))
            # Sort by score descending and take top 2
            task_scores.sort(key=lambda x: x[1], reverse=True)
            top_tasks = [t[0] for t in task_scores[:2]]
            if top_tasks:
                best_for_map[model_id] = top_tasks

    # Short labels for task types in badges
    TASK_BADGES = {
        "issue-triage": "Triage",
        "issue-implementation": "Impl",
        "pr-review": "Review",
        "code-implementation": "Code",
        "frontend-design": "Design",
        "frontend-testing": "FTest",
        "api-testing": "ATest",
        "other": "Other",
    }

    lines = [
        "",
        "### LiveBench Score Reference",
        "",
        "| Model | Tier | Source | Best For | Overall | Coding | Reasoning | Vision | Instruction Following |",
        "|-------|------|--------|----------|---------|--------|-----------|--------|----------------------|",
    ]

    for model_id in sorted(all_model_ids):
        tier = "Free" if model_id in free_ids else "Go (Paid)"
        source = get_model_source(model_id, livebench)
        if source == "livebench":
            src_icon = "\u2705 LiveBench"
        elif source == "fallback":
            src_icon = "\U0001f4cb Fallback"
        else:
            src_icon = "\u274c Missing"

        # Best-for badges
        tasks = best_for_map.get(model_id, [])
        if tasks:
            badges = ", ".join(TASK_BADGES.get(t) or t for t in tasks)
            best_for_cell = badges
        else:
            best_for_cell = "\u2014"

        ov = get_model_score(model_id, livebench, "overall")
        cd = get_model_score(model_id, livebench, "coding")
        re_s = get_model_score(model_id, livebench, "reasoning")
        vs = get_model_score(model_id, livebench, "vision")
        if_ = get_model_score(model_id, livebench, "instruction_following")
        lines.append(
            f"| `{model_id}` | {tier} | {src_icon} | {best_for_cell} | "
            + f"{ov if ov is not None else '—'} | {cd if cd is not None else '—'} | "
            + f"{re_s if re_s is not None else '—'} | {vs if vs is not None else '—'} | "
            + f"{if_ if if_ is not None else '—'} |"
        )

    return "\n".join(lines)


def generate_workflow_audit_table(
    scan_results: list[dict[str, Any]],
    free_models: list[dict[str, Any]],
    go_models: list[dict[str, Any]],
    livebench: dict[str, Any],
    task_types: list[dict[str, Any]],
    threshold_pct: float,
    zen_models: list[dict[str, Any]] | None = None,
) -> str:
    """Generate the workflow audit table with status icons.

    Columns: Workflow | Job | Step | Task Type | Current Model |
    Recommended Zen (+XX%) | Recommended Free | Recommended Go | Status
    The "Recommended Zen" column shows the best Zen model with percentage
    difference vs current model as suffix (e.g., `model (+15%)`).
    """
    if not scan_results:
        return "\n## Workflow Model Audit\n\n> No OpenCode workflows found (excluding maintenance workflow).\n"

    all_zen = zen_models or []
    go_ids = {m["id"] for m in go_models}
    free_ids = {m["id"] for m in free_models}

    lines = [
        "",
        "## Workflow Model Audit",
        "",
        f"> Audited: **{datetime.now(UTC).strftime('%Y-%m-%d %H:%M UTC')}**",
        f"> Workflows checked: **{len({r['file'] for r in scan_results})}**",
        f"> OpenCode steps found: **{len(scan_results)}**",
        "",
        "| Workflow | Job | Step | Task Type | Current Model | Recommended Zen | Recommended Free | Recommended Go | Status |",
        "|----------|-----|------|-----------|---------------|-----------------|------------------|----------------|--------|",
    ]

    for r in scan_results:
        if "error" in r:
            lines.append(
                f"| `{r['file']}` | \u2014 | \u2014 | `parse-error` | \u2014 | \u2014 | \u2014 | \u2014 | \u274c Parse Error |"
            )
            continue

        task_type = r.get("task_type", "other")
        current = r.get("model", "NOT_SET")

        best_free, best_go = get_best_models_for_task(
            task_type, free_models, go_models, livebench, task_types
        )
        best_free, best_go = apply_free_first_rule(
            best_free,
            best_go,
            livebench,
            next(
                (t["priority"] for t in task_types if t["name"] == task_type), "overall"
            ),
            threshold_pct,
        )

        # Best Zen model and % diff vs current
        zen_id, zen_score, _ = get_best_zen_model_for_task(
            task_type, all_zen, livebench, task_types, go_ids=go_ids
        )
        priority = next(
            (t["priority"] for t in task_types if t["name"] == task_type), "overall"
        )
        current_score = get_model_score(
            _strip_model_prefix(current), livebench, priority
        )

        zen_display = f"`{zen_id}`" if zen_id else "\u2014"
        zen_suffix = ""
        if zen_id and zen_score is not None and current_score is not None and current_score > 0:
            zen_pct = ((zen_score - current_score) / current_score) * 100
            if abs(zen_pct) >= 0.5:
                zen_suffix = f" (+{zen_pct:.0f}%)" if zen_pct > 0 else f" ({zen_pct:.0f}%)"
            else:
                zen_suffix = " (0%)"

        # Prefix model IDs for display
        zen_id_disp = _add_model_prefix(zen_id, engine="opencode") if zen_id else None
        best_free_disp = _add_model_prefix(best_free, engine="opencode") if best_free else None
        best_go_disp = _add_model_prefix(best_go, engine="opencode-go") if best_go else None

        # Format Zen cell
        if zen_id_disp:
            zen_display = format_model_with_score(
                zen_id_disp, zen_score, score_suffix=zen_suffix,
            )
        else:
            zen_display = "\u2014"

        # Compute percentage diff and trophy display
        free_score = (
            get_model_score(best_free, livebench, priority) if best_free else None
        )
        go_score = (
            get_model_score(best_go, livebench, priority) if best_go else None
        )

        diff_str = ""
        if (
            best_free
            and best_go
            and best_free != best_go
            and free_score is not None
            and go_score is not None
            and free_score > 0
        ):
            pct = ((go_score - free_score) / free_score) * 100
            if abs(pct) >= 1:
                diff_str = f" (+{pct:.0f}%)" if pct > 0 else f" ({pct:.0f}%)"

        status = classify_model_status(
            current, best_free, best_go,
            free_ids=free_ids,
        )

        # Add trophy icon to the recommended model that is preferred
        if best_free and best_go and best_free == best_go:
            # Same model - show in both columns with trophy on free (preferred)
            free_display = "\U0001f3c6 " + format_model_with_score(
                best_free_disp, free_score,
            )
            go_display = format_model_with_score(best_go_disp, go_score)
        elif best_go and best_free:
            free_display = format_model_with_score(
                best_free_disp, free_score,
            )
            go_display = "\U0001f3c6 " + format_model_with_score(
                best_go_disp, go_score, score_suffix=diff_str,
            )
        elif best_go:
            free_display = "\u2014"
            go_display = "\U0001f3c6 " + format_model_with_score(
                best_go_disp, go_score, score_suffix=diff_str,
            )
        elif best_free:
            free_display = "\U0001f3c6 " + format_model_with_score(
                best_free_disp, free_score,
            )
            go_display = "\u2014"
        else:
            free_display = "\u2014"
            go_display = "\u2014"

        workflow = r.get("workflow_name", r["file"])
        job = r.get("job_name", r["job_id"])
        step = r.get("step_name", f"step-{r['step_index']}")

        # Show both tiers for steps with the /oc (Go) + /ocf (free) split
        if current == "__auto__":
            current_cell = "`auto` (central config)"
        else:
            current_cell = f"`{current}`"
            if r.get("model_free"):
                current_cell += f" (`/ocf`: `{r['model_free']}`)"
            if r.get("auto"):
                current_cell += " \u2699\ufe0f"

        lines.append(
            f"| `{workflow}` | `{job}` | `{step}` | `{task_type}` | "
            + f"{current_cell} | {zen_display} | {free_display} | {go_display} | {status} |"
        )

    lines.append("")
    lines.append(
        "_Legend: \u2705 Optimal \u00b7 \u26a0\ufe0f Warn (free, not best) \u00b7 "
        + "\u2757 Alert (paid when free is preferred) \u00b7 "
        + "\u274c Error (wrong model) \u00b7 "
        + "\U0001f480 Fatal (model not set). "
        + "\U0001f3c6 marks the preferred model after free-first policy (free within 5% of best Go \u2192 prefer free). "
        + "\u2699\ufe0f marks steps preselected at runtime from the central config "
        + "(`data/model-config.json`) via the select-model action. "
        + "Recommended Zen shows best Zen model with score difference vs current model (e.g., `model (+15%)`)._"
    )

    return "\n".join(lines)


def update_readme(model_table: str, score_table: str, audit_table: str) -> bool:
    """Update README.md with the new tables."""
    print("-> Updating README.md...")

    if README_PATH.exists():
        content = README_PATH.read_text(encoding="utf-8")
    else:
        content = "# opencode-actions\n\n"

    # Define markers for sections to replace
    sections = {
        "## Model Recommendations by Task Type": model_table,
        "### LiveBench Score Reference": score_table,
        "## Workflow Model Audit": audit_table,
    }

    for marker, new_content in sections.items():
        if marker in content:
            # Replace from marker to next ## or ### or end
            parts = content.split(marker)
            before = parts[0]
            after_marker = parts[1] if len(parts) > 1 else ""
            # Find next section header
            next_header = re.search(r"\n(?=## |### )", after_marker)
            if next_header:
                after = after_marker[next_header.start() :]
            else:
                after = ""
            content = before + new_content + after
        else:
            # Append at end
            content = content.rstrip() + "\n\n" + new_content

    _ = README_PATH.write_text(content, encoding="utf-8")
    print("  v README.md updated")
    return True


# --- Main ---
def main() -> None:
    print("=" * 60)
    print("OpenCode Maintenance - Model Audit & README Update")
    print("=" * 60)

    # Load config
    task_types = load_yaml(TASK_TYPES_PATH).get("task_types") or []
    threshold_pct = load_yaml(TASK_TYPES_PATH).get("free_first_threshold_pct") or 5

    # 1. Fetch model catalogs
    free_models, go_models = fetch_opencode_models()

    # 2. Fetch LiveBench scores
    livebench = fetch_livebench()

    # 3. Scan workflows
    scan_results = scan_workflows()

    # 4. Generate recommendations & audit
    print("-> Computing recommendations...")

    # All Zen models (free + paid) for benchmark scoring
    zen_data_obj = load_json(ZEN_MODELS_PATH) if ZEN_MODELS_PATH.exists() else {}
    all_zen_models = zen_data_obj.get("all", [])
    go_ids = {m["id"] for m in go_models}
    free_ids = {m["id"] for m in free_models}

    model_table = generate_model_recommendation_table(
        task_types, free_models, go_models, livebench, threshold_pct,
        zen_models=all_zen_models,
    )
    score_table = generate_score_reference_table(
        livebench, free_models, go_models,
        zen_models=all_zen_models, task_types=task_types,
    )
    audit_table = generate_workflow_audit_table(
        scan_results, free_models, go_models, livebench, task_types, threshold_pct,
        zen_models=all_zen_models,
    )

    # 5. Generate and save benchmark data
    print("-> Generating benchmark data...")
    benchmark = get_benchmark_summary(
        all_zen_models, go_models, livebench, task_types
    )
    benchmark_path = DATA_DIR / "benchmark_results.json"
    save_json(
        benchmark_path,
        {
            "timestamp": datetime.now(UTC).isoformat(),
            "livebench_snapshot": livebench.get("_snapshot_date")
            if isinstance(livebench, dict)
            else None,
            "livebench_source": livebench.get("_source")
            if isinstance(livebench, dict)
            else None,
            "zen_models_count": len(all_zen_models),
            "go_models_count": len(go_models),
            **benchmark,
        },
    )
    print(f"  v Benchmark data saved to {benchmark_path}")

    # 6. Update README
    _ = update_readme(model_table, score_table, audit_table)

    # 7. Save audit results for CI
    audit_results = []
    for r in scan_results:
        if "error" in r:
            audit_results.append(
                {
                    "file": r["file"],
                    "workflow": r["workflow_name"],
                    "status": "parse_error",
                    "error": r["error"],
                }
            )
            continue

        task_type = r.get("task_type", "other")
        current = r.get("model", "NOT_SET")

        best_free, best_go = get_best_models_for_task(
            task_type, free_models, go_models, livebench, task_types
        )
        best_free, best_go = apply_free_first_rule(
            best_free,
            best_go,
            livebench,
            next(
                (t["priority"] for t in task_types if t["name"] == task_type), "overall"
            ),
            threshold_pct,
        )

        priority = next(
            (t["priority"] for t in task_types if t["name"] == task_type), "overall"
        )

        # Action-preselected steps resolve their model from the central
        # config by task type during the scan, so `current` is directly
        # comparable — including "__auto__" leftovers, which score fatal.
        status = classify_model_status(
            current, best_free, best_go,
            free_ids=free_ids,
        )

        # Determine preferred tier and compute % diff
        if best_free and best_go and best_free == best_go:
            preferred_tier = "free"
        elif best_go:
            preferred_tier = "go"
        elif best_free:
            preferred_tier = "free"
        else:
            preferred_tier = None
        free_score = (
            get_model_score(best_free, livebench, priority) if best_free else None
        )
        go_score = get_model_score(best_go, livebench, priority) if best_go else None

        preferred_diff = None
        if (
            best_free
            and best_go
            and best_free != best_go
            and free_score is not None
            and go_score is not None
            and free_score > 0
        ):
            pct = ((go_score - free_score) / free_score) * 100
            if abs(pct) >= 1:
                preferred_diff = round(pct)

        audit_results.append(
            {
                "file": r["file"],
                "workflow": r["workflow_name"],
                "job": r["job_name"],
                "step": r["step_name"],
                "task_type": task_type,
                "current_model": current,
                "current_model_free": r.get("model_free"),
                "auto": r.get("auto", False),
                "recommended_free": best_free,
                "recommended_go": best_go,
                "preferred_tier": preferred_tier,
                "preferred_diff": preferred_diff,
                "status": status,
            }
        )

    # 7b. Compute the proposed central model config — never applied to the
    # committed file; drift is reported (not applied) and flows into the issue.
    config_drift = generate_model_config(
        free_models, go_models, livebench, task_types, threshold_pct, go_ids
    )

    save_json(
        AUDIT_RESULTS_PATH,
        {
            "timestamp": datetime.now(UTC).isoformat(),
            "livebench_snapshot": livebench.get("_snapshot_date")
            if isinstance(livebench, dict)
            else None,
            "livebench_source": livebench.get("_source")
            if isinstance(livebench, dict)
            else None,
            "livebench_models": len(_lb_models(livebench)),
            "free_models": len(free_models),
            "go_models": len(go_models),
            "workflows_audited": len({r["file"] for r in scan_results}),
            "steps_audited": len(scan_results),
            "model_config_drift": {
                "detected": config_drift,
                "timestamp": datetime.now(UTC).isoformat(),
                "livebench_snapshot": livebench.get("_snapshot_date")
                if isinstance(livebench, dict)
                else None,
                "current_task_types": (
                    (_load_model_config().get("task-types") or {})
                    if config_drift
                    else {}
                ),
            },
            "results": audit_results,
        },
    )

    # 8. Detect coverage issues (stale fallback, missing scores)
    print("-> Checking model coverage...")
    coverage = detect_coverage_issues(free_models, go_models, livebench)
    save_json(COVERAGE_ISSUES_PATH, coverage)
    if coverage.get("stale_fallback"):
        for m in coverage["stale_fallback"]:
            print(f"  w Stale fallback: {m['model']} is now in LiveBench")
    if coverage.get("missing_scores"):
        for m in coverage["missing_scores"]:
            print(f"  x Missing scores: {m['model']} ({m['tier']})")
    if not coverage.get("stale_fallback") and not coverage.get("missing_scores"):
        print("  v All models have scores, no stale fallback entries")


    print("=" * 60)
    print("Maintenance complete")
    print(f"  Workflows audited: {len({r['file'] for r in scan_results})}")
    print(f"  Steps checked: {len(scan_results)}")
    print(f"  LiveBench models: {len(_lb_models(livebench))}")
    if isinstance(livebench, dict) and livebench.get("_snapshot_date"):
        print(f"  LiveBench snapshot: {livebench['_snapshot_date']}")
    print(f"  README updated: {README_PATH}")
    print(f"  Audit data: {AUDIT_RESULTS_PATH}")
    print(f"  Model config: {MODEL_CONFIG_PATH}")
    if config_drift:
        print(f"  ! Config drift — proposal at {MODEL_CONFIG_PROPOSED_PATH} (requires PR)")
    print("=" * 60)

    # Exit with error code if any \u274c (Error), \u2757 (Alert), or \U0001f480 (Fatal) found (for CI) or coverage issues
    has_errors = any(r.get("status") in ("\u274c", "\u2757", "\U0001f480") for r in audit_results)
    has_coverage = bool(
        coverage.get("stale_fallback") or coverage.get("missing_scores")
    )
    sys.exit(1 if (has_errors or has_coverage) else 0)


if __name__ == "__main__":
    main()
