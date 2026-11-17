import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import opencode_maintenance as m  # noqa: E402


class CanonicalKeyTest(unittest.TestCase):
    def test_matches_js_canonical(self):
        # Same vectors as core/catalog.js (github-action/test/core-chain.test.js):
        # the catalog and the runtime MUST agree on model identity.
        self.assertEqual(m._canonical_catalog_key("opencode/muse-spark-1.3-contributor-free"), "muse-spark-1-3")
        self.assertEqual(m._canonical_catalog_key("claude-opus-4.6"), "claude-opus-4-6")
        self.assertEqual(m._canonical_catalog_key("gpt-5.6-luna-xhigh"), "gpt-5-6-luna")
        self.assertEqual(m._canonical_catalog_key("anthropic/claude-opus-4-6-20251101"), "claude-opus-4-6")


class ParseMcpBodyTest(unittest.TestCase):
    def test_plain_json(self):
        self.assertEqual(m._parse_mcp_body('{"jsonrpc":"2.0","id":1,"result":{}}')["id"], 1)

    def test_sse(self):
        body = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n'
        self.assertTrue(m._parse_mcp_body(body)["result"]["ok"])

    def test_empty_raises(self):
        with self.assertRaises(m.ConsoleError):
            m._parse_mcp_body("   ")


class ConsoleClientTest(unittest.TestCase):
    def test_requires_token(self):
        with self.assertRaises(m.ConsoleError):
            m.ConsoleClient("")


class BuildProviderCatalogTest(unittest.TestCase):
    def setUp(self):
        self.free_models = [{"id": "deepseek-v4.1-flash-free", "name": "DS free"}]
        self.go_models = [{"id": "deepseek-v4.1-flash", "name": "DS"}]
        self.all_zen = [*self.free_models, {"id": "gemini-4-argon", "name": "Gemini"}]
        self.caps = {
            "deepseek-v4.1-flash-free": {"context": 1000000, "modalities": ["text", "image"], "source": "x"},
            "deepseek-v4.1-flash": {"context": 1000000, "modalities": ["text", "image"], "source": "x"},
            "gemini-4-argon": {"context": 1048576, "modalities": ["text", "image", "pdf"], "source": "x"},
        }
        self.prices = {
            "deepseek-v4.1-flash-free": {"input": 0.0, "output": 0.0},
            "deepseek-v4.1-flash": {"input": 0.15, "output": 0.6},
            "gemini-4-argon": {"input": 2.0, "output": 10.0},
        }
        self.models_dev = {
            "google": {
                "name": "Google",
                "models": {
                    "gemini-4-hydrogen": {
                        "cost": {"input": 1.5, "output": 7.5},
                        "limit": {"context": 1048576},
                        "modalities": {"input": ["text", "image"], "output": ["text"]},
                    }
                },
            }
        }
        self.cfg = {"engine": {"opencode": {"class": "zen"}, "opencode-go": {"class": "go"}},
                    "console": {"enabled": True, "slug_aliases": {"opencode": "opencode"}}}
        self.inventory = {
            "providers": [
                {"conn_id": "conn_1", "name": "Google", "slug": "google", "built_in": False,
                 "models": [{"id": "gemini-4-hydrogen", "name": "Gemini 4 Hydrogen", "enabled": True, "available": True}]},
                {"conn_id": "conn_2", "name": "OpenCode", "slug": "opencode", "built_in": True, "models": []},
            ]
        }

    def _catalog(self, inventory=None):
        return m.build_provider_catalog(
            self.free_models, self.go_models, self.all_zen, self.prices, (0.75, 0.25),
            self.caps, self.models_dev, self.cfg, inventory if inventory is not None else self.inventory,
        )

    def test_rows_carry_cost_and_class(self):
        catalog = self._catalog()
        rows = {(r["provider"], r["id"]): r for r in catalog["models"]}
        free = rows[("opencode", "deepseek-v4.1-flash-free")]
        paid = rows[("opencode-go", "deepseek-v4.1-flash")]
        ext = rows[("google", "gemini-4-hydrogen")]
        self.assertEqual(free["class"], "free")
        self.assertTrue(free["free"])
        self.assertEqual(free["blended_cost"], 0.0)
        self.assertEqual(paid["class"], "go")
        self.assertAlmostEqual(paid["blended_cost"], round(0.15 * 0.75 + 0.6 * 0.25, 6))
        self.assertEqual(ext["class"], "external")
        self.assertEqual(ext["canonical"], "gemini-4-hydrogen")
        self.assertEqual(ext["context"], 1048576)
        self.assertEqual(ext["media_in"], ["text", "image"])

    def test_key_agnostic_flags_are_not_stored(self):
        catalog = self._catalog()
        blob = json.dumps(catalog)
        for forbidden in ("enabled", "available", "conn_id", "baseURL", "headers", "org_"):
            self.assertNotIn(forbidden, blob)

    def test_reuses_previous_external_rows_without_console(self):
        catalog = self._catalog(inventory=None)
        providers = catalog["providers"]
        self.assertIn("google", providers)
        keys = {(r["provider"], r["id"]) for r in catalog["models"]}
        self.assertIn(("google", "gemini-4-hydrogen"), keys)
        # engine rows are rebuilt, never duplicated
        self.assertEqual(sum(1 for r in catalog["models"] if r["provider"] == "opencode"), 2)

    def test_task_ranked_is_provider_agnostic(self):
        catalog = self._catalog()
        index = m.catalog_index(catalog)
        ranked = m._task_ranked(
            [{"model": "opencode-go/gemini-4-argon", "score": 95},
             {"model": "opencode-go/deepseek-v4.1-flash", "score": 90}],
            [{"model": "opencode/deepseek-v4.1-flash-free", "score": 90}],
            index,
        )
        self.assertEqual([r["model"] for r in ranked], ["gemini-4-argon", "deepseek-v4-1-flash"])
        self.assertFalse(ranked[0]["free"])
        self.assertTrue(ranked[1]["free"])


