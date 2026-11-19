'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { classifyModelMissing, classifyFreeFailure } = require('../src/shared/core/free-quota');
const { buildV2Chain } = require('../src/shared/core/registry');
const { availabilityFromLive } = require('../src/shared/live-catalog');
const {
  inventoryKeySet,
  freshInventoryKeys,
  recordModelMiss,
  readCatalogMisses,
  modelMissFresh,
} = require('../src/shared/runtime-catalog');

const REGISTRY = {
  schema_version: 2,
  models: {
    'qwen3-8-flash': {
      id: 'qwen3-8-flash',
      score: 86,
      variants: [
        { provider: 'opencode', model: 'qwen3.8-flash', free: false, cost: 0.23 },
        { provider: 'opencode-go', model: 'qwen3.8-flash', free: false, cost: 0.23 },
      ],
    },
  },
};

test('catalog miss is distinct from upstream exhaustion', () => {
  assert.equal(classifyModelMissing({ _tag: 'ModelNotFoundError', providerID: 'opencode', modelID: 'qwen3.8-flash' }), true);
  assert.equal(classifyModelMissing(new Error('Model unavailable: opencode/qwen3.8-flash')), true);
  assert.equal(classifyModelMissing(new Error('Model does not exist: opencode/qwen3.8-flash')), true);
  assert.equal(classifyModelMissing(new Error('Model is unavailable.')), false);
  assert.equal(classifyModelMissing(new Error('rate limit exceeded')), false);
  // The upstream wording still latches a rotated free model.
  assert.equal(classifyFreeFailure(0, 'Upstream request failed: Model is unavailable.').exhausted, true);
});

test('v2 chain skips a variant the runtime does not serve', () => {
  const task = { model: 'qwen3-8-flash', score: 86 };
  const availability = { providers: { opencode: true, 'opencode-go': true }, latched: [], models: new Set(['opencode-go/qwen3.8-flash']) };
  const chain = buildV2Chain({ taskEntry: task, registry: REGISTRY, availability, preference: 'free-first' });
  assert.equal(chain.length, 1);
  assert.equal(chain[0].ref, 'opencode-go/qwen3.8-flash');

  // No inventory -> unchanged behavior: both variants survive, cheapest and
  // alphabetically first wins.
  const open = buildV2Chain({ taskEntry: task, registry: REGISTRY, availability: { providers: {}, latched: [] }, preference: 'free-first' });
  assert.equal(open[0].ref, 'opencode/qwen3.8-flash');
});

test('live availability exposes only enabled model keys', () => {
  const avail = availabilityFromLive({
    inventory: {
      providers: { opencode: true },
      models: [
        { providerID: 'opencode', id: 'hy4-flash-free', enabled: true },
        { providerID: 'opencode', id: 'qwen3.8-flash', enabled: false },
      ],
    },
    usage: null,
    latchData: null,
  });
  assert.deepEqual([...avail.models], ['opencode/hy4-flash-free']);
  assert.equal(availabilityFromLive({ inventory: null, usage: null, latchData: null }).models, undefined);
});

test('inventory snapshot and miss ledger are fail-soft and time-bounded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-runtime-'));
  try {
    const cache = path.join(dir, '.opencode', '.modelselect-cache');
    fs.mkdirSync(cache, { recursive: true });
    const now = Date.now();
    fs.writeFileSync(path.join(cache, 'runtime-inventory.json'), JSON.stringify({
      fetchedAt: now,
      models: [{ providerID: 'opencode-go', id: 'qwen3.8-flash', enabled: true }],
    }));
    assert.deepEqual([...freshInventoryKeys(cache, now)], ['opencode-go/qwen3.8-flash']);
    assert.equal(freshInventoryKeys(cache, now + 61_000), null);
    assert.deepEqual([...inventoryKeySet({ models: [{ providerID: 'opencode', id: 'x', enabled: false }] })], []);

    const miss = recordModelMiss(cache, 'opencode/qwen3.8-flash', { now, source: 'retry' });
    assert.equal(miss.count, 1);
    assert.equal(modelMissFresh(cache, 'opencode/qwen3.8-flash', now + 1000), true);
    assert.equal(modelMissFresh(cache, 'opencode-go/qwen3.8-flash', now + 1000), false);
    assert.equal(readCatalogMisses(cache, now + 16 * 60_000).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
