#!/usr/bin/env python3
"""Unit tests for scripts/opencode_maintenance.py (pure, offline functions).

No network access: fetch_* error paths are exercised by monkeypatching
urlopen, and the fallback-score cache is isolated per test.
Run with: python3 -m unittest discover -s tests -v
"""

import csv
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import opencode_maintenance as m  # noqa: E402


class ToFloatTest(unittest.TestCase):
    def test_values(self):
        self.assertEqual(m._to_float("3.5"), 3.5)
        self.assertEqual(m._to_float(2), 2.0)
        self.assertIsNone(m._to_float(None))
        self.assertIsNone(m._to_float(""))
        self.assertIsNone(m._to_float("abc"))
        self.assertIsNone(m._to_float(object()))


class ParseLivebenchCsvTest(unittest.TestCase):
    def test_aggregates_subscores_and_overall(self):
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["model", "code_completion", "python", "math_comp", "paraphrase"])
        w.writerow(["alpha", "80", "90", "70", "60"])
        w.writerow(["beta", "50", "", "bad", "40"])
        w.writerow(["", "10", "10", "10", "10"])  # skipped: no model
        result = m.parse_livebench_csv(buf.getvalue())
        self.assertAlmostEqual(result["alpha"]["coding"], 85.0)
        self.assertAlmostEqual(result["alpha"]["reasoning"], 70.0)
        self.assertAlmostEqual(result["alpha"]["overall"], 75.0)
        self.assertIn("coding", result["beta"])
        self.assertNotIn("reasoning", result["beta"])  # no numeric values
        self.assertNotIn("", result)

    def test_bad_csv_returns_empty(self):
        self.assertEqual(m.parse_livebench_csv("not,a,csv\n\x00\x01"), {})


class FormatModelWithScoreTest(unittest.TestCase):
    def test_all_shapes(self):
        self.assertEqual(m.format_model_with_score(None, 90), "—")
        self.assertEqual(m.format_model_with_score("", 90), "—")
        self.assertEqual(m.format_model_with_score("a/b", None), "`a/b`")
        self.assertEqual(m.format_model_with_score("a/b", None, cost="Free"), "`a/b` (Free)")
        self.assertEqual(m.format_model_with_score("a/b", 88.5), "`a/b` (88.5)")
        self.assertEqual(
            m.format_model_with_score("a/b", 88.5, score_suffix="+2%", cost="$1/$2"),
            "`a/b` (88.5+2%, $1/$2)",
        )


class AddModelPrefixTest(unittest.TestCase):
    def test_rules(self):
        self.assertEqual(m._add_model_prefix(""), "")
        self.assertEqual(m._add_model_prefix("a/b"), "a/b")
        self.assertEqual(m._add_model_prefix("x", engine="opencode-go"), "opencode-go/x")
        self.assertEqual(m._add_model_prefix("x-free"), "opencode/x-free")
        self.assertEqual(m._add_model_prefix("x", {"x"}), "opencode-go/x")
        self.assertEqual(m._add_model_prefix("x", set()), "opencode/x")
        self.assertEqual(m._add_model_prefix("x", None), "opencode/x")


class FetchHelpersTest(unittest.TestCase):
    def test_fetch_json_error_returns_none(self):
        with patch.object(m, "urlopen", side_effect=URLError("down")):
            self.assertIsNone(m.fetch_json("http://x"))

    def test_fetch_text_error_returns_none(self):
        with patch.object(m, "urlopen", side_effect=URLError("down")):
            self.assertIsNone(m.fetch_text("http://x"))

    def test_fetch_livebench_csv_falls_back_to_mirror(self):
        calls = []

        def fake(url, timeout=15):
            calls.append(url)
            return "csv-data" if "raw.githubusercontent" in url else None

        with patch.object(m, "fetch_text", side_effect=fake):
            self.assertEqual(m.fetch_livebench_csv("2024_01_01"), "csv-data")
            self.assertEqual(len(calls), 2)

    def test_fetch_livebench_csv_prefers_primary(self):
        with patch.object(m, "fetch_text", return_value="primary"):
            self.assertEqual(m.fetch_livebench_csv("2024_01_01"), "primary")


