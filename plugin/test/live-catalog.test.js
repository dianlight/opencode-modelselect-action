'use strict';

/**
 * Live provider catalog + availability + chain failover (F4).
 *
 * Covers the plugin-side half of the shared selection chain:
 * - `shared/live-catalog.js` normalization / availability assembly;
 * - `shared/select.js resolveModel` expanding the task's ranked list into
 *   concrete provider/model candidates via the shared chain core.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('os');
const path = require('node:path');

const {
  normalizeInventory,
  availabilityFromLive,
  fetchLiveInventory,
  liveAvailability,
} = require('../src/shared/live-catalog');
const { resolveModel, normalizeOptions, clearQuotaCache } = require('../src/shared/select');
const { seedCache } = require('./helpers');

const CATALOG = {
  models: [
    { provider: 'opencode', id: 'muse-spark-1.3-contributor-free', blended_cost: 0, context: 200000 },
    { provider: 'opencode-go', id: 'gpt-5.6-luna', blended_cost: 0.45, context: 1050000 },
  ],
};

function seedTaskEntry(dir) {
  seedCache(
    dir,
    {
      'task-types': {
        review: {
          go: 'opencode-go/gpt-5.6-luna',
          free: 'opencode/muse-spark-1.3-contributor-free',
          think: 'default',
          ranked: [
            { model: 'opencode/muse-spark-1.3-contributor-free', score: 95, blended_cost: 0, context: 200000 },
            { model: 'opencode-go/gpt-5.6-luna', score: 93, blended_cost: 0.45, context: 1050000 },
          ],
        },
      },
    },
    );
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-live-'));
}

describe('live catalog normalization', () => {
  it('normalizes a bare models array into per-provider enabled flags', () => {
    const inv = normalizeInventory({
      models: [
        { providerID: 'opencode', id: 'muse-spark-1.3-contributor-free', enabled: true },
        { providerID: 'opencode', id: 'deepseek-v4.1-flash-free', enabled: false },
      ],
    });
    assert.ok(inv);
    // One enabled model keeps the provider available; a fully disabled
    // provider reads as unavailable.
    assert.equal(inv.providers.opencode, true);
    const off = normalizeInventory({
      models: [
        { providerID: 'opencode', id: 'deepseek-v4.1-flash-free', enabled: false },
      ],
    });
    assert.equal(off.providers.opencode, false);
    assert.equal(off.models.length, 1);
  });

  it('normalizes a providers array envelope with group-scoped ids', () => {
    const inv = normalizeInventory({
      providers: [{ id: 'opencode-go', models: [{ id: 'gpt-5.6-luna', enabled: true }] }],
    });
    assert.ok(inv);
    assert.equal(inv.providers['opencode-go'], true);
    assert.equal(inv.models.length, 1);
    assert.equal(inv.models[0].providerID, 'opencode-go');
  });

  it('returns null for unusable payloads', () => {
    assert.equal(normalizeInventory(null), null);
    assert.equal(normalizeInventory({ nope: 1 }), null);
  });
});

describe('live availability assembly', () => {
  it('flags providers disabled by the live inventory', () => {
    const avail = availabilityFromLive({
      inventory: { providers: { opencode: false }, models: [{ providerID: 'opencode', id: 'x', enabled: false }] },
      usage: null,
      latchData: null,
    });
    assert.equal(avail.providers.opencode, false);
    assert.deepEqual(avail.latched, []);
  });

  it('marks the go plan spent as a zero-budget (chain skips go rows)', () => {
    const avail = availabilityFromLive({
      inventory: { providers: { opencode: true }, models: [{ providerID: 'opencode', id: 'x', enabled: true }] },
      usage: { go: { rolling: { percent: 100, limited: true }, weekly: { percent: null, limited: false }, monthly: { percent: null, limited: false } } },
      latchData: null,
    });
    assert.equal(avail.providers['opencode-go'] !== undefined, false); // no go provider flagged
    assert.equal(avail.providers.opencode, true);
  });

  it('collects freshly latched free refs', () => {
    const latchData = {
      version: 2,
      models: {
        'opencode/muse-spark-1.3-contributor-free': { at: Date.now() - 1000, until: Date.now() + 10000, kind: 'exhaustion' },
      },
    };
    const avail = availabilityFromLive({ inventory: null, usage: null, latchData });
    assert.deepEqual(avail.latched, ['opencode/muse-spark-1.3-contributor-free']);
  });
});

describe('live inventory fetch', () => {
  it('returns the first inventory the fake server answers', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ models: [{ providerID: 'opencode', id: 'muse-spark-1.3-contributor-free', enabled: true }] }),
    });
    try {
      const inv = await fetchLiveInventory({ env: { OPENCODE_PORT: '4599' }, fetchFn: globalThis.fetch });
      assert.ok(inv);
      assert.equal(inv.providers.opencode, true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('returns null when no local port answers', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('no server');
    };
    try {
      const inv = await fetchLiveInventory({ env: { OPENCODE_PORT: '4598' }, fetchFn: globalThis.fetch });
      assert.equal(inv, null);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('resolveModel provider chain (F4)', () => {
  it('picks the free chain candidate for a free task', async () => {
    const dir = tmpDir();
    seedTaskEntry(dir);
    const cacheDir = path.join(dir, '.opencode', '.modelselect-cache');
    try {
      clearQuotaCache();
      const picked = await resolveModel({
        taskType: 'review',
        opts: normalizeOptions({ tier: 'free' }),
        cacheDir,
        catalog: CATALOG,
        availability: { providers: {}, latched: [] },
      });
      assert.equal(picked.model, 'opencode/muse-spark-1.3-contributor-free');
      assert.equal(picked.tier, 'free');
      assert.deepEqual(picked.chain, ['opencode/muse-spark-1.3-contributor-free']);
    } finally {
      clearQuotaCache();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls through a disabled free provider to the next chain candidate', async () => {
    const dir = tmpDir();
    seedTaskEntry(dir);
    const cacheDir = path.join(dir, '.opencode', '.modelselect-cache');
    try {
      clearQuotaCache();
      const picked = await resolveModel({
        taskType: 'review',
        opts: normalizeOptions({ tier: 'free' }),
        cacheDir,
        catalog: CATALOG,
        availability: { providers: { opencode: false }, latched: [] },
      });
      assert.equal(picked.model, 'opencode-go/gpt-5.6-luna');
      assert.equal(picked.tier, 'go');
    } finally {
      clearQuotaCache();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails over via tried refs: skip the free pick, take the next candidate', async () => {
    const dir = tmpDir();
    seedTaskEntry(dir);
    const cacheDir = path.join(dir, '.opencode', '.modelselect-cache');
    try {
      clearQuotaCache();
      const picked = await resolveModel({
        taskType: 'review',
        opts: normalizeOptions({ tier: 'free' }),
        cacheDir,
        catalog: CATALOG,
        availability: { providers: {}, latched: [] },
        tried: ['opencode/muse-spark-1.3-contributor-free'],
      });
      assert.equal(picked.model, 'opencode-go/gpt-5.6-luna');
      assert.deepEqual(picked.chain, ['opencode-go/gpt-5.6-luna']);
    } finally {
      clearQuotaCache();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns the legacy pick when no catalog is available', async () => {
    const dir = tmpDir();
    seedTaskEntry(dir);
    const cacheDir = path.join(dir, '.opencode', '.modelselect-cache');
    try {
      clearQuotaCache();
      const picked = await resolveModel({
        taskType: 'review',
        opts: normalizeOptions({ tier: 'free' }),
        cacheDir,
        availability: { providers: {}, latched: [] },
      });
      assert.equal(picked.model, 'opencode/muse-spark-1.3-contributor-free');
      assert.deepEqual(picked.chain, []); // no catalog → no chain (empty)
    } finally {
      clearQuotaCache();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