class BuildModelRegistryTest(unittest.TestCase):
    def _catalog(self):
        return {
            "providers": {"opencode": {}, "opencode-go": {}},
            "models": [
                {
                    "provider": "opencode", "id": "muse-spark-1.3-contributor-free",
                    "canonical": "muse-spark-1-3", "name": "Muse Spark",
                    "class": "free", "free": True, "blended_cost": 0,
                    "input_cost": 0, "output_cost": 0, "context": 128000,
                    "media_in": ["text"],
                },
                {
                    "provider": "opencode-go", "id": "muse-spark-1.3-contributor",
                    "canonical": "muse-spark-1-3", "class": "go-plan", "free": False,
                    "blended_cost": 0.125, "input_cost": 0.1, "output_cost": 0.2,
                    "context": 200000, "media_in": ["text", "image"],
                },
                {
                    "provider": "anthropic", "id": "muse-spark-1.3",
                    "canonical": "muse-spark-1-3", "class": "external", "free": False,
                    "blended_cost": 1.5, "input_cost": 1, "output_cost": 3,
                    "context": 200000, "media_in": ["text"],
                },
                {
                    "provider": "opencode", "id": "tiny-model",
                    "canonical": "tiny-model", "class": "zen-paid", "free": False,
                    "blended_cost": 0.5, "input_cost": 0.1, "output_cost": 1,
                    "context": 64000, "media_in": ["text"],
                },
            ],
        }

    def test_groups_variants_by_canonical_model(self):
        registry = m.build_model_registry(self._catalog())
        self.assertEqual(registry["schema_version"], 2)
        self.assertEqual(sorted(registry["models"]), ["muse-spark-1-3", "tiny-model"])
        entry = registry["models"]["muse-spark-1-3"]
        self.assertEqual(entry["id"], "muse-spark-1-3")
        self.assertEqual(entry["name"], "Muse Spark")
        # One entry per model: every provider variant is listed once, free
        # first, then cheapest, engine provider before external.
        self.assertEqual(
            [v["provider"] for v in entry["variants"]],
            ["opencode", "opencode-go", "anthropic"],
        )
        self.assertTrue(entry["variants"][0]["free"])
        self.assertFalse(entry["variants"][1]["free"])
        self.assertEqual(entry["variants"][1]["cost"], 0.125)
        self.assertEqual(entry["variants"][1]["input_cost"], 0.1)

    def test_zero_cost_variant_is_free(self):
        catalog = {"models": [{
            "provider": "opencode", "id": "zero", "canonical": "zero",
            "class": "zen-paid", "blended_cost": 0,
        }]}
        registry = m.build_model_registry(catalog)
        self.assertTrue(registry["models"]["zero"]["variants"][0]["free"])

    def test_no_catalog_yields_empty_registry(self):
        self.assertEqual(m.build_model_registry(None)["models"], {})
        self.assertEqual(m.build_model_registry({"models": []})["models"], {})


class ProviderModelV2ArtifactsTest(unittest.TestCase):
    """The committed artifacts coexist during the transition (task 1.2)."""

    @classmethod
    def setUpClass(cls):
        cls.config = json.loads((ROOT / "data" / "model-config.json").read_text(encoding="utf-8"))
        cls.config_v2 = json.loads((ROOT / "data" / "model-config-v2.json").read_text(encoding="utf-8"))
        cls.registry = json.loads((ROOT / "data" / "model-registry-v2.json").read_text(encoding="utf-8"))

    def test_v1_and_v2_task_entries_coexist(self):
        self.assertEqual(self.config_v2.get("schema_version"), 2)
        self.assertTrue(self.config.get("task-types"))
        v2 = self.config_v2.get("task-types-v2") or {}
        self.assertTrue(v2)
        self.assertEqual(set(self.config["task-types"]), set(v2))

    def test_every_v2_task_model_resolves_in_the_registry(self):
        registry_models = self.registry.get("models") or {}
        for name, entry in (self.config_v2.get("task-types-v2") or {}).items():
            self.assertIn(entry["model"], registry_models, name)

    def test_registry_entries_carry_variants_with_costs(self):
        self.assertEqual(self.registry.get("schema_version"), 2)
        for model_id, entry in (self.registry.get("models") or {}).items():
            self.assertEqual(entry["id"], model_id)
            self.assertTrue(entry["variants"], model_id)
            for variant in entry["variants"]:
                self.assertTrue(variant["provider"])
                self.assertTrue(variant["model"])
                self.assertIsInstance(variant["free"], bool)
                self.assertTrue(variant["cost"] is None or variant["cost"] >= 0)


if __name__ == "__main__":
    unittest.main()