class HtmlTableParserTest(unittest.TestCase):
    def test_extracts_tables(self):
        html = (
            "<table><tr><th>Name</th><th>Input</th></tr>"
            "<tr><td> Foo  Bar </td><td>$0.30</td></tr></table>"
            "<p>noise</p>"
        )
        p = m._HtmlTableParser()
        p.feed(html)
        self.assertEqual(p.tables, [[["Name", "Input"], ["Foo Bar", "$0.30"]]])

    def test_ignores_cells_outside_tables(self):
        p = m._HtmlTableParser()
        p.feed("<td>orphan</td><tr><td>norow</td></tr>")
        self.assertEqual(p.tables, [])


class PricingCellTest(unittest.TestCase):
    def test_normalise(self):
        self.assertIsNone(m._parse_price_cell(""))
        self.assertIsNone(m._parse_price_cell(" - "))
        self.assertIsNone(m._parse_price_cell("-"))
        self.assertEqual(m._parse_price_cell("Free"), "Free")
        self.assertEqual(m._parse_price_cell("  $0.30 "), "$0.30")

    def test_display_to_id(self):
        name_to_id = {"GPT 5.6 Sol": "gpt-5.6-sol"}
        self.assertEqual(
            m._pricing_display_to_id("GPT 5.6 Sol (≤ 272K tokens)", name_to_id),
            "gpt-5.6-sol",
        )
        self.assertEqual(m._pricing_display_to_id("Some New Model!", {}), "some-new-model")
        self.assertIsNone(m._pricing_display_to_id("((()))", {}))


class PriceValueTest(unittest.TestCase):
    def test_parse(self):
        self.assertIsNone(m._parse_price_value(None))
        self.assertIsNone(m._parse_price_value(""))
        self.assertIsNone(m._parse_price_value("-"))
        self.assertEqual(m._parse_price_value("Free"), 0.0)
        self.assertEqual(m._parse_price_value("free"), 0.0)
        self.assertEqual(m._parse_price_value("$1.50"), 1.5)
        self.assertEqual(m._parse_price_value("$2 / 1M"), 2.0)
        self.assertIsNone(m._parse_price_value("n/a"))


class PriceLookupTest(unittest.TestCase):
    def test_build_and_lookup(self):
        zen = [
            {"id": "model-a", "pricing": {"input": "$1.00", "output": "$2.00"}},
            {"id": "model-b", "pricing": {}},
            {"id": "model-c-free", "pricing": {}},
        ]
        lookup = m._build_price_lookup(zen, free_ids={"model-c-free", "ghost-free"})
        self.assertEqual(lookup["model-a"], {"input": 1.0, "output": 2.0})
        # free-tier ids without published prices default to Free
        self.assertEqual(lookup["model-c-free"], {"input": 0.0, "output": 0.0})
        self.assertEqual(lookup["ghost-free"], {"input": 0.0, "output": 0.0})
        # normalised lookup strips provider prefix / -free suffix
        self.assertEqual(
            m._lookup_price("opencode/model-a", lookup), (1.0, 2.0)
        )
        self.assertEqual(m._lookup_price("model-a-free", lookup), (1.0, 2.0))
        self.assertEqual(m._lookup_price("unknown", lookup), (None, None))
        self.assertEqual(m._lookup_price("", lookup), (None, None))
        self.assertEqual(m._lookup_price("model-a", None), (None, None))
        # paid model without pricing stays unknown
        self.assertEqual(m._lookup_price("model-b", lookup), (None, None))

    def test_skips_empty_ids(self):
        self.assertEqual(m._build_price_lookup([{"id": ""}, {}], free_ids={" "}), {})


