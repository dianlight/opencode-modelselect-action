'use strict';

/**
 * Free-tier soft-error latch (`src/shared/freequota.js`) + the pure
 * constants it reuses from the routing core: exhaustion fingerprints
 * (mirroring github-action's classifyFreeProbe), free-model detection,
 * and the first-detection mark/read semantics — a new check is only
 * allowed after the selected window expires. Spent quota uses 12h;
 * transient rate limiting uses 1h.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  FREE_QUOTA_BASENAME,
  FREE_RATE_LIMIT_TTL_MS,
  RATE_LIMIT_MESSAGE_RE,
  classifyFreeExhaustion,
  classifyFreeFailure,
  isFreeModelRef,
  isFreeQuotaFresh,
  markFreeQuota,
  readFreeQuota,
  readModelTable,
} = require('../src/shared/freequota');
const { FREE_QUOTA_FILE, FREE_QUOTA_TTL_MS, freeQuotaFresh } = require('../src/shared/routing');

function tempCache(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('classifyFreeExhaustion', () => {
  it('treats 402/429 as exhaustion on status alone', () => {
    assert.equal(classifyFreeExhaustion(402, ''), true);
    assert.equal(classifyFreeExhaustion(429, ''), true);
    assert.equal(classifyFreeExhaustion(429, 'internal server detail'), true);
  });

  it('accepts quota wording in other4xx and in 503/529 bodies', () => {
    assert.equal(classifyFreeExhaustion(403, 'You have exceeded your quota'), true);
    assert.equal(classifyFreeExhaustion(400, 'rate limit hit'), true);
    assert.equal(classifyFreeExhaustion(503, 'too many requests'), true);
    assert.equal(classifyFreeExhaustion(529, 'upstream provider error'), true);
  });

  it('falls back to the body when no status is known', () => {
    assert.equal(classifyFreeExhaustion(null, 'too many requests'), true);
    assert.equal(classifyFreeExhaustion(0, 'usage limit reached'), true);
    assert.equal(classifyFreeExhaustion(undefined, ''), false);
  });

  it('rejects success, auth, transient overload and plain failures', () => {
    assert.equal(classifyFreeExhaustion(200, 'quota quota quota'), false);
    assert.equal(classifyFreeExhaustion(401, 'quota exceeded'), false); // auth, never quota
    assert.equal(classifyFreeExhaustion(503, 'upstream overloaded'), false); // bare overload is transient
    assert.equal(classifyFreeExhaustion(500, 'rate limit'), false);
    assert.equal(classifyFreeExhaustion(404, 'not found'), false);
    assert.equal(classifyFreeExhaustion(400, 'invalid request'), false);
  });

  it('distinguishes transient rate limiting from spent quota', () => {
    const message = 'Rate limit exceeded. Please try again later.';
    assert.match(message, RATE_LIMIT_MESSAGE_RE);
    assert.deepEqual(classifyFreeFailure(429, ''), { exhausted: true, rateLimited: true });
    assert.deepEqual(classifyFreeFailure(403, message), { exhausted: true, rateLimited: true });
    assert.deepEqual(classifyFreeFailure(500, message), { exhausted: true, rateLimited: true });
    assert.deepEqual(classifyFreeFailure(402, ''), { exhausted: true, rateLimited: false });
    assert.deepEqual(classifyFreeFailure(403, 'You have exceeded your quota'), {
      exhausted: true,
      rateLimited: false,
    });
    assert.deepEqual(classifyFreeFailure(200, message), { exhausted: false, rateLimited: false });
  });
});

describe('isFreeModelRef', () => {
  const table = {
    review: { go: 'g/a', free: 'f/b' },
    generic: { go: 'g/x', free: 'big-pickle' },
  };

  it('prefers the configured table: any free entry matches', () => {
    assert.equal(isFreeModelRef({ providerID: 'f', id: 'b' }, table), true);
    // bare-id match (model refs without a provider in the config)
    assert.equal(isFreeModelRef({ providerID: 'opencode', id: 'big-pickle' }, table), true);
  });

  it('a configured go entry means paid, even with a -free suffix', () => {
    assert.equal(isFreeModelRef({ providerID: 'g', id: 'a' }, table), false);
    assert.equal(
      isFreeModelRef({ providerID: 'g', id: 'weird-free' }, { t: { go: 'g/weird-free', free: 'f/b' } }),
      false,
    );
  });

  it('falls back to the -free suffix without a usable table', () => {
    assert.equal(isFreeModelRef({ providerID: 'opencode', id: 'muse-spark-1.3-contributor-free' }, null), true);
    // v1 splitModelRef shape carries modelID instead of id
    assert.equal(isFreeModelRef({ providerID: 'opencode', modelID: 'x-free' }, {}), true);
    assert.equal(isFreeModelRef({ providerID: 'opencode', id: 'claude-opus-5' }, null), false);
    assert.equal(isFreeModelRef({ providerID: 'opencode', id: 'big-pickle' }, null), false);
  });

  it('rejects junk refs', () => {
    assert.equal(isFreeModelRef(null, table), false);
    assert.equal(isFreeModelRef('f/b', table), false);
    assert.equal(isFreeModelRef({ id: '' }, table), false);
  });
});

describe('markFreeQuota / freshness (first-detection windows)', () => {
  it('registers a spent-quota latch and never extends the deadline', () => {
    const dir = tempCache('modelselect-fq-');
    try {
      assert.equal(isFreeQuotaFresh(dir), false, 'no latch -> not fresh');
      const at = Date.now();
      const first = markFreeQuota(dir, { model: 'f/b', detail: 'http 429' }, at);
      assert.ok(first);
      assert.equal(first.at, at);
      assert.equal(first.until, at + FREE_QUOTA_TTL_MS);
      assert.equal(first.kind, 'exhaustion');
      assert.equal(first.model, 'f/b');
      assert.equal(isFreeQuotaFresh(dir, at), true);

      // A later failure re-registers evidence but keeps the original window.
      const again = markFreeQuota(dir, { model: 'f/b', detail: 'retry error' }, at + 60_000);
      assert.equal(again.at, at, 'fresh latch keeps first-detection at');
      assert.equal(again.until, at + FREE_QUOTA_TTL_MS);
      assert.equal(again.updatedAt, at + 60_000);

      assert.equal(isFreeQuotaFresh(dir, at + FREE_QUOTA_TTL_MS - 1), true);
      assert.equal(isFreeQuotaFresh(dir, at + FREE_QUOTA_TTL_MS), false, 'exactly 12h -> expired');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses a one-hour window for a rate-limit signal', () => {
    const dir = tempCache('modelselect-fq-rate-');
    try {
      const at = Date.now();
      const first = markFreeQuota(
        dir,
        { kind: 'rate-limit', model: 'f/b', detail: 'Rate limit exceeded. Please try again later.' },
        at,
      );
      assert.equal(first.kind, 'rate-limit');
      assert.equal(first.until, at + FREE_RATE_LIMIT_TTL_MS);
      assert.equal(isFreeQuotaFresh(dir, at + FREE_RATE_LIMIT_TTL_MS - 1), true);
      assert.equal(isFreeQuotaFresh(dir, at + FREE_RATE_LIMIT_TTL_MS), false, 'exactly 1h -> expired');

      // The first failure controls the active window: a later quota signal
      // does not lengthen or reclassify it.
      const later = markFreeQuota(dir, { kind: 'exhaustion', detail: 'quota spent' }, at + 60_000);
      assert.equal(later.kind, 'rate-limit');
      assert.equal(later.until, at + FREE_RATE_LIMIT_TTL_MS);
      assert.equal(later.updatedAt, at + 60_000);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('opens a NEW window only after expiry (the "new check")', () => {
    const dir = tempCache('modelselect-fq-');
    try {
      const at = Date.now();
      markFreeQuota(dir, { detail: 'first' }, at);
      const later = at + FREE_QUOTA_TTL_MS + 1;
      const next = markFreeQuota(dir, { detail: 'second' }, later);
      assert.equal(next.at, later, 'expired latch restarts from the new failure');
      assert.equal(next.until, later + FREE_QUOTA_TTL_MS);
      assert.equal(isFreeQuotaFresh(dir, later), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads back the entry and survives missing/corrupt files', () => {
    const dir = tempCache('modelselect-fq-');
    try {
      assert.equal(readFreeQuota(dir), null, 'missing -> null');
      assert.deepEqual(readFreeQuota(''), null, 'no cacheDir -> null');
      const at = Date.now();
      const entry = markFreeQuota(dir, { detail: 'x' }, at);
      assert.deepEqual(readFreeQuota(dir), entry);

      fs.writeFileSync(path.join(dir, FREE_QUOTA_BASENAME), 'nope{', 'utf8');
      assert.equal(readFreeQuota(dir), null, 'corrupt -> null');
      assert.equal(isFreeQuotaFresh(dir, at), false, 'corrupt -> not fresh');
      fs.writeFileSync(path.join(dir, FREE_QUOTA_BASENAME), '[]', 'utf8');
      assert.equal(readFreeQuota(dir), null, 'array -> null');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes to the path routing sync reads', () => {
    assert.equal(FREE_QUOTA_BASENAME, 'free-quota.json');
    assert.equal(FREE_QUOTA_FILE, '.opencode/.modelselect-cache/free-quota.json');
    assert.equal(FREE_QUOTA_TTL_MS, 12 * 60 * 60 * 1000);
    assert.equal(FREE_RATE_LIMIT_TTL_MS, 60 * 60 * 1000);
    const dir = tempCache('modelselect-fq-');
    try {
      markFreeQuota(dir, { detail: 'x' });
      assert.ok(fs.existsSync(path.join(dir, 'free-quota.json')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('freeQuotaFresh rejects unusable entries', () => {
    const now = 1_000_000;
    assert.equal(freeQuotaFresh(null, now), false);
    assert.equal(freeQuotaFresh('x', now), false);
    assert.equal(freeQuotaFresh({ at: 1 }, now), false, 'missing until');
    assert.equal(freeQuotaFresh({ at: now, until: 'soon' }, now), false, 'non-numeric until');
    assert.equal(freeQuotaFresh({ at: now, until: now }, now), false, 'until > at required');
    assert.equal(freeQuotaFresh({ at: now - 5, until: now }, now), false, 'until > now required');
    assert.equal(freeQuotaFresh({ at: now - 5, until: now + 5 }, now), true);
    assert.equal(
      freeQuotaFresh({ at: now - 5, until: now + 5 }),
      false,
      'default now = Date.now(), long past the tiny fixture',
    );
  });
});

describe('readModelTable', () => {
  it('reads task-types from the model-config cache', () => {
    const dir = tempCache('modelselect-fq-');
    try {
      assert.equal(readModelTable(dir), null, 'missing -> null');
      const table = { review: { go: 'g/a', free: 'f/b' } };
      fs.writeFileSync(
        path.join(dir, 'model-config-cache.json'),
        JSON.stringify({ fetchedAt: 1, config: { 'task-types': table } }),
        'utf8',
      );
      assert.deepEqual(readModelTable(dir), table);
      // snake_case variant
      fs.writeFileSync(
        path.join(dir, 'model-config-cache.json'),
        JSON.stringify({ fetchedAt: 1, config: { task_types: table } }),
        'utf8',
      );
      assert.deepEqual(readModelTable(dir), table);
      // corrupt + wrong shapes -> null
      fs.writeFileSync(path.join(dir, 'model-config-cache.json'), 'nope{', 'utf8');
      assert.equal(readModelTable(dir), null);
      fs.writeFileSync(path.join(dir, 'model-config-cache.json'), JSON.stringify({ config: [] }), 'utf8');
      assert.equal(readModelTable(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
