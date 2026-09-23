'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { inferTaskType } = require('../src/shared/detect');
const { normalizeOptions, loadConfig, resolveModel, splitModelRef, clearQuotaCache } = require('../src/shared/select');

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
