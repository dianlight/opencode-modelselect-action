'use strict';

/**
 * Shared routing-sync core (`src/shared/routing.js`) + fs adapter
 * (`src/shared/routing-io.js`). The Work Status bundle wraps the same core
 * in a host adapter, so these tests pin the behavior both consumers rely
 * on: criteria verbatim, empty criteria ignored, stale entries disabled,
 * unusable payloads never write, writes only on diff.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ROUTING_PATH,
  FREE_QUOTA_FILE,
  FREE_QUOTA_TTL_MS,
  parseJsonLenient,
  findPluginOptions,
  autoPreferenceOf,
  normalizeModelselectConfig,
  pickSideRef,
  mergeSettingsOverrides,
  mergePreferencesOverrides,
  splitModelRef,
  buildDesired,
  mergeCategories,
  syncRouting,
} = require('../src/shared/routing');
const { createRoutingIo, resolveLogicalPath } = require('../src/shared/routing-io');

function tempdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Fake IO over an in-memory map keyed by logical path (also exposes
// `files`/`writes` for assertions).
function fakeIo(initial = {}) {
  const files = new Map(Object.entries(initial));
  const writes = [];
  return {
    files,
    writes,
    async readJson(p) {
      return files.has(p) ? files.get(p) : null;
    },
    async writeJson(p, value) {
      files.set(p, value);
      writes.push(p);
    },
  };
}

const TASK_TYPES = {
  review: { label: 'Review', description: 'Review diffs', jev_criteria: 'Review work: judge diffs.' },
  docs: { label: 'Docs', description: 'Docs', jev_criteria: '' },
  generic: { label: 'Generic', description: 'Generic', jev_criteria: 'Everything else.' },
};
const MODEL_TABLE = {
  review: { go: 'g/a', free: 'f/b' },
  docs: { go: 'g/d', free: 'f/d' },
  generic: { go: 'g/x', free: 'f/x' },
};

function caches(overrides = {}) {
  return {
    '.opencode/.modelselect-cache/model-config-cache.json': {
      fetchedAt: 1,
      config: { 'task-types': MODEL_TABLE },
      ...(overrides.model || {}),
    },
    '.opencode/.modelselect-cache/task-types-cache.json': {
      v: 2,
      fetchedAt: 1,
      taskTypes: overrides.taskTypes || TASK_TYPES,
    },
  };
}

describe('routing core helpers', () => {
  it('parseJsonLenient strips // and /* */ comments outside strings', () => {
    assert.deepEqual(parseJsonLenient('{"a":1}'), { a: 1 });
    assert.deepEqual(parseJsonLenient('{ // note\n"a": /* x */ 1}'), { a: 1 });
    assert.deepEqual(parseJsonLenient('{"a":"http://x//y"}'), { a: 'http://x//y' });
    assert.throws(() => parseJsonLenient('nope{'));
  });

  it('findPluginOptions handles v1/v2 shapes and picks autoPreference', () => {
    assert.equal(autoPreferenceOf({}), 'free-first');
    assert.equal(autoPreferenceOf({ autoPreference: 'GO-First ' }), 'go-first');
    assert.deepEqual(
      findPluginOptions({ plugins: [{ package: 'opencode-modelselect-plugin', options: { autoPreference: 'go-first' } }] }),
      { autoPreference: 'go-first' },
    );
    assert.deepEqual(findPluginOptions({ plugin: [['opencode-modelselect-plugin', { tier: 'go' }]] }), { tier: 'go' });
    assert.deepEqual(findPluginOptions({ plugins: ['./plugin'] }), {});
    assert.deepEqual(findPluginOptions(null), {});
  });

  it('normalizeModelselectConfig defaults to auto/off-off autoset', () => {
    assert.deepEqual(normalizeModelselectConfig(null), {
      mode: 'auto',
      autoSmallModel: false,
      autoWalkthroughModel: false,
      smallModelTask: 'small-model',
      walkthroughModelTask: 'review',
    });
    assert.equal(normalizeModelselectConfig({ mode: 'ON' }).mode, 'on');
    assert.equal(normalizeModelselectConfig({ mode: 'sometimes' }).mode, 'auto');
    const flags = normalizeModelselectConfig({ autoSmallModel: true, 'auto-walkthrough-model': true });
    assert.equal(flags.autoSmallModel, true);
    assert.equal(flags.autoWalkthroughModel, true);
  });

  it('pickSideRef + merge helpers behave', () => {
    assert.equal(pickSideRef(MODEL_TABLE, 'review', 'free-first'), 'f/b');
    assert.equal(pickSideRef(MODEL_TABLE, 'REVIEW', 'go-first'), 'g/a');
    assert.equal(pickSideRef(MODEL_TABLE, 'missing', 'free-first'), null);
    assert.equal(mergeSettingsOverrides(null, { a: 1 }), null);
    assert.equal(mergeSettingsOverrides({ a: 1 }, { a: 1 }), null);
    assert.deepEqual(mergeSettingsOverrides({ a: 1 }, { a: 2 }), { a: 2 });
    const prefs = mergePreferencesOverrides(null, { smallModelOverride: 'f/s' }, 7);
    assert.equal(prefs.fields.smallModelOverride.value, 'f/s');
    assert.equal(
      mergePreferencesOverrides(prefs, { smallModelOverride: 'f/s' }, 8),
      null,
      'no diff -> null',
    );
  });

  it('splitModelRef parses provider/model and rejects junk', () => {
    assert.deepEqual(splitModelRef('a/b'), { providerID: 'a', modelID: 'b' });
    assert.equal(splitModelRef('nope'), null);
    assert.equal(splitModelRef('/leading'), null);
    assert.equal(splitModelRef('trailing/'), null);
  });

  it('buildDesired applies the preference, keeps agent, ignores empty criteria', () => {
    const free = buildDesired(TASK_TYPES, MODEL_TABLE, 'free-first');
    assert.deepEqual(Object.keys(free.desired).sort(), ['generic', 'review']);
    assert.deepEqual(free.desired.review, {
      name: 'Review',
      description: 'Review work: judge diffs.',
      model: { providerID: 'f', modelID: 'b' },
    });
    assert.deepEqual(free.ignored, ['docs']);
    assert.equal(free.unusable, false);

    const go = buildDesired(TASK_TYPES, MODEL_TABLE, 'go-first');
    assert.deepEqual(go.desired.review.model, { providerID: 'g', modelID: 'a' });

    // Preferred side unconfigured -> falls back to the other one.
    const fallback = buildDesired(
      { review: { label: 'R', jev_criteria: 'c' } },
      { review: { go: 'g/a' } },
      'free-first',
    );
    assert.deepEqual(fallback.desired.review.model, { providerID: 'g', modelID: 'a' });

    const unusable = buildDesired({ docs: { label: 'D', jev_criteria: '' } }, MODEL_TABLE, 'free-first');
    assert.equal(unusable.unusable, true);
  });

  it('mergeCategories disables stale entries and keeps builtins/user values', () => {
    const { desired } = buildDesired(TASK_TYPES, MODEL_TABLE, 'free-first');
    const stored = {
      review: { builtin: false, name: 'Mine', description: 'old', model: { providerID: 'u', modelID: 'z' } },
      plan: { builtin: true, name: 'Plan', description: 'Plan work.', model: { providerID: 'g', modelID: 'p' } },
      gone: { builtin: false, name: 'Gone', description: 'stale' },
      docs: { builtin: false, name: 'Docs', description: 'Docs' },
    };
    const next = mergeCategories(stored, desired, ['docs']);
    assert.ok(next, 'expected a diff');
    // Desired wins, but the user's model survives when the payload has none.
    assert.equal(next.review.name, 'Review');
    assert.equal(next.review.description, 'Review work: judge diffs.');
    assert.deepEqual(next.review.model, { providerID: 'f', modelID: 'b' });
    // Stored builtin overrides keep builtin: true.
    assert.equal(next.plan.builtin, true);
    // Stale + ignored (docs) are disabled, never deleted.
    assert.equal(next.gone.disabled, true);
    assert.equal(next.docs.disabled, true);
    assert.equal(next.generic.disabled, undefined);
    assert.equal(mergeCategories(next, desired, ['docs']), null, 'no diff -> null');
  });
});

