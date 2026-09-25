'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { inferTaskType } = require('../src/shared/detect');
const { normalizeOptions, formatAnnounce, loadConfig, resolveModel, splitModelRef, clearQuotaCache } = require('../src/shared/select');

function seedCache(dir, config) {
  const cache = path.join(dir, '.opencode', '.modelselect-cache');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(
    path.join(cache, 'model-config-cache.json'),
    JSON.stringify({ fetchedAt: Date.now(), config }),
  );
}

describe('detect heuristics', () => {
  it('small-model fast-path wins on commit prompts', () => {
    const { taskType } = inferTaskType({ prompt: 'generate a commit message for this diff' });
    assert.equal(taskType, 'small-model');
  });

  it('review prompt beats generic repo signals', () => {
    const { taskType } = inferTaskType({
      prompt: 'review this pull request diff',
      files: ['src/index.ts'],
      repo: { stackFiles: ['package.json'], hasUI: false, hasE2E: false, hasMech: false, fileCount: 120 },
    });
    assert.equal(taskType, 'review');
  });

  it('agent tag boosts but a clear prompt wins', () => {
    const { taskType } = inferTaskType({ prompt: 'review this diff', agent: 'docs' });
    assert.equal(taskType, 'review');
  });

  it('fixed task-type overrides everything', () => {
    const { taskType, override } = inferTaskType({ prompt: 'review this diff', fixedTaskType: 'plan' });
    assert.equal(taskType, 'plan');
    assert.equal(override, true);
  });

  it('empty signals fall back to generic', () => {
    const { taskType } = inferTaskType({});
    assert.equal(taskType, 'generic');
  });

  it('defaultTaskType replaces the generic fallback', () => {
    const { taskType } = inferTaskType({ defaultTaskType: 'docs' });
    assert.equal(taskType, 'docs');
  });

  it('rejects an unknown defaultTaskType', () => {
    assert.throws(() => inferTaskType({ defaultTaskType: 'nope' }));
  });

  it('agentTaskMap pin beats a clear prompt', () => {
    const { taskType } = inferTaskType({
      prompt: 'review this diff',
      agent: 'writer',
      agentTaskMap: { writer: 'docs' },
    });
    assert.equal(taskType, 'docs');
  });

  it('agentTaskMap keys are case-insensitive', () => {
    const { taskType } = inferTaskType({
      prompt: 'hello',
      agent: 'Reviewer',
      agentTaskMap: { reviewer: 'review' },
    });
    assert.equal(taskType, 'review');
  });

  it('agentTaskMap pin beats the small-model fast-path', () => {
    const { taskType } = inferTaskType({
      prompt: 'generate a commit message for this diff',
      agent: 'reviewer',
      agentTaskMap: { reviewer: 'review' },
    });
    assert.equal(taskType, 'review');
  });

  it('fixed taskType still beats the agent map', () => {
    const { taskType } = inferTaskType({
      prompt: 'review this diff',
      agent: 'writer',
      fixedTaskType: 'plan',
      agentTaskMap: { writer: 'docs' },
    });
    assert.equal(taskType, 'plan');
  });

  it('ties fall back to generic', () => {
    const { taskType } = inferTaskType({ prompt: 'plan the review of this diff' });
    assert.equal(taskType, 'generic');
  });

  it('ties fall back to defaultTaskType when set', () => {
    const { taskType } = inferTaskType({ prompt: 'plan the review of this diff', defaultTaskType: 'docs' });
    assert.equal(taskType, 'docs');
  });

  it('a repo-only baseline never decides alone', () => {
    const { taskType } = inferTaskType({
      prompt: '',
      files: [],
      repo: { stackFiles: ['package.json'], hasUI: false, hasE2E: false, hasMech: false, fileCount: 120 },
    });
    assert.equal(taskType, 'generic');
  });

  it('rejects unknown types in agentTaskMap', () => {
    assert.throws(() => inferTaskType({ agent: 'x', agentTaskMap: { x: 'nope' } }));
    assert.throws(() => normalizeOptions({ agentTaskMap: { x: 'nope' } }));
  });
});

