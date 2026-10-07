'use strict';

/**
 * v2 single virtual provider (`modelselect/auto-free-first` +
 * `modelselect/auto-go-first`) + `/modelselect` command.
 *
 * - Registration is unconditional (every host) via `editor.add`: one
 *   `modelselect` provider pointing at the plugin's localhost proxy, with
 *   one model per auto-preference. Replays stay idempotent (remove + add).
 * - A virtual pick is the routing switch: routes every turn, the session
 *   model is never mutated to a real pick and never persisted
 *   (switchModel must never fire — dispatch always flows through the
 *   proxy, which forwards to the real base).
 * - The `http.request` hook stamps the resolved pick into
 *   `x-modelselect-*` headers + body per attempt — resolving on the spot
 *   when no pick exists and re-resolving under a fresh exhaustion latch.
 * - Free-exhaustion on a virtual session arms the forced retry; the retry
 *   re-resolves through the same headers, where the fresh latch prefers
 *   go. The session model itself never moves.
 * - The command prints status / toggles the router sync (`sync on|off`),
 *   preferring synthetic output (no model turn).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const v2 = require('../src/v2.js');
const { seedCache, isolateAuth } = require('./helpers');
const { resolveModel, normalizeOptions } = require('../src/shared/select');
const { SESSION_MAP_FILE } = require('../src/shared/host');
const { readRoutingSync } = require('../src/shared/status');
const { isFreeQuotaFresh, markFreeQuota } = require('../src/shared/freequota');

const CACHE = (dir) => path.join(dir, '.opencode', '.modelselect-cache');
const FREE = { providerID: 'modelselect', id: 'auto-free-first' };
const GO = { providerID: 'modelselect', id: 'auto-go-first' };
// The six picker variants both virtual models register (literal, not derived:
// the assertion must catch accidental shape changes in v2.js).
const EXPECTED_VARIANTS = [
  { id: 'default' },
  { id: 'minimal', settings: { reasoningEffort: 'minimal' }, body: { reasoning_effort: 'minimal' } },
  { id: 'low', settings: { reasoningEffort: 'low' }, body: { reasoning_effort: 'low' } },
  { id: 'medium', settings: { reasoningEffort: 'medium' }, body: { reasoning_effort: 'medium' } },
  { id: 'high', settings: { reasoningEffort: 'high' }, body: { reasoning_effort: 'high' } },
  { id: 'xhigh', settings: { reasoningEffort: 'xhigh' }, body: { reasoning_effort: 'xhigh' } },
];

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-virt-'));
}

/** Pin MODELSELECT_OPENCHAMBER for one test; returns a restore function. */
function isolateOpenChamberEnv(value) {
  const saved = process.env.MODELSELECT_OPENCHAMBER;
  if (value === undefined) delete process.env.MODELSELECT_OPENCHAMBER;
  else process.env.MODELSELECT_OPENCHAMBER = value;
  return () => {
    if (saved === undefined) delete process.env.MODELSELECT_OPENCHAMBER;
    else process.env.MODELSELECT_OPENCHAMBER = saved;
  };
}

function writeMap(dir, sessions) {
  fs.mkdirSync(CACHE(dir), { recursive: true });
  fs.writeFileSync(path.join(CACHE(dir), SESSION_MAP_FILE), JSON.stringify({ version: 1, sessions }));
}

/**
 * Boot v2 with a fake ctx. `features.syntheticError` makes synthetic
 * delivery throw (exercises the prompt fallback). The provider mock is a
 * stateful catalog shared across transform replays, like the real one.
 */
async function setupV2(dir, options = {}, features = {}) {
  const seen = { switches: [], synthetics: [], promptsOut: [], added: [] };
  const providers = new Map();
  for (const id of ['opencode', 'opencode-go']) {
    providers.set(id, {
      provider: {
        id,
        name: id,
        activation: 'enabled',
        package: '@opencode/ai/providers/openai-compatible',
        settings: { baseURL: `https://example.test/${id}/v1` },
        headers: { 'x-opencode-org-id': 'org-1' },
      },
      models: new Map([['x', { id: 'x', modelID: 'x', providerID: id, name: 'X' }]]),
    });
  }
  const fakeCtx = {
    options: { tier: 'free', taskType: 'review', ...options },
    location: { directory: dir },
    session: {
      async hook(name, cb) {
        seen[name] = cb;
      },
      async switchModel(input) {
        if (features.switchModelError) throw new Error('switch unavailable');
        seen.switches.push(input);
      },
      async synthetic(input) {
        if (features.syntheticError) throw new Error('synthetic unavailable');
        seen.synthetics.push(input);
      },
      async prompt(input) {
        seen.promptsOut.push(input);
      },
    },
  };
  if (features.provider !== false) {
    const cbs = [];
    const editorFor = () => ({
      get:
        features.providerGet === false
          ? undefined
          : (id) => providers.get(id),
      add: ({ info, models }) => {
        providers.set(info.id, {
          provider: info,
          models: new Map(models.map((m) => [m.id, m])),
        });
        seen.added.push(info.id);
      },
      remove: (id) => {
        providers.delete(id);
      },
      models: {
        set: (providerID, models) => {
          const rec = providers.get(providerID);
          if (rec) rec.models = new Map(models.map((m) => [m.id, m]));
          seen.modelsSet = { providerID, models };
        },
      },
    });
    const runCb = (cb) => cb(editorFor());
    fakeCtx.provider = {
      async transform(cb) {
        cbs.push(cb);
        seen.providerTransforms = (seen.providerTransforms || 0) + 1;
        runCb(cb);
      },
    };
    if (features.providerReload) {
      fakeCtx.provider.reload = async () => {
        seen.reloads = (seen.reloads || 0) + 1;
        for (const cb of cbs) runCb(cb);
      };
    }
    seen.catalog = providers;
  }
  if (features.command !== false) {
    fakeCtx.command = {
      async transform(cb) {
        const defs = [];
        cb({ add: (x) => defs.push(x) });
        seen.commandDef = defs[0];
      },
    };
  }
  const cleanup = await v2.setup(fakeCtx);
  seen.cleanup = cleanup;
  return seen;
}

