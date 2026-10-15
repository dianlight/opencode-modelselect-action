import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import benchmark_models as b  # noqa: E402


class ValidateTest(unittest.TestCase):
    def test_integer(self):
        self.assertTrue(b.validate({"kind": "integer", "expected": 10}, "10"))
        self.assertFalse(b.validate({"kind": "integer", "expected": 10}, "9"))

    def test_float_tolerance(self):
        self.assertTrue(b.validate({"kind": "float", "expected": 0.05}, "0.05"))
        self.assertFalse(b.validate({"kind": "float", "expected": 0.05}, "0.1"))

    def test_json(self):
        self.assertTrue(
            b.validate({"kind": "json", "expected": '{"answer":"four","count":4}'}, '{"answer":"four","count":4}')
        )
        self.assertFalse(
            b.validate({"kind": "json", "expected": '{"answer":"four","count":4}'}, '{"count":4}')
        )

    def test_contains(self):
        self.assertTrue(b.validate({"kind": "contains", "expected": "red"}, "Red!"))
        self.assertFalse(b.validate({"kind": "contains", "expected": "red"}, "blue"))


class LoadTasksTest(unittest.TestCase):
    def test_loads_bank(self):
        tasks = b.load_tasks()
        self.assertGreaterEqual(len(tasks), 4)
        ids = {t["id"] for t in tasks}
        self.assertIn("coding-puzzle", ids)


class RunBatteryMockedTest(unittest.TestCase):
    def test_pass_fail(self):
        class FakeResp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return b'{"choices":[{"message":{"content":"10"}}]}'

        with patch.object(b, "urlopen", return_value=FakeResp()):
            results = b.run_battery(
                "m", [{"id": "t", "kind": "integer", "expected": 10, "prompt": "q"}], "key"
            )
        self.assertTrue(results["t"]["passed"])


class CacheRoundTripTest(unittest.TestCase):
    def test_save_and_load(self, tmp_path=None):
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            cache_path = Path(d) / "bench.json"
            cache = {"models": {"x": {"scores": {"overall": 10.0}, "source": "benchmark"}}}
            b._save_cache(cache, cache_path)
            loaded = b._load_cache(cache_path)
            self.assertEqual(loaded["models"]["x"]["scores"]["overall"], 10.0)


class BenchmarkSourceTest(unittest.TestCase):
    def setUp(self):
        import opencode_maintenance as m

        m._BENCHMARK_CACHE = None

    def tearDown(self):
        import opencode_maintenance as m

        m._BENCHMARK_CACHE = None

    def test_benchmark_source(self):
        import opencode_maintenance as m
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as d:
            m.BENCHMARK_PATH = Path(d) / "benchmark_scores.json"
            cache = {
                "models": {
                    "ghost-free": {"scores": {"overall": 42.0, "coding": 42.0}, "source": "benchmark"}
                }
            }
            m.BENCHMARK_PATH.write_text(json.dumps(cache))
            m._BENCHMARK_CACHE = None
            score = m.get_model_score("ghost-free", {"models": {}}, "overall")
            self.assertEqual(score, 42.0)
            self.assertEqual(m.get_model_source("ghost-free", {"models": {}}), "benchmark")


if __name__ == "__main__":
    unittest.main()