describe('select options + cache', () => {
  it('defaults to 24h refresh', () => {
    assert.equal(normalizeOptions({}).configRefreshMinutes, 1440);
  });

  it('accepts 0 for always-refetch', () => {
    assert.equal(normalizeOptions({ configRefreshMinutes: 0 }).configRefreshMinutes, 0);
  });

  it('rejects negative refresh', () => {
    assert.throws(() => normalizeOptions({ configRefreshMinutes: -1 }));
  });

  it('defaults suggestOnly to false and accepts aliases', () => {
    assert.equal(normalizeOptions({}).suggestOnly, false);
    assert.equal(normalizeOptions({ suggestOnly: true }).suggestOnly, true);
    assert.equal(normalizeOptions({ 'suggest-only': true }).suggestOnly, true);
    assert.equal(normalizeOptions({ suggest_only: true }).suggestOnly, true);
  });

  it('defaults defaultTaskType/agentTaskMap and validates them', () => {
    const opts = normalizeOptions({});
    assert.equal(opts.defaultTaskType, 'generic');
    assert.deepEqual(opts.agentTaskMap, {});
    assert.equal(normalizeOptions({ defaultTaskType: 'docs' }).defaultTaskType, 'docs');
    assert.deepEqual(normalizeOptions({ agentTaskMap: { Writer: 'docs' } }).agentTaskMap, {
      writer: 'docs',
    });
    assert.throws(() => normalizeOptions({ defaultTaskType: 'nope' }));
  });

  it('empty token falls back to OPENCODE_API_KEY', () => {
    const prev = process.env.OPENCODE_API_KEY;
    process.env.OPENCODE_API_KEY = 'env-key';
    try {
      assert.equal(normalizeOptions({ token: '' }).token, 'env-key');
      assert.equal(normalizeOptions({}).token, 'env-key');
      assert.equal(normalizeOptions({ token: 'explicit' }).token, 'explicit');
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_API_KEY;
      else process.env.OPENCODE_API_KEY = prev;
    }
  });

  it('free-first stays on free when Go quota is unusable', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-tier-'));
    seedCache(dir, { 'task-types': { code: { go: 'g/a', free: 'f/b' } } });
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ status: 401, ok: false });
    try {
      clearQuotaCache();
      const opts = normalizeOptions({ tier: 'auto', autoPreference: 'free-first', token: 'bad-token' });
      const { model, tier } = await resolveModel({ taskType: 'code', opts, cacheDir: path.join(dir, '.opencode', '.modelselect-cache') });
      assert.equal(tier, 'free');
      assert.equal(model, 'f/b');
    } finally {
      globalThis.fetch = realFetch;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('caches the Go quota probe per token', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-quota-'));
    seedCache(dir, { 'task-types': { code: { go: 'g/a', free: 'f/b' } } });
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      calls += 1;
      return { status: 401, ok: false };
    };
    try {
      clearQuotaCache();
      const cacheDir = path.join(dir, '.opencode', '.modelselect-cache');
      const opts = normalizeOptions({ tier: 'auto', autoPreference: 'free-first', token: 'tok' });
      await resolveModel({ taskType: 'code', opts, cacheDir });
      await resolveModel({ taskType: 'code', opts, cacheDir });
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = realFetch;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it('uses fresh cache without network', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-'));
    const config = { 'task-types': { plan: { go: 'g', free: 'f' } } };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'model-config-cache.json'),
      JSON.stringify({ fetchedAt: Date.now(), config }),
    );
    const opts = normalizeOptions({});
    const { config: got, source } = await loadConfig(opts, dir);
    assert.equal(source, 'cache');
    assert.deepEqual(got, config);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('splits provider/model refs (modelID may contain slashes)', () => {
    assert.deepEqual(splitModelRef('opencode/muse-spark-free'), {
      providerID: 'opencode',
      id: 'muse-spark-free',
    });
    assert.deepEqual(splitModelRef('acme/a/b'), { providerID: 'acme', id: 'a/b' });
    assert.throws(() => splitModelRef('bare'));
  });
});