/** Temp dir + isolated env/HOME/auth with a guaranteed cleanup. */
function withIsolation(envValue) {
  const dir = tmp();
  const restoreEnv = isolateOpenChamberEnv(envValue);
  const restoreAuth = isolateAuth(dir);
  return {
    dir,
    restore() {
      restoreAuth();
      restoreEnv();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('virtual provider registration', () => {
  it('registers modelselect with one model per auto-preference in every host', async () => {
    const iso = withIsolation(undefined);
    try {
      const seen = await setupV2(iso.dir);
      const rec = seen.catalog.get('modelselect');
      assert.ok(rec, 'modelselect provider registered');
      assert.match(rec.provider.settings.baseURL, /^http:\/\/127\.0\.0\.1:\d+\/v1$/, 'points at the localhost proxy');
      assert.equal(rec.provider.package, '@opencode/ai/providers/openai-compatible');
      assert.equal(rec.provider.headers['x-opencode-org-id'], 'org-1', 'live org headers carried over');
      const models = [...rec.models.values()];
      assert.equal(models.length, 2, 'exactly the two virtual models');
      const free = rec.models.get('auto-free-first');
      const go = rec.models.get('auto-go-first');
      assert.ok(free && go);
      assert.equal(free.modelID, 'auto-free-first');
      assert.equal(free.providerID, 'modelselect');
      assert.equal(free.name.length > 0, true);
      assert.deepEqual(free.capabilities, { tools: true, input: ['text', 'image'], output: ['text'] });
      assert.deepEqual(free.variants, EXPECTED_VARIANTS, 'six thinking-level picker variants');
      assert.deepEqual(go.variants, EXPECTED_VARIANTS, 'both virtual models offer the levels');
      assert.deepEqual(free.time, { released: 0 });
      assert.deepEqual(free.cost, []);
      assert.equal(free.status, 'active');
      assert.equal(free.enabled, true);
      assert.deepEqual(free.limit, v2.FALLBACK_VIRTUAL_LIMIT, 'large window, never a small one');
      assert.deepEqual(go.limit, v2.FALLBACK_VIRTUAL_LIMIT);
      assert.ok(seen.commandDef, 'command registered');
      assert.equal(seen.commandDef.name, 'modelselect');
    } finally {
      iso.restore();
    }
  });

  it('stays idempotent across transform replays (remove + add)', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
      const seen = await setupV2(iso.dir);
      const rec = () => seen.catalog.get('modelselect');
      assert.equal(rec().models.size, 2);
      // The per-turn api sync replays a transform over the catalog.
      const e1 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e1);
      assert.equal(rec().models.size, 2, 'still exactly the two virtual models');
      assert.equal(seen.added.filter((id) => id === 'modelselect').length, 1, 'registered once');
    } finally {
      iso.restore();
    }
  });

  it('pins preferences per virtual model id', () => {
    assert.equal(v2.preferenceForVirtualId('auto-free-first'), 'free-first');
    assert.equal(v2.preferenceForVirtualId('auto-go-first'), 'go-first');
    assert.ok(v2.isVirtualRef({ providerID: 'modelselect', id: 'auto-free-first' }));
    assert.ok(v2.isVirtualRef({ providerID: 'modelselect', id: 'auto-go-first' }));
    assert.equal(v2.isVirtualRef({ providerID: 'opencode', id: 'auto' }), false, 'old anchors are not virtual');
    assert.equal(v2.isVirtualRef({ providerID: 'modelselect', id: 'other' }), false);
  });

  it('setup works without a provider api (resolving still runs)', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
      const seen = await setupV2(iso.dir, {}, { provider: false });
      const e = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e);
      assert.deepEqual(e.model, FREE, 'session model untouched');
      const st = JSON.parse(fs.readFileSync(path.join(CACHE(iso.dir), 'status-s1.json'), 'utf8'));
      assert.equal(st.model, 'f/b');
    } finally {
      iso.restore();
    }
  });

  it('registers even when a fresh session-map entry says OpenChamber (always visible)', async () => {
    const iso = withIsolation(undefined);
    try {
      writeMap(iso.dir, { ses_openchamber: Date.now() });
      const seen = await setupV2(iso.dir);
      assert.ok(seen.catalog.get('modelselect'), 'virtual provider registered under OpenChamber too');
    } finally {
      iso.restore();
    }
  });

  it('virtualLimitFor floors small live limits at the large fallback', async () => {
    assert.deepEqual(
      v2.virtualLimitFor([{ id: 'big', limit: { context: 5000000, output: 64000 } }]),
      { context: 5000000, output: v2.FALLBACK_VIRTUAL_LIMIT.output },
    );
    assert.deepEqual(v2.virtualLimitFor([{ id: 'tiny', limit: { context: 64000, output: 8000 } }]), v2.FALLBACK_VIRTUAL_LIMIT);
  });
});