describe('syncRouting', () => {
  it('writes categories + generic fallback on first sync', async () => {
    const io = fakeIo(caches());
    const r = await syncRouting(io);
    assert.deepEqual(r, { written: true, settingsWritten: false });
    assert.deepEqual(io.writes, [ROUTING_PATH]);
    const routing = io.files.get(ROUTING_PATH);
    assert.equal(routing.version, 1);
    assert.equal(routing.categories.review.description, 'Review work: judge diffs.');
    assert.deepEqual(routing.fallback, { model: { providerID: 'f', modelID: 'x' } });
  });

  it('writes nothing when routing already matches', async () => {
    const first = fakeIo(caches());
    await syncRouting(first);
    const second = fakeIo({
      ...caches(),
      [ROUTING_PATH]: first.files.get(ROUTING_PATH),
    });
    const r = await syncRouting(second);
    assert.deepEqual(r, { written: false, settingsWritten: false });
    assert.equal(second.writes.length, 0);
  });

  it('honors autoPreference from the managed config', async () => {
    const io = fakeIo({
      ...caches(),
      '~/.config/openchamber/opencode.managed.json': {
        plugins: [{ package: 'opencode-modelselect-plugin', options: { autoPreference: 'go-first' } }],
      },
    });
    await syncRouting(io);
    assert.deepEqual(io.files.get(ROUTING_PATH).categories.review.model, {
      providerID: 'g',
      modelID: 'a',
    });
  });

  it('skips unusable payloads (no criteria anywhere) and empty results', async () => {
    const noCriteria = fakeIo(caches({ taskTypes: { review: { label: 'R', jev_criteria: '' } } }));
    assert.deepEqual(await syncRouting(noCriteria), { written: false, settingsWritten: false });
    assert.equal(noCriteria.writes.length, 0);

    const noModelTable = fakeIo({
      '.opencode/.modelselect-cache/task-types-cache.json': { taskTypes: TASK_TYPES },
    });
    assert.deepEqual(await syncRouting(noModelTable), { written: false, settingsWritten: false });
  });

  it('never rejects: bad io and write failures resolve { written: false }', async () => {
    assert.deepEqual(await syncRouting(null), { written: false, settingsWritten: false });
    assert.deepEqual(await syncRouting({ readJson: () => Promise.reject(new Error('boom')) }), {
      written: false,
      settingsWritten: false,
    });
    const failing = {
      ...fakeIo(caches()),
      writeJson: () => Promise.reject(new Error('denied')),
    };
    assert.deepEqual(await syncRouting(failing), { written: false, settingsWritten: false });
  });

  it('keeps the user agent only when the task type defines one', async () => {
    const io = fakeIo({
      ...caches({
        taskTypes: {
          ...TASK_TYPES,
          review: { ...TASK_TYPES.review, agent: 'review' },
        },
      }),
      [ROUTING_PATH]: {
        version: 1,
        categories: {
          generic: { builtin: false, name: 'Generic', description: 'Everything else.', agent: 'mine' },
        },
      },
    });
    await syncRouting(io);
    const cats = io.files.get(ROUTING_PATH).categories;
    assert.equal(cats.review.agent, 'review');
    assert.equal(cats.generic.agent, 'mine', 'user agent preserved when no task-type agent');
  });

  it('forces the go side while the free-quota latch is fresh (12h)', async () => {
    // Fresh latch overrides the default free-first preference…
    const fresh = fakeIo({
      ...caches(),
      [FREE_QUOTA_FILE]: {
        version: 1,
        at: Date.now(),
        until: Date.now() + FREE_QUOTA_TTL_MS,
        model: 'f/b',
        detail: 'http 429',
      },
    });
    assert.deepEqual(await syncRouting(fresh), { written: true, settingsWritten: false });
    assert.deepEqual(fresh.files.get(ROUTING_PATH).categories.review.model, {
      providerID: 'g',
      modelID: 'a',
    });

    // …and an expired latch hands the choice back to the preference.
    const expired = fakeIo({
      ...caches(),
      [FREE_QUOTA_FILE]: {
        version: 1,
        at: Date.now() - FREE_QUOTA_TTL_MS - 1,
        until: Date.now() - 1,
        model: 'f/b',
        detail: 'http 429',
      },
    });
    assert.deepEqual(await syncRouting(expired), { written: true, settingsWritten: false });
    assert.deepEqual(expired.files.get(ROUTING_PATH).categories.review.model, {
      providerID: 'f',
      modelID: 'b',
    });
  });

  it('the latch is per model: only the latched task flips to paid', async () => {
    // generic's free model (f/x) is exhausted; review keeps its free pick.
    // (`docs` carries no jev_criteria, so it never becomes a category.)
    const io = fakeIo({
      ...caches(),
      [FREE_QUOTA_FILE]: {
        version: 2,
        models: {
          'f/x': {
            at: Date.now(),
            until: Date.now() + FREE_QUOTA_TTL_MS,
            kind: 'exhaustion',
            detail: 'http 402',
            updatedAt: Date.now(),
          },
        },
      },
    });
    assert.deepEqual(await syncRouting(io), { written: true, settingsWritten: false });
    const cats = io.files.get(ROUTING_PATH).categories;
    assert.deepEqual(cats.generic.model, { providerID: 'g', modelID: 'x' }, 'generic flips to paid');
    assert.deepEqual(cats.review.model, { providerID: 'f', modelID: 'b' }, 'review stays free');
  });

  it('a legacy model-less latch still forces every row (global)', async () => {
    const io = fakeIo({
      ...caches(),
      [FREE_QUOTA_FILE]: {
        version: 1,
        at: Date.now(),
        until: Date.now() + FREE_QUOTA_TTL_MS,
        kind: 'exhaustion',
        model: null,
        detail: 'http 402',
      },
    });
    assert.deepEqual(await syncRouting(io), { written: true, settingsWritten: false });
    const cats = io.files.get(ROUTING_PATH).categories;
    assert.deepEqual(cats.review.model, { providerID: 'g', modelID: 'a' });
    assert.deepEqual(cats.generic.model, { providerID: 'g', modelID: 'x' });
  });

  it('leaves Small Model + Walkthrough rows alone unless autoset is enabled', async () => {
    const io = fakeIo({
      ...caches(),
      [ROUTING_PATH]: { version: 1, categories: {} },
      '~/.config/openchamber/preferences.json': { version: 1, fields: {} },
    });
    const r = await syncRouting(io);
    assert.equal(r.settingsWritten, false);
    assert.ok(!io.writes.includes('~/.config/openchamber/preferences.json'));
    assert.ok(!io.writes.includes('~/.config/openchamber/settings.json'));
  });

  it('autosets smallModelOverride + walkthroughModelOverride from the resolved side', async () => {
    const taskTypes = {
      ...TASK_TYPES,
      'small-model': { label: 'Small Model', jev_criteria: 'Trivial work.' },
    };
    const modelTable = {
      ...MODEL_TABLE,
      'small-model': { go: 'g/s', free: 'f/s' },
    };
    const io = fakeIo({
      ...caches({ taskTypes }),
      '.opencode/.modelselect-cache/model-config-cache.json': {
        fetchedAt: 1,
        config: { 'task-types': modelTable },
      },
      '~/.config/openchamber/modelselect.json': { autoSmallModel: true, autoWalkthroughModel: true },
      '~/.config/openchamber/settings.json': { themeId: 'x' },
      '~/.config/openchamber/preferences.json': { version: 1, fields: {} },
    });
    const r = await syncRouting(io);
    assert.equal(r.settingsWritten, true);
    const prefs = io.files.get('~/.config/openchamber/preferences.json');
    assert.equal(prefs.fields.smallModelOverride.value, 'f/s');
    assert.equal(prefs.fields.smallModelUseDefault.value, false);
    assert.equal(prefs.fields.walkthroughModelOverride.value, 'f/b');
    const settings = io.files.get('~/.config/openchamber/settings.json');
    assert.equal(settings.smallModelOverride, 'f/s');
    assert.equal(settings.smallModelUseDefault, false);
    assert.equal(settings.walkthroughModelOverride, 'f/b');
    // Second sync with everything in place writes nothing.
    const again = await syncRouting(io);
    assert.equal(again.settingsWritten, false);
  });

  it('autoset follows the go side while the free-quota latch is fresh', async () => {
    const taskTypes = {
      ...TASK_TYPES,
      'small-model': { label: 'Small Model', jev_criteria: 'Trivial work.' },
    };
    const modelTable = {
      ...MODEL_TABLE,
      'small-model': { go: 'g/s', free: 'f/s' },
    };
    const io = fakeIo({
      ...caches({ taskTypes }),
      '.opencode/.modelselect-cache/model-config-cache.json': {
        fetchedAt: 1,
        config: { 'task-types': modelTable },
      },
      '~/.config/openchamber/modelselect.json': { autoSmallModel: true },
      '~/.config/openchamber/preferences.json': { version: 1, fields: {} },
      [FREE_QUOTA_FILE]: { version: 1, at: Date.now(), until: Date.now() + FREE_QUOTA_TTL_MS },
    });
    await syncRouting(io);
    assert.equal(io.files.get('~/.config/openchamber/preferences.json').fields.smallModelOverride.value, 'g/s');
  });
});

