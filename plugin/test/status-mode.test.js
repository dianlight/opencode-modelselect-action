'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { normalizeOptions, resolveModel, clearQuotaCache } = require('../src/shared/select');
const { sanitizeSessionID, readMode, clearModeCache, writeStatus, statusFile } = require('../src/shared/status');

function seedCache(dir, config) {
  const cache = path.join(dir, '.opencode', '.modelselect-cache');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(
    path.join(cache, 'model-config-cache.json'),
    JSON.stringify({ fetchedAt: Date.now(), config }),
  );
}

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
        source: 'cache',
        suggestOnly: false,
      });
      assert.ok(payload.updatedAt >= before);
      const raw = JSON.parse(fs.readFileSync(statusFile(cacheDir, 's1'), 'utf8'));
      assert.deepEqual(raw, payload);
      assert.deepEqual(Object.keys(raw).sort(), [
        'goOk',
        'jev',
        'model',
        'sessionID',
        'source',
        'suggestOnly',
        'taskType',
        'tier',
        'updatedAt',
      ]);
      assert.equal(raw.sessionID, 's1');
      assert.equal(raw.taskType, 'review');
      assert.equal(raw.tier, 'free');
      assert.equal(raw.model, 'f/b');
      assert.equal(raw.jev, 'pinned');
      assert.equal(raw.goOk, null);
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
      const payload = writeStatus(cacheDir, '../evil/x y!', { model: 'f/b', goOk: 'yes', suggestOnly: 1 });
      assert.equal(payload.goOk, null);
      assert.equal(payload.suggestOnly, true);
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

  it('defaults to on when missing, invalid, or unknown', () => {
    clearModeCache();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-mode-'));
    try {
      assert.equal(readMode(path.join(dir, '.opencode', '.modelselect-cache')), 'on');
      assert.equal(readMode(seedMode(dir, 'not json{')), 'on');
      clearModeCache();
      assert.equal(readMode(seedMode(dir, {})), 'on');
      clearModeCache();
      assert.equal(readMode(seedMode(dir, { mode: 'sometimes' })), 'on');
      clearModeCache();
      assert.equal(readMode(seedMode(dir, { mode: 42 })), 'on');
    } finally {
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
});

describe('resolveModel goOk', () => {
  it('is null when no quota probe runs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-gook-'));
    seedCache(dir, { 'task-types': { code: { go: 'g/a', free: 'f/b' } } });
    try {
      clearQuotaCache();
      const cacheDir = path.join(dir, '.opencode', '.modelselect-cache');
      const explicit = await resolveModel({ taskType: 'code', opts: normalizeOptions({ tier: 'free' }), cacheDir });
      assert.equal(explicit.goOk, null);
      const prev = process.env.OPENCODE_API_KEY;
      delete process.env.OPENCODE_API_KEY;
      try {
        const auto = await resolveModel({
          taskType: 'code',
          opts: normalizeOptions({ tier: 'auto', token: '' }),
          cacheDir,
        });
        assert.equal(auto.tier, 'free');
        assert.equal(auto.goOk, null);
      } finally {
        if (prev !== undefined) process.env.OPENCODE_API_KEY = prev;
      }
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

describe('v1 status + mode', () => {
  function seedMode(dir, mode) {
    const cache = path.join(dir, '.opencode', '.modelselect-cache');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'mode.json'), JSON.stringify({ mode }));
    return cache;
  }

  function cacheOf(dir) {
    return path.join(dir, '.opencode', '.modelselect-cache');
  }

  function v1Turn(sessionID, model) {
    return {
      input: { sessionID, messageID: 'm' },
      output: {
        parts: [{ type: 'text', text: 'review this diff' }],
        message: { model: { providerID: model[0], modelID: model[1] } },
      },
    };
  }

  it('writes the status file on every routed turn', async () => {
    const v1 = require('../src/v1.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v1-status-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    try {
      const hooks = await v1.server({ directory: dir }, { tier: 'free', taskType: 'review' });
      const t = v1Turn('s1', ['old', 'old']);
      await hooks['chat.message'](t.input, t.output);
      const raw = JSON.parse(fs.readFileSync(path.join(cacheOf(dir), 'status-s1.json'), 'utf8'));
      assert.equal(raw.sessionID, 's1');
      assert.equal(raw.taskType, 'review');
      assert.equal(raw.tier, 'free');
      assert.equal(raw.model, 'f/b');
      assert.equal(raw.jev, 'pinned');
      assert.equal(raw.goOk, null);
      assert.equal(raw.source, 'cache');
      assert.equal(raw.suggestOnly, false);
      assert.equal(typeof raw.updatedAt, 'number');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('suggestOnly writes status without touching the model', async () => {
    const v1 = require('../src/v1.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v1-status-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    try {
      const hooks = await v1.server(
        { directory: dir },
        { tier: 'free', taskType: 'review', suggestOnly: true },
      );
      const origLog = console.log;
      console.log = () => {};
      const t = v1Turn('s1', ['old', 'old']);
      try {
        await hooks['chat.message'](t.input, t.output);
      } finally {
        console.log = origLog;
      }
      assert.equal(t.output.message.model.providerID, 'old');
      const raw = JSON.parse(fs.readFileSync(path.join(cacheOf(dir), 'status-s1.json'), 'utf8'));
      assert.equal(raw.suggestOnly, true);
      assert.equal(raw.model, 'f/b');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('off skips routing, announce, and status entirely', async () => {
    const v1 = require('../src/v1.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v1-mode-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    seedMode(dir, 'off');
    clearModeCache();
    try {
      const hooks = await v1.server({ directory: dir }, { tier: 'free', taskType: 'review' });
      const t = v1Turn('s1', ['old', 'old']);
      await hooks['chat.message'](t.input, t.output);
      assert.equal(t.output.message.model.providerID, 'old');
      assert.equal(t.output.message.model.modelID, 'old');
      assert.equal(t.output.parts.length, 1);
      assert.ok(!fs.existsSync(path.join(cacheOf(dir), 'status-s1.json')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('invalid mode falls back to on', async () => {
    const v1 = require('../src/v1.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v1-mode-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    const cache = seedMode(dir, 'sometimes');
    fs.writeFileSync(path.join(cache, 'mode.json'), 'broken{');
    clearModeCache();
    try {
      const hooks = await v1.server({ directory: dir }, { tier: 'free', taskType: 'review' });
      const t = v1Turn('s1', ['old', 'old']);
      await hooks['chat.message'](t.input, t.output);
      assert.equal(t.output.message.model.providerID, 'f');
      assert.ok(fs.existsSync(path.join(cacheOf(dir), 'status-s1.json')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('auto routes unmanaged turns and skips externally changed models', async () => {
    const v1 = require('../src/v1.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v1-mode-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    seedMode(dir, 'auto');
    clearModeCache();
    try {
      const hooks = await v1.server({ directory: dir }, { tier: 'free', taskType: 'review' });
      const t1 = v1Turn('s1', ['old', 'old']);
      await hooks['chat.message'](t1.input, t1.output);
      assert.equal(t1.output.message.model.providerID, 'f');
      const afterFirst = JSON.parse(fs.readFileSync(path.join(cacheOf(dir), 'status-s1.json'), 'utf8'));
      // Same model as applied: still managed, routes again.
      const t2 = v1Turn('s1', ['f', 'b']);
      await hooks['chat.message'](t2.input, t2.output);
      assert.equal(t2.output.message.model.providerID, 'f');
      // Externally changed model: skipped, nothing touched or announced.
      const t3 = v1Turn('s1', ['user', 'x']);
      await hooks['chat.message'](t3.input, t3.output);
      assert.equal(t3.output.message.model.providerID, 'user');
      assert.equal(t3.output.message.model.modelID, 'x');
      assert.equal(t3.output.parts.length, 1);
      const afterSkip = JSON.parse(fs.readFileSync(path.join(cacheOf(dir), 'status-s1.json'), 'utf8'));
      assert.equal(afterSkip.model, afterFirst.model);
    } finally {
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
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
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

  it('auto routes the first turn then skips externally changed models', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-mode-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    seedMode(dir, 'auto');
    try {
      const seen = await v2Hooks(dir, {});
      const e1 = { sessionID: 's1', prompt: 'review this diff' };
      await seen.prompt(e1);
      assert.match(e1.prompt, /\[modelselect: task=review tier=free → f\/b/);
      const ev1 = { sessionID: 's1', agent: 'review', model: { providerID: 'old', id: 'old' }, messages: [] };
      await seen.context(ev1);
      assert.equal(ev1.model.providerID, 'f');
      assert.deepEqual(seen.switched, { sessionID: 's1', model: { providerID: 'f', id: 'b' } });
      // Later prompt turns stay quiet in auto mode (context hook owns them).
      const e2 = { sessionID: 's1', prompt: 'review this diff' };
      await seen.prompt(e2);
      assert.equal(e2.prompt, 'review this diff');
      // Same model as applied: still managed, routes again.
      const ev2 = { sessionID: 's1', agent: 'review', model: { providerID: 'f', id: 'b' }, messages: [] };
      await seen.context(ev2);
      assert.equal(ev2.model.providerID, 'f');
      // Externally changed model: skipped, nothing persisted or announced.
      const ev3 = { sessionID: 's1', agent: 'review', model: { providerID: 'user', id: 'x' }, messages: [] };
      await seen.context(ev3);
      assert.equal(ev3.model.providerID, 'user');
      assert.equal(ev3.model.id, 'x');
      assert.equal(seen.switches, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