class CostBlendTest(unittest.TestCase):
    def test_defaults_and_overrides(self):
        self.assertEqual(m._resolve_cost_blend(None), (0.75, 0.25))
        self.assertEqual(
            m._resolve_cost_blend({"cost_blend": {"input_weight": 1, "output_weight": 3}}),
            (0.25, 0.75),
        )
        # invalid global weights fall back to defaults
        self.assertEqual(
            m._resolve_cost_blend({"cost_blend": {"input_weight": "x"}}),
            (0.75, 0.25),
        )
        # zero total falls back to defaults
        self.assertEqual(
            m._resolve_cost_blend({"cost_blend": {"input_weight": 0, "output_weight": 0}}),
            (0.75, 0.25),
        )
        # per-task override wins
        tts = [{"name": "t", "cost_blend": {"input_weight": 1, "output_weight": 1}}]
        self.assertEqual(
            m._resolve_cost_blend({}, task_types=tts, task_type="t"), (0.5, 0.5)
        )

    def test_get_model_cost(self):
        lookup = {"a": {"input": 1.0, "output": 3.0}}
        self.assertEqual(
            m.get_model_cost("a", lookup, 0.75, 0.25),
            {"input": 1.0, "output": 3.0, "blended": 1.5},
        )
        self.assertEqual(
            m.get_model_cost("missing", lookup)["blended"], None
        )

    def test_format_cost_pair(self):
        self.assertEqual(m.format_cost_pair(0.0, 0.0), "Free")
        self.assertEqual(m.format_cost_pair(1.0, 2.0), "$1/$2")
        self.assertEqual(m.format_cost_pair(1.5, None), "$1.5 in")
        self.assertEqual(m.format_cost_pair(None, 2.0), "$2 out")
        self.assertEqual(m.format_cost_pair(None, None), "—")


class PickCheapestTest(unittest.TestCase):
    def test_empty(self):
        self.assertIsNone(m._pick_cheapest_within_threshold([], 5))

    def test_cheapest_within_threshold_wins(self):
        scored = [("a", 100.0, 10.0), ("b", 99.0, 1.0), ("c", 50.0, 0.1)]
        self.assertEqual(m._pick_cheapest_within_threshold(scored, 5), "b")

    def test_nonpositive_top_picks_best_score(self):
        scored = [("a", 0.0, 5.0), ("b", -1.0, 1.0)]
        self.assertEqual(m._pick_cheapest_within_threshold(scored, 5), "a")

    def test_unknown_costs_sort_last(self):
        scored = [("a", 100.0, None), ("b", 99.0, 2.0)]
        self.assertEqual(m._pick_cheapest_within_threshold(scored, 5), "b")


class ModelExpressionTest(unittest.TestCase):
    def test_auto_expression(self):
        self.assertEqual(
            m._parse_model_expression("${{ steps.resolve.outputs.model }}"),
            ("__auto__", "__auto__"),
        )

    def test_literal(self):
        self.assertEqual(m._parse_model_expression("opencode/x"), ("opencode/x", None))


class ClassifyTaskTypeTest(unittest.TestCase):
    def test_signal_match_and_fallback(self):
        tts = [
            {"name": "pr-review", "signals": ["review", "pull request"]},
            {"name": "triage", "signals": ["triage"]},
        ]
        self.assertEqual(
            m.classify_task_type("wf", "job", "Review step", "prompt", tts),
            "pr-review",
        )
        self.assertEqual(
            m.classify_task_type("wf", "job", "step", "nothing here", tts), "other"
        )


