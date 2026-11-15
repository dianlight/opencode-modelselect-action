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
      go: 'opencode-go/model-b',
      free: 'opencode/model-a-free',
      ranked: [
        { model: 'model-b', score: 95, free: false },
        { model: 'model-a', score: 90, free: true },
      ],
      go_ranked: [{ model: 'opencode-go/model-b', score: 95 }],
      free_ranked: [{ model: 'opencode/model-a-free', score: 90 }],
    },
  },
};

const CATALOG = {
  providers: { opencode: {}, 'opencode-go': {}, google: {} },
  models: [
    { provider: 'opencode', id: 'model-a-free', canonical: 'model-a', input_cost: 0, output_cost: 0, blended_cost: 0, context: 200000, media_in: ['text'] },
    { provider: 'google', id: 'model-a', canonical: 'model-a', input_cost: 0, output_cost: 0, blended_cost: 0, context: 1000000, media_in: ['text', 'image'] },
    { provider: 'opencode-go', id: 'model-b', canonical: 'model-b', input_cost: 0.15, output_cost: 0.6, blended_cost: 0.26, context: 1000000, media_in: ['text'] },
    { provider: 'opencode', id: 'model-b', canonical: 'model-b', input_cost: 1, output_cost: 4, blended_cost: 1.75, context: 1000000, media_in: ['text'] },
  ],
};

function run(inputs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'select-catalog-'));
  const configPath = path.join(dir, 'model-config.json');
  const catalogPath = path.join(dir, 'provider-catalog.json');
  fs.writeFileSync(configPath, JSON.stringify(CONFIG));
  fs.writeFileSync(catalogPath, JSON.stringify(CATALOG));
  const outPath = path.join(dir, 'github-output.txt');
  const env = {
    ...process.env,
    GITHUB_OUTPUT: outPath,
    'INPUT_CONFIG-PATH': configPath,
    'INPUT_CONFIG-URL': '',
    'INPUT_CATALOG-PATH': catalogPath,
    'INPUT_CATALOG-URL': '',
    ...inputs,
  };
  let exit = 0;
  let stderr = '';
  try {
    execFileSync('node', [ACTION], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    exit = err.status ?? 1;
    stderr = String(err.stderr ?? '');
  }
  const outputs = {};
  if (fs.existsSync(outPath)) {
    for (const line of fs.readFileSync(outPath, 'utf8').split('\n')) {
      const i = line.indexOf('=');
      if (i > 0) outputs[line.slice(0, i)] = line.slice(i + 1);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { exit, stderr, outputs };
}

describe('select-model provider chain', () => {
  it('expands the ranked list into provider candidates and keeps the free tier', () => {
    const { exit, stderr, outputs } = run({ 'INPUT_TASK-TYPE': 'pr-review', 'INPUT_TIER': 'free' });
    assert.equal(exit, 0, stderr);
    // Free tier from the catalog; with the default allowlist only the
    // reachable engine provider is in the chain.
    assert.equal(outputs.model, 'opencode/model-a-free');
    assert.equal(outputs['model-cost'], '0');
    const chain = JSON.parse(outputs['model-chain']);
    assert.deepEqual(chain, ['opencode/model-a-free']);
  });

  it('never leaves the reachable providers', () => {
    const { exit, stderr, outputs } = run({
      'INPUT_TASK-TYPE': 'pr-review',
      'INPUT_TIER': 'free',
      'INPUT_AVAILABLE-PROVIDERS': 'opencode,opencode-go',
    });
    assert.equal(exit, 0, stderr);
    assert.equal(outputs.model, 'opencode/model-a-free');
    const chain = JSON.parse(outputs['model-chain']);
    assert.ok(chain.every((ref) => ref.startsWith('opencode/')));
  });

  it('moves to the cheapest provider for the paid tier', () => {
    const { exit, stderr, outputs } = run({ 'INPUT_TASK-TYPE': 'pr-review', 'INPUT_TIER': 'go' });
    assert.equal(exit, 0, stderr);
    assert.equal(outputs.model, 'opencode-go/model-b');
    assert.equal(outputs['model-cost'], '0.26');
  });

  it('crosses providers within the same cost class (free variants)', () => {
    const { exit, stderr, outputs } = run({
      'INPUT_TASK-TYPE': 'pr-review',
      'INPUT_TIER': 'free',
      'INPUT_AVAILABLE-PROVIDERS': 'google,opencode',
    });
    assert.equal(exit, 0, stderr);
    assert.equal(outputs.model, 'google/model-a');
    const chain = JSON.parse(outputs['model-chain']);
    assert.deepEqual(chain, ['google/model-a', 'opencode/model-a-free']);
  });

  it('degrades to the legacy tiers when the catalog is missing', () => {
    const { exit, stderr, outputs } = run({
      'INPUT_TASK-TYPE': 'pr-review',
      'INPUT_TIER': 'free',
      'INPUT_CATALOG-PATH': '/nonexistent/provider-catalog.json',
      'INPUT_CATALOG-URL': '',
    });
    assert.equal(exit, 0, stderr);
    assert.equal(outputs.model, 'opencode/model-a-free');
    assert.equal(outputs['model-chain'], '');
  });
});
