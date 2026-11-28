'use strict';

/**
 * Free-tier fail-soft (v2): the `http.response`/`retry` hooks classify a
 * real failure (free exhaustion, paid quota, rate limit), register the 12h
 * latch (`.opencode/.modelselect-cache/free-quota.json`) for free and
 * paid/external refs, and arm a forced retry. Virtual sessions keep their anchor and re-route through
 * the proxy; explicit-model sessions are moved with `switchModel`. Each
 * failure re-arms so the cascade walks the whole provider chain (another
 * provider first, then free), skipping every ref already tried, and stops
 * when no candidate is left. Also pins the resolveModel latch honoring
 * (auto + pinned free) and the never-extend invariant.
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
const VIRTUAL = { providerID: 'modelselect', id: 'auto-free-first' };

// Three catalog candidates over two providers, so a failover has somewhere
// to go. Chain order (free-first): free-a, free-b-free (opencode), paid-a
// (opencode-go). A failure on free-a must jump to paid-a first (different
// provider), then free-b-free, then stop.
const ROUTED_CONFIG = {
  'task-types': {
    review: {
      go: 'opencode-go/paid-a',
      free: 'opencode/free-a',
      ranked: [
        { model: 'opencode/free-a', score: 95 },
        { model: 'opencode-go/paid-a', score: 90 },
        { model: 'opencode/free-b-free', score: 85 },
      ],
    },
  },
};
const ROUTED_MODELS = [
  { provider: 'opencode', id: 'free-a', blended_cost: 0, context: 200000 },
  { provider: 'opencode-go', id: 'paid-a', blended_cost: 0.1, context: 200000 },
  { provider: 'opencode', id: 'free-b-free', blended_cost: 0, context: 200000 },
];

function seedCatalog(dir) {
  fs.mkdirSync(CACHE(dir), { recursive: true });
  fs.writeFileSync(
    path.join(CACHE(dir), 'provider-catalog-cache.json'),
    JSON.stringify({ fetchedAt: Date.now(), catalog: { models: ROUTED_MODELS } }),
  );
}

async function setupSession(dir, options = {}, cfg) {
  seedCache(dir, cfg || { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
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

async function setupRoutedSession(dir, options = {}) {
  seedCatalog(dir);
  return setupSession(dir, options, ROUTED_CONFIG);
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

function httpEvent(sessionID) {
  return {
    sessionID,
    model: { ...VIRTUAL },
    kind: 'primary',
    request: new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: VIRTUAL.id, messages: [] }),
    }),
  };
}

function headersOf(event) {
  return {
    provider: event.request.headers.get('x-modelselect-provider'),
    model: event.request.headers.get('x-modelselect-model'),
  };
}

describe('v2 free-tier fail-soft', () => {
  it('free 429 on an explicit-model session latches and switches to the next candidate', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-explicit-'));
    const restore = isolateAuth(dir);
    try {
      const seen = await setupRoutedSession(dir, { taskType: 'review' });
      // No context hook: this session uses an explicitly pinned real model.
      await seen['http.response']({
        kind: 'primary',
        sessionID: 's-explicit',
        model: { providerID: 'opencode', id: 'free-a' },
        response: new Response('rate limited', { status: 429 }),
      });
      assert.ok(fs.existsSync(LATCH(dir)), 'soft error registered in the latch');
      assert.equal(isFreeQuotaFresh(CACHE(dir), undefined, 'opencode/free-a'), true);
      const r = retryEvent('s-explicit', { providerID: 'opencode', id: 'free-a' });
      await seen.retry(r);
      assert.deepEqual(r.decision, { retry: true, delay: 0 }, 'explicit sessions force a retry too');
      assert.deepEqual(seen.switches, [
        { sessionID: 's-explicit', model: { providerID: 'opencode-go', id: 'paid-a' } },
      ], 'a different provider is preferred over another model on the same provider');
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('free 429 on a virtual session walks the whole chain, then stops when exhausted', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-'));
    const restore = isolateAuth(dir);
    try {
      const seen = await setupRoutedSession(dir);
      await virtualTurn(seen, 's-chain');
      assert.deepEqual(seen.switches, [], 'virtual sessions never persist via switchModel');
      const status = () => JSON.parse(fs.readFileSync(path.join(CACHE(dir), 'status-s-chain.json'), 'utf8'));
      assert.equal(status().model, 'opencode/free-a');

      // 1) free-a exhausts → latch it and retry on a different provider.
      await seen['http.response']({
        kind: 'primary',
        sessionID: 's-chain',
        model: { providerID: 'opencode', id: 'free-a' },
        response: new Response('rate limited', { status: 429 }),
      });
      assert.equal(isFreeQuotaFresh(CACHE(dir), undefined, 'opencode/free-a'), true);
      const r1 = retryEvent('s-chain', { ...VIRTUAL });
      await seen.retry(r1);
      assert.deepEqual(r1.decision, { retry: true, delay: 0 });
      assert.deepEqual(r1.model, VIRTUAL, 'retry keeps the virtual anchor');
      const h1 = httpEvent('s-chain');
      await seen['http.request'](h1);
      assert.deepEqual(headersOf(h1), { provider: 'opencode-go', model: 'paid-a' }, 'different provider is tried first');

      // 2) paid-a hits its quota → retry on the last free candidate.
      await seen['http.response']({
        kind: 'primary',
        sessionID: 's-chain',
        model: { providerID: 'opencode-go', id: 'paid-a' },
        response: new Response('quota exceeded', { status: 429 }),
      });
      assert.equal(fs.existsSync(LATCH(dir)), true, 'free-a latch still present; go failures are not latched');
      const r2 = retryEvent('s-chain', { providerID: 'opencode-go', id: 'paid-a' });
      await seen.retry(r2);
      assert.deepEqual(r2.decision, { retry: true, delay: 0 }, 'paid failure re-arms the cascade');
      const h2 = httpEvent('s-chain');
      await seen['http.request'](h2);
      assert.deepEqual(headersOf(h2), { provider: 'opencode', model: 'free-b-free' }, 'then the remaining free model');

      // 3) free-b-free exhausts → every candidate is spent, no more retries.
      const before = JSON.parse(fs.readFileSync(LATCH(dir), 'utf8')).models['opencode/free-a'];
      await seen['http.response']({
        kind: 'primary',
        sessionID: 's-chain',
        model: { providerID: 'opencode', id: 'free-b-free' },
        response: new Response('rate limited', { status: 429 }),
      });
      const after = JSON.parse(fs.readFileSync(LATCH(dir), 'utf8')).models['opencode/free-a'];
      assert.equal(after.until, before.until, 'an active window never extends');
      assert.equal(isFreeQuotaFresh(CACHE(dir), undefined, 'opencode/free-b-free'), true);
      const r3 = retryEvent('s-chain', { providerID: 'opencode', id: 'free-b-free' }, { retry: false }, 4);
      await seen.retry(r3);
      assert.deepEqual(r3.decision, { retry: false }, 'all candidates exhausted: error surfaces');
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the requested rate-limit message latches for one hour and arms a failover (virtual)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-rate-'));
    const restore = isolateAuth(dir);
    try {
      const seen = await setupRoutedSession(dir);
      await virtualTurn(seen, 's-rate');
      await seen['http.response']({
        kind: 'primary',
        sessionID: 's-rate',
        model: { providerID: 'opencode', id: 'free-a' },
        response: new Response('Rate limit exceeded. Please try again later.', { status: 429 }),
      });

      const entry = JSON.parse(fs.readFileSync(LATCH(dir), 'utf8')).models['opencode/free-a'];
      assert.equal(entry.kind, 'rate-limit');
      assert.equal(entry.until - entry.at, FREE_RATE_LIMIT_TTL_MS);
      assert.equal(isFreeQuotaFresh(CACHE(dir), entry.until - 1, 'opencode/free-a'), true);
      assert.equal(isFreeQuotaFresh(CACHE(dir), entry.until, 'opencode/free-a'), false);

      const retry = retryEvent('s-rate', { ...VIRTUAL });
      await seen.retry(retry);
      assert.deepEqual(retry.decision, { retry: true, delay: 0 });
      assert.deepEqual(retry.model, VIRTUAL, 'retry keeps the virtual anchor');
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a paid go pick failing arms the chain failover retry (F4)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-go-'));
    const restore = isolateAuth(dir);
    try {
      const seen = await setupRoutedSession(dir);
      await virtualTurn(seen, 's-go');
      await seen['http.response']({
        kind: 'primary',
        sessionID: 's-go',
        model: { providerID: 'opencode-go', id: 'paid-a' },
        response: new Response('rate limited', { status: 429 }),
      });
      assert.equal(fs.existsSync(LATCH(dir)), false, 'go-side failures are not free exhaustion');
      assert.deepEqual(seen.switches, [], 'no flip');
      const r = retryEvent('s-go', { providerID: 'opencode-go', id: 'paid-a' });
      await seen.retry(r);
      assert.deepEqual(r.decision, { retry: true, delay: 0 }, 'paid failure arms the chain failover retry');
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a paid-side limit latches the ref so the next prompt does not re-pick it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-paid-latch-'));
    const restore = isolateAuth(dir);
    try {
      const seen = await setupRoutedSession(dir);
      await virtualTurn(seen, 's-paid');
      const r = retryEvent('s-paid', { providerID: 'opencode-go', id: 'paid-a' });
      await seen.retry(r);
      assert.deepEqual(r.decision, { retry: true, delay: 0 });

      const entry = JSON.parse(fs.readFileSync(LATCH(dir), 'utf8')).models['opencode-go/paid-a'];
      assert.equal(entry.kind, 'paid-limit');
      assert.equal(entry.until - entry.at, FREE_QUOTA_TTL_MS);
      assert.equal(isFreeQuotaFresh(CACHE(dir), entry.until - 1, 'opencode-go/paid-a'), true);

      // A new prompt resets the in-session failover history, but the latch
      // survives it: the next wire request must not route to the dead ref.
      await seen.prompt({ sessionID: 's-paid', prompt: 'review this diff' });
      const ev = httpEvent('s-paid');
      await seen['http.request'](ev);
      assert.equal(headersOf(ev).model, 'free-a', 'the paid-limit ref is skipped on a later turn');
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

  it('retry classifies an error without a response and arms the failover (virtual)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-fs-retry-'));
    const restore = isolateAuth(dir);
    try {
      const seen = await setupRoutedSession(dir);
      await virtualTurn(seen, 's-retry-error');
      const r = {
        sessionID: 's-retry-error',
        model: { ...VIRTUAL },
        error: { type: 'provider', message: 'You have exceeded your quota', status: 403 },
        attempt: 2,
        decision: { retry: false },
      };
      await seen.retry(r);
      assert.deepEqual(r.decision, { retry: true, delay: 0 }, 'fallback path forces one retry');
      assert.deepEqual(r.model, VIRTUAL, 'retry keeps the virtual anchor');
      assert.ok(fs.existsSync(LATCH(dir)), 'latch registered from the retry path');
      assert.equal(isFreeQuotaFresh(CACHE(dir), undefined, 'opencode/free-a'), true);
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