describe('thinking levels (task default, manual variant wins)', () => {
  function httpEvent(sessionID, model, bodyModel) {
    return {
      sessionID,
      model,
      kind: 'primary',
      request: new Request('https://opencode.ai/inference/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: bodyModel, messages: [] }),
      }),
    };
  }

  function virtualEntry(seen, id = 'auto-free-first') {
    return seen.catalog.get('modelselect').models.get(id);
  }

  it('syncs the task think hint onto the virtual entry as the dispatch default', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, { 'task-types': { review: { go: 'g/a', free: 'f/b', think: 'high' } } });
      const seen = await setupV2(iso.dir);

      const e1 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e1);

      const entry = virtualEntry(seen);
      assert.equal(entry.settings.reasoningEffort, 'high', 'settings carry the task hint');
      assert.equal(entry.body.reasoning_effort, 'high', 'body carries the raw passthrough');
      // Wanted state is keyed per virtual id: the sibling stays untouched.
      const go = virtualEntry(seen, 'auto-go-first');
      assert.equal(go.settings, undefined, 'sibling gets no default until it routes');
      assert.equal(go.body, undefined);
      assert.deepEqual(e1.model, FREE, 'session ref untouched');
    } finally {
      iso.restore();
    }
  });

  it('clears a stale think hint when the task moves to default/absent', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
      const seen = await setupV2(iso.dir);

      // Absent think: no effort is forced at all.
      await seen.context({ sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' });
      assert.equal(virtualEntry(seen).settings, undefined, 'absent think forces nothing');
      assert.equal(virtualEntry(seen).body, undefined);

      // Config gains a concrete hint: next turn applies it.
      seedCache(iso.dir, { 'task-types': { review: { go: 'g/a', free: 'f/b', think: 'medium' } } });
      await seen.context({ sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' });
      assert.equal(virtualEntry(seen).settings.reasoningEffort, 'medium');

      // Explicit `default` think: the forced hint must disappear again.
      seedCache(iso.dir, { 'task-types': { review: { go: 'g/a', free: 'f/b', think: 'default' } } });
      await seen.context({ sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' });
      const entry = virtualEntry(seen);
      assert.equal(entry.settings, undefined, 'stale reasoningEffort cleared');
      assert.equal(entry.body, undefined, 'stale reasoning_effort cleared');
    } finally {
      iso.restore();
    }
  });

  it('records a manual picker variant in status without touching the task default', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, { 'task-types': { review: { go: 'g/a', free: 'f/b', think: 'high' } } });
      const seen = await setupV2(iso.dir);

      const e1 = { sessionID: 's1', model: { ...FREE, variant: 'low' }, messages: [], agent: 'review' };
      await seen.context(e1);

      const st = JSON.parse(fs.readFileSync(path.join(CACHE(iso.dir), 'status-s1.json'), 'utf8'));
      assert.equal(st.think, 'high', 'task default stays recorded');
      assert.equal(st.variant, 'low', 'manual override recorded alongside');
      // The catalog default stays the task hint — the host merges the session
      // ref's variant overlay over it at dispatch time, so the plugin must
      // not pre-apply the manual choice.
      assert.equal(virtualEntry(seen).settings.reasoningEffort, 'high');
      assert.deepEqual(e1.model, { ...FREE, variant: 'low' }, 'ref (incl. variant) never mutated');

      // Unknown variant ids normalize to null for display (the host fails the
      // dispatch itself with VariantUnavailable — nothing to record here).
      const e2 = { sessionID: 's2', model: { ...FREE, variant: 'banana' }, messages: [], agent: 'review' };
      await seen.context(e2);
      const st2 = JSON.parse(fs.readFileSync(path.join(CACHE(iso.dir), 'status-s2.json'), 'utf8'));
      assert.equal(st2.variant, null);
    } finally {
      iso.restore();
    }
  });

  it('syncs the think default from a title-first dispatch (no context turn yet)', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, { 'task-types': { review: { go: 'opencode/ga', free: 'opencode/fb', think: 'xhigh' } } });
      const seen = await setupV2(iso.dir);

      const h = httpEvent('s9', { ...FREE }, 'auto-free-first');
      await seen['http.request'](h);
      const body = JSON.parse(await h.request.text());
      assert.equal(body.model, 'fb', 'live pick stamped');
      assert.equal(virtualEntry(seen).settings.reasoningEffort, 'xhigh', 'resolve-on-the-spot syncs the default');
      assert.equal(body.reasoning_effort, undefined, 'task default rides the catalog, not a body rewrite');
    } finally {
      iso.restore();
    }
  });

  it('suggestOnly reports think/variant in status but never patches the catalog', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, { 'task-types': { review: { go: 'g/a', free: 'f/b', think: 'high' } } });
      const seen = await setupV2(iso.dir, { suggestOnly: true });
      const e1 = { sessionID: 's1', model: { ...FREE, variant: 'medium' }, messages: [], agent: 'review' };
      const origLog = console.log;
      console.log = () => {};
      try {
        await seen.context(e1);
      } finally {
        console.log = origLog;
      }
      assert.equal(virtualEntry(seen).settings, undefined, 'trial mode changes nothing in the catalog');
      assert.equal(virtualEntry(seen).body, undefined);
      const st = JSON.parse(fs.readFileSync(path.join(CACHE(iso.dir), 'status-s1.json'), 'utf8'));
      assert.equal(st.think, 'high', 'reporting still works in trial mode');
      assert.equal(st.variant, 'medium');
    } finally {
      iso.restore();
    }
  });
});

