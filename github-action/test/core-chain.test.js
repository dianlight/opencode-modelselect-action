'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const CORE = path.join(__dirname, '..', '..', 'core');
const { canonicalModel, indexCatalog, classOf } = require(path.join(CORE, 'catalog.js'));
const { buildChain, nextCandidate, partitionTiers } = require(path.join(CORE, 'chain.js'));

const CATALOG = {
  models: [
    {
      provider: 'opencode',
      id: 'deepseek-v4.1-flash-free',
      canonical: 'deepseek-v4.1-flash',
      input_cost: 0,
      output_cost: 0,
      blended_cost: 0,
      context: 1000000,
      media_in: ['text', 'image'],
    },
    {
      provider: 'opencode-go',
      id: 'deepseek-v4.1-flash',
      canonical: 'deepseek-v4.1-flash',
      input_cost: 0.15,
      output_cost: 0.6,
      blended_cost: 0.26,
      context: 1000000,
      media_in: ['text', 'image'],
    },
    {
      provider: 'google',
      id: 'gemini-4-argon',
      canonical: 'gemini-4-argon',
      input_cost: 2,
      output_cost: 10,
      blended_cost: 4,
      context: 1048576,
      media_in: ['text', 'image', 'pdf'],
    },
    {
      provider: 'opencode-go',
      id: 'gemini-4-argon',
      canonical: 'gemini-4-argon',
      input_cost: 2,
      output_cost: 10,
      blended_cost: 4,
      context: 1048576,
      media_in: ['text', 'image'],
    },
    {
      provider: 'opencode',
      id: 'tiny-context-free',
      canonical: 'tiny-context',
      input_cost: 0,
      output_cost: 0,
      blended_cost: 0,
      context: 8192,
      media_in: ['text'],
    },
  ],
};

const ENTRY = {
  ranked: [
    { model: 'gemini-4-argon', score: 95 },
    { model: 'deepseek-v4.1-flash', score: 90 },
    { model: 'tiny-context', score: 80 },
  ],
  go: 'opencode-go/gemini-4-argon',
  free: 'opencode/deepseek-v4.1-flash-free',
};

describe('canonicalModel', () => {
  it('collapses tier, effort, snapshot and dotted variants', () => {
    assert.equal(canonicalModel('opencode/muse-spark-1.3-contributor-free'), 'muse-spark-1-3');
    assert.equal(canonicalModel('claude-opus-4.6'), 'claude-opus-4-6');
    assert.equal(canonicalModel('gpt-5.6-luna-xhigh'), 'gpt-5-6-luna');
    assert.equal(canonicalModel('anthropic/claude-opus-4-6-20251101'), 'claude-opus-4-6');
  });
});

describe('indexCatalog/classOf', () => {
  it('indexes by canonical and derives the cost class', () => {
    const index = indexCatalog(CATALOG);
    assert.equal(index.get('gemini-4-argon').length, 2);
    assert.equal(classOf({ provider: 'opencode', blended_cost: 0 }), 'free');
    assert.equal(classOf({ provider: 'opencode', blended_cost: 1.5 }), 'zen-paid');
    assert.equal(classOf({ provider: 'opencode-go', blended_cost: 3 }), 'go-plan');
    assert.equal(classOf({ provider: 'google', blended_cost: 3 }), 'external');
    assert.equal(classOf({ provider: 'opencode-go', blended_cost: 0 }), 'free');
  });
});

describe('buildChain', () => {
  it('walks free then paid, cheapest provider first', () => {
    const chain = buildChain({ entry: ENTRY, catalog: CATALOG });
    assert.equal(chain[0].ref, 'opencode/deepseek-v4.1-flash-free');
    assert.equal(chain[1].ref, 'opencode/tiny-context-free');
    assert.deepEqual(
      chain.slice(2, 4).map((r) => r.ref),
      ['google/gemini-4-argon', 'opencode-go/gemini-4-argon'],
    );
    assert.equal(chain[0].class, 'free');
    assert.equal(chain[4].class, 'go-plan');
  });

  it('honours go-first and abs modes', () => {
    const goFirst = buildChain({ entry: ENTRY, catalog: CATALOG, preference: 'go-first' });
    assert.notEqual(goFirst[0].class, 'free');
    const abs = buildChain({ entry: ENTRY, catalog: CATALOG, mode: 'abs' });
    assert.equal(abs[0].ref, 'google/gemini-4-argon');
    assert.equal(abs[0].score, 95);
  });

  it('filters providers, latches, budgets, context, media and cost', () => {
    const noGoogle = buildChain({ entry: ENTRY, catalog: CATALOG, providers: ['opencode', 'opencode-go'] });
    assert.ok(noGoogle.every((r) => r.provider !== 'google'));

    const latched = buildChain({
      entry: ENTRY,
      catalog: CATALOG,
      availability: { latched: ['opencode/deepseek-v4.1-flash-free'] },
    });
    assert.ok(latched.every((r) => r.ref !== 'opencode/deepseek-v4.1-flash-free'));

    const noBudget = buildChain({
      entry: ENTRY,
      catalog: CATALOG,
      availability: { providers: { google: { budget_remaining: 0 } } },
    });
    assert.ok(noBudget.every((r) => r.provider !== 'google'));

    const offline = buildChain({
      entry: ENTRY,
      catalog: CATALOG,
      availability: { providers: { 'opencode-go': false } },
    });
    assert.ok(offline.every((r) => r.provider !== 'opencode-go'));

    const pdf = buildChain({ entry: ENTRY, catalog: CATALOG, media: ['pdf'] });
    assert.deepEqual(pdf.map((r) => r.ref), ['google/gemini-4-argon']);

    const big = buildChain({ entry: ENTRY, catalog: CATALOG, contextNeed: 100000 });
    assert.ok(big.every((r) => r.ref !== 'opencode/tiny-context-free'));

    const cheap = buildChain({ entry: ENTRY, catalog: CATALOG, maxCost: 1 });
    assert.ok(cheap.every((r) => r.cost === null || r.cost <= 1));
  });

  it('keeps the legacy ranked shape working', () => {
    const legacy = {
      go: 'opencode-go/gemini-4-argon',
      free: 'opencode/deepseek-v4.1-flash-free',
      go_ranked: [{ model: 'opencode-go/gemini-4-argon', score: 95 }],
      free_ranked: [{ model: 'opencode/deepseek-v4.1-flash-free', score: 90 }],
    };
    const chain = buildChain({ entry: legacy, catalog: CATALOG });
    assert.deepEqual(chain.map((r) => r.ref), [
      'opencode/deepseek-v4.1-flash-free',
      'google/gemini-4-argon',
      'opencode-go/gemini-4-argon',
      'opencode-go/deepseek-v4.1-flash',
    ]);
  });

  it('partitions tiers and advances after a failure', () => {
    const chain = buildChain({ entry: ENTRY, catalog: CATALOG });
    const { free, paid } = partitionTiers(chain);
    assert.equal(free.length, 2);
    assert.ok(paid.length >= 2);
    assert.equal(nextCandidate(chain, [chain[0].ref]).ref, chain[1].ref);
    assert.equal(nextCandidate(chain, chain.map((r) => r.ref)), null);
  });
});
