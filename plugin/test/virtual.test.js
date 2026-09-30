'use strict';

/**
 * v2 virtual model (`opencode/auto`) + `/modelselect` command.
 *
 * - Registration is standalone-only (option → env → session map decide
 *   the host) and uses literal @opencode/schema shapes.
 * - A virtual pick routes like mode `on` in every mode, mutates the
 *   in-flight ref, and never persists (switchModel must never fire —
 *   otherwise the session would stop re-routing). Title/compaction/
 *   generate requests follow the session's last resolved pick (the raw
 *   virtual ref has no dispatchable driver).
 * - Free-exhaustion on a virtual session arms the forced retry and
 *   re-points the retry event in place instead of flipping the session.
 * - The `http.request` overlay is what actually routes virtual sessions:
 *   `event.model` mutation is cosmetic (dispatch reads the persisted
 *   session model), so the overlay writes the decided model into the
 *   outgoing body per attempt — resolving on the spot when no pick
 *   exists and re-resolving under a fresh exhaustion latch.
 * - The command prints status / writes the mode, preferring synthetic
 *   output (no model turn).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const v2 = require('../src/v2.js');
const { seedCache, isolateAuth } = require('./helpers');
const { SESSION_MAP_FILE } = require('../src/shared/host');
const { clearModeCache, readMode } = require('../src/shared/status');
const { isFreeQuotaFresh, markFreeQuota } = require('../src/shared/freequota');

const CACHE = (dir) => path.join(dir, '.opencode', '.modelselect-cache');

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

function seedMode(dir, mode) {
  fs.mkdirSync(CACHE(dir), { recursive: true });
  fs.writeFileSync(path.join(CACHE(dir), 'mode.json'), JSON.stringify({ mode }));
  clearModeCache();
}

/**
 * Boot v2 with a fake ctx. `features.syntheticError` makes synthetic
 * delivery throw (exercises the prompt fallback).
 */
