'use strict';

/**
 * Tests for usage-aware resolution (proposals 1–7): the snapshot veto in
 * `resolveModel`, the resetsAt-aware quota cache, the snapshot upsert, the
 * status fields and the announce suffix.
 *
 * Conventions follow plugin.test.js: `seedCache` for the config,
 * `usageUrl: 'http://127.0.0.1:1/'` for an unreachable probe, `clearQuotaCache`
 * between cases (also resets the hysteresis gate).
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seedCache, isolateAuth } = require('./helpers');
const {
  normalizeOptions,
  resolveModel,
  formatAnnounce,
  usageNote,
  checkGoQuota,
  clearQuotaCache,
} = require('../src/shared/select');
const { writeStatus, statusFile } = require('../src/shared/status');
const { markFreeQuota } = require('../src/shared/freequota');

let dir;
let restoreAuth;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-resolve-usage-'));
  restoreAuth = isolateAuth(dir); // no real token leaks into tokenless cases
  clearQuotaCache();
});
afterEach(() => {
  restoreAuth();
  fs.rmSync(dir, { recursive: true, force: true });
});

const cacheDir = () => path.join(dir, '.opencode', '.modelselect-cache');
const seedConfig = () => seedCache(dir, { 'task-types': { code: { go: 'g/a', free: 'f/b' } } });
const seedUsage = (snap) => {
  fs.mkdirSync(cacheDir(), { recursive: true });
  fs.writeFileSync(
    path.join(cacheDir(), 'usage-limits.json'),
    JSON.stringify(snap),
  );
};
const freshSnap = (monthly, extra) => ({
  fetchedAt: Date.now(),
  source: 'limits',
  go: { monthly, rolling: null, weekly: null },
  budgets: [],
  ...extra,
});
const goOpts = (over = {}) =>
  normalizeOptions({ tier: 'auto', autoPreference: 'go-first', token: 'tok', usageUrl: 'http://127.0.0.1:1/', ...over });

describe('usage veto in resolveModel', () => {
  it('vetoes go on a limited snapshot under go-first', async () => {
    seedConfig();
    seedUsage(freshSnap({ percent: 42, limited: true, resetsAt: null }));
    const r = await resolveModel({ taskType: 'code', opts: goOpts(), cacheDir: cacheDir() });
    assert.equal(r.tier, 'free');
    assert.equal(r.model, 'f/b');
    assert.equal(r.usage.veto, true);
    assert.equal(r.usage.percent, 42);
  });

  it('vetoes go on a spent window even when the live probe is unreachable', async () => {
    seedConfig();
    seedUsage(freshSnap({ percent: 100, limited: false, resetsAt: null }));
    const r = await resolveModel({ taskType: 'code', opts: goOpts(), cacheDir: cacheDir() });
    assert.equal(r.tier, 'free');
    assert.equal(r.usage.veto, true);
  });

  it('keeps go on a healthy snapshot', async () => {
    seedConfig();
    seedUsage(freshSnap({ percent: 42, limited: false, resetsAt: null }));
    const r = await resolveModel({ taskType: 'code', opts: goOpts(), cacheDir: cacheDir() });
    assert.equal(r.tier, 'go');
    assert.equal(r.model, 'g/a');
    assert.equal(r.usage.veto, false);
    assert.equal(r.usage.percent, 42);
  });

  it('leaves free-first on free but still records usage', async () => {
    seedConfig();
    seedUsage(freshSnap({ percent: 100, limited: true, resetsAt: null }));
    const opts = normalizeOptions({ tier: 'auto', autoPreference: 'free-first', token: 'tok', usageUrl: 'http://127.0.0.1:1/' });
    const r = await resolveModel({ taskType: 'code', opts, cacheDir: cacheDir() });
    assert.equal(r.tier, 'free');
    assert.equal(r.usage.veto, true);
  });

  it('never overrides a pinned go tier', async () => {
    seedConfig();
    seedUsage(freshSnap({ percent: 100, limited: true, resetsAt: null }));
    const opts = normalizeOptions({ tier: 'go', token: 'tok', usageUrl: 'http://127.0.0.1:1/' });
    const r = await resolveModel({ taskType: 'code', opts, cacheDir: cacheDir() });
    assert.equal(r.tier, 'go');
    assert.equal(r.model, 'g/a');
    assert.equal(r.usage.veto, true); // recorded, not applied
  });

  it('keeps go when both sides are spent (latch supreme, proposal 7)', async () => {
    seedConfig();
    seedUsage(freshSnap({ percent: 100, limited: true, resetsAt: null }));
    markFreeQuota(cacheDir(), { model: 'f/b', detail: 'spent' });
    const r = await resolveModel({ taskType: 'code', opts: goOpts(), cacheDir: cacheDir() });
    assert.equal(r.tier, 'go');
    assert.equal(r.usage.veto, true);
    assert.equal(r.freeExhausted, true);
  });

  it('vetoes on a spent budget with healthy windows', async () => {
    seedConfig();
    seedUsage(freshSnap({ percent: 10, limited: false, resetsAt: null }, {
      budgets: [{ id: 'b1', percent: 100, limited: true, resetsAt: null }],
    }));
    const r = await resolveModel({ taskType: 'code', opts: goOpts(), cacheDir: cacheDir() });
    assert.equal(r.tier, 'free');
    assert.equal(r.usage.budgetLimited, true);
  });

  it('ignores a stale snapshot (fail-open)', async () => {
    seedConfig();
    seedUsage({ ...freshSnap({ percent: 100, limited: true, resetsAt: null }), fetchedAt: Date.now() - 11 * 60 * 1000 });
    const r = await resolveModel({ taskType: 'code', opts: goOpts(), cacheDir: cacheDir() });
    // Probe is unreachable (null) and the snapshot is stale: go-first keeps go.
    assert.equal(r.tier, 'go');
    assert.equal(r.usage, null);
  });

  it('soft-vetoes at >=95 with hysteresis', async () => {
    seedConfig();
    seedUsage(freshSnap({ percent: 96, limited: false, resetsAt: null }));
    const first = await resolveModel({ taskType: 'code', opts: goOpts(), cacheDir: cacheDir() });
    assert.equal(first.tier, 'free');
    // Still 92: the sticky veto holds without re-probing.
    seedUsage(freshSnap({ percent: 92, limited: false, resetsAt: null }));
    const second = await resolveModel({ taskType: 'code', opts: goOpts(), cacheDir: cacheDir() });
    assert.equal(second.tier, 'free');
    // Back below 90: re-admitted to go.
    seedUsage(freshSnap({ percent: 50, limited: false, resetsAt: null }));
    const third = await resolveModel({ taskType: 'code', opts: goOpts(), cacheDir: cacheDir() });
    assert.equal(third.tier, 'go');
  });
});

describe('quota cache with snapshot + resetsAt', () => {
  it('answers from a fresh snapshot without fetching', async () => {
    seedConfig();
    seedUsage(freshSnap({ percent: 20, limited: false, resetsAt: null }));
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      calls += 1;
      return { status: 500, ok: false };
    };
    try {
      assert.equal(await checkGoQuota('tok', 'http://127.0.0.1:1/', cacheDir()), true);
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('holds a negative answer until its reset (clamped)', async () => {
    const at = Date.now();
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      calls += 1;
      return {
        status: 200,
        ok: true,
        json: async () => ({
          usage: { monthly: { percent: 100, status: 'ok', resetsAt: new Date(at + 3600e3).toISOString() } },
        }),
      };
    };
    try {
      assert.equal(await checkGoQuota('tok', 'http://127.0.0.1:1/', undefined, { now: at }), false);
      assert.equal(calls, 1);
      // 29 minutes later: still held (30-min clamp), no refetch.
      assert.equal(await checkGoQuota('tok', 'http://127.0.0.1:1/', undefined, { now: at + 29 * 60e3 }), false);
      assert.equal(calls, 1);
      // Past the clamp: refetches.
      assert.equal(await checkGoQuota('tok', 'http://127.0.0.1:1/', undefined, { now: at + 31 * 60e3 }), false);
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('re-probes after a near reset passes', async () => {
    const at = Date.now();
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      calls += 1;
      return {
        status: 200,
        ok: true,
        json: async () => ({
          usage: { monthly: { percent: 100, status: 'ok', resetsAt: new Date(at + 60e3).toISOString() } },
        }),
      };
    };
    try {
      assert.equal(await checkGoQuota('tok', 'http://127.0.0.1:1/', undefined, { now: at }), false);
      assert.equal(await checkGoQuota('tok', 'http://127.0.0.1:1/', undefined, { now: at + 30e3 }), false);
      assert.equal(calls, 1);
      assert.equal(await checkGoQuota('tok', 'http://127.0.0.1:1/', undefined, { now: at + 61e3 }), false);
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('upserts the display snapshot from a live Zen answer, preserving budgets', async () => {
    seedConfig();
    // Stale file: old enough to skip the snapshot path, fresh enough to count as previous.
    seedUsage({
      fetchedAt: Date.now() - 120e3,
      source: 'limits',
      go: { monthly: null, rolling: null, weekly: null },
      budgets: [{ id: 'old', percent: 10, limited: false, resetsAt: null }],
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({ usage: { monthly: { percent: 33, status: 'ok' } } }),
    });
    try {
      assert.equal(await checkGoQuota('tok', 'http://127.0.0.1:1/', cacheDir()), true);
      const raw = JSON.parse(fs.readFileSync(path.join(cacheDir(), 'usage-limits.json'), 'utf8'));
      assert.equal(raw.source, 'zen');
      assert.equal(raw.go.monthly.percent, 33);
      assert.deepEqual(raw.budgets, [{ id: 'old', percent: 10, limited: false, resetsAt: null }]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('usage observability', () => {
  it('appends the usage suffix to the announce line', () => {
    const base = { taskType: 'review', tier: 'free', model: 'f/b', suggestOnly: false };
    assert.equal(
      formatAnnounce({ ...base, usage: { percent: 92, limited: false, resetsAt: null } }),
      '[modelselect: task=review tier=free → f/b (go 92%)]',
    );
    assert.equal(formatAnnounce(base), '[modelselect: task=review tier=free → f/b]');
    assert.equal(usageNote(null), '');
    assert.equal(usageNote({ percent: 100, limited: true, resetsAt: null }), 'go 100% limited');
  });

  it('round-trips the new status fields', () => {
    const payload = writeStatus(cacheDir(), 's1', {
      model: 'f/b',
      goPercent: 92,
      goLimited: true,
      budgetLimited: false,
    });
    assert.equal(payload.goPercent, 92);
    assert.equal(payload.goLimited, true);
    assert.equal(payload.budgetLimited, false);
    const back = JSON.parse(fs.readFileSync(statusFile(cacheDir(), 's1'), 'utf8'));
    assert.equal(back.goPercent, 92);
    // Old readers tolerate absence: fields default to null.
    const bare = writeStatus(cacheDir(), 's2', { model: 'f/b' });
    assert.equal(bare.goPercent, null);
    assert.equal(bare.goLimited, null);
    assert.equal(bare.budgetLimited, null);
  });
});
