'use strict';

/**
 * Free-tier fail-soft (v2): the `http.response`/`retry` hooks classify a
 * real free-side failure, register the 12h latch
 * (`.opencode/.modelselect-cache/free-quota.json`), and — for the virtual
 * session only — arm exactly one forced retry that re-points the retry
 * event in place. Non-virtual sessions just latch + resync: they are the
 * user's hands-off choice and are never flipped (switchSessionToGo is gone).
 * Also pins the resolveModel latch honoring (auto + pinned free) and the
 * never-loop / never-extend invariants.
 *
 * `isolateAuth` isolates HOME so the routing sync that runs inside the
 * hooks can never touch the real `~/.config/openchamber/routing.json`.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('os');
const path = require('node:path');

const v2 = require('../src/v2.js');
const { resolveModel, normalizeOptions, clearQuotaCache } = require('../src/shared/select');
const { isFreeQuotaFresh, markFreeQuota } = require('../src/shared/freequota');
const { FREE_QUOTA_TTL_MS } = require('../src/shared/routing');
const { FREE_RATE_LIMIT_TTL_MS } = require('../src/shared/freequota');
const { seedCache, isolateAuth } = require('./helpers');

const CACHE = (dir) => path.join(dir, '.opencode', '.modelselect-cache');
const LATCH = (dir) => path.join(CACHE(dir), 'free-quota.json');
const VIRTUAL = { providerID: 'opencode', id: 'auto' };

async function setupSession(dir, options = {}) {
  seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
  const seen = { switches: [] };
  const fakeCtx = {
    options: { tier: 'free', taskType: 'review', ...options },
    location: { directory: dir },
    session: {
      async hook(name, cb) {
        seen[name] = cb;
      },
      async switchModel(input) {
        seen.switches.push(input);
      },
    },
  };
  await v2.setup(fakeCtx);
  return seen;
}

// Register a virtual session (the context hook marks it virtual + routes but
// never persists — virtual sessions re-route every turn).
async function virtualTurn(seen, sessionID = 's1') {
  await seen.prompt({ sessionID, prompt: 'review this diff' });
  await seen.context({ sessionID, agent: 'review', model: { ...VIRTUAL }, messages: [] });
}

function freeResponse(sessionID, status = 429, body = 'rate limited') {
  return {
    kind: 'primary',
    sessionID,
    model: { providerID: 'f', id: 'b' },
    response: new Response(body, { status }),
  };
}

function retryEvent(sessionID, model, decision = { retry: false }, attempt = 2) {
  return {
    sessionID,
    model,
    error: { type: 'rate_limit', message: '429 too many requests', status: 429 },
    attempt,
    decision,
  };
}

describe('v2 free-tier fail-soft', () => {
  it('free 429 on a non-virtual session: latch + sync, no flip, no arm', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-novirt-'));
    const restore = isolateAuth(dir);
    try {
      const seen = await setupSession(dir);
      // Fire the exhaustion directly on a free model: the hook classifies it
      // regardless of any prior routing.
      await seen['http.response'](freeResponse('s1'));
      assert.ok(fs.existsSync(LATCH(dir)), 'soft error registered in the latch');
      assert.equal(isFreeQuotaFresh(CACHE(dir)), true);
      assert.deepEqual(seen.switches, [], 'non-virtual sessions are never flipped');
      // No arm either: the retry hook leaves the decision untouched.
      const r = retryEvent('s1', { providerID: 'f', id: 'b' });
      await seen.retry(r);
      assert.deepEqual(r.decision, { retry: false }, 'no forced retry for non-virtual sessions');
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('free 429 on a virtual session: latch + sync + exactly one forced retry', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-'));
    const restore = isolateAuth(dir);
    try {
      const seen = await setupSession(dir);
      await virtualTurn(seen);
      // The virtual session routed + wrote status but never persisted.
      assert.deepEqual(seen.switches, [], 'virtual sessions never persist via switchModel');
      const st0 = JSON.parse(fs.readFileSync(path.join(CACHE(dir), 'status-s1.json'), 'utf8'));
      assert.equal(st0.model, 'f/b');

      await seen['http.response'](freeResponse('s1'));
      assert.ok(fs.existsSync(LATCH(dir)), 'soft error registered in the latch');
      assert.equal(isFreeQuotaFresh(CACHE(dir), undefined, 'f/b'), true);

      // The armed retry forces the turn to resume, re-pointing to go.
      const r1 = retryEvent('s1', { providerID: 'f', id: 'b' });
      await seen.retry(r1);
      assert.deepEqual(r1.decision, { retry: true, delay: 0 });
      assert.equal(r1.model.providerID, 'g', 'retry re-points to the task go model');
      assert.equal(r1.model.id, 'a');

      // second failure: window never extends, arm is spent, no re-arm.
      const before = JSON.parse(fs.readFileSync(LATCH(dir), 'utf8')).models['f/b'];
      await seen['http.response'](freeResponse('s1'));
      const after = JSON.parse(fs.readFileSync(LATCH(dir), 'utf8')).models['f/b'];
      assert.equal(after.until, before.until, 'the active window never extends');
      const r2 = retryEvent('s1', { providerID: 'f', id: 'b' }, { retry: false }, 3);
      await seen.retry(r2);
      assert.deepEqual(r2.decision, { retry: false }, 'built-in decision untouched after the arm is spent');
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the requested rate-limit message latches for one hour and arms once (virtual)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-rate-'));
    const restore = isolateAuth(dir);
    try {
      const seen = await setupSession(dir);
      await virtualTurn(seen);
      await seen['http.response'](freeResponse('s1', 429, 'Rate limit exceeded. Please try again later.'));

      const entry = JSON.parse(fs.readFileSync(LATCH(dir), 'utf8')).models['f/b'];
      assert.equal(entry.kind, 'rate-limit');
      assert.equal(entry.until - entry.at, FREE_RATE_LIMIT_TTL_MS);
      assert.equal(isFreeQuotaFresh(CACHE(dir), entry.until - 1, 'f/b'), true);
      assert.equal(isFreeQuotaFresh(CACHE(dir), entry.until, 'f/b'), false);

      const retry = retryEvent('s1', { providerID: 'f', id: 'b' });
      await seen.retry(retry);
      assert.deepEqual(retry.decision, { retry: true, delay: 0 });
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a paid go pick failing does not latch, flip or arm', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-go-'));
    const restore = isolateAuth(dir);
    try {
      const seen = await setupSession(dir);
      await virtualTurn(seen);
      await seen['http.response']({
        kind: 'primary',
        sessionID: 's1',
        model: { providerID: 'g', id: 'a' },
        response: new Response('rate limited', { status: 429 }),
      });
      assert.equal(fs.existsSync(LATCH(dir)), false, 'go-side failures are not free exhaustion');
      assert.deepEqual(seen.switches, [], 'no flip');
      const r = retryEvent('s1', { providerID: 'g', id: 'a' });
      await seen.retry(r);
      assert.deepEqual(r.decision, { retry: false });
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('transient failures (bare 500) on a free pick do not latch', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-500-'));
    const restore = isolateAuth(dir);
    try {
      const seen = await setupSession(dir);
      await seen['http.response'](freeResponse('s1', 500, 'internal error'));
      assert.equal(fs.existsSync(LATCH(dir)), false, 'no quota wording -> no latch');
      assert.deepEqual(seen.switches, []);
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a non-primary response (title/compaction traffic) never latches', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-title-'));
    const restore = isolateAuth(dir);
    try {
      const seen = await setupSession(dir);
      await virtualTurn(seen);
      const ev = freeResponse('s1');
      ev.kind = 'title';
      await seen['http.response'](ev);
      assert.equal(fs.existsSync(LATCH(dir)), false);
      assert.deepEqual(seen.switches, []);
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('suggestOnly latches but never switches or arms', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-suggest-'));
    const restore = isolateAuth(dir);
    try {
      const seen = await setupSession(dir, { suggestOnly: true });
      await virtualTurn(seen);
      assert.deepEqual(seen.switches, [], 'trial mode applies nothing');
      await seen['http.response'](freeResponse('s1'));
      assert.ok(fs.existsSync(LATCH(dir)), 'the observation is still registered');
      assert.deepEqual(seen.switches, [], 'no flip in suggestOnly');
      const r = retryEvent('s1', { providerID: 'f', id: 'b' });
      await seen.retry(r);
      assert.deepEqual(r.decision, { retry: false }, 'no forced retry without a real route');
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('router-sync off latches but skips the OpenChamber sync', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-syncoff-'));
    const restore = isolateAuth(dir);
    try {
      seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
      fs.mkdirSync(CACHE(dir), { recursive: true });
      fs.writeFileSync(path.join(CACHE(dir), 'routing-sync.json'), JSON.stringify({ sync: false }));
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-home-'));
      fs.mkdirSync(path.join(home, '.config', 'openchamber'), { recursive: true });
      const prevHome = process.env.HOME;
      process.env.HOME = home;
      try {
        const seen = await setupSession(dir);
        await virtualTurn(seen);
        await seen['http.response'](freeResponse('s1'));
        assert.ok(fs.existsSync(LATCH(dir)), 'routing-relevant observation still registered');
        assert.deepEqual(seen.switches, [], 'no flip');
        assert.ok(
          !fs.existsSync(path.join(home, '.config', 'openchamber', 'routing.json')),
          'sync skipped while router-sync is off',
        );
      } finally {
        if (prevHome === undefined) delete process.env.HOME;
        else process.env.HOME = prevHome;
        fs.rmSync(home, { recursive: true, force: true });
      }
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('retry classifies an error without a response and arms the retry (virtual)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-retry-'));
    const restore = isolateAuth(dir);
    try {
      const seen = await setupSession(dir);
      await virtualTurn(seen);
      const r = {
        sessionID: 's1',
        model: { providerID: 'f', id: 'b' },
        error: { type: 'provider', message: 'You have exceeded your quota', status: 403 },
        attempt: 2,
        decision: { retry: false },
      };
      await seen.retry(r);
      assert.deepEqual(r.decision, { retry: true, delay: 0 }, 'fallback path forces one retry');
      assert.ok(fs.existsSync(LATCH(dir)), 'latch registered from the retry path');
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveModel honors the latch', () => {
  function seedWithLatch(dir, latchNow) {
    seedCache(dir, { 'task-types': { code: { go: 'g/a', free: 'f/b' } } });
    markFreeQuota(CACHE(dir), { model: 'f/b', detail: 'http 429' }, latchNow ?? Date.now());
  }

  it('auto prefers go while fresh, even when the go probe fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-auto-'));
    const restore = isolateAuth(dir);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ status: 401, ok: false });
    try {
      seedWithLatch(dir);
      clearQuotaCache();
      const opts = normalizeOptions({ tier: 'auto', autoPreference: 'free-first', token: 'bad-token' });
      const picked = await resolveModel({ taskType: 'code', opts, cacheDir: CACHE(dir) });
      assert.equal(picked.freeExhausted, true);
      assert.equal(picked.goOk, false, 'the probe still failed…');
      assert.equal(picked.tier, 'go', '…but the fresh latch wins');
      assert.equal(picked.model, 'g/a');
    } finally {
      globalThis.fetch = realFetch;
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a latch on a different model leaves sibling tasks on free', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-per-'));
    const restore = isolateAuth(dir);
    try {
      seedCache(dir, {
        'task-types': { code: { go: 'g/a', free: 'f/b' }, other: { go: 'g/z', free: 'f/z' } },
      });
      markFreeQuota(CACHE(dir), { model: 'f/b', detail: 'http 429' }, Date.now());
      const opts = normalizeOptions({ tier: 'free', token: 'tok' });
      const latchedTask = await resolveModel({ taskType: 'code', opts, cacheDir: CACHE(dir) });
      assert.equal(latchedTask.freeExhausted, true);
      assert.equal(latchedTask.model, 'g/a', 'the latched task falls to go');
      const sibling = await resolveModel({ taskType: 'other', opts, cacheDir: CACHE(dir) });
      assert.equal(sibling.freeExhausted, false, 'no latch on the sibling free model');
      assert.equal(sibling.tier, 'free');
      assert.equal(sibling.model, 'f/z');
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('auto falls back to the free-first pick once the latch expires', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-exp-'));
    const restore = isolateAuth(dir);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ status: 401, ok: false });
    try {
      seedWithLatch(dir, Date.now() - FREE_QUOTA_TTL_MS - 1);
      clearQuotaCache();
      const opts = normalizeOptions({ tier: 'auto', autoPreference: 'free-first', token: 'bad-token' });
      const picked = await resolveModel({ taskType: 'code', opts, cacheDir: CACHE(dir) });
      assert.equal(picked.freeExhausted, false);
      assert.equal(picked.tier, 'free');
      assert.equal(picked.model, 'f/b');
    } finally {
      globalThis.fetch = realFetch;
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pinned tier free falls to go while the latch is fresh (token present)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-pin-'));
    const restore = isolateAuth(dir);
    try {
      seedWithLatch(dir);
      const opts = normalizeOptions({ tier: 'free', token: 'tok' });
      const picked = await resolveModel({ taskType: 'code', opts, cacheDir: CACHE(dir) });
      assert.equal(picked.freeExhausted, true);
      assert.equal(picked.tier, 'go');
      assert.equal(picked.model, 'g/a');
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pinned tier free stays free without a token (go could not work either)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-pin-nt-'));
    const restore = isolateAuth(dir);
    try {
      seedWithLatch(dir);
      const opts = normalizeOptions({ tier: 'free' }); // no token after isolation
      const picked = await resolveModel({ taskType: 'code', opts, cacheDir: CACHE(dir) });
      assert.equal(picked.freeExhausted, true, 'the latch is still reported');
      assert.equal(picked.tier, 'free');
      assert.equal(picked.model, 'f/b');
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
