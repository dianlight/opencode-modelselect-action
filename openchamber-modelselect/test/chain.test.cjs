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
          { model: 'opencode-go/gpt-5.6-luna', score: 93, input_cost: 0.2, output_cost: 1.2, blended_cost: 0.5, context: 1050000, modalities: ['text', 'image', 'pdf'] },
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