describe('v1 routing hook', () => {
  it('mutates output.message.model in place via chat.message', async () => {
    const v1 = require('../src/v1.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v1-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    const hooks = await v1.server({ directory: dir }, { tier: 'free', taskType: 'review' });
    assert.ok(hooks['chat.message']);
    assert.ok(!hooks['chat.params'], 'chat.params cannot route (no model field in output)');
    const target = { providerID: 'old', modelID: 'old' };
    await hooks['chat.message'](
      { sessionID: 's1' },
      { parts: [{ type: 'text', text: 'review this diff' }], message: { model: target } },
    );
    assert.equal(target.providerID, 'f');
    assert.equal(target.modelID, 'b');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('suggestOnly logs the pick without touching the model', async () => {
    const v1 = require('../src/v1.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v1-suggest-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    const hooks = await v1.server(
      { directory: dir },
      { tier: 'free', taskType: 'review', suggestOnly: true },
    );
    const target = { providerID: 'old', modelID: 'old' };
    const lines = [];
    const origLog = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
      await hooks['chat.message'](
        { sessionID: 's1' },
        { parts: [{ type: 'text', text: 'review this diff' }], message: { model: target } },
      );
    } finally {
      console.log = origLog;
    }
    assert.equal(target.providerID, 'old');
    assert.equal(target.modelID, 'old');
    assert.match(lines.join('\n'), /\(suggest-only\).*would-select=f\/b/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('announce option', () => {
  it('defaults to switch and accepts always/off', () => {
    assert.equal(normalizeOptions({}).announce, 'switch');
    assert.equal(normalizeOptions({ announce: 'always' }).announce, 'always');
    assert.equal(normalizeOptions({ announce: 'OFF' }).announce, 'off');
  });

  it('rejects invalid values like tier does', () => {
    assert.throws(() => normalizeOptions({ announce: 'sometimes' }));
  });

  it('formats the terse line, with would-use wording in suggestOnly', () => {
    assert.equal(
      formatAnnounce({ taskType: 'review', tier: 'free', model: 'f/b', suggestOnly: false }),
      '[modelselect: task=review tier=free → f/b]',
    );
    assert.equal(
      formatAnnounce({ taskType: 'review', tier: 'free', model: 'f/b', suggestOnly: true }),
      '[modelselect: task=review tier=free would use f/b]',
    );
  });
});

describe('v1 announce', () => {
  async function v1Hooks(dir, opts) {
    const v1 = require('../src/v1.js');
    return v1.server({ directory: dir }, { tier: 'free', taskType: 'review', ...opts });
  }

  function v1Turn(msgId) {
    return {
      input: { sessionID: 's1', messageID: msgId },
      output: {
        parts: [{ type: 'text', text: 'review this diff' }],
        message: { model: { providerID: 'old', modelID: 'old' } },
      },
    };
  }

  it('switch mode announces the first turn and dedups the second', async () => {
    const v1 = require('../src/v1.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v1-ann-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    try {
      const hooks = await v1.server({ directory: dir }, { tier: 'free', taskType: 'review' });
      const t1 = v1Turn('m1');
      await hooks['chat.message'](t1.input, t1.output);
      assert.equal(t1.output.parts.length, 2);
      const ann = t1.output.parts[1];
      assert.equal(ann.type, 'text');
      assert.equal(ann.ignored, true);
      assert.equal(ann.sessionID, 's1');
      assert.equal(ann.messageID, 'm1');
      assert.ok(typeof ann.id === 'string' && ann.id.length > 0);
      assert.equal(ann.text, '[modelselect: task=review tier=free → f/b]');
      assert.equal(t1.output.message.model.providerID, 'f');
      const t2 = v1Turn('m2');
      await hooks['chat.message'](t2.input, t2.output);
      assert.equal(t2.output.parts.length, 1, 'identical second turn emits nothing');
      assert.equal(t2.output.message.model.providerID, 'f');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('always mode announces every identical turn', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v1-always-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    try {
      const hooks = await v1Hooks(dir, { announce: 'always' });
      const t1 = v1Turn('m1');
      await hooks['chat.message'](t1.input, t1.output);
      const t2 = v1Turn('m2');
      await hooks['chat.message'](t2.input, t2.output);
      assert.equal(t1.output.parts.length, 2);
      assert.equal(t2.output.parts.length, 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('off mode keeps console-only behavior with routing intact', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v1-off-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    try {
      const hooks = await v1Hooks(dir, { announce: 'off' });
      const t1 = v1Turn('m1');
      await hooks['chat.message'](t1.input, t1.output);
      assert.equal(t1.output.parts.length, 1);
      assert.equal(t1.output.message.model.providerID, 'f');
      assert.equal(t1.output.message.model.modelID, 'b');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('suggestOnly announces with would-use wording without touching the model', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v1-suggest-ann-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    try {
      const hooks = await v1Hooks(dir, { suggestOnly: true });
      const lines = [];
      const origLog = console.log;
      console.log = (...args) => lines.push(args.join(' '));
      const t1 = v1Turn('m1');
      try {
        await hooks['chat.message'](t1.input, t1.output);
      } finally {
        console.log = origLog;
      }
      assert.equal(t1.output.message.model.providerID, 'old');
      assert.equal(t1.output.parts.length, 2);
      assert.equal(t1.output.parts[1].text, '[modelselect: task=review tier=free would use f/b]');
      assert.match(lines.join('\n'), /\(suggest-only\).*would-select=f\/b/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('announce failure does not break routing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v1-annfail-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    try {
      const hooks = await v1Hooks(dir, {});
      const target = { providerID: 'old', modelID: 'old' };
      const output = {
        parts: Object.freeze([{ type: 'text', text: 'review this diff' }]),
        message: { model: target },
      };
      const errs = [];
      const origErr = console.error;
      console.error = (...args) => errs.push(args.join(' '));
      try {
        await hooks['chat.message']({ sessionID: 's1', messageID: 'm1' }, output);
      } finally {
        console.error = origErr;
      }
      assert.equal(target.providerID, 'f');
      assert.equal(target.modelID, 'b');
      assert.match(errs.join('\n'), /announce skipped/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('v2 announce', () => {
  async function v2Hooks(dir, opts) {
    const v2 = require('../src/v2.js');
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
        },
      },
    };
    await v2.setup(fakeCtx);
    return seen;
  }

  it('switch mode appends once and dedups the second identical turn', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-ann-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    try {
      const seen = await v2Hooks(dir, {});
      const e1 = { sessionID: 's1', prompt: 'review this diff' };
      await seen.prompt(e1);
      assert.equal(e1.prompt, 'review this diff\n[modelselect: task=review tier=free → f/b]');
      await seen.context({ sessionID: 's1', agent: 'review', model: { providerID: 'old', id: 'old' }, messages: [] });
      const e2 = { sessionID: 's1', prompt: 'review this diff' };
      await seen.prompt(e2);
      assert.equal(e2.prompt, 'review this diff', 'identical second turn emits nothing');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('always mode appends every identical turn', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-always-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    try {
      const seen = await v2Hooks(dir, { announce: 'always' });
      const e1 = { sessionID: 's1', prompt: 'review this diff' };
      await seen.prompt(e1);
      await seen.context({ sessionID: 's1', agent: 'review', model: { providerID: 'old', id: 'old' }, messages: [] });
      const e2 = { sessionID: 's1', prompt: 'review this diff' };
      await seen.prompt(e2);
      assert.match(e1.prompt, /\[modelselect: task=review tier=free → f\/b\]/);
      assert.match(e2.prompt, /\[modelselect: task=review tier=free → f\/b\]/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('off mode leaves the prompt untouched with routing intact', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-off-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    try {
      const seen = await v2Hooks(dir, { announce: 'off' });
      const e1 = { sessionID: 's1', prompt: 'review this diff' };
      await seen.prompt(e1);
      assert.equal(e1.prompt, 'review this diff');
      const event = { sessionID: 's1', agent: 'review', model: { providerID: 'old', id: 'old' }, messages: [] };
      await seen.context(event);
      assert.equal(event.model.providerID, 'f');
      assert.equal(event.model.id, 'b');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('suggestOnly appends with would-use wording without mutating', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-suggest-ann-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    try {
      const seen = await v2Hooks(dir, { suggestOnly: true });
      const e1 = { sessionID: 's1', prompt: 'review this diff' };
      await seen.prompt(e1);
      assert.equal(e1.prompt, 'review this diff\n[modelselect: task=review tier=free would use f/b]');
      const event = { sessionID: 's1', agent: 'review', model: { providerID: 'old', id: 'old' }, messages: [] };
      await seen.context(event);
      assert.equal(event.model.providerID, 'old');
      assert.equal(seen.switched, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('announce failure does not break routing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-annfail-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    try {
      const seen = await v2Hooks(dir, {});
      const errs = [];
      const origErr = console.error;
      console.error = (...args) => errs.push(args.join(' '));
      try {
        await seen.prompt(Object.freeze({ sessionID: 's1', prompt: 'review this diff' }));
      } finally {
        console.error = origErr;
      }
      const event = { sessionID: 's1', agent: 'review', model: { providerID: 'old', id: 'old' }, messages: [] };
      await seen.context(event);
      assert.equal(event.model.providerID, 'f');
      assert.equal(event.model.id, 'b');
      assert.match(errs.join('\n'), /announce skipped/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('v2 prompt shape (PromptInput.Prompt)', () => {
  async function v2Hooks(dir, opts) {
    const v2 = require('../src/v2.js');
    const seen = {};
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    const fakeCtx = {
      options: { tier: 'free', taskType: 'review', ...opts },
      location: { directory: dir },
      session: {
        async hook(name, cb) {
          seen[name] = cb;
        },
        async switchModel(input) {
          seen.switched = input;
        },
      },
    };
    try {
      await v2.setup(fakeCtx);
    } finally {
      console.log = origLog;
    }
    return { seen, logs };
  }

  it('logs once at setup so loading is verifiable', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-shape-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    try {
      const { logs } = await v2Hooks(dir, {});
      assert.match(logs.join('\n'), /\[modelselect\] loaded/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('appends the announce line to prompt.text', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-shape-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    try {
      const { seen } = await v2Hooks(dir, {});
      const e1 = { sessionID: 's1', messageID: 'm1', prompt: { text: 'review this diff' } };
      await seen.prompt(e1);
      assert.equal(e1.prompt.text, 'review this diff\n[modelselect: task=review tier=free → f/b]');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('routes via agent mentions and file attachments', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-shape-'));
    seedCache(dir, {
      'task-types': {
        review: { go: 'g/a', free: 'f/b' },
        docs: { go: 'g/doc', free: 'f/doc' },
      },
    });
    try {
      const { seen } = await v2Hooks(dir, { taskType: 'auto', agentTaskMap: { writer: 'docs' } });
      const e1 = {
        sessionID: 's1',
        messageID: 'm1',
        prompt: {
          text: 'review this diff',
          files: [{ uri: 'file:///repo/README.md', name: 'README.md' }],
          agents: [{ name: 'writer' }],
        },
      };
      await seen.prompt(e1);
      assert.match(e1.prompt.text, /task=docs/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('context hook still works when the prompt hook saw the v2 shape', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-shape-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    try {
      const { seen } = await v2Hooks(dir, {});
      await seen.prompt({ sessionID: 's1', messageID: 'm1', prompt: { text: 'review this diff' } });
      const event = { sessionID: 's1', agent: 'review', model: { providerID: 'old', id: 'old' }, messages: [] };
      await seen.context(event);
      assert.equal(event.model.providerID, 'f');
      assert.equal(event.model.id, 'b');
      assert.deepEqual(seen.switched, { sessionID: 's1', model: { providerID: 'f', id: 'b' } });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
describe('v2 routing hooks', () => {
  it('mutates event.model in place and persists via switchModel', async () => {
    const v2 = require('../src/v2.js');
    assert.equal(v2.id, 'modelselect');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    const seen = {};
    const fakeCtx = {
      options: { tier: 'free', taskType: 'review' },
      location: { directory: dir },
      session: {
        async hook(name, cb) {
          seen[name] = cb;
        },
        async switchModel(input) {
          seen.switched = input;
        },
      },
    };
    await v2.setup(fakeCtx);
    assert.ok(seen.prompt && seen.context, 'registers prompt + context hooks');
    await seen.prompt({ sessionID: 's1', prompt: 'review this diff' });
    const event = { sessionID: 's1', agent: 'review', model: { providerID: 'old', id: 'old' }, messages: [] };
    await seen.context(event);
    assert.equal(event.model.providerID, 'f');
    assert.equal(event.model.id, 'b');
    assert.deepEqual(seen.switched, {
      sessionID: 's1',
      model: { providerID: 'f', id: 'b' },
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('agentTaskMap pin routes the pinned entry end to end', async () => {
    const v2 = require('../src/v2.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-agentmap-'));
    seedCache(dir, {
      'task-types': {
        review: { go: 'g/a', free: 'f/b' },
        docs: { go: 'g/doc', free: 'f/doc' },
      },
    });
    const seen = {};
    const fakeCtx = {
      options: { tier: 'free', taskType: 'auto', agentTaskMap: { writer: 'docs' } },
      location: { directory: dir },
      session: {
        async hook(name, cb) {
          seen[name] = cb;
        },
        async switchModel(input) {
          seen.switched = input;
        },
      },
    };
    await v2.setup(fakeCtx);
    await seen.prompt({ sessionID: 's1', prompt: 'review this diff' });
    const event = { sessionID: 's1', agent: 'writer', model: { providerID: 'old', id: 'old' }, messages: [] };
    await seen.context(event);
    assert.equal(event.model.providerID, 'f');
    assert.equal(event.model.id, 'doc');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('suggestOnly logs the pick without mutating or persisting', async () => {
    const v2 = require('../src/v2.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-suggest-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    const seen = {};
    const fakeCtx = {
      options: { tier: 'free', taskType: 'review', suggestOnly: true },
      location: { directory: dir },
      session: {
        async hook(name, cb) {
          seen[name] = cb;
        },
        async switchModel(input) {
          seen.switched = input;
        },
      },
    };
    await v2.setup(fakeCtx);
    await seen.prompt({ sessionID: 's1', prompt: 'review this diff' });
    const event = { sessionID: 's1', agent: 'review', model: { providerID: 'old', id: 'old' }, messages: [] };
    const lines = [];
    const origLog = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
      await seen.context(event);
    } finally {
      console.log = origLog;
    }
    assert.equal(event.model.providerID, 'old');
    assert.equal(event.model.id, 'old');
    assert.equal(seen.switched, undefined);
    assert.match(lines.join('\n'), /\(suggest-only\).*would-select=f\/b.*current=old\/old/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
