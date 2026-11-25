'use strict';

/**
 * Unit tests for the models-chain adapter (`service/src/chain.js`).
 *
 * The chain used to be computed in the panel; it now runs in the service and
 * is served as `GET /chain`, so this is the pure test of the resolution
 * preview (pick, failover, budget cap, per-row usage bars). No filesystem, no
 * process: the service test covers the wiring around it.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let computeModelsView;

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

before(async () => {
  const chain = await import(pathToFileURL(path.join(__dirname, '..', 'service', 'src', 'chain.js')).href);
  computeModelsView = chain.computeModelsView;
});

function catalogConfig(extra) {
  return Object.assign({
    'task-types': {
      generic: {
        go: 'opencode-go/gpt-5.6-luna',
        free: 'opencode/deepseek-free',
        go_ranked: [
          { model: 'opencode-go/gemini-4-argon', score: 95.1, input_cost: 4, output_cost: 20, blended_cost: 8, context: 1048576, modalities: ['text', 'image'] },
          {
            model: 'opencode-go/gpt-5.6-luna', score: 93, input_cost: 0.2, output_cost: 1.2,
            blended_cost: 0.5, context: 1050000, modalities: ['text', 'image', 'pdf'],
            output: 256000, monthly_usage: { go: 60, 'go-plus': 240, 'go-teams': 65 },
          },
        ],
        free_ranked: [
          { model: 'opencode/deepseek-free', score: 90, input_cost: 0, output_cost: 0, blended_cost: 0, context: 128000, modalities: ['text'] },
        ],
      },
    },
  }, extra || {});
}

function latch(model, until) {
  return { version: 2, models: { [model]: { at: NOW - 60000, until: until, kind: 'exhaustion', detail: 'spent' } } };
}

describe('models chain', () => {
  it('picks the preferred side and marks exactly one row', () => {
    const view = computeModelsView({
      taskType: 'generic',
      catalogConfig: catalogConfig(),
      options: { autoPreference: 'free-first' },
      latchData: null,
      now: NOW,
    });
    assert.equal(view.found, true);
    assert.equal(view.side, 'free');
    assert.equal(view.pick, 'opencode/deepseek-free');
    assert.equal(view.pickSource, 'chain');
    assert.match(view.sideNote, /auto → free-first/);
    assert.equal(view.chain.filter((r) => r.status === 'pick').length, 1);
    assert.equal(view.chain[0].status, 'pick');
    assert.equal(view.chain[0].bar.label, 'PICK · free');
    const goRow = view.chain.find((r) => r.model === 'opencode-go/gpt-5.6-luna');
    assert.equal(goRow.output, 256000);
    assert.deepEqual(goRow.monthlyUsage, { go: 60, 'go-plus': 240, 'go-teams': 65 });
  });

  it('fails over to the other side when the free model is latched', () => {
    const view = computeModelsView({
      taskType: 'generic',
      catalogConfig: catalogConfig(),
      options: { autoPreference: 'free-first' },
      latchData: latch('opencode/deepseek-free', NOW + 3 * 3600 * 1000 + 5 * 60000),
      now: NOW,
    });
    assert.equal(view.side, 'go');
    assert.match(view.sideNote, /latched → failover/);
    assert.equal(view.pick, 'opencode-go/gpt-5.6-luna');
    const latched = view.chain.find((r) => r.model === 'opencode/deepseek-free');
    assert.equal(latched.status, 'excluded');
    assert.match(latched.reason, /quota latched · retry in 3h 5m/);
    assert.equal(latched.bar.tone, 'err');
  });

  it('honours a pinned tier and the maxCost cap', () => {
    const view = computeModelsView({
      taskType: 'generic',
      catalogConfig: catalogConfig(),
      options: { tier: 'go', maxCost: 2 },
      latchData: null,
      now: NOW,
    });
    assert.equal(view.side, 'go');
    assert.match(view.sideNote, /tier=go/);
    assert.equal(view.maxCost, 2);
    const gemini = view.chain.find((r) => r.model === 'opencode-go/gemini-4-argon');
    assert.equal(gemini.status, 'excluded');
    assert.match(gemini.reason, /over maxCost \$2/);
    assert.equal(gemini.bar.pct, 100);
    assert.equal(gemini.bar.tone, 'err');
  });

  it('reports the Go monthly window on the pick row as a bar', () => {
    const view = computeModelsView({
      taskType: 'generic',
      catalogConfig: catalogConfig(),
      options: { tier: 'go' },
      latchData: null,
      usage: { go: { monthly: { percent: 42.4, limited: false, resetsAt: NOW + 3600 * 1000 } } },
      now: NOW,
    });
    const pick = view.chain.find((r) => r.status === 'pick');
    assert.equal(pick.bar.pct, 42);
    assert.equal(pick.bar.tone, 'ok');
    assert.equal(pick.bar.label, 'PICK · Go monthly 42%');
  });

  it('marks a limited Go window red with its reset', () => {
    const view = computeModelsView({
      taskType: 'generic',
      catalogConfig: catalogConfig(),
      options: { tier: 'go' },
      latchData: null,
      usage: { go: { monthly: { percent: 100, limited: true, resetsAt: NOW + 90 * 60000 } } },
      now: NOW,
    });
    const pick = view.chain.find((r) => r.status === 'pick');
    assert.equal(pick.bar.tone, 'err');
    assert.match(pick.bar.label, /limited · resets 1h 30m/);
  });

  it('says the task is unknown instead of throwing', () => {
    const view = computeModelsView({
      taskType: 'nope',
      catalogConfig: catalogConfig(),
      options: {},
      latchData: null,
      now: NOW,
    });
    assert.equal(view.found, false);
  });
});

describe('models chain — provider-model v2', () => {
  const REGISTRY = {
    schema_version: 2,
    models: {
      'gpt-5.6-luna': {
        id: 'gpt-5.6-luna',
        score: 93,
        variants: [
          { provider: 'google', model: 'gpt-5.6-luna', free: false, cost: 0.5, media_in: ['text'] },
          {
            provider: 'opencode-go', model: 'gpt-5.6-luna', free: false, cost: 0.5,
            media_in: ['text'], output: 256000,
            monthly_usage: { go: 60, 'go-plus': 240, 'go-teams': 65 },
          },
          { provider: 'opencode', model: 'gpt-5.6-luna-free', free: true, cost: 0, media_in: ['text'] },
        ],
      },
    },
  };
  const V2_CONFIG = catalogConfig({ 'task-types-v2': { generic: { model: 'gpt-5.6-luna', score: 93 } } });

  it('previews the v2 chain and prefers the free variant', () => {
    const view = computeModelsView({
      taskType: 'generic',
      catalogConfig: catalogConfig(),
      configV2: V2_CONFIG,
      options: { autoPreference: 'free-first' },
      latchData: null,
      registry: REGISTRY,
      now: NOW,
    });
    assert.equal(view.found, true);
    assert.equal(view.registry, true);
    assert.equal(view.side, 'free');
    assert.equal(view.pick, 'opencode/gpt-5.6-luna-free');
    assert.equal(view.pickSource, 'chain');
    assert.equal(view.chain.filter((r) => r.status === 'pick').length, 1);
    assert.match(view.sideNote, /v2 · model=gpt-5\.6-luna/);
  });

  it('applies go-first and the engine tie-break', () => {
    const view = computeModelsView({
      taskType: 'generic',
      catalogConfig: catalogConfig(),
      configV2: V2_CONFIG,
      options: { autoPreference: 'go-first' },
      latchData: null,
      registry: REGISTRY,
      now: NOW,
    });
    assert.equal(view.side, 'go');
    assert.equal(view.pick, 'opencode-go/gpt-5.6-luna');
    const row = view.chain.find((r) => r.model === 'opencode-go/gpt-5.6-luna');
    assert.equal(row.output, 256000);
    assert.deepEqual(row.monthlyUsage, { go: 60, 'go-plus': 240, 'go-teams': 65 });
  });

  it('falls back to the v1 preview without a registry', () => {
    const view = computeModelsView({
      taskType: 'generic',
      catalogConfig: catalogConfig(),
      configV2: V2_CONFIG,
      options: { autoPreference: 'free-first' },
      latchData: null,
      now: NOW,
    });
    assert.equal(view.registry, undefined);
    assert.equal(view.pick, 'opencode/deepseek-free');
  });

  it('shows unused chain variants as failover standbys, not off-side exclusions', () => {
    const view = computeModelsView({
      taskType: 'generic',
      catalogConfig: catalogConfig(),
      configV2: V2_CONFIG,
      options: { autoPreference: 'free-first' },
      latchData: null,
      registry: REGISTRY,
      now: NOW,
    });
    const paid = view.chain.find((r) => r.model === 'opencode-go/gpt-5.6-luna');
    assert.equal(paid.status, 'standby');
    assert.match(paid.reason, /failover/);
    assert.equal(paid.bar.tone, 'muted');
    assert.equal(view.chain.some((r) => /off-side/.test(r.reason)), false);
  });

  it('marks Go variants over quota and keeps the free pick', () => {
    const view = computeModelsView({
      taskType: 'generic',
      catalogConfig: catalogConfig(),
      configV2: V2_CONFIG,
      options: { autoPreference: 'free-first' },
      latchData: null,
      registry: REGISTRY,
      usage: { go: { monthly: { percent: 100, limited: true, resetsAt: NOW + 3600 * 1000 } } },
      now: NOW,
    });
    assert.equal(view.pick, 'opencode/gpt-5.6-luna-free');
    const paid = view.chain.find((r) => r.model === 'opencode-go/gpt-5.6-luna');
    assert.equal(paid.status, 'excluded');
    assert.match(paid.reason, /go quota spent · resets 1h 0m/);
    assert.equal(paid.bar.tone, 'err');
  });

  it('reports the fallback when both sides are blocked', () => {
    const view = computeModelsView({
      taskType: 'generic',
      catalogConfig: catalogConfig(),
      configV2: V2_CONFIG,
      options: { autoPreference: 'free-first', fallbackModel: 'modelselect/free-router' },
      latchData: latch('opencode/gpt-5.6-luna-free', NOW + 3 * 3600 * 1000),
      registry: REGISTRY,
      usage: { go: { monthly: { percent: 100, limited: true } } },
      now: NOW,
    });
    assert.equal(view.pick, 'modelselect/free-router');
    assert.equal(view.pickSource, 'fallback');
    assert.match(view.pickNote, /All variants blocked.*Go quota spent.*free tier latched/);
    assert.equal(view.chain.some((r) => r.status === 'pick'), false);
  });

  it('applies the runtime inventory to the preview', () => {
    const view = computeModelsView({
      taskType: 'generic',
      catalogConfig: catalogConfig(),
      configV2: V2_CONFIG,
      options: { autoPreference: 'free-first' },
      latchData: null,
      registry: REGISTRY,
      runtimeInventory: {
        fetchedAt: NOW,
        models: [
          { providerID: 'opencode-go', id: 'gpt-5.6-luna', enabled: true },
          { providerID: 'opencode', id: 'gpt-5.6-luna-free', enabled: false },
        ],
      },
      now: NOW,
    });
    assert.equal(view.pick, 'opencode-go/gpt-5.6-luna');
    const free = view.chain.find((r) => r.model === 'opencode/gpt-5.6-luna-free');
    assert.equal(free.status, 'excluded');
    assert.match(free.reason, /not in runtime inventory/);
  });
});
