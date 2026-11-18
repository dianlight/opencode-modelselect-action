'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const CORE = path.join(__dirname, '..', '..', 'core');
const {
  taskEntryV2,
  modelEntry,
  variantRows,
  buildV2Chain,
  V2_SCHEMA_VERSION,
} = require(path.join(CORE, 'registry.js'));

const CONFIG = {
  'task-types': {
    generic: { go: 'opencode-go/model-b', free: 'opencode/model-a-free' },
  },
  'task-types-v2': {
    generic: { model: 'model-b', score: 90, think: 'medium' },
    'unknown-task': { model: 'model-missing' },
  },
};

const REGISTRY = {
  schema_version: 2,
  models: {
    'model-b': {
      id: 'model-b',
      name: 'Model B',
      score: 90,
      variants: [
        { provider: 'google', model: 'model-b', free: false, cost: 4, input_cost: 2, output_cost: 10, media_in: ['text', 'image', 'pdf'] },
        { provider: 'opencode-go', model: 'model-b', free: false, cost: 4, input_cost: 1, output_cost: 4, media_in: ['text'] },
        { provider: 'opencode', model: 'model-b', free: false, cost: 8, input_cost: 4, output_cost: 20, media_in: ['text'] },
      ],
    },
    'model-c': {
      id: 'model-c',
      variants: [
        { provider: 'opencode-go', model: 'model-c', free: false, cost: 2 },
        { provider: 'opencode', model: 'model-c-free', free: true, cost: 0 },
        { provider: 'anthropic', model: 'model-c', free: true, cost: 0 },
      ],
    },
  },
};

describe('provider-model v2 registry', () => {
  it('resolves a task by model id, case-insensitively', () => {
    assert.equal(V2_SCHEMA_VERSION, 2);
    const found = taskEntryV2(CONFIG, 'GENERIC');
    assert.equal(found.key, 'generic');
    assert.equal(found.model, 'model-b');
    assert.equal(taskEntryV2(CONFIG, 'unknown-task').model, 'model-missing');
    assert.equal(taskEntryV2(CONFIG, 'not-configured'), null);
    assert.equal(taskEntryV2({}, 'generic'), null);
  });

  it('matches a registry entry by id, provider ref or canonical id', () => {
    assert.equal(modelEntry(REGISTRY, 'model-b').name, 'Model B');
    assert.equal(modelEntry(REGISTRY, 'opencode/model-b').id, 'model-b');
    assert.equal(modelEntry(REGISTRY, 'opencode/model-c-free').id, 'model-c');
    assert.equal(modelEntry(REGISTRY, 'nope'), null);
  });

  it('normalises variants with cost and free state', () => {
    const rows = variantRows(modelEntry(REGISTRY, 'model-c'));
    assert.deepEqual(
      rows.map((r) => [r.ref, r.class, r.cost]),
      [
        ['opencode-go/model-c', 'go-plan', 2],
        ['opencode/model-c-free', 'free', 0],
        ['anthropic/model-c', 'free', 0],
      ],
    );
    const withScore = variantRows(modelEntry(REGISTRY, 'model-b'));
    assert.ok(withScore.every((r) => r.score === 90));
  });

  it('orders variants by preference, cost and engine provider', () => {
    const taskEntry = taskEntryV2(CONFIG, 'generic').entry;
    const freeFirst = buildV2Chain({ taskEntry, registry: REGISTRY, preference: 'free-first' });
    // Equal cost and score: the engine provider (opencode-go) wins over google.
    assert.deepEqual(freeFirst.map((r) => r.ref), [
      'opencode-go/model-b',
      'google/model-b',
      'opencode/model-b',
    ]);
    const goFirst = buildV2Chain({ taskEntry, registry: REGISTRY, preference: 'go-first' });
    assert.deepEqual(goFirst.map((r) => r.ref), freeFirst.map((r) => r.ref));

    const freeModel = taskEntryV2(CONFIG, 'unknown-task');
    assert.equal(freeModel.model, 'model-missing');
    const freeChain = buildV2Chain({
      taskEntry: { model: 'model-c' },
      registry: REGISTRY,
      preference: 'free-first',
    });
    assert.equal(freeChain[0].class, 'free');
    assert.equal(freeChain[0].ref, 'opencode/model-c-free');
    const paidFirst = buildV2Chain({
      taskEntry: { model: 'model-c' },
      registry: REGISTRY,
      preference: 'go-first',
    });
    assert.equal(paidFirst[0].ref, 'opencode-go/model-c');
  });

  it('applies availability, provider, media, context and cost filters', () => {
    const taskEntry = taskEntryV2(CONFIG, 'generic').entry;
    const engineOnly = buildV2Chain({
      taskEntry,
      registry: REGISTRY,
      providers: ['opencode', 'opencode-go'],
    });
    assert.ok(engineOnly.every((r) => r.provider !== 'google'));

    const offline = buildV2Chain({
      taskEntry,
      registry: REGISTRY,
      availability: { providers: { 'opencode-go': false } },
    });
    assert.ok(offline.every((r) => r.provider !== 'opencode-go'));

    const latched = buildV2Chain({
      taskEntry,
      registry: REGISTRY,
      availability: { latched: ['opencode-go/model-b'] },
    });
    assert.ok(latched.every((r) => r.ref !== 'opencode-go/model-b'));

    const cheap = buildV2Chain({ taskEntry, registry: REGISTRY, maxCost: 4 });
    assert.ok(cheap.every((r) => r.cost === null || r.cost <= 4));

    const pdf = buildV2Chain({
      taskEntry: { model: 'model-b' },
      registry: REGISTRY,
      media: ['pdf'],
    });
    assert.deepEqual(pdf.map((r) => r.ref), ['google/model-b']);
  });

  it('returns an empty chain when v2 cannot answer (v1 fallback)', () => {
    assert.deepEqual(buildV2Chain({ taskEntry: { model: 'model-missing' }, registry: REGISTRY }), []);
    assert.deepEqual(buildV2Chain({ taskEntry: { model: 'model-b' }, registry: null }), []);
    assert.deepEqual(buildV2Chain({ taskEntry: null, registry: REGISTRY }), []);
  });
});
