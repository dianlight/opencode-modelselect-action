'use strict';

/**
 * Free-tier fail-soft (v2): the `http.response`/`retry` hooks classify a
 * real free-side failure, register the 12h latch
 * (`.opencode/.modelselect-cache/free-quota.json`), flip the session to
 * its task's go model, and force exactly one retry — no dummy probe.
 * Also pins the resolveModel latch honoring (auto + pinned free) and the
 * never-loop / never-extend invariants.
 *
 * `isolateAuth` isolates HOME so the routing sync that runs inside the
 * hooks can never touch the real `~/.config/openchamber/routing.json`.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const v2 = require('../src/v2.js');
const { resolveModel, normalizeOptions, clearQuotaCache } = require('../src/shared/select');
const { isFreeQuotaFresh, markFreeQuota } = require('../src/shared/freequota');
const { FREE_QUOTA_TTL_MS } = require('../src/shared/routing');
const { FREE_RATE_LIMIT_TTL_MS } = require('../src/shared/freequota');
const { seedCache, isolateAuth } = require('./helpers');

const CACHE = (dir) => path.join(dir, '.opencode', '.modelselect-cache');
const LATCH = (dir) => path.join(CACHE(dir), 'free-quota.json');

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

async function runTurn(seen, sessionID = 's1') {
  await seen.prompt({ sessionID, prompt: 'review this diff' });
  const event = { sessionID, agent: 'review', model: { providerID: 'old', id: 'old' }, messages: [] };
  await seen.context(event);
  return event;
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
  it('free 429 on a free pick: latch + flip to go + exactly one forced retry', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-'));
    const restore = isolateAuth(dir);
    try {
      const seen = await setupSession(dir);
      await runTurn(seen);
      assert.deepEqual(
        seen.switches,
        [{ sessionID: 's1', model: { providerID: 'f', id: 'b' } }],
        'the turn applied the free pick first',
      );

      await seen['http.response'](freeResponse('s1'));

      assert.ok(fs.existsSync(LATCH(dir)), 'soft error registered in the latch');
      assert.equal(isFreeQuotaFresh(CACHE(dir)), true);
      assert.deepEqual(
        seen.switches[1],
        { sessionID: 's1', model: { providerID: 'g', id: 'a' } },
        'session flipped to the task go model',
      );
      assert.equal(seen.switches.length, 2);

      // status view input reflects the flip immediately
      const st = JSON.parse(fs.readFileSync(path.join(CACHE(dir), 'status-s1.json'), 'utf8'));
      assert.equal(st.tier, 'go');
      assert.equal(st.model, 'g/a');
      assert.equal(st.freeExhausted, true);

      // the armed retry forces the turn to resume on go
      const r1 = retryEvent('s1', { providerID: 'f', id: 'b' });
      await seen.retry(r1);
      assert.deepEqual(r1.decision, { retry: true, delay: 0 });

      // second failure: window never extends, flip happens once, no re-arm
      const before = JSON.parse(fs.readFileSync(LATCH(dir), 'utf8')).models['f/b'];
      await seen['http.response'](freeResponse('s1'));
      const after = JSON.parse(fs.readFileSync(LATCH(dir), 'utf8')).models['f/b'];
      assert.equal(after.until, before.until, 'the active window never extends');
      assert.equal(seen.switches.length, 2, 'one flip per session');
      const r2 = retryEvent('s1', { providerID: 'f', id: 'b' }, { retry: false }, 3);
      await seen.retry(r2);
      assert.deepEqual(r2.decision, { retry: false }, 'built-in decision untouched after the arm is spent');
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the requested rate-limit message latches for one hour and flips once', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-rate-'));
    const restore = isolateAuth(dir);
    try {
      const seen = await setupSession(dir);
      await runTurn(seen);
      await seen['http.response'](freeResponse('s1', 429, 'Rate limit exceeded. Please try again later.'));

      const entry = JSON.parse(fs.readFileSync(LATCH(dir), 'utf8')).models['f/b'];
      assert.equal(entry.kind, 'rate-limit');
      assert.equal(entry.until - entry.at, FREE_RATE_LIMIT_TTL_MS);
      assert.equal(isFreeQuotaFresh(CACHE(dir), entry.until - 1, 'f/b'), true);
      assert.equal(isFreeQuotaFresh(CACHE(dir), entry.until, 'f/b'), false);
      assert.deepEqual(
        seen.switches[1],
        { sessionID: 's1', model: { providerID: 'g', id: 'a' } },
        'session flipped to the task go model',
      );

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
      await runTurn(seen);
      await seen['http.response']({
        kind: 'primary',
        sessionID: 's1',
        model: { providerID: 'g', id: 'a' },
        response: new Response('rate limited', { status: 429 }),
      });
      assert.equal(fs.existsSync(LATCH(dir)), false, 'go-side failures are not free exhaustion');
      assert.equal(seen.switches.length, 1, 'only the original free apply');
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
      await runTurn(seen);
      await seen['http.response'](freeResponse('s1', 500, 'internal error'));
      assert.equal(fs.existsSync(LATCH(dir)), false, 'no quota wording -> no latch');
      assert.equal(seen.switches.length, 1);
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a non-primary response (title/compaction traffic) never flips', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-title-'));
    const restore = isolateAuth(dir);
    try {
      const seen = await setupSession(dir);
      await runTurn(seen);
      const ev = freeResponse('s1');
      ev.kind = 'title';
      await seen['http.response'](ev);
      assert.equal(fs.existsSync(LATCH(dir)), false);
      assert.equal(seen.switches.length, 1);
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
      await runTurn(seen);
      assert.deepEqual(seen.switches, [], 'trial mode applies nothing');
      await seen['http.response'](freeResponse('s1'));
      assert.ok(fs.existsSync(LATCH(dir)), 'the observation is still registered');
      assert.deepEqual(seen.switches, [], 'no flip in suggestOnly');
      const r = retryEvent('s1', { providerID: 'f', id: 'b' });
      await seen.retry(r);
      assert.deepEqual(r.decision, { retry: false }, 'no forced retry without a flip');
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('mode off latches but never switches', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-off-'));
    const restore = isolateAuth(dir);
    try {
      seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
      fs.mkdirSync(CACHE(dir), { recursive: true });
      fs.writeFileSync(path.join(CACHE(dir), 'mode.json'), JSON.stringify({ mode: 'off' }), 'utf8');
      const seen = await setupSession(dir);
      await runTurn(seen);
      assert.deepEqual(seen.switches, [], 'off applies nothing');
      await seen['http.response'](freeResponse('s1'));
      assert.ok(fs.existsSync(LATCH(dir)), 'routing-relevant observation still registered');
      assert.deepEqual(seen.switches, [], 'no flip while off');
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('retry classifies an error without a response and arms the flip', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-retry-'));
    const restore = isolateAuth(dir);
    try {
      const seen = await setupSession(dir);
      await runTurn(seen);
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
      assert.deepEqual(seen.switches[1], { sessionID: 's1', model: { providerID: 'g', id: 'a' } });
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
