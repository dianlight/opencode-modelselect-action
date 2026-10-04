'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { inferTaskType } = require('../src/shared/detect');
const { normalizeOptions, formatAnnounce, loadConfig, resolveModel, splitModelRef, clearQuotaCache } = require('../src/shared/select');
const { parseJevAnswer, refineTaskTypeWithJev, buildJevQuestions, jevLabel, DEFAULT_JEV_ENDPOINT } = require('../src/shared/jev');
const { loadTaskTypes, normalizeTaskTypes, taskTypesCacheFile, TASK_TYPES_CACHE_VERSION, DEFAULT_TASK_TYPES_URL } = require('../src/shared/tasktypes');
const { seedCache, seedTaskTypes, isolateAuth, writeAuthFile } = require('./helpers');

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

  it('serves the remote config even when the cache write fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-ro-'));
    const blocked = path.join(dir, 'not-a-dir'); // parent is a file: mkdir/write throws
    fs.writeFileSync(blocked, 'x');
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ 'task-types': {} }) });
    try {
      const opts = normalizeOptions({});
      const { config: got, source } = await loadConfig(opts, path.join(blocked, 'cache'));
      assert.equal(source, 'remote');
      assert.deepEqual(got, { 'task-types': {} });
    } finally {
      globalThis.fetch = realFetch;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies the maxCost budget cap', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-budget-'));
    seedCache(dir, {
      'task-types': {
        code: {
          go: 'g/a',
          free: 'f/expensive',
          free_ranked: [
            { model: 'f/expensive', score: 80, blended_cost: 10 },
            { model: 'f/cheap', score: 70, blended_cost: 0.5 },
          ],
        },
      },
    });
    const cacheDir = path.join(dir, '.opencode', '.modelselect-cache');
    try {
      // within budget: keep the recommended pick
      const keep = await resolveModel({ taskType: 'code', opts: normalizeOptions({ tier: 'free', maxCost: 10 }), cacheDir });
      assert.equal(keep.model, 'f/expensive');
      // over budget: swap to the best-scoring ranked row within budget
      const swap = await resolveModel({ taskType: 'code', opts: normalizeOptions({ tier: 'free', maxCost: 1 }), cacheDir });
      assert.equal(swap.model, 'f/cheap');
      // nothing fits: no fallback -> throws; fallbackModel -> used
      await assert.rejects(
        resolveModel({ taskType: 'code', opts: normalizeOptions({ tier: 'free', maxCost: 0.1 }), cacheDir }),
        /fits max-cost/,
      );
      const fb = await resolveModel({
        taskType: 'code',
        opts: normalizeOptions({ tier: 'free', maxCost: 0.1, fallbackModel: 'f/fb' }),
        cacheDir,
      });
      assert.equal(fb.model, 'f/fb');
      assert.match(fb.source, /\+fallback/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('validates the maxCost option', () => {
    assert.equal(normalizeOptions({}).maxCost, null);
    assert.equal(normalizeOptions({ maxCost: '' }).maxCost, null);
    assert.equal(normalizeOptions({ maxCost: 0 }).maxCost, 0);
    assert.equal(normalizeOptions({ 'max-cost': '1.5' }).maxCost, 1.5);
    assert.throws(() => normalizeOptions({ maxCost: -1 }), /non-negative/);
    assert.throws(() => normalizeOptions({ maxCost: 'abc' }), /non-negative/);
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

  it('appends the jev segment when given', () => {
    assert.equal(
      formatAnnounce({ taskType: 'review', tier: 'free', model: 'f/b', suggestOnly: false, jev: 'review@0.95' }),
      '[modelselect: task=review tier=free → f/b jev=review@0.95]',
    );
    assert.equal(
      formatAnnounce({ taskType: 'generic', tier: 'free', model: 'f/b', suggestOnly: true, jev: 'kept:no-token' }),
      '[modelselect: task=generic tier=free would use f/b jev=kept:no-token]',
    );
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

  // The virtual model is the routing switch: only sessions on opencode/auto
  // route + announce. A context call marks the session virtual first; the
  // prompt hook then announces (first real turn misses this and lands on the
  // next turn — hence context-before-prompt here).
  const VIRTUAL = { providerID: 'opencode', id: 'auto' };

  it('switch mode appends once and dedups the second identical turn', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-ann-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    try {
      const seen = await v2Hooks(dir, {});
      await seen.context({ sessionID: 's1', agent: 'review', model: { ...VIRTUAL }, messages: [] });
      const e1 = { sessionID: 's1', prompt: 'review this diff' };
      await seen.prompt(e1);
      assert.equal(e1.prompt, 'review this diff\n[modelselect: task=review tier=free → f/b jev=pinned]');
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
      await seen.context({ sessionID: 's1', agent: 'review', model: { ...VIRTUAL }, messages: [] });
      const e1 = { sessionID: 's1', prompt: 'review this diff' };
      await seen.prompt(e1);
      const e2 = { sessionID: 's1', prompt: 'review this diff' };
      await seen.prompt(e2);
      assert.match(e1.prompt, /\[modelselect: task=review tier=free → f\/b jev=pinned\]/);
      assert.match(e2.prompt, /\[modelselect: task=review tier=free → f\/b jev=pinned\]/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('announce off leaves the prompt untouched but routing still happens', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-annoff-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    try {
      const seen = await v2Hooks(dir, { announce: 'off' });
      const event = { sessionID: 's1', agent: 'review', model: { ...VIRTUAL }, messages: [] };
      await seen.context(event);
      assert.equal(event.model.providerID, 'f');
      assert.equal(event.model.id, 'b');
      const e1 = { sessionID: 's1', prompt: 'review this diff' };
      await seen.prompt(e1);
      assert.equal(e1.prompt, 'review this diff', 'announce off appends nothing');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('suggestOnly appends with would-use wording without mutating', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-suggest-ann-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    try {
      const seen = await v2Hooks(dir, { suggestOnly: true });
      await seen.context({ sessionID: 's1', agent: 'review', model: { ...VIRTUAL }, messages: [] });
      const e1 = { sessionID: 's1', prompt: 'review this diff' };
      await seen.prompt(e1);
      assert.equal(e1.prompt, 'review this diff\n[modelselect: task=review tier=free would use f/b jev=pinned]');
      const event = { sessionID: 's1', agent: 'review', model: { ...VIRTUAL }, messages: [] };
      await seen.context(event);
      assert.equal(event.model.providerID, 'opencode', 'suggestOnly never mutates the model');
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
      // Mark the session virtual first so the prompt hook attempts the
      // announce (and fails on the frozen prompt) instead of bailing at the
      // virtual gate.
      await seen.context({ sessionID: 's1', agent: 'review', model: { ...VIRTUAL }, messages: [] });
      const errs = [];
      const origErr = console.error;
      console.error = (...args) => errs.push(args.join(' '));
      try {
        await seen.prompt(Object.freeze({ sessionID: 's1', prompt: 'review this diff' }));
      } finally {
        console.error = origErr;
      }
      const event = { sessionID: 's1', agent: 'review', model: { ...VIRTUAL }, messages: [] };
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

  // The virtual model is the routing switch: only sessions on opencode/auto
  // route + announce. A context call marks the session virtual first; the
  // prompt hook then announces (first real turn misses this and lands on the
  // next turn — hence context-before-prompt here).
  const VIRTUAL = { providerID: 'opencode', id: 'auto' };

  it('appends the announce line to prompt.text', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-shape-'));
    seedCache(dir, { 'task-types': { review: { go: 'g/a', free: 'f/b' } } });
    try {
      const { seen } = await v2Hooks(dir, {});
      await seen.context({ sessionID: 's1', agent: 'review', model: { ...VIRTUAL }, messages: [] });
      const e1 = { sessionID: 's1', messageID: 'm1', prompt: { text: 'review this diff' } };
      await seen.prompt(e1);
      assert.equal(e1.prompt.text, 'review this diff\n[modelselect: task=review tier=free → f/b jev=pinned]');
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
      await seen.context({ sessionID: 's1', agent: 'review', model: { ...VIRTUAL }, messages: [] });
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
      const event = { sessionID: 's1', agent: 'review', model: { ...VIRTUAL }, messages: [] };
      await seen.context(event);
      assert.equal(event.model.providerID, 'f');
      assert.equal(event.model.id, 'b');
      assert.equal(seen.switched, undefined, 'virtual pick never persists');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
describe('v2 routing hooks', () => {
  // The virtual model is the routing switch: only sessions on opencode/auto
  // route. Non-virtual sessions are the user's hands-off choice.
  const VIRTUAL = { providerID: 'opencode', id: 'auto' };

  it('mutates event.model in place and never persists (virtual pick)', async () => {
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
    const event = { sessionID: 's1', agent: 'review', model: { ...VIRTUAL }, messages: [] };
    await seen.context(event);
    assert.equal(event.model.providerID, 'f');
    assert.equal(event.model.id, 'b');
    assert.equal(seen.switched, undefined, 'virtual pick never persists');
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
    const event = { sessionID: 's1', agent: 'writer', model: { ...VIRTUAL }, messages: [] };
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
    const event = { sessionID: 's1', agent: 'review', model: { ...VIRTUAL }, messages: [] };
    const lines = [];
    const origLog = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
      await seen.context(event);
    } finally {
      console.log = origLog;
    }
    assert.equal(event.model.providerID, 'opencode', 'suggestOnly never mutates the model');
    assert.equal(event.model.id, 'auto');
    assert.equal(seen.switched, undefined);
    assert.match(lines.join('\n'), /\(suggest-only\).*would-select=f\/b.*current=opencode\/auto/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('jev optional refinement', () => {
  it('defaults to disabled with threshold 0.6', () => {
    const opts = normalizeOptions({});
    assert.equal(opts.jevModel, '');
    assert.equal(opts.jevThreshold, 0.6);
    assert.equal(opts.jevEndpoint, DEFAULT_JEV_ENDPOINT);
  });

  it('accepts aliases and rejects bad thresholds', () => {
    assert.equal(normalizeOptions({ 'jev-model': 'jev-1.13-free' }).jevModel, 'jev-1.13-free');
    assert.equal(normalizeOptions({ typesafeModel: 'jev-1.13' }).jevModel, 'jev-1.13');
    assert.equal(normalizeOptions({ jevThreshold: 0.8 }).jevThreshold, 0.8);
    assert.throws(() => normalizeOptions({ jevThreshold: 2 }));
    assert.throws(() => normalizeOptions({ jevThreshold: -0.1 }));
  });

  it('parses the Choice answer shape', () => {
    assert.deepEqual(
      parseJevAnswer({ answers: { task: { type: 'choice', choice: 'review', confidence: 0.95 } } }),
      { choice: 'review', confidence: 0.95 },
    );
    assert.equal(parseJevAnswer({ answers: {} }), null);
    assert.equal(parseJevAnswer({}), null);
  });

  it('disabled jev never calls fetch', async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; throw new Error('must not be called'); };
    try {
      const opts = normalizeOptions({});
      const { taskType, jev } = await refineTaskTypeWithJev({ heuristic: 'generic', prompt: 'hello', opts });
      assert.equal(taskType, 'generic');
      assert.equal(jev, null);
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('confident jev overrides the heuristic', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ answers: { task: { type: 'choice', choice: 'review', confidence: 0.95 } } }),
    });
    try {
      const opts = normalizeOptions({ jevModel: 'jev-1.13-free', token: 'tok' });
      const { taskType, jev } = await refineTaskTypeWithJev({ heuristic: 'generic', prompt: 'review this diff', opts });
      assert.equal(taskType, 'review');
      assert.equal(jev.choice, 'review');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('low confidence keeps the heuristic', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ answers: { task: { type: 'choice', choice: 'review', confidence: 0.2 } } }),
    });
    try {
      const opts = normalizeOptions({ jevModel: 'jev-1.13-free', token: 'tok' });
      const { taskType, jev } = await refineTaskTypeWithJev({ heuristic: 'generic', prompt: 'review this diff', opts });
      assert.equal(taskType, 'generic');
      assert.equal(jev, null);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('missing confidence keeps the heuristic (no number, no override)', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ answers: { task: { type: 'choice', choice: 'review' } } }),
    });
    try {
      const opts = normalizeOptions({ jevModel: 'jev-1.13-free', token: 'tok' });
      const { taskType, status } = await refineTaskTypeWithJev({
        heuristic: 'generic',
        prompt: 'review this diff',
        opts,
      });
      assert.equal(taskType, 'generic');
      assert.equal(status, 'lowconf');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('network errors and unknown choices fail open', async () => {
    const realFetch = globalThis.fetch;
    const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-jev-failopen-'));
    const restoreAuth = isolateAuth(authDir);
    try {
      const opts = normalizeOptions({ jevModel: 'jev-1.13-free', token: 'tok' });
      globalThis.fetch = async () => { throw new Error('down'); };
      assert.equal((await refineTaskTypeWithJev({ heuristic: 'generic', prompt: 'hi', opts })).taskType, 'generic');
      globalThis.fetch = async () => ({
        ok: true, status: 200,
        json: async () => ({ answers: { task: { type: 'choice', choice: 'nope', confidence: 0.99 } } }),
      });
      assert.equal((await refineTaskTypeWithJev({ heuristic: 'generic', prompt: 'hi', opts })).taskType, 'generic');
      const noToken = normalizeOptions({ jevModel: 'jev-1.13-free' });
      delete process.env.OPENCODE_API_KEY;
      noToken.token = '';
      noToken.jevToken = '';
      let calls = 0;
      globalThis.fetch = async () => { calls += 1; throw new Error('must not be called'); };
      assert.equal((await refineTaskTypeWithJev({ heuristic: 'generic', prompt: 'hi', opts: noToken })).taskType, 'generic');
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = realFetch;
      restoreAuth();
      fs.rmSync(authDir, { recursive: true, force: true });
    }
  });

  it('a dev-machine auth.json key still does not leak into no-token paths', async () => {
    // refineTaskTypeWithJev falls back to the auth store, so a test that
    // wants "no token" must isolate the store, not just the env var.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-jev-isolate-'));
    const restoreAuth = isolateAuth(dir);
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; throw new Error('must not be called'); };
    try {
      const r = await refineTaskTypeWithJev({
        heuristic: 'generic',
        prompt: 'hi',
        opts: { jevModel: 'jev-1.13-free', token: '', jevToken: '', jevThreshold: 0.6, verbose: false },
      });
      assert.equal(r.status, 'no-token');
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = realFetch;
      restoreAuth();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('remote task-types (option B)', () => {
  it('normalizeOptions defaults taskTypesUrl', () => {
    assert.equal(normalizeOptions({}).taskTypesUrl, DEFAULT_TASK_TYPES_URL);
    assert.equal(
      normalizeOptions({ 'task-types-url': 'https://example.com/tt.json' }).taskTypesUrl,
      'https://example.com/tt.json',
    );
  });

  it('normalizeTaskTypes accepts published and bare shapes', () => {
    const got = normalizeTaskTypes({
      timestamp: 'x',
      'task-types': {
        plan: { label: 'Plan', description: 'Planning things', jev_criteria: 'Decide structure', agent: 'plan' },
        bare: 'Just a description',
        labelOnly: { label: 'Label Only' },
        empty: {},
      },
    });
    assert.deepEqual(got, {
      plan: { label: 'Plan', description: 'Planning things', jev_criteria: 'Decide structure', agent: 'plan' },
      bare: { label: 'bare', description: 'Just a description', jev_criteria: '' },
      labelonly: { label: 'Label Only', description: 'Label Only', jev_criteria: '' },
    });
    assert.deepEqual(
      normalizeTaskTypes({ task_types: { docs: { label: 'Docs', description: 'Write docs', jev_criteria: 'Explain things' } } }),
      { docs: { label: 'Docs', description: 'Write docs', jev_criteria: 'Explain things' } },
    );
    assert.equal(normalizeTaskTypes({}), null);
    assert.equal(normalizeTaskTypes(null), null);
    assert.equal(normalizeTaskTypes([]), null);
  });

  it('buildJevQuestions uses remote jev_criteria and ignores empty ones', () => {
    const q = buildJevQuestions({
      'web-search': { label: 'Web Search', description: 'Deep research', jev_criteria: 'Gather and synthesize from the web' },
      review: { label: 'Review', description: 'Review a diff', jev_criteria: '' },
    });
    assert.equal(q.task.type, 'choice');
    assert.deepEqual(q.task.criteria, {
      'web-search': 'Gather and synthesize from the web',
    });
  });

  it('buildJevQuestions falls back to the static list without remote data', () => {
    const q = buildJevQuestions();
    assert.ok(q.task.criteria.plan);
    assert.ok(q.task.criteria.review);
  });

  it('loadTaskTypes uses fresh cache without network', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-tt-'));
    const taskTypes = { review: { label: 'Review', description: 'Review a diff' } };
    seedTaskTypes(dir, taskTypes);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('must not be called'); };
    try {
      const opts = normalizeOptions({});
      const { taskTypes: got, source } = await loadTaskTypes(
        opts, path.join(dir, '.opencode', '.modelselect-cache'),
      );
      assert.equal(source, 'cache');
      assert.deepEqual(got, taskTypes);
    } finally {
      globalThis.fetch = realFetch;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loadTaskTypes refetches a cache written before jev_criteria existed', async () => {
    // Regression gate for the 24h-TTL deadlock: a cache file written by
    // pre-jev_criteria plugin code is still "fresh" by fetchedAt, but its
    // entries carry no criteria — trusting it leaves the OpenChamber sync
    // with nothing routable. Unstamped (v1) files must be refetched.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-tt-v1-'));
    const cache = path.join(dir, '.opencode', '.modelselect-cache');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(
      taskTypesCacheFile(cache),
      JSON.stringify({
        fetchedAt: Date.now(), // fresh: only the missing version may trigger the refetch
        taskTypes: { plan: { label: 'Plan', description: 'Planning, architecture decisions' } },
      }),
    );
    const remote = {
      plan: { label: 'Plan', description: 'Planning', jev_criteria: 'Plan work: decide structure.', agent: 'plan' },
    };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ 'task-types': remote }) });
    try {
      const opts = normalizeOptions({});
      const { taskTypes: got, source } = await loadTaskTypes(opts, cache);
      assert.equal(source, 'remote');
      assert.deepEqual(got, remote);
      const rewritten = JSON.parse(fs.readFileSync(taskTypesCacheFile(cache), 'utf8'));
      assert.equal(rewritten.v, TASK_TYPES_CACHE_VERSION);
      assert.equal(rewritten.taskTypes.plan.jev_criteria, 'Plan work: decide structure.');
    } finally {
      globalThis.fetch = realFetch;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loadTaskTypes serves stale cache on fetch failure and throws with neither', async () => {
    const realFetch = globalThis.fetch;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-tt-stale-'));
    const taskTypes = { review: { label: 'Review', description: 'Review a diff' } };
    seedTaskTypes(dir, taskTypes);
    // age the cache past the default 24h window
    const file = taskTypesCacheFile(path.join(dir, '.opencode', '.modelselect-cache'));
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.fetchedAt -= 25 * 60 * 60 * 1000;
    fs.writeFileSync(file, JSON.stringify(raw));
    globalThis.fetch = async () => { throw new Error('down'); };
    try {
      const opts = normalizeOptions({});
      const { taskTypes: got, source, stale } = await loadTaskTypes(
        opts, path.join(dir, '.opencode', '.modelselect-cache'),
      );
      assert.equal(source, 'cache-stale');
      assert.equal(stale, true);
      assert.deepEqual(got, taskTypes);
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-tt-empty-'));
      try {
        await assert.rejects(loadTaskTypes(opts, empty), /unreachable/);
      } finally {
        fs.rmSync(empty, { recursive: true, force: true });
      }
    } finally {
      globalThis.fetch = realFetch;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('jev accepts a remote-only choice and sends remote criteria', async () => {
    const realFetch = globalThis.fetch;
    let body = null;
    globalThis.fetch = async (url, init) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ answers: { task: { type: 'choice', choice: 'web-search', confidence: 0.9 } } }),
      };
    };
    try {
      const opts = normalizeOptions({ jevModel: 'jev-1.13-free', token: 'tok' });
      const taskTypes = {
        'web-search': { label: 'Web Search', description: 'Deep research', jev_criteria: 'Deep multi-source web research' },
        generic: { label: 'Generic', description: 'Everything else', jev_criteria: 'General work' },
      };
      const { taskType, jev } = await refineTaskTypeWithJev({
        heuristic: 'generic', prompt: 'research this topic online', opts, taskTypes,
      });
      assert.equal(taskType, 'web-search');
      assert.equal(jev.choice, 'web-search');
      assert.equal(body.questions.task.criteria['web-search'], 'Deep multi-source web research');
      // without the remote map the same answer fails open (unknown choice)
      const keep = await refineTaskTypeWithJev({
        heuristic: 'generic', prompt: 'research this topic online', opts,
      });
      assert.equal(keep.taskType, 'generic');
      assert.equal(keep.jev, null);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('jev loads the remote list from cacheDir best-effort', async () => {
    const realFetch = globalThis.fetch;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-tt-jev-'));
    seedTaskTypes(dir, {
      'web-search': { label: 'Web Search', description: 'Deep multi-source web research', jev_criteria: 'Deep multi-source web research' },
    });
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ answers: { task: { type: 'choice', choice: 'web-search', confidence: 0.9 } } }),
    });
    try {
      const opts = normalizeOptions({ jevModel: 'jev-1.13-free', token: 'tok' });
      const { taskType } = await refineTaskTypeWithJev({
        heuristic: 'generic',
        prompt: 'research this topic online',
        opts,
        cacheDir: path.join(dir, '.opencode', '.modelselect-cache'),
      });
      assert.equal(taskType, 'web-search');
    } finally {
      globalThis.fetch = realFetch;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('jev announce label', () => {
  it('labels ok / off / pinned / kept states', () => {
    assert.equal(jevLabel({ status: 'ok', jev: { choice: 'review', confidence: 0.95 } }), 'review@0.95');
    assert.equal(jevLabel({ status: 'ok', jev: { choice: 'review', confidence: null } }), 'review@?');
    assert.equal(jevLabel({ status: 'off', jev: null }), 'off');
    assert.equal(jevLabel({ status: 'pinned', jev: null }), 'pinned');
    assert.equal(jevLabel({ status: 'no-token', jev: null }), 'kept:no-token');
    assert.equal(jevLabel({ status: 'lowconf', jev: null }), 'kept:lowconf');
    assert.equal(jevLabel({ status: 'error', jev: null }), 'kept:error');
    assert.equal(jevLabel({}), null);
  });

  it('v2 announce shows the jev choice when it overrides', async () => {
    const v2 = require('../src/v2.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-jevann-'));
    seedCache(dir, {
      'task-types': {
        generic: { go: 'g/gen', free: 'f/gen' },
        review: { go: 'g/a', free: 'f/b' },
      },
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ answers: { task: { type: 'choice', choice: 'review', confidence: 0.95 } } }),
    });
    try {
      const seen = {};
      const fakeCtx = {
        options: { tier: 'free', taskType: 'auto', jevModel: 'jev-1.13-free', token: 'tok' },
        location: { directory: dir },
        session: {
          async hook(name, cb) { seen[name] = cb; },
          async switchModel(input) { seen.switched = input; },
        },
      };
      await v2.setup(fakeCtx);
      await seen.context({ sessionID: 's1', model: { providerID: 'opencode', id: 'auto' }, messages: [] });
      const e1 = { sessionID: 's1', prompt: 'ciao, controlla questo lavoro' };
      await seen.prompt(e1);
      assert.match(e1.prompt, /task=review.*jev=review@0\.95/);
    } finally {
      globalThis.fetch = realFetch;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('v2 announce shows kept:no-token when the key is missing', async () => {
    const v2 = require('../src/v2.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-jevnotok-'));
    seedCache(dir, { 'task-types': { generic: { go: 'g/gen', free: 'f/gen' } } });
    const restoreAuth = isolateAuth(dir);
    try {
      const seen = {};
      const fakeCtx = {
        options: { tier: 'free', taskType: 'auto', jevModel: 'jev-1.13-free' },
        location: { directory: dir },
        session: {
          async hook(name, cb) { seen[name] = cb; },
          async switchModel(input) { seen.switched = input; },
        },
      };
      await v2.setup(fakeCtx);
      await seen.context({ sessionID: 's1', model: { providerID: 'opencode', id: 'auto' }, messages: [] });
      const e1 = { sessionID: 's1', prompt: 'ciao' };
      await seen.prompt(e1);
      assert.match(e1.prompt, /task=generic.*jev=kept:no-token/);
    } finally {
      restoreAuth();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('v2 reads the auth.json key so Jev runs under OpenChamber', async () => {
    const v2 = require('../src/v2.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-jevauth-'));
    seedCache(dir, { 'task-types': { generic: { go: 'g/gen', free: 'f/gen' }, review: { go: 'g/rev', free: 'f/rev' } } });
    const restoreAuth = isolateAuth(dir);
    writeAuthFile(dir, { opencode: { type: 'api', key: 'sk-store' } });
    const realFetch = globalThis.fetch;
    let sawAuth = null;
    globalThis.fetch = async (_url, init) => {
      if (init?.method === 'POST') {
        sawAuth = init.headers.Authorization;
        return {
          ok: true,
          status: 200,
          json: async () => ({ answers: { task: { choice: 'review', confidence: 0.95 } } }),
        };
      }
      return { status: 401, ok: false };
    };
    try {
      const seen = {};
      const fakeCtx = {
        options: { tier: 'free', taskType: 'auto', jevModel: 'jev-1.13-free' },
        location: { directory: dir },
        session: {
          async hook(name, cb) { seen[name] = cb; },
          async switchModel(input) { seen.switched = input; },
        },
      };
      await v2.setup(fakeCtx);
      await seen.context({ sessionID: 's1', model: { providerID: 'opencode', id: 'auto' }, messages: [] });
      const e1 = { sessionID: 's1', prompt: 'review this diff please' };
      await seen.prompt(e1);
      assert.equal(sawAuth, 'Bearer sk-store');
      assert.match(e1.prompt, /task=review.*jev=review@0\.95/);
    } finally {
      globalThis.fetch = realFetch;
      restoreAuth();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('continuation (short acks inherit previous task)', () => {
  const { isAck, isLowSignal } = require('../src/shared/detect');
  const { resolveWithHistory, continuationState, lastAssistantSnippet, truncate } = require('../src/shared/continuation');

  it('truncate keeps nothing when max is 0 (historyChars: 0)', () => {
    assert.equal(truncate('review this diff', 0), '');
    assert.equal(truncate('review this diff', 6), 'review');
    assert.equal(truncate('short', 100), 'short');
  });

  it('matches Italian and English acks, not long messages', () => {
    assert.equal(isAck('do it'), true);
    assert.equal(isAck('yes'), true);
    assert.equal(isAck('go ahead'), true);
    assert.equal(isAck('sì, procedi'), true);
    assert.equal(isAck('vai pure'), true);
    assert.equal(isAck('va bene, procedi pure'), true);
    assert.equal(isAck('perfetto'), true);
    assert.equal(isAck('review this diff'), false);
    assert.equal(
      isAck('sì procedi pure con la seconda opzione che mi hai proposto ieri sera al telefono amico mio caro'),
      false,
    );
  });

  it('scores zero in any language regardless of length', () => {
    assert.equal(isLowSignal({ prompt: 'do it' }), true);
    assert.equal(isLowSignal({ prompt: 'sì, procedi pure così va bene grazie' }), true);
    assert.equal(isLowSignal({ prompt: 'la seconda opzione che mi hai proposto' }), true);
    assert.equal(isLowSignal({ prompt: 'review this pull request diff' }), false);
  });

  it('zero-signal turns inherit history, signal turns do not', () => {
    const inherited = resolveWithHistory({ prompt: 'do it' }, { task: 'review', prompt: 'review this diff' });
    assert.equal(inherited.taskType, 'review');
    assert.equal(inherited.continued, true);
    const kept = resolveWithHistory(
      { prompt: 'review this pull request diff' },
      { task: 'code', prompt: 'implement feature' },
    );
    assert.equal(kept.taskType, 'review');
    assert.equal(kept.continued, false);
    const noHistory = resolveWithHistory({ prompt: 'do it' }, null);
    assert.equal(noHistory.taskType, 'generic');
    assert.equal(noHistory.continued, false);
  });

  it('options default continuation on with 2000 history chars', () => {
    const opts = normalizeOptions({});
    assert.equal(opts.continuation, true);
    assert.equal(opts.historyChars, 2000);
    assert.equal(normalizeOptions({ continuation: false }).continuation, false);
    assert.equal(normalizeOptions({ 'history-chars': 500 }).historyChars, 500);
    assert.throws(() => normalizeOptions({ historyChars: -1 }));
  });

  it('continuation state carries previous prompt and assistant snippet', () => {
    const s = continuationState({
      current: 'do it',
      historyPrompt: 'review this diff',
      assistantSnippet: 'Shall I proceed?',
      historyChars: 2000,
    });
    assert.match(s, /Previous: review this diff/);
    assert.match(s, /Assistant: Shall I proceed\?/);
    assert.match(s, /Current: do it/);
    assert.equal(lastAssistantSnippet([{ role: 'assistant', parts: [{ type: 'text', text: 'Shall I proceed?' }] }]), 'Shall I proceed?');
  });

  it('v2 keeps review across an Italian ack end to end', async () => {
    const v2 = require('../src/v2.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-cont-'));
    seedCache(dir, {
      'task-types': {
        review: { go: 'g/a', free: 'f/b' },
        generic: { go: 'g/gen', free: 'f/gen' },
      },
    });
    try {
      const seen = {};
      const fakeCtx = {
        options: { tier: 'free', taskType: 'auto' },
        location: { directory: dir },
        session: {
          async hook(name, cb) { seen[name] = cb; },
          async switchModel(input) { seen.switched = input; },
        },
      };
      await v2.setup(fakeCtx);
      const VIRTUAL = { providerID: 'opencode', id: 'auto' };
      await seen.prompt({ sessionID: 's1', prompt: 'review this pull request diff' });
      const e1 = { sessionID: 's1', model: { ...VIRTUAL }, messages: [], agent: 'review' };
      await seen.context(e1);
      assert.equal(e1.model.id, 'b');
      await seen.prompt({ sessionID: 's1', prompt: 'sì, procedi pure' });
      const e2 = { sessionID: 's1', model: { ...VIRTUAL }, messages: [], agent: 'review' };
      await seen.context(e2);
      assert.equal(e2.model.id, 'b', 'Italian ack stays on review, not generic');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