class NormaliseAndScoreTest(unittest.TestCase):
    def setUp(self):
        self._saved = m._FALLBACK_CACHE
        m._FALLBACK_CACHE = {}

    def tearDown(self):
        m._FALLBACK_CACHE = self._saved

    def test_normalise(self):
        self.assertEqual(
            m._normalise_model_for_lookup("OpenCode-Go/DeepSeek-V4-FREE "), "deepseek-v4"
        )
        self.assertEqual(m._normalise_model_for_lookup("plain"), "plain")

    def test_lb_models_unwrap(self):
        self.assertEqual(m._lb_models("nope"), {})
        self.assertEqual(
            m._lb_models({"models": {"a": {"overall": 1}}}), {"a": {"overall": 1}}
        )
        self.assertEqual(
            m._lb_models({"_src": "x", "a": {"overall": 1}}), {"a": {"overall": 1}}
        )

    def test_livebench_exact_and_fuzzy(self):
        lb = {"models": {"deepseek-v4": {"overall": 80.0}}}
        self.assertEqual(
            m.get_model_score("opencode/deepseek-v4-free", lb, "overall"), 80.0
        )
        # substring fallback also matches
        self.assertEqual(m.get_model_score("deepseek", lb, "overall"), 80.0)
        self.assertIsNone(m.get_model_score("unknown-xyz", lb, "overall"))

    def test_fallback_scores(self):
        m._FALLBACK_CACHE = {"foo": {"overall": 70.0}, "bar-free": {"overall": 71.0}}
        lb = {"models": {}}
        self.assertEqual(m.get_model_score("foo", lb, "overall"), 70.0)
        self.assertEqual(m.get_model_score("bar", lb, "overall"), 71.0)
        self.assertEqual(m.get_model_source("foo", lb), "fallback")
        self.assertEqual(m.get_model_source("nope", lb), "missing")
        self.assertEqual(m.get_model_source("x", {"models": {"x": {"overall": 1}}}), "livebench")


class BestModelsTest(unittest.TestCase):
    def setUp(self):
        self._saved = m._FALLBACK_CACHE
        m._FALLBACK_CACHE = {}

    def tearDown(self):
        m._FALLBACK_CACHE = self._saved

    def test_unknown_task_type(self):
        self.assertEqual(m.get_best_models_for_task("nope", [], [], {}, []), (None, None))

    def test_best_score_per_tier(self):
        lb = {
            "models": {
                "free-a": {"overall": 90.0},
                "free-b": {"overall": 80.0},
                "go-a": {"overall": 95.0},
            }
        }
        tts = [{"name": "t", "priority": "overall"}]
        free = [{"id": "free-a"}, {"id": "free-b"}]
        go = [{"id": "go-a"}]
        self.assertEqual(
            m.get_best_models_for_task("t", free, go, lb, tts), ("free-a", "go-a")
        )

    def test_no_scores_returns_defaults(self):
        tts = [{"name": "pr-review", "priority": "overall"}]
        best = m.get_best_models_for_task("pr-review", [{"id": "x"}], [{"id": "y"}], {"models": {}}, tts)
        self.assertEqual(best, ("nemotron-3-ultra-free", "deepseek-v4-pro"))

    def test_blended_selector_picks_cheaper_within_threshold(self):
        lb = {"models": {"f1": {"overall": 100.0}, "f2": {"overall": 99.0}, "g1": {"overall": 100.0}}}
        tts = [{"name": "t", "priority": "overall"}]
        free = [{"id": "f1"}, {"id": "f2"}]
        go = [{"id": "g1"}]
        lookup = {
            "f1": {"input": 10.0, "output": 10.0},
            "f2": {"input": 1.0, "output": 1.0},
            "g1": {"input": 5.0, "output": 5.0},
        }
        best_free, best_go = m.get_best_models_for_task(
            "t", free, go, lb, tts, lookup, (0.75, 0.25), 5
        )
        self.assertEqual((best_free, best_go), ("f2", "g1"))


class FreeFirstRuleTest(unittest.TestCase):
    def setUp(self):
        self._saved = m._FALLBACK_CACHE
        m._FALLBACK_CACHE = {}

    def tearDown(self):
        m._FALLBACK_CACHE = self._saved

    def test_passthrough_when_missing(self):
        self.assertEqual(m.apply_free_first_rule("", "g", {}, "overall"), ("", "g"))

    def test_free_wins_within_threshold(self):
        lb = {"models": {"f": {"overall": 99.0}, "g": {"overall": 100.0}}}
        self.assertEqual(
            m.apply_free_first_rule("f", "g", lb, "overall", 5.0), ("f", "f")
        )

    def test_paid_kept_when_gap_too_large(self):
        lb = {"models": {"f": {"overall": 80.0}, "g": {"overall": 100.0}}}
        self.assertEqual(
            m.apply_free_first_rule("f", "g", lb, "overall", 5.0), ("f", "g")
        )


