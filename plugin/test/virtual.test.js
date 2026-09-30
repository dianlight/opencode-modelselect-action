'use strict';

/**
 * v2 virtual model (`modelselect/auto`) + `/modelselect` command.
 *
 * - Registration is standalone-only (option → env → session map decide
 *   the host) and uses literal @opencode/schema shapes.
 * - A virtual pick routes like mode `on` in every mode, mutates the
 *   in-flight ref, and never persists (switchModel must never fire —
 *   otherwise the session would stop re-routing).
 * - Free-exhaustion on a virtual session arms the forced retry and
 *   re-points the retry event in place instead of flipping the session.
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
const { isFreeQuotaFresh } = require('../src/shared/freequota');

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
    fakeCtx.provider = {
      async transform(cb) {
        const added = [];
        cb({ add: (x) => added.push(x) });
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
  it('registers modelselect/auto with schema literal shapes when standalone', async () => {
    const iso = withIsolation(undefined);
    try {
      const seen = await setupV2(iso.dir);
      assert.ok(seen.providerAdded, 'provider transform ran');
      assert.equal(seen.providerAdded.length, 1);
      assert.deepEqual(seen.providerAdded[0].info, {
        id: 'modelselect',
        name: 'ModelSelect',
        activation: 'enabled',
        package: '',
      });
      const m = seen.providerAdded[0].models[0];
      assert.equal(m.id, 'auto');
      assert.equal(m.modelID, 'auto');
      assert.equal(m.providerID, 'modelselect');
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
      assert.ok(seen.providerAdded, 'stale map -> standalone -> registered');
    } finally {
      iso.restore();
    }
  });

  it('option beats env and map in both directions', async () => {
    let iso = withIsolation('1'); // env says OpenChamber
    try {
      const seen = await setupV2(iso.dir, { openchamber: 'off' });
      assert.ok(seen.providerAdded, "option 'off' forces standalone despite env");
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
      assert.ok(seen.providerAdded, "env '0' forces standalone despite map");
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

      const e1 = { sessionID: 's1', model: { providerID: 'modelselect', id: 'auto' }, messages: [], agent: 'review' };
      await seen.context(e1);
      assert.equal(e1.model.providerID, 'f', 'in-flight ref mutated to the real model');
      assert.equal(e1.model.id, 'b');
      assert.deepEqual(seen.switches, [], 'virtual picks never persist');

      const st = JSON.parse(fs.readFileSync(path.join(CACHE(iso.dir), 'status-s1.json'), 'utf8'));
      assert.equal(st.taskType, 'review');
      assert.equal(st.model, 'f/b');

      // Turn 2 still starts from the virtual pick: the session model was
      // never switched away, so it re-routes every turn.
      const e2 = { sessionID: 's1', model: { providerID: 'modelselect', id: 'auto' }, messages: [], agent: 'review' };
      await seen.context(e2);
      assert.equal(e2.model.id, 'b');
      assert.deepEqual(seen.switches, [], 'still no persistence on turn 2');
    } finally {
      iso.restore();
    }
  });

  it('suggestOnly keeps the virtual pick untouched (contract: change nothing)', async () => {
    const iso = withIsolation(undefined);
    try {
      seedCache(iso.dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
      const seen = await setupV2(iso.dir, { suggestOnly: true });
      const e = { sessionID: 's1', model: { providerID: 'modelselect', id: 'auto' }, messages: [], agent: 'review' };
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

      const e = { sessionID: 's1', model: { providerID: 'modelselect', id: 'auto' }, messages: [], agent: 'review' };
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

      const e = { sessionID: 's1', model: { providerID: 'modelselect', id: 'auto' }, messages: [], agent: 'review' };
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