describe('/modelselect command', () => {
  it('prints routing-sync, host/source and a no-status hint via synthetic output', async () => {
    const iso = withIsolation(undefined);
    try {
      const seen = await setupV2(iso.dir);
      await seen.commandDef.execute({ sessionID: 's1', prompt: { text: '' }, delivery: 'steer' });
      assert.equal(seen.synthetics.length, 1);
      assert.equal(seen.promptsOut.length, 0, 'status reads never cost a model turn');
      const text = seen.synthetics[0].text;
      assert.match(text, /routing-sync=on/);
      assert.match(text, /host=standalone \(source=default\)/);
      assert.match(text, /pick=persisted/);
      assert.match(text, /no status yet/);
    } finally {
      iso.restore();
    }
  });

  it('sync on|off argument writes routing-sync.json', async () => {
    const iso = withIsolation(undefined);
    try {
      const seen = await setupV2(iso.dir);

      await seen.commandDef.execute({ sessionID: 's1', prompt: { text: 'modelselect sync off' }, delivery: 'steer' });
      assert.equal(readRoutingSync(CACHE(iso.dir)), false);
      assert.match(seen.synthetics[0].text, /router sync → off/);

      await seen.commandDef.execute({ sessionID: 's1', prompt: { text: 'modelselect sync on' }, delivery: 'steer' });
      assert.equal(readRoutingSync(CACHE(iso.dir)), true);
      assert.match(seen.synthetics[1].text, /router sync → on/);
    } finally {
      iso.restore();
    }
  });

  it('rejects unknown arguments with usage text', async () => {
    const iso = withIsolation(undefined);
    try {
      const seen = await setupV2(iso.dir);
      await seen.commandDef.execute({ sessionID: 's1', prompt: 'banana', delivery: 'steer' });
      assert.match(seen.synthetics[0].text, /unknown argument 'banana' — use sync on or sync off/);
      assert.equal(readRoutingSync(CACHE(iso.dir)), true, 'routing-sync untouched');
    } finally {
      iso.restore();
    }
  });

  it('falls back to a steered prompt when synthetic delivery fails', async () => {
    const iso = withIsolation(undefined);
    try {
      const seen = await setupV2(iso.dir, {}, { syntheticError: true });
      await seen.commandDef.execute({ sessionID: 's1', prompt: '', delivery: 'queue' });
      assert.equal(seen.synthetics.length, 0);
      assert.equal(seen.promptsOut.length, 1);
      assert.match(seen.promptsOut[0].text, /routing-sync=on/);
      assert.equal(seen.promptsOut[0].delivery, 'queue');
    } finally {
      iso.restore();
    }
  });
});

describe('virtual routing', () => {
  it('resolves the pick without touching the session model or persisting', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
      const seen = await setupV2(iso.dir);

      const e1 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e1);
      assert.deepEqual(e1.model, FREE, 'session stays on its virtual anchor');
      assert.deepEqual(seen.switches, [], 'switchModel never fires');

      const st = JSON.parse(fs.readFileSync(path.join(CACHE(iso.dir), 'status-s1.json'), 'utf8'));
      assert.equal(st.taskType, 'review');
      assert.equal(st.model, 'f/b');

      // Turn 2 still starts from the virtual pick: the session model was
      // never moved, so it re-routes every turn.
      const e2 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e2);
      assert.deepEqual(e2.model, FREE);
      assert.deepEqual(seen.switches, [], 'still no persistence on turn 2');
    } finally {
      iso.restore();
    }
  });

  it('each virtual model pins its auto-preference under tier auto', async () => {
    const iso = withIsolation(undefined);
    try {
      // usageUrl refuses immediately: the quota probe degrades to null
      // without network, so free-first falls to free and go-first to go.
      seedCache(iso.dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
      const opts = { tier: 'auto', token: 'probe-pref-1', usageUrl: 'http://127.0.0.1:1/' };
      const seen = await setupV2(iso.dir, opts);

      const e1 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e1);
      const st1 = JSON.parse(fs.readFileSync(path.join(CACHE(iso.dir), 'status-s1.json'), 'utf8'));
      assert.equal(st1.tier, 'free');
      assert.equal(st1.model, 'f/b');

      const e2 = { sessionID: 's2', model: { ...GO }, messages: [], agent: 'review' };
      await seen.context(e2);
      const st2 = JSON.parse(fs.readFileSync(path.join(CACHE(iso.dir), 'status-s2.json'), 'utf8'));
      assert.equal(st2.tier, 'go');
      assert.equal(st2.model, 'g/a');
      assert.deepEqual(seen.switches, []);
    } finally {
      iso.restore();
    }
  });

  it('aux requests (title/compaction/generate) follow the last virtual pick untouched', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, {
        'task-types': { review: { go: 'g/a', free: 'f/b' }, generic: { go: 'g/a', free: 'f/b' } },
      });
      const seen = await setupV2(iso.dir);

      // No primary turn yet (title usually runs first): the aux hook
      // resolves a pick on the spot without moving the session model.
      const early = { sessionID: 's9', model: { ...FREE } };
      await seen.title(early);
      assert.deepEqual(early.model, FREE, 'aux never mutates the session model');

      const e1 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e1);

      for (const name of ['title', 'compaction', 'generate']) {
        const e = { sessionID: 's1', model: { ...FREE } };
        await seen[name](e);
        assert.deepEqual(e.model, FREE, `${name} leaves the anchor alone`);
      }
      assert.deepEqual(seen.switches, []);

      // Non-virtual sessions keep their own models here.
      const other = { sessionID: 's2', model: { providerID: 'opencode', id: 'x' } };
      await seen.title(other);
      assert.equal(other.model.id, 'x');
    } finally {
      iso.restore();
    }
  });

  it('suggestOnly resolves without touching anything (contract: change nothing)', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
      const seen = await setupV2(iso.dir, { suggestOnly: true });
      const e = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      const origLog = console.log;
      console.log = () => {};
      try {
        await seen.context(e);
      } finally {
        console.log = origLog;
      }
      assert.deepEqual(e.model, FREE, 'unchanged');
      assert.deepEqual(seen.switches, []);
      const st = JSON.parse(fs.readFileSync(path.join(CACHE(iso.dir), 'status-s1.json'), 'utf8'));
      assert.equal(st.suggestOnly, true);
      assert.equal(st.model, 'f/b');
    } finally {
      iso.restore();
    }
  });

  it('free exhaustion arms a retry without moving the session', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
      const seen = await setupV2(iso.dir);

      const e = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e);
      assert.deepEqual(seen.switches, [], 'precondition: still virtual');

      const r = {
        sessionID: 's1',
        agent: 'review',
        model: { ...FREE },
        error: { type: 'rate_limit', message: '429 too many requests', status: 429 },
        attempt: 2,
        decision: { retry: false },
      };
      await seen.retry(r);
      assert.deepEqual(r.decision, { retry: true, delay: 0 }, 'forced retry armed');
      assert.deepEqual(r.model, FREE, 'retry event keeps the virtual anchor');
      assert.deepEqual(seen.switches, [], 'switchModel never fired: the session stays virtual');
      assert.equal(isFreeQuotaFresh(CACHE(iso.dir)), true, 'latch registered');
    } finally {
      iso.restore();
    }
  });

  it('announce gate: virtual sessions announce (from turn 2, after context marks them)', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
      const seen = await setupV2(iso.dir);

      // First prompt: session not yet marked virtual (prompt runs before
      // context) -> no announce. Documented first-turn gap.
      const p1 = { sessionID: 's1', prompt: { text: 'review this diff' } };
      await seen.prompt(p1);
      assert.equal(p1.prompt.text, 'review this diff', 'no announce before the context hook marks the session');

      const e = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e);

      // Next prompt: session is marked virtual -> announces.
      const p2 = { sessionID: 's1', prompt: { text: 'review this diff again' } };
      await seen.prompt(p2);
      assert.match(p2.prompt.text, /\[modelselect: task=review tier=free/);
      assert.match(p2.prompt.text, /f\/b/);
    } finally {
      iso.restore();
    }
  });
});

