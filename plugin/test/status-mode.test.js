'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { normalizeOptions, resolveModel, clearQuotaCache } = require('../src/shared/select');
const { sanitizeSessionID, readMode, clearModeCache, writeMode, writeStatus, statusFile } = require('../src/shared/status');
const { seedCache, seedTaskTypes, isolateAuth } = require('./helpers');

describe('status file helpers', () => {
  it('sanitizes session IDs to [A-Za-z0-9-_]', () => {
    assert.equal(sanitizeSessionID('abc-XYZ_09'), 'abc-XYZ_09');
    assert.equal(sanitizeSessionID('a/b\\c:d e!f'), 'a_b_c_d_e_f');
    assert.equal(sanitizeSessionID('ses_123-abc'), 'ses_123-abc');
  });

  it('falls back to default on empty/missing IDs and caps length', () => {
    assert.equal(sanitizeSessionID(''), 'default');
    assert.equal(sanitizeSessionID(undefined), 'default');
    assert.equal(sanitizeSessionID('...'), '___');
    assert.equal(sanitizeSessionID('x'.repeat(200)).length, 128);
  });

  it('writes the full status schema', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-status-'));
    try {
      const cacheDir = path.join(dir, '.opencode', '.modelselect-cache');
      const before = Date.now();
      const payload = writeStatus(cacheDir, 's1', {
        taskType: 'review',
        tier: 'free',
        model: 'f/b',
        jev: 'pinned',
        goOk: null,
        think: 'high',
        source: 'cache',
        suggestOnly: false,
      });
      assert.ok(payload.updatedAt >= before);
      const raw = JSON.parse(fs.readFileSync(statusFile(cacheDir, 's1'), 'utf8'));
      assert.deepEqual(raw, payload);
      assert.deepEqual(Object.keys(raw).sort(), [
        'freeExhausted',
        'goOk',
        'jev',
        'model',
        'sessionID',
        'source',
        'suggestOnly',
        'taskType',
        'think',
        'tier',
        'updatedAt',
      ]);
      assert.equal(raw.sessionID, 's1');
      assert.equal(raw.taskType, 'review');
      assert.equal(raw.tier, 'free');
      assert.equal(raw.model, 'f/b');
      assert.equal(raw.jev, 'pinned');
      assert.equal(raw.goOk, null);
      assert.equal(raw.think, 'high');
      assert.equal(raw.freeExhausted, null);
      assert.equal(raw.source, 'cache');
      assert.equal(raw.suggestOnly, false);
      assert.equal(typeof raw.updatedAt, 'number');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('normalizes goOk/suggestOnly and keeps hostile IDs inside the cache dir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-status-'));
    try {
      const cacheDir = path.join(dir, '.opencode', '.modelselect-cache');
      const payload = writeStatus(cacheDir, '../evil/x y!', { model: 'f/b', goOk: 'yes', suggestOnly: 1, think: 'extreme' });
      assert.equal(payload.goOk, null);
      assert.equal(payload.suggestOnly, true);
      assert.equal(payload.think, null);
      const upper = writeStatus(cacheDir, 's2', { model: 'f/b', think: 'MEDIUM' });
      assert.equal(upper.think, 'medium');
      const xhigh = writeStatus(cacheDir, 's3', { model: 'f/b', think: 'XHIGH' });
      assert.equal(xhigh.think, 'xhigh');
      const def = writeStatus(cacheDir, 's4', { model: 'f/b', think: 'DEFAULT' });
      assert.equal(def.think, 'default');
      assert.equal(payload.sessionID, '../evil/x y!');
      assert.ok(fs.existsSync(path.join(cacheDir, 'status-___evil_x_y_.json')));
      assert.deepEqual(fs.readdirSync(dir), ['.opencode']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never throws when the cache dir is unusable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-status-'));
    try {
      const blocker = path.join(dir, 'blocker');
      fs.writeFileSync(blocker, 'x');
      assert.equal(writeStatus(path.join(blocker, 'sub'), 's', { model: 'f/b' }), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('mode file', () => {
  function seedMode(dir, body) {
    const cache = path.join(dir, '.opencode', '.modelselect-cache');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'mode.json'), typeof body === 'string' ? body : JSON.stringify(body));
    return cache;
  }

  it('defaults to auto when missing, invalid, or unknown', () => {
    clearModeCache();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-mode-'));
    const restoreHome = (() => {
      const saved = process.env.HOME;
      process.env.HOME = dir;
      return () => {
        if (saved === undefined) delete process.env.HOME;
        else process.env.HOME = saved;
      };
    })();
    try {
      assert.equal(readMode(path.join(dir, '.opencode', '.modelselect-cache')), 'auto');
      assert.equal(readMode(seedMode(dir, 'not json{')), 'auto');
      clearModeCache();
      assert.equal(readMode(seedMode(dir, {})), 'auto');
      clearModeCache();
      assert.equal(readMode(seedMode(dir, { mode: 'sometimes' })), 'auto');
      clearModeCache();
      assert.equal(readMode(seedMode(dir, { mode: 42 })), 'auto');
    } finally {
      restoreHome();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the global modelselect.json mode when the cache file is missing', () => {
    clearModeCache();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-mode-global-'));
    const saved = process.env.HOME;
    process.env.HOME = dir;
    try {
      const cfg = path.join(dir, '.config', 'openchamber');
      fs.mkdirSync(cfg, { recursive: true });
      fs.writeFileSync(path.join(cfg, 'modelselect.json'), JSON.stringify({ mode: 'off' }));
      assert.equal(readMode(path.join(dir, '.opencode', '.modelselect-cache')), 'off');
    } finally {
      if (saved === undefined) delete process.env.HOME;
      else process.env.HOME = saved;
      clearModeCache();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads on/off/auto (case-insensitive) and tracks rewrites', () => {
    clearModeCache();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-mode-'));
    try {
      assert.equal(readMode(seedMode(dir, { mode: 'off' })), 'off');
      clearModeCache();
      assert.equal(readMode(seedMode(dir, { mode: 'auto' })), 'auto');
      clearModeCache();
      assert.equal(readMode(seedMode(dir, { mode: 'ON' })), 'on');
      const cache = seedMode(dir, { mode: 'off' });
      clearModeCache();
      assert.equal(readMode(cache), 'off');
      fs.writeFileSync(path.join(cache, 'mode.json'), JSON.stringify({ mode: 'on' }));
      assert.equal(readMode(cache), 'on');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writeMode persists valid modes and rejects invalid ones', () => {
    clearModeCache();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-mode-write-'));
    try {
      const cache = path.join(dir, '.opencode', '.modelselect-cache');
      assert.equal(writeMode(cache, 'off'), true);
      assert.equal(readMode(cache), 'off');
      assert.equal(writeMode(cache, 'ON'), true, 'case-insensitive');
      assert.equal(readMode(cache), 'on');
      assert.equal(writeMode(cache, 'sometimes'), false);
      assert.equal(writeMode(cache, undefined), false);
      assert.equal(writeMode(cache, { mode: 'off' }), false);
      assert.equal(readMode(cache), 'on', 'rejected writes leave the mode alone');
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cache, 'mode.json'), 'utf8')), { mode: 'on' });
    } finally {
      clearModeCache();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveModel goOk', () => {
  it('is null when no quota probe runs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-gook-'));
    seedCache(dir, { 'task-types': { code: { go: 'g/a', free: 'f/b' } } });
    const restoreAuth = isolateAuth(dir);
    try {
      clearQuotaCache();
      const cacheDir = path.join(dir, '.opencode', '.modelselect-cache');
      const explicit = await resolveModel({ taskType: 'code', opts: normalizeOptions({ tier: 'free' }), cacheDir });
      assert.equal(explicit.goOk, null);
      const auto = await resolveModel({
        taskType: 'code',
        opts: normalizeOptions({ tier: 'auto', token: '' }),
        cacheDir,
      });
      assert.equal(auto.tier, 'free');
      assert.equal(auto.goOk, null);
    } finally {
      restoreAuth();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('carries think from the config entry (invalid/absent -> null)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-think-'));
    seedCache(dir, {
      'task-types': {
        code: { go: 'g/a', free: 'f/b', think: 'high' },
        docs: { go: 'g/a', free: 'f/b', think: 'extreme' },
        plan: { go: 'g/a', free: 'f/b' },
        'small-model': { go: 'g/a', free: 'f/b', think: 'minimal' },
      },
    });
    try {
      const cacheDir = path.join(dir, '.opencode', '.modelselect-cache');
      const opts = normalizeOptions({ tier: 'free' });
      const withThink = await resolveModel({ taskType: 'code', opts, cacheDir });
      assert.equal(withThink.think, 'high');
      const invalid = await resolveModel({ taskType: 'docs', opts, cacheDir });
      assert.equal(invalid.think, null);
      const absent = await resolveModel({ taskType: 'plan', opts, cacheDir });
      assert.equal(absent.think, null);
      const minimal = await resolveModel({ taskType: 'small-model', opts, cacheDir });
      assert.equal(minimal.think, 'minimal');
      const fallback = await resolveModel({
        taskType: 'nope',
        opts: normalizeOptions({ tier: 'free', fallbackModel: 'g/fallback' }),
        cacheDir,
      });
      assert.equal(fallback.think, null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('carries the probe result when tier auto probes quota', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-gook-'));
    seedCache(dir, { 'task-types': { code: { go: 'g/a', free: 'f/b' } } });
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ status: 401, ok: false });
    try {
      clearQuotaCache();
      const opts = normalizeOptions({ tier: 'auto', token: 'gook-probe-token' });
      const { tier, model, goOk } = await resolveModel({
        taskType: 'code',
        opts,
        cacheDir: path.join(dir, '.opencode', '.modelselect-cache'),
      });
      assert.equal(goOk, false);
      assert.equal(tier, 'free');
      assert.equal(model, 'f/b');
    } finally {
      globalThis.fetch = realFetch;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('v2 status + mode', () => {
  function seedMode(dir, mode) {
    const cache = path.join(dir, '.opencode', '.modelselect-cache');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'mode.json'), JSON.stringify({ mode }));
    return cache;
  }

  function cacheOf(dir) {
    return path.join(dir, '.opencode', '.modelselect-cache');
  }

  async function v2Hooks(dir, opts) {
    const v2 = require('../src/v2.js');
    clearModeCache();
    const seen = {};
    const fakeCtx = {
      options: { tier: 'free', taskType: 'review', ...opts },
      location: { directory: dir },
      session: {
        async hook(name, cb) {
          seen[name] = cb;
        },
        async switchModel(input) {
          seen.switched = input;
          seen.switches = (seen.switches ?? 0) + 1;
        },
      },
    };
    await v2.setup(fakeCtx);
    return seen;
  }

  it('writes the status file on context routing, incl. suggestOnly', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-status-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b', think: 'high' } } });
    try {
      const seen = await v2Hooks(dir, {});
      await seen.prompt({ sessionID: 's1', prompt: 'review this diff' });
      const event = { sessionID: 's1', agent: 'review', model: { providerID: 'old', id: 'old' }, messages: [] };
      await seen.context(event);
      assert.equal(event.model.providerID, 'f');
      const raw = JSON.parse(fs.readFileSync(path.join(cacheOf(dir), 'status-s1.json'), 'utf8'));
      assert.equal(raw.sessionID, 's1');
      assert.equal(raw.taskType, 'review');
      assert.equal(raw.tier, 'free');
      assert.equal(raw.model, 'f/b');
      assert.equal(raw.jev, 'pinned');
      assert.equal(raw.goOk, null);
      assert.equal(raw.think, 'high');
      assert.equal(raw.source, 'cache');
      assert.equal(raw.suggestOnly, false);
      assert.equal(typeof raw.updatedAt, 'number');

      const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-status-'));
      seedCache(dir2, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
      try {
        const seen2 = await v2Hooks(dir2, { suggestOnly: true });
        await seen2.prompt({ sessionID: 's1', prompt: 'review this diff' });
        const ev2 = { sessionID: 's1', agent: 'review', model: { providerID: 'old', id: 'old' }, messages: [] };
        const origLog = console.log;
        console.log = () => {};
        try {
          await seen2.context(ev2);
        } finally {
          console.log = origLog;
        }
        assert.equal(ev2.model.providerID, 'old');
        const raw2 = JSON.parse(fs.readFileSync(path.join(cacheOf(dir2), 'status-s1.json'), 'utf8'));
        assert.equal(raw2.suggestOnly, true);
        assert.equal(raw2.model, 'f/b');
      } finally {
        fs.rmSync(dir2, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('off skips prompt announce, mutation, persistence, and status', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-mode-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    seedMode(dir, 'off');
    try {
      const seen = await v2Hooks(dir, {});
      const e1 = { sessionID: 's1', prompt: 'review this diff' };
      await seen.prompt(e1);
      assert.equal(e1.prompt, 'review this diff');
      const event = { sessionID: 's1', agent: 'review', model: { providerID: 'old', id: 'old' }, messages: [] };
      await seen.context(event);
      assert.equal(event.model.providerID, 'old');
      assert.equal(event.model.id, 'old');
      assert.equal(seen.switched, undefined);
      assert.ok(!fs.existsSync(path.join(cacheOf(dir), 'status-s1.json')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // The routing sync resolves `~` against the user home, so every test
  // that can trigger a write points $HOME at a temp dir first — never the
  // real ~/.config/openchamber/routing.json. The dir is pre-created: the
  // adapter never mkdirs OpenChamber's config (absent dir = never ran).
  function isolateHome() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-home-'));
    fs.mkdirSync(path.join(home, '.config', 'openchamber'), { recursive: true });
    const prev = process.env.HOME;
    process.env.HOME = home;
    return {
      home,
      restore() {
        if (prev === undefined) delete process.env.HOME;
        else process.env.HOME = prev;
        fs.rmSync(home, { recursive: true, force: true });
      },
    };
  }

  it('auto routes like on (announce + mutate + status) and still syncs OpenChamber routing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-mode-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    seedTaskTypes(dir, {
      review: { label: 'Review', description: 'Review', jev_criteria: 'Review work: judge diffs.' },
    });
    seedMode(dir, 'auto');
    const home = isolateHome();
    try {
      const seen = await v2Hooks(dir, {});
      // Prompt: auto announces like on — no OpenChamber hand-off anymore.
      const e1 = { sessionID: 's1', prompt: 'review this diff' };
      await seen.prompt(e1);
      assert.match(
        typeof e1.prompt === 'string' ? e1.prompt : String(e1.prompt && e1.prompt.text),
        /\[modelselect: task=review tier=free → f\/b/,
        'auto announces the pick',
      );
      // Context: routes + persists + writes the status file.
      const ev1 = {
        sessionID: 's1',
        agent: 'review',
        model: { providerID: 'old', id: 'old' },
        messages: [],
      };
      await seen.context(ev1);
      assert.equal(ev1.model.providerID, 'f');
      assert.equal(ev1.model.id, 'b');
      assert.equal(seen.switches, 1, 'the pick is persisted like mode on');
      const raw = JSON.parse(fs.readFileSync(path.join(cacheOf(dir), 'status-s1.json'), 'utf8'));
      assert.equal(raw.model, 'f/b');
      // The courtesy sync still landed: fresh category from the caches.
      const routingFile = path.join(home.home, '.config', 'openchamber', 'routing.json');
      const routing = JSON.parse(fs.readFileSync(routingFile, 'utf8'));
      assert.equal(routing.version, 1);
      assert.equal(routing.categories.review.builtin, false);
      assert.equal(routing.categories.review.description, 'Review work: judge diffs.');
      assert.deepEqual(routing.categories.review.model, { providerID: 'f', modelID: 'b' });
    } finally {
      home.restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('off also refreshes routing (sync runs before the mode check) but routes nothing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-mode-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    seedTaskTypes(dir, {
      review: { label: 'Review', description: 'Review', jev_criteria: 'Review work: judge diffs.' },
    });
    seedMode(dir, 'off');
    const home = isolateHome();
    try {
      const seen = await v2Hooks(dir, {});
      const e1 = { sessionID: 's1', prompt: 'review this diff' };
      await seen.prompt(e1);
      assert.equal(e1.prompt, 'review this diff');
      const ev1 = {
        sessionID: 's1',
        agent: 'review',
        model: { providerID: 'old', id: 'old' },
        messages: [],
      };
      await seen.context(ev1);
      assert.equal(ev1.model.providerID, 'old');
      assert.equal(seen.switched, undefined);
      assert.ok(!fs.existsSync(path.join(cacheOf(dir), 'status-s1.json')));
      const routingFile = path.join(home.home, '.config', 'openchamber', 'routing.json');
      assert.ok(fs.existsSync(routingFile), 'sync runs before the mode check');
    } finally {
      home.restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