class StripPrefixAndStatusTest(unittest.TestCase):
    def test_strip(self):
        self.assertEqual(m._strip_model_prefix("opencode/x"), "x")
        self.assertEqual(m._strip_model_prefix("x"), "x")
        self.assertEqual(m._strip_model_prefix(""), "")

    def test_status_tiers(self):
        self.assertEqual(m.classify_model_status("", "f", "g"), "💀")
        self.assertEqual(m.classify_model_status("NOT_SET", "f", "g"), "💀")
        self.assertEqual(m.classify_model_status("opencode/go-a", "f", "go-a"), "✅")
        # free but not best -> warn
        self.assertEqual(
            m.classify_model_status("opencode/other-free", "best-free", "go-a"), "⚠️"
        )
        # paid while free won -> alert
        self.assertEqual(m.classify_model_status("go-a", "f", "f"), "❗")
        # paid and not best, free did not win -> error
        self.assertEqual(
            m.classify_model_status("go-b", "best-free", "go-a"), "❌"
        )
        # pricing-page free id without -free suffix counts as free
        self.assertEqual(
            m.classify_model_status(
                "big-pickle", "best-free", "go-a", free_ids={"big-pickle"}
            ),
            "⚠️",
        )


class ChangelogAndTreeDatesTest(unittest.TestCase):
    def test_parse_changelog_dates(self):
        text = "## x\n### 2024-02-01\n### 2024-01-15\n"
        with patch.object(m, "fetch_text", return_value=text):
            self.assertEqual(
                m._parse_changelog_dates(), ["2024_02_01", "2024_01_15"]
            )

    def test_parse_changelog_none(self):
        with patch.object(m, "fetch_text", return_value=None):
            self.assertEqual(m._parse_changelog_dates(), [])

    def test_discover_dates_from_tree(self):
        payload = {
            "tree": [
                {"path": "public/table_2024_02_01.csv"},
                {"path": "public/other.txt"},
                {"path": "public/table_2024_01_01.csv"},
            ]
        }
        with patch.object(m, "fetch_json", return_value=payload):
            self.assertEqual(
                m._discover_dates_from_tree(), ["2024_02_01", "2024_01_01"]
            )

    def test_discover_dates_empty(self):
        with patch.object(m, "fetch_json", return_value=None):
            self.assertEqual(m._discover_dates_from_tree(), [])

    def test_snapshot_dates_fallback_chain(self):
        with (
            patch.object(m, "_discover_dates_from_tree", return_value=["a"]),
            patch.object(m, "_parse_changelog_dates") as changelog,
        ):
            self.assertEqual(m.get_livebench_snapshot_dates(), ["a"])
            changelog.assert_not_called()
        with (
            patch.object(m, "_discover_dates_from_tree", return_value=[]),
            patch.object(m, "_parse_changelog_dates", return_value=["b"]),
        ):
            self.assertEqual(m.get_livebench_snapshot_dates(), ["b"])


class ZenPricingParseTest(unittest.TestCase):
    HTML = (
        "<table><tr><th>Model</th><th>Model ID</th></tr>"
        "<tr><td>Foo</td><td>foo</td></tr></table>"
        "<table><tr><th>Model</th><th>Input</th><th>Output</th></tr>"
        "<tr><td>Foo</td><td>Free</td><td>Free</td></tr>"
        "<tr><td>Bar (&le; 1K)</td><td>$0.30</td><td>-</td></tr>"
        "<tr><td></td><td>$1</td><td>$2</td></tr></table>"
    )

    def test_unreachable_returns_none(self):
        with patch.object(m, "fetch_text", return_value=None):
            self.assertIsNone(m.fetch_zen_pricing())

    def test_parses_tables(self):
        with patch.object(m, "fetch_text", return_value=self.HTML):
            pricing = m.fetch_zen_pricing()
        self.assertTrue(pricing["foo"]["free"])
        self.assertEqual(pricing["foo"]["input"], "Free")
        self.assertIn("tiers", pricing["bar"])
        self.assertEqual(pricing["bar"]["output"], None)

    def test_no_pricing_table_returns_empty(self):
        with patch.object(m, "fetch_text", return_value="<table></table>"):
            self.assertEqual(m.fetch_zen_pricing(), {})