describe('virtual protocol api (config endpoints map)', () => {
  it('resolveModel surfaces the endpoint token from the config', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, {
        'task-types': {
          review: { go: 'opencode/gc', free: 'opencode/muse-spark-1.3-contributor-free' },
          docs: { go: 'opencode/gc', free: 'opencode/plain-free' },
        },
        endpoints: { 'muse-spark-1.3-contributor-free': 'responses' },
      });
      const withEndpoint = await resolveModel({
        taskType: 'review',
        opts: normalizeOptions({ tier: 'free' }),
        cacheDir: CACHE(iso.dir),
      });
      assert.equal(withEndpoint.model, 'opencode/muse-spark-1.3-contributor-free');
      assert.equal(withEndpoint.endpoint, 'responses');
      const without = await resolveModel({
        taskType: 'docs',
        opts: normalizeOptions({ tier: 'free' }),
        cacheDir: CACHE(iso.dir),
      });
      assert.equal(without.endpoint, null, 'models missing from the map keep the provider default');
    } finally {
      iso.restore();
    }
  });

  it('points the virtual entry at the pick protocol before dispatch', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, {
        'task-types': { review: { go: 'opencode/gc', free: 'opencode/muse-spark-1.3-contributor-free' } },
        endpoints: { 'muse-spark-1.3-contributor-free': 'responses' },
      });
      const seen = await setupV2(iso.dir);
      const e1 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e1);
      assert.deepEqual(e1.model, FREE, 'session model untouched');
      assert.ok(seen.catalog.get('modelselect'), 'catalog re-materialized');
      const entry = seen.catalog.get('modelselect').models.get('auto-free-first');
      assert.ok(entry, 'virtual entry still registered');
      assert.deepEqual(
        entry.api,
        { id: 'muse-spark-1.3-contributor-free', type: 'aisdk', package: '@ai-sdk/openai' },
        'route resolves to /responses (URL + body + decoder)',
      );
      // The sibling virtual model keeps the provider default.
      assert.equal(seen.catalog.get('modelselect').models.get('auto-go-first').api, undefined);
    } finally {
      iso.restore();
    }
  });

  it('prefers ctx.provider.reload over extra transform registrations', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, {
        'task-types': { review: { go: 'opencode/gc', free: 'opencode/muse-spark-1.3-contributor-free' } },
        endpoints: { 'muse-spark-1.3-contributor-free': 'responses' },
      });
      const seen = await setupV2(iso.dir, {}, { providerReload: true });
      assert.equal(seen.providerTransforms, 2, 'setup registers registration cb + applier');
      assert.equal(seen.reloads ?? 0, 0, 'no reload during setup');
      const e1 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e1);
      assert.equal(seen.reloads, 1, 'sync re-materialized via reload');
      assert.equal(seen.providerTransforms, 2, 'sync appended no transform cbs');
      const entry = seen.catalog.get('modelselect').models.get('auto-free-first');
      assert.deepEqual(
        entry.api,
        { id: 'muse-spark-1.3-contributor-free', type: 'aisdk', package: '@ai-sdk/openai' },
        'reload replay applied the override',
      );
    } finally {
      iso.restore();
    }
  });

  it('clears a stale protocol override when the next pick has none', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, {
        'task-types': { review: { go: 'opencode/gc', free: 'opencode/muse-spark-1.3-contributor-free' } },
        endpoints: { 'muse-spark-1.3-contributor-free': 'responses' },
      });
      const seen = await setupV2(iso.dir);
      const e1 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e1);
      assert.ok(seen.catalog.get('modelselect').models.get('auto-free-first').api, 'turn 1 sets the override');
      // Same task, new config: the pick moves to a model with no endpoint
      // entry (e.g. an unmapped/removed docs row) — the override must go.
      seedCache(iso.dir, {
        'task-types': { review: { go: 'opencode/gc', free: 'opencode/plain-free' } },
      });
      const e2 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e2);
      const st = JSON.parse(fs.readFileSync(path.join(CACHE(iso.dir), 'status-s1.json'), 'utf8'));
      assert.equal(st.model, 'opencode/plain-free', 're-resolve picks the unmapped model');
      const entry = seen.catalog.get('modelselect').models.get('auto-free-first');
      assert.equal(entry.api, undefined, 'provider default restored');
    } finally {
      iso.restore();
    }
  });

  it('falls back to a known protocol when the cached config predates the endpoints map', async () => {
    const iso = withIsolation(undefined);
    try {
      // No `endpoints` key: a 24h cache written before the upgrade.
      seedCache(iso.dir, {
        'task-types': { review: { go: 'opencode/gc', free: 'opencode/muse-spark-1.3-contributor-free' } },
      });
      const seen = await setupV2(iso.dir);
      const e1 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e1);
      const entry = seen.catalog.get('modelselect').models.get('auto-free-first');
      assert.deepEqual(
        entry.api,
        { id: 'muse-spark-1.3-contributor-free', type: 'aisdk', package: '@ai-sdk/openai' },
        'fallback supplies the responses token, no chat-default miss',
      );
    } finally {
      iso.restore();
    }
  });

  it('a protocol mismatch fails soft onto the real pick and retries once without latching (virtual)', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, {
        'task-types': { review: { go: 'opencode/gc', free: 'opencode/muse-spark-1.3-contributor-free' } },
        endpoints: { 'muse-spark-1.3-contributor-free': 'responses' },
      });
      const seen = await setupV2(iso.dir);
      const e1 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e1);
      assert.ok(seen.catalog.get('modelselect').models.get('auto-free-first').api, 'precondition: override set');

      // Simulate the race: the dispatch went out on the chat default.
      delete seen.catalog.get('modelselect').models.get('auto-free-first').api;
      const mismatch = {
        sessionID: 's1',
        model: { ...FREE },
        error: { type: 'ModelProtocolUnsupported', message: 'Model does not support this protocol.' },
        attempt: 1,
        decision: { retry: false },
      };
      await seen.retry(mismatch);
      assert.deepEqual(mismatch.decision, { retry: true, delay: 0 }, 'one re-synced retry');
      assert.deepEqual(mismatch.model, FREE, 'retry event keeps the virtual anchor');
      assert.deepEqual(
        seen.catalog.get('modelselect').models.get('auto-free-first').api,
        { id: 'muse-spark-1.3-contributor-free', type: 'aisdk', package: '@ai-sdk/openai' },
        'catalog api corrected before the retry',
      );
      // The virtual chat driver cannot speak the responses pick, so the
      // session fails soft onto the real pick whose native route works.
      assert.deepEqual(
        seen.switches,
        [{ sessionID: 's1', model: { providerID: 'opencode', id: 'muse-spark-1.3-contributor-free' } }],
        'exactly one fail-soft switch onto the real pick',
      );
      const st = JSON.parse(fs.readFileSync(path.join(CACHE(iso.dir), 'status-s1.json'), 'utf8'));
      assert.equal(st.model, 'opencode/muse-spark-1.3-contributor-free', 'status follows the landed pick');
      assert.match(st.source, /protocol-failsoft/, 'status names the fail-soft');
      assert.equal(
        fs.existsSync(path.join(CACHE(iso.dir), 'free-quota.json')),
        false,
        'a routing miss never latches as exhaustion',
      );

      const again = {
        sessionID: 's1',
        model: { ...FREE },
        error: { type: 'ModelProtocolUnsupported', message: 'Model does not support this protocol.' },
        attempt: 2,
        decision: { retry: false },
      };
      await seen.retry(again);
      assert.deepEqual(again.decision, { retry: false }, 'one shot: no retry loop');
      assert.equal(seen.switches.length, 1, 'one shot: no second switch');
    } finally {
      iso.restore();
    }
  });

  it('a nested send-time protocol error fails soft the same way (ses_ee8036 shape)', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, {
        'task-types': { review: { go: 'opencode/gc', free: 'opencode/muse-spark-1.3-contributor-free' } },
        endpoints: { 'muse-spark-1.3-contributor-free': 'responses' },
      });
      const seen = await setupV2(iso.dir);
      const e1 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e1);
      const mismatch = {
        sessionID: 's1',
        model: { ...FREE },
        error: {
          type: 'error',
          error: { type: 'ModelProtocolUnsupported', message: 'Model does not support this protocol.' },
        },
        attempt: 1,
        decision: { retry: false },
      };
      await seen.retry(mismatch);
      assert.deepEqual(mismatch.decision, { retry: true, delay: 0 }, 'nested shape still retries');
      assert.deepEqual(
        seen.switches,
        [{ sessionID: 's1', model: { providerID: 'opencode', id: 'muse-spark-1.3-contributor-free' } }],
        'nested shape still fails soft onto the real pick',
      );
      assert.equal(
        fs.existsSync(path.join(CACHE(iso.dir), 'free-quota.json')),
        false,
        'a routing miss never latches as exhaustion',
      );
    } finally {
      iso.restore();
    }
  });

  it('a stale protocol arm expires so the next independent mismatch retries again', async () => {
    const iso = withIsolation(undefined);
    const realNow = Date.now;
    try {
      seedCache(iso.dir, {
        'task-types': { review: { go: 'opencode/gc', free: 'opencode/muse-spark-1.3-contributor-free' } },
        endpoints: { 'muse-spark-1.3-contributor-free': 'responses' },
      });
      const seen = await setupV2(iso.dir);
      const e1 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e1);
      const first = {
        sessionID: 's1',
        model: { ...FREE },
        error: { type: 'ModelProtocolUnsupported', message: 'Model does not support this protocol.' },
        attempt: 1,
        decision: { retry: false },
      };
      await seen.retry(first);
      assert.deepEqual(first.decision, { retry: true, delay: 0 }, 'first mismatch retries');
      assert.equal(seen.switches.length, 1);
      // The retried turn succeeded long ago: the arm must not swallow the
      // next independent mismatch forever.
      Date.now = () => realNow() + v2.PROTOCOL_RETRY_TTL_MS + 1000;
      const later = {
        sessionID: 's1',
        model: { ...FREE },
        error: { type: 'ModelProtocolUnsupported', message: 'Model does not support this protocol.' },
        attempt: 1,
        decision: { retry: false },
      };
      await seen.retry(later);
      assert.deepEqual(later.decision, { retry: true, delay: 0 }, 'stale arm expires: fresh retry');
      assert.equal(seen.switches.length, 2, 'stale arm expires: fresh fail-soft switch');
    } finally {
      Date.now = realNow;
      iso.restore();
    }
  });

  it('the prompt hook pre-syncs the virtual protocol ahead of the context hook', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, {
        'task-types': { review: { go: 'opencode/gc', free: 'opencode/muse-spark-1.3-contributor-free' } },
        endpoints: { 'muse-spark-1.3-contributor-free': 'responses' },
      });
      const seen = await setupV2(iso.dir);
      const e1 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e1);
      const api = { id: 'muse-spark-1.3-contributor-free', type: 'aisdk', package: '@ai-sdk/openai' };
      assert.deepEqual(seen.catalog.get('modelselect').models.get('auto-free-first').api, api, 'precondition: override set');
      // Simulate the first-turn race: the dispatch went out before the
      // re-point landed. The next prompt pre-syncs it back without waiting
      // for another context turn.
      delete seen.catalog.get('modelselect').models.get('auto-free-first').api;
      const p2 = { sessionID: 's1', prompt: { text: 'review this diff again' } };
      await seen.prompt(p2);
      assert.deepEqual(
        seen.catalog.get('modelselect').models.get('auto-free-first').api,
        api,
        'prompt pre-sync restored the protocol override',
      );
      assert.deepEqual(seen.switches, [], 'pre-sync never moves the session');
    } finally {
      iso.restore();
    }
  });

  it('a protocol mismatch still retries when the fail-soft switch throws (virtual)', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, {
        'task-types': { review: { go: 'opencode/gc', free: 'opencode/muse-spark-1.3-contributor-free' } },
        endpoints: { 'muse-spark-1.3-contributor-free': 'responses' },
      });
      const seen = await setupV2(iso.dir, {}, { switchModelError: true });
      // Host without switchModel: the plain re-synced retry below still fires.
      const e1 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e1);
      const mismatch = {
        sessionID: 's1',
        model: { ...FREE },
        error: { type: 'ModelProtocolUnsupported', message: 'Model does not support this protocol.' },
        attempt: 1,
        decision: { retry: false },
      };
      await seen.retry(mismatch);
      assert.deepEqual(mismatch.decision, { retry: true, delay: 0 }, 'fallback retry still armed');
    } finally {
      iso.restore();
    }
  });

  it('a protocol mismatch in suggestOnly never switches nor retries', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, {
        'task-types': { review: { go: 'opencode/gc', free: 'opencode/muse-spark-1.3-contributor-free' } },
        endpoints: { 'muse-spark-1.3-contributor-free': 'responses' },
      });
      const seen = await setupV2(iso.dir, { suggestOnly: true });
      const e1 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      const origLog = console.log;
      console.log = () => {};
      try {
        await seen.context(e1);
      } finally {
        console.log = origLog;
      }
      const mismatch = {
        sessionID: 's1',
        model: { ...FREE },
        error: { type: 'ModelProtocolUnsupported', message: 'Model does not support this protocol.' },
        attempt: 1,
        decision: { retry: false },
      };
      await seen.retry(mismatch);
      assert.deepEqual(mismatch.decision, { retry: false }, 'trial mode never retries');
      assert.deepEqual(seen.switches, [], 'trial mode never switches');
    } finally {
      iso.restore();
    }
  });

  it('a protocol mismatch on a non-virtual session never retries', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, {
        'task-types': { review: { go: 'opencode/gc', free: 'opencode/muse-spark-1.3-contributor-free' } },
        endpoints: { 'muse-spark-1.3-contributor-free': 'responses' },
      });
      const seen = await setupV2(iso.dir);
      const r = {
        sessionID: 's9',
        model: { providerID: 'opencode', id: 'x' },
        error: { type: 'ModelProtocolUnsupported', message: 'Model does not support this protocol.' },
        attempt: 1,
        decision: { retry: false },
      };
      await seen.retry(r);
      assert.deepEqual(r.decision, { retry: false }, "hands-off sessions keep the host's decision");
    } finally {
      iso.restore();
    }
  });
});

