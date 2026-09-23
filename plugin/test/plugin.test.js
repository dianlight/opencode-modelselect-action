'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { inferTaskType } = require('../src/shared/detect');
const { normalizeOptions, loadConfig, splitModelRef } = require('../src/shared/select');

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
});
