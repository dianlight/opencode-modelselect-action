'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ACTION = path.join(__dirname, '..', 'src', 'index.js');

const CONFIG = {
  'task-types': {
    'pr-review': {
      go: 'opencode-go/paid-b',
      free: 'opencode/free-a',
      ranked: [{ model: 'opencode-go/paid-b', score: 95, blended_cost: 1 }],
      go_ranked: [{ model: 'opencode-go/paid-b', score: 95, blended_cost: 1 }],
      free_ranked: [{ model: 'opencode/free-a', score: 90, blended_cost: 0 }],
    },
  },
};

const CATALOG = {
  providers: { opencode: {}, 'opencode-go': {} },
  models: [
    { provider: 'opencode', id: 'free-a', canonical: 'free-a', blended_cost: 0, context: 200000 },
    { provider: 'opencode-go', id: 'paid-b', canonical: 'paid-b', blended_cost: 1, context: 1000000 },
  ],
};

function run(inputs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'select-exclusions-'));
  const configPath = path.join(dir, 'model-config.json');
  const configV2Path = path.join(dir, 'model-config-v2.json');
  const catalogPath = path.join(dir, 'provider-catalog.json');
  const registryPath = path.join(dir, 'model-registry-v2.json');
  const outPath = path.join(dir, 'github-output.txt');
  fs.writeFileSync(configPath, JSON.stringify(CONFIG));
  fs.writeFileSync(configV2Path, '{}');
  fs.writeFileSync(catalogPath, JSON.stringify(CATALOG));
  const env = {
    ...process.env,
    GITHUB_OUTPUT: outPath,
    'INPUT_TASK-TYPE': 'pr-review',
    'INPUT_CONFIG-PATH': configPath,
    'INPUT_CONFIG-URL': '',
    'INPUT_CONFIG-V2-PATH': configV2Path,
    'INPUT_CONFIG-V2-URL': '',
    'INPUT_CATALOG-PATH': catalogPath,
    'INPUT_CATALOG-URL': '',
    'INPUT_REGISTRY-PATH': registryPath,
    'INPUT_REGISTRY-URL': '',
    ...inputs,
  };
  let stdout = '';
  let stderr = '';
  let exit = 0;
  try {
    stdout = String(execFileSync('node', [ACTION], { env, stdio: ['ignore', 'pipe', 'pipe'] }) ?? '');
  } catch (err) {
    exit = err.status ?? 1;
    stdout = String(err.stdout ?? '');
    stderr = String(err.stderr ?? '');
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { exit, stdout, stderr, warnings: stdout.split('\n').filter((l) => l.startsWith('::warning::')) };
}

describe('select-model fallback exclusions', () => {
  it('warns with the rejected chain candidates when no provider can serve them', () => {
    const { exit, warnings, stderr } = run({
      'INPUT_TIER': 'go',
      'INPUT_AVAILABLE-PROVIDERS': 'opencode',
    });
    assert.equal(exit, 0, stderr);
    assert.ok(
      warnings.some((w) => w.includes('no usable model — checked 1: opencode-go/paid-b (provider not allowed)')),
      warnings.join('\n'),
    );
  });

  it('warns with the checked candidates when max-cost forces the fallback-model', () => {
    const { exit, warnings, stderr } = run({
      'INPUT_TIER': 'go',
      'INPUT_MAX-COST': '0.1',
      'INPUT_FALLBACK-MODEL': 'opencode-go/paid-b',
    });
    assert.equal(exit, 0, stderr);
    assert.ok(
      warnings.some((w) => w.includes('no usable model — checked 1: opencode-go/paid-b (over maxCost $0.1); using opencode-go/paid-b')),
      warnings.join('\n'),
    );
  });
});
