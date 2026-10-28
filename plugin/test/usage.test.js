'use strict';

/**
 * Tests for the usage snapshot (`plugin/src/shared/usage.js`): the Node-side
 * source of the Models-pane usage-status bar.
 *
 * The panel holds no token and makes no network calls, so the plugin
 * persists `usage-limits.json` (local `GET /api/experimental/usage/limits`
 * first, Zen fallback via the probe token) and the panel reads it.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  USAGE_LIMITS_BASENAME,
  SNAPSHOT_MAX_AGE_MS,
  usageLimitsFile,
  readUsageLimits,
  writeUsageLimits,
  normalizeLimitsPayload,
  normalizeZenPayload,
  usagePorts,
  fetchLimitsSnapshot,
  refreshUsageLimits,
  clearUsageVeto,
  snapshotUsable,
  worstWindow,
  anyBudgetLimited,
  goSoftVeto,
  goVetoFromSnapshot,
} = require('../src/shared/usage');

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-usage-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const cacheDir = () => path.join(dir, '.opencode', '.modelselect-cache');

describe('usage snapshot file', () => {
  it('round-trips and reads missing files as null', () => {
    assert.equal(readUsageLimits(cacheDir()), null);
    const snap = { fetchedAt: 123, source: 'limits', go: {}, budgets: [] };
    assert.equal(writeUsageLimits(cacheDir(), snap), true);
    assert.deepEqual(readUsageLimits(cacheDir()), snap);
    assert.equal(
      usageLimitsFile(cacheDir()),
      path.join(cacheDir(), USAGE_LIMITS_BASENAME),
    );
  });

  it('rejects unusable payloads without throwing', () => {
    assert.equal(writeUsageLimits(cacheDir(), null), false);
    assert.equal(writeUsageLimits('', { fetchedAt: 1 }), false);
    assert.equal(readUsageLimits(''), null);
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(usageLimitsFile(cacheDir()), '{ not json', 'utf8');
    assert.equal(readUsageLimits(cacheDir()), null);
  });
});

describe('normalizeLimitsPayload', () => {
  it('keeps the Go meters and summarizes budgets', () => {
    const snap = normalizeLimitsPayload(
      {
        workspace: { id: 'w', name: 'W', usageURL: 'https://x' },
        go: {
          monthly: { percent: 42, limited: false, resetsAt: 999 },
          weekly: { percent: 10, limited: false, resetsAt: 888 },
        },
        budgets: [{ id: 'b1', limit: 100, spent: 25, resetsAt: 777 }],
      },
      1000,
    );
    assert.equal(snap.source, 'limits');
    assert.equal(snap.fetchedAt, 1000);
    assert.equal(snap.go.monthly.percent, 42);
    assert.equal(snap.go.weekly.resetsAt, 888);
    assert.deepEqual(snap.budgets, [{ id: 'b1', percent: 25, limited: false, resetsAt: 777 }]);
  });

  it('returns null when nothing usable is carried', () => {
    assert.equal(normalizeLimitsPayload(null), null);
    assert.equal(normalizeLimitsPayload({ workspace: {} }), null);
    assert.equal(normalizeLimitsPayload({ go: {} }), null);
  });
});

describe('normalizeZenPayload', () => {
  it('parses the Zen windows via the shared core parser', () => {
    const snap = normalizeZenPayload(
      { usage: { monthly: { percent: 80, status: 'ok', resetsAt: new Date(Date.now() + 3600e3).toISOString() } } },
      1000,
    );
    assert.equal(snap.source, 'zen');
    assert.equal(snap.go.monthly.percent, 80);
    assert.equal(snap.go.monthly.limited, false);
  });

  it('marks limited windows', () => {
    const snap = normalizeZenPayload({ usage: { monthly: { percent: 100, status: 'ok' } } }, 1000);
    assert.equal(snap.go.monthly.limited, true);
  });
});

describe('usagePorts', () => {
  it('prefers env ports with the default last', () => {
    assert.deepEqual(usagePorts({ OPENCODE_PORT: '5001', PORT: 'x' }), [5001, 4096]);
    assert.deepEqual(usagePorts({}), [4096]);
  });
});

describe('refreshUsageLimits', () => {
  it('uses the local limits endpoint first', async () => {
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(url);
      return { ok: true, json: async () => ({ go: { monthly: { percent: 30, limited: false } } }) };
    };
    const snap = await refreshUsageLimits(cacheDir(), { fetchFn, now: 5000 });
    assert.equal(snap.source, 'limits');
    assert.equal(snap.go.monthly.percent, 30);
    assert.ok(calls[0].includes('/api/experimental/usage/limits'));
    assert.deepEqual(readUsageLimits(cacheDir()), snap);
  });

  it('falls back to Zen when the local endpoint is unreachable', async () => {
    const fetchFn = async (url, opts = {}) => {
      if (String(url).includes('/api/experimental/usage/limits')) return { ok: false };
      assert.ok(String(opts.headers?.Authorization || '').startsWith('Bearer '));
      return { ok: true, json: async () => ({ usage: { monthly: { percent: 55, status: 'ok' } } }) };
    };
    const snap = await refreshUsageLimits(cacheDir(), {
      token: 'tok',
      usageUrl: 'https://opencode.ai/zen/go/v1/usage',
      fetchFn,
      now: 6000,
    });
    assert.equal(snap.source, 'zen');
    assert.equal(snap.go.monthly.percent, 55);
  });

  it('is throttled: a fresh file means no fetch', async () => {
    writeUsageLimits(cacheDir(), { fetchedAt: 9000, source: 'limits', go: {}, budgets: [] });
    let fetched = 0;
    const snap = await refreshUsageLimits(cacheDir(), {
      fetchFn: async () => {
        fetched += 1;
        return null;
      },
      now: 9050,
    });
    assert.equal(fetched, 0);
    assert.equal(snap.source, 'limits');
  });

  it('returns the stale file when every fetch fails', async () => {
    writeUsageLimits(cacheDir(), { fetchedAt: 1000, source: 'zen', go: {}, budgets: [] });
    const snap = await refreshUsageLimits(cacheDir(), {
      fetchFn: async () => null,
      now: 1000 + 61 * 1000,
    });
    assert.equal(snap.source, 'zen');
  });

  it('returns null with no file and no fetch', async () => {
    const snap = await refreshUsageLimits(cacheDir(), { fetchFn: async () => null, now: 1000 });
    assert.equal(snap, null);
  });
});

describe('fetchLimitsSnapshot', () => {
  it('tries env ports before the default', async () => {
    const seen = [];
    const fetchFn = async (url) => {
      seen.push(url);
      return { ok: false };
    };
    await fetchLimitsSnapshot({ env: { OPENCODE_PORT: '5001' }, fetchFn, now: 1 });
    assert.deepEqual(seen, [
      'http://127.0.0.1:5001/api/experimental/usage/limits',
      'http://127.0.0.1:4096/api/experimental/usage/limits',
    ]);
  });
});

describe('usage veto signals', () => {
  const freshGo = (monthly, extra) => ({
    fetchedAt: 100000,
    source: 'limits',
    go: { monthly, rolling: null, weekly: null },
    budgets: [],
    ...extra,
  });

  it('snapshotUsable enforces the age cap and shapes', () => {
    assert.equal(snapshotUsable({ fetchedAt: 100000 }, 100001), true);
    assert.equal(snapshotUsable({ fetchedAt: 100000 }, 100000 + SNAPSHOT_MAX_AGE_MS), false);
    assert.equal(snapshotUsable(null, 1), false);
    assert.equal(snapshotUsable({ fetchedAt: 'x' }, 1), false);
    assert.equal(snapshotUsable({ fetchedAt: 1 }), false); // Date.now() default: epoch+1ms is stale
    assert.equal(snapshotUsable({ fetchedAt: Date.now() }), true);
  });

  it('worstWindow picks the highest percent', () => {
    assert.equal(worstWindow(null), null);
    assert.deepEqual(
      worstWindow({ monthly: { percent: 40 }, weekly: { percent: 70, limited: false } }),
      { percent: 70, limited: false, resetsAt: undefined },
    );
  });

  it('anyBudgetLimited flags explicit and spent budgets only', () => {
    assert.equal(anyBudgetLimited(null), false);
    assert.equal(anyBudgetLimited({ budgets: [] }), false);
    assert.equal(anyBudgetLimited({ budgets: [{ id: 'a', percent: 50 }] }), false);
    assert.equal(anyBudgetLimited({ budgets: [{ id: 'a', percent: 100 }] }), true);
    assert.equal(anyBudgetLimited({ budgets: [{ id: 'a', limited: true }] }), true);
  });

  it('hard-vetoes limited or spent windows, fail-open otherwise', () => {
    clearUsageVeto();
    const limited = goVetoFromSnapshot(
      freshGo({ percent: 42, limited: true, resetsAt: null }), { token: 't', now: 100001 },
    );
    assert.equal(limited.veto, true);
    assert.equal(limited.percent, 42);
    const spent = goVetoFromSnapshot(
      freshGo({ percent: 100, limited: false, resetsAt: null }), { token: 't', now: 100001 },
    );
    assert.equal(spent.veto, true);
    const healthy = goVetoFromSnapshot(
      freshGo({ percent: 42, limited: false, resetsAt: null }), { token: 't2', now: 100001 },
    );
    assert.equal(healthy.veto, false);
    assert.equal(healthy.percent, 42);
    assert.equal(healthy.budgetLimited, false);
    assert.equal(goVetoFromSnapshot(null, { token: 't' }), null);
    assert.equal(goVetoFromSnapshot({ fetchedAt: 1, go: {} }, { token: 't', now: Date.now() }), null);
  });

  it('vetoes on spent budgets even with healthy windows', () => {
    clearUsageVeto();
    const v = goVetoFromSnapshot(
      freshGo({ percent: 10, limited: false, resetsAt: null }, {
        budgets: [{ id: 'b1', percent: 100, limited: true, resetsAt: null }],
      }),
      { token: 't', now: 100001 },
    );
    assert.equal(v.veto, true);
    assert.equal(v.budgetLimited, true);
  });

  it('hysteresis: soft-vetoes at >=95, holds to 90, clears below', () => {
    clearUsageVeto();
    assert.equal(goSoftVeto('tok-h', 94), false);
    assert.equal(goSoftVeto('tok-h', 95), true);
    assert.equal(goSoftVeto('tok-h', 92), true); // sticky
    assert.equal(goSoftVeto('tok-h', 90), true); // boundary holds
    assert.equal(goSoftVeto('tok-h', 89), false); // re-admitted
    assert.equal(goSoftVeto('', 100), false); // tokenless never vetoes
    assert.equal(goSoftVeto('tok-h', NaN), false);
  });

  it('applies the hysteresis inside the snapshot verdict', () => {
    clearUsageVeto();
    const at = (p) => goVetoFromSnapshot(
      freshGo({ percent: p, limited: false, resetsAt: null }), { token: 'tok-v', now: 100001 },
    );
    assert.equal(at(94).veto, false);
    assert.equal(at(96).veto, true);
    assert.equal(at(92).veto, true);
    clearUsageVeto();
    assert.equal(at(92).veto, false);
  });
});