describe('virtual routing headers', () => {
  const URL = 'https://opencode.ai/inference/openai/v1/chat/completions';
  const SAME = {
    'task-types': {
      review: { go: 'opencode/gc', free: 'opencode/fc' },
      generic: { go: 'opencode/gc', free: 'opencode/fc' },
    },
  };

  function httpEvent(sessionID, providerID, id, bodyModel, kind = 'primary') {
    return {
      sessionID,
      model: { providerID, id },
      kind,
      request: new Request(URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: bodyModel, messages: [] }),
      }),
    };
  }

  async function bodyOf(event) {
    return JSON.parse(await event.request.text());
  }

  function headersOf(event) {
    return {
      provider: event.request.headers.get('x-modelselect-provider'),
      model: event.request.headers.get('x-modelselect-model'),
    };
  }

  it('stamps routing headers + body for a virtual session (no persistence)', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, SAME);
      const seen = await setupV2(iso.dir);

      const e1 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e1);

      const h = httpEvent('s1', 'modelselect', 'auto-free-first', 'auto-free-first');
      await seen['http.request'](h);
      assert.equal((await bodyOf(h)).model, 'fc', 'the wire carries the pick');
      assert.deepEqual(headersOf(h), { provider: 'opencode', model: 'fc' }, 'proxy routing headers stamped');
      assert.deepEqual(seen.switches, [], 'the session stays virtual');
    } finally {
      iso.restore();
    }
  });

  it('routes cross-provider picks through the same proxy (no hop, no persist)', async () => {
    const iso = withIsolation(undefined);
    try {
      // The pick lives on opencode-go while the session sits on the
      // single modelselect anchor: headers carry it, the session never
      // moves. This is the case the dual anchors existed for.
      seedCache(iso.dir, { 'task-types': { review: { go: 'opencode-go/a', free: 'opencode-go/b' } } });
      const seen = await setupV2(iso.dir);

      const e1 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e1);

      const h = httpEvent('s1', 'modelselect', 'auto-free-first', 'auto-free-first');
      await seen['http.request'](h);
      assert.deepEqual(headersOf(h), { provider: 'opencode-go', model: 'b' });
      assert.equal((await bodyOf(h)).model, 'b');
      assert.deepEqual(seen.switches, [], 'no anchor hop, no persist-real fallback');

      // Next turn still starts virtual and re-routes.
      const e2 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e2);
      assert.deepEqual(e2.model, FREE);
    } finally {
      iso.restore();
    }
  });

  it('resolves on the spot when no primary turn has run yet (title-first)', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, SAME);
      const seen = await setupV2(iso.dir);

      const h = httpEvent('s9', 'modelselect', 'auto-free-first', 'auto-free-first', 'title');
      await seen['http.request'](h);
      assert.equal((await bodyOf(h)).model, 'fc', 'title carries a live pick, never the raw ref');
      assert.deepEqual(headersOf(h), { provider: 'opencode', model: 'fc' });
      assert.deepEqual(seen.switches, []);
    } finally {
      iso.restore();
    }
  });

  it('re-resolves under a fresh exhaustion latch (armed retries stay live)', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, SAME);
      const seen = await setupV2(iso.dir, { token: 'probe-latch-1' });

      const e1 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e1);
      assert.deepEqual(seen.switches, [], 'precondition: still virtual');

      markFreeQuota(CACHE(iso.dir), { model: 'opencode/fc', detail: 'http 402' });
      assert.equal(isFreeQuotaFresh(CACHE(iso.dir)), true, 'precondition: latch fresh');

      const h = httpEvent('s1', 'modelselect', 'auto-free-first', 'auto-free-first');
      await seen['http.request'](h);
      assert.equal((await bodyOf(h)).model, 'gc', 'stale free pick refreshed to go');
      assert.deepEqual(headersOf(h), { provider: 'opencode', model: 'gc' });
      assert.deepEqual(seen.switches, [], 'still virtual');
    } finally {
      iso.restore();
    }
  });

  it('leaves non-virtual sessions and foreign bodies alone, never throws', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, SAME);
      const seen = await setupV2(iso.dir);

      const other = httpEvent('s2', 'opencode', 'x', 'x');
      await seen['http.request'](other);
      assert.equal((await bodyOf(other)).model, 'x');
      assert.equal(other.request.headers.get('x-modelselect-provider'), null);

      const e1 = { sessionID: 's1', model: { ...FREE }, messages: [], agent: 'review' };
      await seen.context(e1);
      const foreign = httpEvent('s1', 'modelselect', 'auto-free-first', 'zzz');
      await seen['http.request'](foreign);
      assert.equal((await bodyOf(foreign)).model, 'zzz', 'only the virtual id is rewritten');
      assert.deepEqual(headersOf(foreign), { provider: 'opencode', model: 'fc' }, 'headers still carry the live pick');

      const noReq = { sessionID: 's1', model: { ...FREE }, kind: 'primary' };
      await seen['http.request'](noReq);
      const garbage = {
        sessionID: 's1',
        model: { ...FREE },
        kind: 'primary',
        request: new Request(URL, { method: 'POST', body: 'not json{' }),
      };
      await seen['http.request'](garbage);
      assert.deepEqual(seen.switches, []);
    } finally {
      iso.restore();
    }
  });
});
