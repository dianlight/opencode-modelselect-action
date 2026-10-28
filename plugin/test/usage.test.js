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
  usageLimitsFile,
  readUsageLimits,
  writeUsageLimits,
  normalizeLimitsPayload,
  normalizeZenPayload,
  usagePorts,
  fetchLimitsSnapshot,
  refreshUsageLimits,
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