async function setupV2(dir, options = {}, features = {}) {
  const seen = { switches: [], synthetics: [], promptsOut: [] };
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
    // Mock live `opencode` inventory (mirrors the ProviderRecord shape);
    // `features.providerGet === false` simulates a host with no readable
    // `opencode` inventory (registration must skip); `features.liveModels`
    // seeds pre-existing models (idempotency assertions).
    const LIVE_MODELS = features.liveModels || [
      { id: 'x', modelID: 'x', providerID: 'opencode', name: 'X' },
    ];
    fakeCtx.provider = {
      async transform(cb) {
        const added = [];
        const editor = { add: (x) => added.push(x) };
        if (features.providerGet !== false) {
          editor.get = (id) =>
            id === 'opencode'
              ? { provider: { id: 'opencode' }, models: new Map(LIVE_MODELS.map((m) => [m.id, m])) }
              : undefined;
          editor.models = {
            set: (providerID, models) => {
              seen.modelsSet = { providerID, models };
            },
          };
        }
        cb(editor);
        seen.providerAdded = added;
      },
    };
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
  await v2.setup(fakeCtx);
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

describe('virtual model registration', () => {
  it('appends opencode/auto to the live provider inventory when standalone', async () => {
    const iso = withIsolation(undefined);
    try {
      const seen = await setupV2(iso.dir);
      assert.ok(seen.providerAdded, 'provider transform ran');
      assert.deepEqual(seen.providerAdded, [], 'no standalone fake provider');
      assert.ok(seen.modelsSet, 'inventory replaced');
      assert.equal(seen.modelsSet.providerID, 'opencode');
      assert.equal(seen.modelsSet.models.length, 2, 'existing models preserved + auto appended');
      assert.equal(seen.modelsSet.models[0].id, 'x');
      const m = seen.modelsSet.models[1];
      assert.equal(m.id, 'auto');
      assert.equal(m.modelID, 'auto');
      assert.equal(m.providerID, 'opencode');
      assert.equal(m.name.length > 0, true);
      assert.deepEqual(m.capabilities, { tools: true, input: ['text', 'image'], output: ['text'] });
      assert.deepEqual(m.variants, []);
      assert.deepEqual(m.time, { released: 0 });
      assert.deepEqual(m.cost, []);
      assert.equal(m.status, 'active');
      assert.equal(m.enabled, true);
      assert.deepEqual(m.limit, { context: 200000, output: 32000 });
      assert.ok(seen.commandDef, 'command registered');
      assert.equal(seen.commandDef.name, 'modelselect');
    } finally {
      iso.restore();
    }
  });

  it('skips registration when no live opencode inventory is readable', async () => {
    const iso = withIsolation(undefined);
    try {
      const seen = await setupV2(iso.dir, {}, { providerGet: false });
      assert.deepEqual(seen.providerAdded, [], 'no fake provider ever');
      assert.equal(seen.modelsSet, undefined, 'inventory untouched without a live record');
    } finally {
      iso.restore();
    }
  });

  it('never duplicates an existing auto entry (transform replays must be idempotent)', async () => {
    const iso = withIsolation(undefined);
    try {
      const seen = await setupV2(iso.dir, {}, {
        liveModels: [
          { id: 'x', modelID: 'x', providerID: 'opencode', name: 'X' },
          { id: 'auto', modelID: 'auto', providerID: 'opencode', name: 'Old auto' },
        ],
      });
      assert.ok(seen.modelsSet, 'inventory replaced');
      const autos = seen.modelsSet.models.filter((m) => m.id === 'auto');
      assert.equal(autos.length, 1, 'exactly one auto entry');
      assert.equal(autos[0].name, 'Auto (modelselect routes every turn)', 'ours wins');
      assert.equal(seen.modelsSet.models[0].id, 'x', 'other models preserved');
    } finally {
      iso.restore();
    }
  });

  it('skips registration when a fresh session-map entry says OpenChamber', async () => {
    const iso = withIsolation(undefined);
    try {
      writeMap(iso.dir, { ses_openchamber: Date.now() });
      const seen = await setupV2(iso.dir);
      assert.equal(seen.providerAdded, undefined, 'no provider transform under OpenChamber');
    } finally {
      iso.restore();
    }
  });

  it('stale session-map entries do not count as OpenChamber', async () => {
    const iso = withIsolation(undefined);
    try {
      writeMap(iso.dir, { ses_old: Date.now() - 31 * 24 * 60 * 60 * 1000 });
      const seen = await setupV2(iso.dir);
      assert.ok(seen.modelsSet, 'stale map -> standalone -> registered');
    } finally {
      iso.restore();
    }
  });

  it('option beats env and map in both directions', async () => {
    let iso = withIsolation('1'); // env says OpenChamber
    try {
      const seen = await setupV2(iso.dir, { openchamber: 'off' });
      assert.ok(seen.modelsSet, "option 'off' forces standalone despite env");
    } finally {
      iso.restore();
    }

    iso = withIsolation(undefined);
    try {
      writeMap(iso.dir, { ses_x: Date.now() }); // map says OpenChamber
      const seen = await setupV2(iso.dir, { openchamber: 'on' });
      assert.equal(seen.providerAdded, undefined, "option 'on' forces OpenChamber despite map");
    } finally {
      iso.restore();
    }
  });

  it('env beats the session map', async () => {
    let iso = withIsolation('0');
    try {
      writeMap(iso.dir, { ses_x: Date.now() });
      const seen = await setupV2(iso.dir);
      assert.ok(seen.modelsSet, "env '0' forces standalone despite map");
    } finally {
      iso.restore();
    }

    iso = withIsolation('1');
    try {
      const seen = await setupV2(iso.dir);
      assert.equal(seen.providerAdded, undefined, "env '1' forces OpenChamber");
    } finally {
      iso.restore();
    }
  });
});

describe('/modelselect command', () => {
  it('prints mode, host/source and a no-status hint via synthetic output', async () => {
    const iso = withIsolation(undefined);
    try {
      seedMode(iso.dir, 'auto');
      const seen = await setupV2(iso.dir);
      await seen.commandDef.execute({ sessionID: 's1', prompt: { text: '' }, delivery: 'steer' });
      assert.equal(seen.synthetics.length, 1);
      assert.equal(seen.promptsOut.length, 0, 'status reads never cost a model turn');
      const text = seen.synthetics[0].text;
      assert.match(text, /mode=auto/);
      assert.match(text, /host=standalone \(source=default\)/);
      assert.match(text, /pick=persisted/);
      assert.match(text, /no status yet/);
    } finally {
      iso.restore();
    }
  });

  it('session-map hit reports openchamber for that session', async () => {
    const iso = withIsolation(undefined);
    try {
      writeMap(iso.dir, { s1: Date.now() });
      const seen = await setupV2(iso.dir);
      await seen.commandDef.execute({ sessionID: 's1', prompt: 'modelselect', delivery: 'steer' });
      assert.match(seen.synthetics[0].text, /host=openchamber \(source=session-map\)/);
    } finally {
      iso.restore();
    }
  });

  it('on|off|auto argument writes mode.json (command word tolerated)', async () => {
    const iso = withIsolation(undefined);
    try {
      seedMode(iso.dir, 'auto');
      const seen = await setupV2(iso.dir);

      await seen.commandDef.execute({ sessionID: 's1', prompt: { text: 'modelselect off' }, delivery: 'steer' });
      assert.equal(readMode(CACHE(iso.dir)), 'off');
      assert.match(seen.synthetics[0].text, /mode . off/);

      await seen.commandDef.execute({ sessionID: 's1', prompt: 'auto', delivery: 'steer' });
      assert.equal(readMode(CACHE(iso.dir)), 'auto');
      assert.match(seen.synthetics[1].text, /mode . auto/);
    } finally {
      iso.restore();
    }
  });

  it('rejects unknown arguments with usage text', async () => {
    const iso = withIsolation(undefined);
    try {
      seedMode(iso.dir, 'on');
      const seen = await setupV2(iso.dir);
      await seen.commandDef.execute({ sessionID: 's1', prompt: 'banana', delivery: 'steer' });
      assert.match(seen.synthetics[0].text, /unknown argument 'banana' — use on, off or auto/);
      assert.equal(readMode(CACHE(iso.dir)), 'on', 'mode untouched');
    } finally {
      iso.restore();
    }
  });

  it('falls back to a steered prompt when synthetic delivery fails', async () => {
    const iso = withIsolation(undefined);
    try {
      seedMode(iso.dir, 'auto');
      const seen = await setupV2(iso.dir, {}, { syntheticError: true });
      await seen.commandDef.execute({ sessionID: 's1', prompt: '', delivery: 'queue' });
      assert.equal(seen.synthetics.length, 0);
      assert.equal(seen.promptsOut.length, 1);
      assert.match(seen.promptsOut[0].text, /mode=auto/);
      assert.equal(seen.promptsOut[0].delivery, 'queue');
    } finally {
      iso.restore();
    }
  });
});

describe('virtual routing', () => {
  it('mutates the in-flight ref and never persists, bypassing mode=off', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
      seedMode(iso.dir, 'off'); // virtual picks must ignore the mode
      const seen = await setupV2(iso.dir);

      const e1 = { sessionID: 's1', model: { providerID: 'opencode', id: 'auto' }, messages: [], agent: 'review' };
      await seen.context(e1);
      assert.equal(e1.model.providerID, 'f', 'in-flight ref mutated to the real model');
      assert.equal(e1.model.id, 'b');
      assert.deepEqual(seen.switches, [], 'virtual picks never persist');

      const st = JSON.parse(fs.readFileSync(path.join(CACHE(iso.dir), 'status-s1.json'), 'utf8'));
      assert.equal(st.taskType, 'review');
      assert.equal(st.model, 'f/b');

      // Turn 2 still starts from the virtual pick: the session model was
      // never switched away, so it re-routes every turn.
      const e2 = { sessionID: 's1', model: { providerID: 'opencode', id: 'auto' }, messages: [], agent: 'review' };
      await seen.context(e2);
      assert.equal(e2.model.id, 'b');
      assert.deepEqual(seen.switches, [], 'still no persistence on turn 2');
    } finally {
      iso.restore();
    }
  });

  it('aux requests (title/compaction/generate) follow the last virtual pick', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, {
        'task-types': { review: { go: 'g/a', free: 'f/b' }, generic: { go: 'g/a', free: 'f/b' } },
      });
      seedMode(iso.dir, 'off');
      const seen = await setupV2(iso.dir);

      // No primary turn yet (title usually runs first): the aux hook
      // resolves a pick on the spot and stamps the event for consistency
      // (the `http.request` overlay below is what reaches the wire).
      const early = { sessionID: 's9', model: { providerID: 'opencode', id: 'auto' } };
      await seen.title(early);
      assert.equal(early.model.providerID, 'f', 'resolved on the spot');
      assert.equal(early.model.id, 'b');

      // Primary turn resolves f/b…
      const e1 = { sessionID: 's1', model: { providerID: 'opencode', id: 'auto' }, messages: [], agent: 'review' };
      await seen.context(e1);
      assert.equal(e1.model.id, 'b');

      // …and aux requests now follow it on the event (the overlay below
      // is what reaches the wire).
      for (const name of ['title', 'compaction', 'generate']) {
        const e = { sessionID: 's1', model: { providerID: 'opencode', id: 'auto' } };
        await seen[name](e);
        assert.equal(e.model.providerID, 'f', `${name} re-pointed`);
        assert.equal(e.model.id, 'b', `${name} re-pointed`);
      }

      // Non-virtual sessions keep their own models here.
      const other = { sessionID: 's2', model: { providerID: 'opencode', id: 'x' } };
      await seen.title(other);
      assert.equal(other.model.id, 'x');
    } finally {
      iso.restore();
    }
  });

  it('suggestOnly keeps the virtual pick untouched (contract: change nothing)', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
      const seen = await setupV2(iso.dir, { suggestOnly: true });
      const e = { sessionID: 's1', model: { providerID: 'opencode', id: 'auto' }, messages: [], agent: 'review' };
      const origLog = console.log;
      console.log = () => {};
      try {
        await seen.context(e);
      } finally {
        console.log = origLog;
      }
      assert.equal(e.model.id, 'auto', 'unchanged');
      assert.deepEqual(seen.switches, []);
      const st = JSON.parse(fs.readFileSync(path.join(CACHE(iso.dir), 'status-s1.json'), 'utf8'));
      assert.equal(st.suggestOnly, true);
      assert.equal(st.model, 'f/b');
    } finally {
      iso.restore();
    }
  });

  it('free exhaustion arms a retry + re-points the event, never flipping the session', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
      seedMode(iso.dir, 'off'); // virtual bypasses the mode gate here too
      const seen = await setupV2(iso.dir);

      const e = { sessionID: 's1', model: { providerID: 'opencode', id: 'auto' }, messages: [], agent: 'review' };
      await seen.context(e);
      assert.deepEqual(seen.switches, [], 'precondition: still virtual');

      const r = {
        sessionID: 's1',
        agent: 'review',
        model: { providerID: 'f', id: 'b' },
        error: { type: 'rate_limit', message: '429 too many requests', status: 429 },
        attempt: 2,
        decision: { retry: false },
      };
      await seen.retry(r);
      assert.deepEqual(r.decision, { retry: true, delay: 0 }, 'forced retry armed');
      assert.deepEqual(
        r.model,
        { providerID: 'g', id: 'a' },
        'retry event re-pointed to the task go model in place',
      );
      assert.deepEqual(seen.switches, [], 'switchModel never fired: the session stays virtual');
      assert.equal(isFreeQuotaFresh(CACHE(iso.dir)), true, 'latch registered');
    } finally {
      iso.restore();
    }
  });

  it('announce gate: virtual sessions announce even in mode=off (from turn 2)', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
      seedMode(iso.dir, 'off');
      const seen = await setupV2(iso.dir);

      // First prompt: session not yet marked virtual (prompt runs before
      // context) and mode is off -> no announce. Documented first-turn gap.
      const p1 = { sessionID: 's1', prompt: { text: 'review this diff' } };
      await seen.prompt(p1);
      assert.equal(p1.prompt.text, 'review this diff', 'no announce before the context hook marks the session');

      const e = { sessionID: 's1', model: { providerID: 'opencode', id: 'auto' }, messages: [], agent: 'review' };
      await seen.context(e);
      assert.equal(e.model.id, 'b');

      // Next prompt: session is marked virtual -> announces like mode on.
      const p2 = { sessionID: 's1', prompt: { text: 'review this diff again' } };
      await seen.prompt(p2);
      assert.match(p2.prompt.text, /\[modelselect: task=review tier=free/);
      assert.match(p2.prompt.text, /f\/b/);
    } finally {
      iso.restore();
    }
  });
});