describe('routing io adapter', () => {
  it('resolves ~ against the home and project-relative paths against the project', () => {
    assert.equal(resolveLogicalPath('/p', '/h', ROUTING_PATH), path.join('/h', '.config/openchamber/routing.json'));
    assert.equal(
      resolveLogicalPath('/p', '/h', '.opencode/.modelselect-cache/mode.json'),
      path.join('/p', '.opencode/.modelselect-cache/mode.json'),
    );
  });

  it('reads/writes under a temp home and survives missing files', async () => {
    const home = tempdir('modelselect-routing-home-');
    const project = tempdir('modelselect-routing-proj-');
    try {
      const io = createRoutingIo(project, { home });
      assert.equal(await io.readJson(ROUTING_PATH), null, 'missing file -> null');
      // Seed the project caches so the sync has something to write.
      const cache = path.join(project, '.opencode', '.modelselect-cache');
      fs.mkdirSync(cache, { recursive: true });
      fs.writeFileSync(
        path.join(cache, 'model-config-cache.json'),
        JSON.stringify({ config: { 'task-types': { review: { go: 'g/a', free: 'f/b' } } } }),
      );
      fs.writeFileSync(
        path.join(cache, 'task-types-cache.json'),
        JSON.stringify({ taskTypes: { review: { label: 'Review', jev_criteria: 'Review work.' } } }),
      );
      // No mkdir in the adapter: an absent ~/.config/openchamber means
      // OpenChamber never ran here, so the sync stays silent (ENOENT).
      assert.deepEqual(await syncRouting(io), { written: false, settingsWritten: false }, 'no dir -> no write');
      fs.mkdirSync(path.join(home, '.config', 'openchamber'), { recursive: true });
      assert.deepEqual(await syncRouting(io), { written: true, settingsWritten: false });
      const written = JSON.parse(
        fs.readFileSync(path.join(home, '.config', 'openchamber', 'routing.json'), 'utf8'),
      );
      assert.equal(written.categories.review.description, 'Review work.');
      assert.deepEqual(await io.readJson(ROUTING_PATH), written);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it('parses jsonc configs and returns null on unreadable/corrupt files', async () => {
    const home = tempdir('modelselect-routing-home-');
    try {
      const cfg = path.join(home, '.config', 'opencode');
      fs.mkdirSync(cfg, { recursive: true });
      fs.writeFileSync(path.join(cfg, 'opencode.jsonc'), '{ // c\n"plugins": [] }');
      fs.writeFileSync(path.join(home, 'broken.json'), 'nope{');
      const io = createRoutingIo(process.cwd(), { home });
      assert.deepEqual(await io.readJson('~/.config/opencode/opencode.jsonc'), { plugins: [] });
      assert.equal(await io.readJson('~/broken.json'), null);
      assert.equal(await io.readJson('~/absent.json'), null);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