class ResolveAutoModelsTest(unittest.TestCase):
    def test_case_insensitive(self):
        m._MODEL_CONFIG_CACHE = {"task-types": {"PR-Review": {"go": "g", "free": "f"}}}
        try:
            self.assertEqual(m.resolve_auto_models("pr-review"), ("g", "f"))
            self.assertEqual(m.resolve_auto_models("missing"), (None, None))
        finally:
            m._MODEL_CONFIG_CACHE = None


class RankModelsTest(unittest.TestCase):
    def setUp(self):
        self._saved = m._FALLBACK_CACHE
        m._FALLBACK_CACHE = {}

    def tearDown(self):
        m._FALLBACK_CACHE = self._saved

    def test_ranking_order_and_costs(self):
        lb = {"models": {"a": {"overall": 90.0}, "b": {"overall": 90.0}, "c": {"overall": 80.0}}}
        lookup = {
            "a": {"input": 2.0, "output": 2.0},
            "b": {"input": 1.0, "output": 1.0},
            "c": {"input": 1.0, "output": 1.0},
        }
        ranked = m._rank_models_for_config(
            ["a", "b", "c", "zzz-qqq"], lb, "overall", lookup, (0.5, 0.5), engine="opencode-go"
        )
        self.assertEqual([r["model"] for r in ranked], ["opencode-go/b", "opencode-go/a", "opencode-go/c"])
        self.assertEqual(ranked[0]["blended_cost"], 1.0)

    def test_no_price_lookup_gives_none_costs(self):
        lb = {"models": {"a": {"overall": 90.0}}}
        ranked = m._rank_models_for_config(["a"], lb, "overall", None, (0.5, 0.5), engine="opencode")
        self.assertEqual(ranked[0]["blended_cost"], None)


class ScoreAllZenTest(unittest.TestCase):
    def setUp(self):
        self._saved = m._FALLBACK_CACHE
        m._FALLBACK_CACHE = {}

    def tearDown(self):
        m._FALLBACK_CACHE = self._saved

    def test_rank_and_value(self):
        lb = {"models": {"a": {"overall": 90.0}, "b": {"overall": 80.0}}}
        lookup = {"a": {"input": 3.0, "output": 3.0}, "b": {"input": 0.0, "output": 0.0}}
        out = m.score_all_zen_models(
            [{"id": "a"}, {"id": "b"}], lb, [{"name": "t", "priority": "overall"}], lookup, (0.5, 0.5)
        )
        self.assertEqual([e["model"] for e in out["t"]], ["a", "b"])
        self.assertEqual(out["t"][0]["rank"], 1)
        self.assertAlmostEqual(out["t"][0]["value"], 30.0)
        self.assertIsNone(out["t"][1]["value"])  # free model has no value


class DetectCoverageTest(unittest.TestCase):
    def setUp(self):
        self._saved = m._FALLBACK_CACHE
        m._FALLBACK_CACHE = {"stale-model": {"overall": 1.0}}

    def tearDown(self):
        m._FALLBACK_CACHE = self._saved

    def test_issues(self):
        lb = {"models": {"stale-model": {"overall": 90.0}}}
        issues = m.detect_coverage_issues(
            [{"id": "ghost-free"}], [{"id": "paid-x"}],
            lb, {"paid-x": {"input": None, "output": 1.0}},
        )
        self.assertTrue(any(i["model"] == "stale-model" for i in issues["stale_fallback"]))
        models_missing = {i["model"] for i in issues["missing_scores"]}
        self.assertIn("ghost-free", models_missing)
        self.assertIn("paid-x", models_missing)
        self.assertEqual(issues["missing_prices"], [{"model": "paid-x", "tier": "Go (Paid)"}])


if __name__ == "__main__":
    unittest.main()
