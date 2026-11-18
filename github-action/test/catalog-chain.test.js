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

function run(inputs, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'select-catalog-'));
  const configPath = path.join(dir, 'model-config.json');
  const configV2Path = path.join(dir, 'model-config-v2.json');
  const catalogPath = path.join(dir, 'provider-catalog.json');
  const registryPath = path.join(dir, 'model-registry-v2.json');
  fs.writeFileSync(configPath, JSON.stringify(extra.config ?? CONFIG));
  fs.writeFileSync(configV2Path, JSON.stringify(extra.configV2 ?? {}));
  fs.writeFileSync(catalogPath, JSON.stringify(CATALOG));
  if (extra.registry) fs.writeFileSync(registryPath, JSON.stringify(extra.registry));
  const outPath = path.join(dir, 'github-output.txt');
  const env = {
    ...process.env,
    GITHUB_OUTPUT: outPath,
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

describe('select-model provider-model v2', () => {
  const V2_CONFIG = {
    schema_version: 2,
    'task-types-v2': {
      'pr-review': { model: 'model-a', score: 90, think: 'high' },
    },
  };
  const REGISTRY = {
    schema_version: 2,
    models: {
      'model-a': {
        id: 'model-a',
        score: 90,
        variants: [
          { provider: 'google', model: 'model-a', free: true, cost: 0 },
          { provider: 'opencode', model: 'model-a-free', free: true, cost: 0 },
          { provider: 'opencode-go', model: 'model-a', free: false, cost: 0.5 },
        ],
      },
    },
  };

  it('prefers the v2 task -> model id -> engine variant', () => {
    const { exit, stderr, outputs } = run(
      {
        'INPUT_TASK-TYPE': 'pr-review',
        'INPUT_TIER': 'free',
        'INPUT_AUTO-PREFERENCE': 'free-first',
        'INPUT_AVAILABLE-PROVIDERS': 'opencode,opencode-go,google',
      },
      { configV2: V2_CONFIG, registry: REGISTRY },
    );
    assert.equal(exit, 0, stderr);
    // Both free variants tie on cost+score: the engine provider wins.
    assert.equal(outputs.model, 'opencode/model-a-free');
    assert.equal(outputs['tier-selected'], 'free');
    const chain = JSON.parse(outputs['model-chain']);
    assert.equal(chain[0], 'opencode/model-a-free');
    assert.equal(chain[1], 'google/model-a');
  });

  it('applies go-first preference at selection time', () => {
    const { exit, stderr, outputs } = run(
      {
        'INPUT_TASK-TYPE': 'pr-review',
        'INPUT_TIER': 'go',
        'INPUT_AUTO-PREFERENCE': 'go-first',
      },
      { configV2: V2_CONFIG, registry: REGISTRY },
    );
    assert.equal(exit, 0, stderr);
    assert.equal(outputs.model, 'opencode-go/model-a');
    const chain = JSON.parse(outputs['model-chain']);
    assert.equal(chain[chain.length - 1], 'opencode/model-a-free');
  });

  it('falls back to the v1 chain when v2 has no usable variant', () => {
    const { exit, stderr, outputs } = run(
      {
        'INPUT_TASK-TYPE': 'pr-review',
        'INPUT_TIER': 'free',
        'INPUT_AVAILABLE-PROVIDERS': 'opencode',
      },
      {
        configV2: V2_CONFIG,
        registry: {
          schema_version: 2,
          models: { 'model-a': { id: 'model-a', variants: [{ provider: 'google', model: 'model-a', cost: 0 }] } },
        },
      },
    );
    assert.equal(exit, 0, stderr);
    assert.equal(outputs.model, 'opencode/model-a-free');
    assert.ok(!outputs.model.startsWith('google/'));
  });
});