describe('virtual dispatch overlay', () => {
  const URL = 'https://opencode.ai/inference/openai/v1/chat/completions';
  // Same-provider seeds: the overlay can only rewrite the body when the
  // pick lives on the session model's provider (the endpoint is pinned).
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

  it('rewrites the outgoing body model for a virtual session (no persistence)', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, SAME);
      seedMode(iso.dir, 'off'); // virtual bypasses the mode
      const seen = await setupV2(iso.dir);

      const e1 = { sessionID: 's1', model: { providerID: 'opencode', id: 'auto' }, messages: [], agent: 'review' };
      await seen.context(e1);
      assert.equal(e1.model.id, 'fc');

      const h = httpEvent('s1', 'opencode', 'auto', 'auto');
      await seen['http.request'](h);
      assert.equal((await bodyOf(h)).model, 'fc', 'the wire carries the pick');
      assert.deepEqual(seen.switches, [], 'the session stays virtual');
    } finally {
      iso.restore();
    }
  });

  it('resolves on the spot when no primary turn has run yet (title-first)', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, SAME);
      const seen = await setupV2(iso.dir);

      const h = httpEvent('s9', 'opencode', 'auto', 'auto', 'title');
      await seen['http.request'](h);
      assert.equal((await bodyOf(h)).model, 'fc', 'title carries a live pick, never the raw ref');
      assert.deepEqual(seen.switches, []);
    } finally {
      iso.restore();
    }
  });

  it('re-resolves under a fresh exhaustion latch (armed retries stay live)', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, SAME);
      seedMode(iso.dir, 'off');
      const seen = await setupV2(iso.dir, { token: 'sk-test' });

      const e1 = { sessionID: 's1', model: { providerID: 'opencode', id: 'auto' }, messages: [], agent: 'review' };
      await seen.context(e1);
      assert.equal(e1.model.id, 'fc');

      markFreeQuota(CACHE(iso.dir), { model: 'opencode/fc', detail: 'http 402' });
      assert.equal(isFreeQuotaFresh(CACHE(iso.dir)), true, 'precondition: latch fresh');

      const h = httpEvent('s1', 'opencode', 'auto', 'auto');
      await seen['http.request'](h);
      assert.equal((await bodyOf(h)).model, 'gc', 'stale free pick refreshed to go');
      assert.deepEqual(seen.switches, [], 'still virtual: same provider');
    } finally {
      iso.restore();
    }
  });

  it('persists + unmarks on cross-provider picks (endpoint is pinned)', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
      seedMode(iso.dir, 'off');
      const seen = await setupV2(iso.dir);

      const e1 = { sessionID: 's1', model: { providerID: 'opencode', id: 'auto' }, messages: [], agent: 'review' };
      await seen.context(e1);

      const h = httpEvent('s1', 'opencode', 'auto', 'auto');
      await seen['http.request'](h);
      assert.deepEqual(
        seen.switches,
        [{ sessionID: 's1', model: { providerID: 'f', id: 'b' } }],
        'cross-provider pick persists: the session leaves virtual mode',
      );
      assert.equal((await bodyOf(h)).model, 'auto', 'in-flight body untouched');

      // After the persist the session dispatches its real model: skipped.
      const h2 = httpEvent('s1', 'f', 'b', 'b');
      await seen['http.request'](h2);
      assert.equal((await bodyOf(h2)).model, 'b');
      assert.equal(seen.switches.length, 1, 'no repeat persist');
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

      const e1 = { sessionID: 's1', model: { providerID: 'opencode', id: 'auto' }, messages: [], agent: 'review' };
      await seen.context(e1);
      const foreign = httpEvent('s1', 'opencode', 'auto', 'zzz');
      await seen['http.request'](foreign);
      assert.equal((await bodyOf(foreign)).model, 'zzz', 'only the virtual id is rewritten');

      const noReq = { sessionID: 's1', model: { providerID: 'opencode', id: 'auto' }, kind: 'primary' };
      await seen['http.request'](noReq);
      const garbage = {
        sessionID: 's1',
        model: { providerID: 'opencode', id: 'auto' },
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
