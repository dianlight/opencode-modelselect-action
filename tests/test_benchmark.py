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


class BackupGuardTest(unittest.TestCase):
    """A battery that never reached the endpoint must not record a score."""

    TASKS = [
        {"id": "t1", "kind": "integer", "expected": 1, "prompt": "q", "subscore": "overall"},
        {"id": "t2", "kind": "contains", "expected": "red", "prompt": "q", "subscore": "vision"},
    ]
    MISSING = [{"model": "mystery-free", "tier": "Free"}]

    def _results(self, error=None, passed=False):
        return {
            "t1": {"passed": passed, "response": None if error else "1", "error": error},
            "t2": {"passed": passed, "response": None if error else "red", "error": error},
        }

    def _run(self, cache, ref_results, model_results, missing=None):
        import tempfile

        import opencode_maintenance as m

        with tempfile.TemporaryDirectory() as d:
            cache_path = Path(d) / "bench.json"
            cache_path.write_text(json.dumps(cache))
            seen: list[str] = []

            def fake_battery(model_id, tasks, api_key=None, **_kw):
                seen.append(model_id)
                return ref_results if model_id == "big-pickle" else model_results

            with patch.object(b, "load_tasks", return_value=self.TASKS), \
                 patch.object(b, "run_battery", side_effect=fake_battery), \
                 patch.object(b.time, "sleep", lambda *_: None), \
                 patch.object(
                     m, "detect_coverage_issues",
                     return_value={"missing_scores": missing if missing is not None else self.MISSING},
                 ):
                out = b.run_backup(
                    [{"id": "mystery-free"}], [], {"models": {}},
                    api_key="k", cache_path=cache_path,
                )
            return out, seen

    def test_all_errors_records_no_score(self):
        out, _ = self._run(
            {"models": {}},
            {"model": "big-pickle", "results": self._results(passed=True)},
            self._results(error="HTTP Error 403: Forbidden"),
        )
        self.assertNotIn("mystery-free", out["models"])

    def test_answered_run_records_score(self):
        out, _ = self._run(
            {"models": {}},
            {"model": "big-pickle", "results": self._results(passed=True)},
            self._results(passed=True),
        )
        self.assertEqual(out["models"]["mystery-free"]["source"], "benchmark")

    def test_unusable_reference_wipes_stale_scores(self):
        broken = self._results(error="HTTP Error 403: Forbidden")
        cache = {
            "_reference": {"model": "big-pickle", "results": broken},
            "models": {"mystery-free": {"scores": {"overall": 1.2}, "source": "benchmark"}},
        }
        out, _ = self._run(cache, broken, broken)
        self.assertEqual(out["models"], {})
        self.assertNotIn("_reference", out)

    def test_duplicate_missing_ids_benchmarked_once(self):
        _, seen = self._run(
            {"models": {}},
            {"model": "big-pickle", "results": self._results(passed=True)},
            self._results(passed=True),
            missing=[{"model": "mystery-free", "tier": "Free"}, {"model": "mystery-free", "tier": "Free"}],
        )
        self.assertEqual(seen.count("mystery-free"), 1)


if __name__ == "__main__":
    unittest.main()
