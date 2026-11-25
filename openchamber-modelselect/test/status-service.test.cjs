'use strict';

/**
 * End-to-end tests for the local service (`service/main.js`).
 *
 * The service is now the panel's only file owner and the section's only
 * reader, so this file drives the real wire: `/health`, `/status` (+ its
 * controls), `/config` read and write, `/chain`, `/pick`, the quota provider,
 * and the promise that reading never rewrites the project's routing config.
 *
 * Run `bun run build` first — this test exercises the shipped bundle.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  makeFixture,
  startService,
  globalConfigPath,
  readConfigFile,
  extConfigPath,
  TOKEN,
} = require('./helpers/service.cjs');

let guestStatusViewSchema;
let quotaProviderSchemasV1;

before(async () => {
  ({ guestStatusViewSchema, quotaProviderSchemasV1 } = await import('@openchamber/sdk/schemas'));
});

describe('status service', () => {
  let fixture;
  let service;
  const q = () => ({ directory: fixture.project });

  before(async () => {
    fixture = makeFixture();
    service = await startService(fixture);
  });

  after(() => {
    if (service) service.stop();
  });

  it('answers /health for the host ready probe', async () => {
    const res = await fetch(service.base + '/health', { headers: service.auth });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  it('refuses requests without the bearer token', async () => {
    const res = await fetch(service.base + '/health');
    assert.equal(res.status, 401);
  });

  describe('/schedule (host automations)', () => {
    const run = (id, v = 1) => ({ v, requestId: 'req_test', id, at: Date.now() });

    it('accepts a valid routing-refresh wake', async () => {
      const res = await service.post('/schedule', {}, run('routing-refresh'));
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.handled, true);
    });

    it('accepts a valid quota-probe wake', async () => {
      const res = await service.post('/schedule', {}, run('quota-probe'));
      assert.equal(res.status, 200);
      assert.equal(res.body.handled, true);
    });

    it('rejects an unknown wire version', async () => {
      const res = await service.post('/schedule', {}, run('routing-refresh', 2));
      assert.equal(res.status, 400);
      assert.match(res.body.message, /Invalid schedule run/);
    });

    it('accepts an unknown schedule id without doing work', async () => {
      const res = await service.post('/schedule', {}, run('something-else'));
      assert.equal(res.status, 200);
      assert.equal(res.body.handled, false);
    });
  });

  describe('scheduled refresh behavior', () => {
    const taskTypes = { generic: { label: 'Generic', jev_criteria: 'criteria generic' } };
    const routingFile = (fx) => path.join(fx.home, '.config', 'openchamber', 'routing.json');
    const run = (id) => ({ v: 1, requestId: 'req_throttle', id, at: Date.now() });
    const waitForFile = async (file) => {
      for (let i = 0; i < 40 && !fs.existsSync(file); i += 1) {
        await new Promise((r) => setTimeout(r, 25));
      }
      assert.ok(fs.existsSync(file), 'routing.json was not written by the wake');
    };

    it('refreshes on a wake and honors the throttle on a second wake', async () => {
      const fx = makeFixture({ taskTypesCache: taskTypes });
      const svc = await startService(fx);
      try {
        await svc.get('/status', { directory: fx.project });
        const first = await svc.post('/schedule', {}, run('routing-refresh'));
        assert.equal(first.status, 200);
        const file = routingFile(fx);
        await waitForFile(file);
        const mtime = fs.statSync(file).mtimeMs;
        const second = await svc.post('/schedule', {}, run('quota-probe'));
        assert.equal(second.status, 200);
        assert.equal(fs.statSync(file).mtimeMs, mtime, 'the wake inside the window performed no extra refresh');
      } finally {
        svc.stop();
      }
    });

    it('succeeds with no open project and performs no refresh', async () => {
      const fx = makeFixture({ taskTypesCache: taskTypes });
      const svc = await startService(fx);
      try {
        const res = await svc.post('/schedule', {}, run('routing-refresh'));
        assert.equal(res.status, 200);
        assert.equal(res.body.handled, true);
        assert.equal(fs.existsSync(routingFile(fx)), false, 'no project means no routing refresh');
      } finally {
        svc.stop();
      }
    });
  });

  it('answers a view the host schema accepts', async () => {
    const res = await service.get('/status', Object.assign({ locale: 'en' }, q()));
    assert.equal(res.status, 200);
    const parsed = guestStatusViewSchema.safeParse(res.body);
    assert.ok(parsed.success, JSON.stringify(parsed.error && parsed.error.issues));
    const rows = {};
    for (const row of res.body.rows) rows[row.id] = row;
    assert.equal(rows.task.value, 'bugfix');
    assert.equal(rows.task.badge, undefined, 'bugfix is a known task type');
    assert.equal(rows.tier.dot, 'success');
    assert.equal(rows.tier.value, 'free');
    assert.equal(rows.model.value, 'opencode/zen-free');
    assert.equal(rows.usage.content.kind, 'bar');
    assert.equal(rows.usage.value, '42%');
    assert.equal(rows.task.icon, 'task-line');
    assert.equal(rows.router, undefined, 'the router switch is not a row');
    assert.deepEqual(res.body.controls, [{
      kind: 'select',
      id: 'routing-sync',
      label: 'Auto-update router',
      value: 'on',
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]
    }]);
    const latch = res.body.rows.find((row) => row.kind === 'note');
    // The countdown truncates the seconds, so the window reads "3h 5m" in
    // its first second and "3h 4m" for the minute after that.
    assert.match(latch.text, /Free tier exhausted — opencode\/deepseek-v4\.1-flash-free — retry in 3h [45]m/);
  });

  it('turns the Tier row into a control that writes the plugin option', async () => {
    const before = await service.get('/status', q());
    const tier = before.body.rows.find((r) => r.id === 'tier');
    assert.equal(tier.actions.length, 1);
    assert.equal(tier.actions[0].kind, 'select');
    assert.equal(tier.actions[0].value, 'go', 'the global config stores tier: go');
    assert.deepEqual(tier.actions[0].options.map((o) => o.value), ['auto', 'go', 'free']);

    const res = await service.post('/status', q(), { id: 'tier', value: 'free' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(typeof res.body.reload.ok, 'boolean');
    const pluginConfig = readConfigFile(globalConfigPath(fixture));
    assert.equal(pluginConfig.plugins[1].options.tier, 'free');
    assert.equal(pluginConfig.plugins[1].options.futureOption.keep, true, 'unknown keys untouched');
    assert.match(fs.readFileSync(globalConfigPath(fixture), 'utf8'), /the user owns this file/, 'JSONC comments survive a write');

    const after = await service.get('/status', q());
    assert.equal(after.body.rows.find((r) => r.id === 'tier').actions[0].value, 'free');
  });

  it('stamps the host-detection session map the plugin reads', async () => {
    const file = path.join(fixture.cache, 'openchamber-sessions.json');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 40 && !fs.existsSync(file); i += 1) await wait(25);
    assert.ok(fs.existsSync(file), 'session map was not written');
    const map = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(map.version, 1);
    assert.equal(typeof map.sessions.ses_test, 'number');
  });

  it('never rewrites the project routing config from a read', async () => {
    // The fixture has no routing.json; a read must not create one. The sync
    // runs on the timer, on the switch, and after a save — never here.
    await service.get('/status', q());
    assert.equal(fs.existsSync(path.join(fixture.cache, 'routing-sync.json')), false);
  });

  it('toggles the router sync and reports it on the next read', async () => {
    const post = await service.post('/status', q(), { id: 'routing-sync', value: 'off' });
    assert.equal(post.status, 200);
    assert.deepEqual(post.body, { ok: true });

    const file = path.join(fixture.cache, 'routing-sync.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { sync: false });

    const res = await service.get('/status', q());
    const control = res.body.controls.find((c) => c.id === 'routing-sync');
    assert.equal(control.value, 'off', 'the header control reports the file');

    await service.post('/status', q(), { id: 'routing-sync', value: 'on' });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { sync: true });
    const back = await service.get('/status', q());
    assert.equal(back.body.controls.find((c) => c.id === 'routing-sync').value, 'on');
  });

  it('answers a bad control with a message the host can toast', async () => {
    const res = await service.post('/status', q(), { id: 'nope' });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Unknown control/);
    assert.ok(res.body.message.length <= 300);
  });

  it('refuses a tier it does not know', async () => {
    const res = await service.post('/status', q(), { id: 'tier', value: 'turbo' });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Tier wants/);
  });

  it('degrades to a project-free note without a directory', async () => {
    const res = await service.get('/status', { locale: 'en' });
    assert.equal(res.body.rows.length, 1);
    assert.equal(res.body.rows[0].id, 'no-project');
  });

  describe('/config (the panel\'s only read and write)', () => {
    it('returns one snapshot for all three tabs', async () => {
      const res = await service.get('/config', { directory: fixture.project, session: 'ses_test' });
      assert.equal(res.status, 200);
      const snap = res.body;
      assert.equal(snap.pluginConfig.parseOk, true);
      assert.equal(snap.pluginConfig.entry.form, 'object');
      assert.equal(snap.pluginConfig.entry.package, '@dianlight/opencode-modelselect-plugin');
      assert.equal(snap.pluginConfig.entry.options.historyChars, 1200);
      assert.equal(snap.pluginConfigPath, '~/.config/opencode/opencode.jsonc');
      assert.deepEqual(snap.catalog.types.sort(), ['bugfix', 'code', 'generic', 'review']);
      assert.equal(snap.catalog.bounds.min, 0);
      assert.equal(snap.catalog.bounds.max, 8);
      assert.equal(snap.extConfig.autoSmallModel, true);
      assert.equal(snap.extConfig.keep, 'me');
      assert.equal(snap.syncOn, true);
      assert.equal(snap.sessionTask, 'bugfix');
      assert.equal(snap.pluginConfig.entry.options.token, undefined, 'secrets are never returned');
    });

    it('saves the plugin options with read-modify-write and keeps the stored secret', async () => {
      const res = await service.post('/config', q(), {
        kind: 'plugin',
        values: {
          tier: 'auto',
          autoPreference: 'free-first',
          taskType: 'auto',
          defaultTaskType: 'generic',
          announce: 'switch',
          openchamber: 'auto',
          verbose: false,
          suggestOnly: false,
          continuation: true,
          configUrl: '',
          taskTypesUrl: '',
          jevEndpoint: '',
          jevModel: '',
          fallbackModel: '',
          agentTaskMap: { build: 'code' },
          tokenDraft: '',
          jevTokenDraft: '',
          maxCost: null,
          historyChars: 3000,
          configRefreshMinutes: 1440,
          jevThreshold: 0.6,
          jevTimeoutMs: 10000,
        },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(typeof res.body.reload.ok, 'boolean');

      const config = readConfigFile(globalConfigPath(fixture));
      assert.equal(config.theme, 'dark', 'top-level unknown key preserved');
      assert.equal(config.plugins[0], 'some-other-plugin');
      const options = config.plugins[1].options;
      assert.equal(options.historyChars, 3000);
      assert.equal(options.token, 'SUPERSECRET', 'blank draft keeps the stored value');
      assert.equal(options.futureOption.keep, true, 'unknown option preserved');
      assert.equal('maxCost' in options, false, 'no cap removes the key');
      assert.equal('fallbackModel' in options, false);
      assert.equal(options.configUrl, 'https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/model-config.json');
    });

    it('stores a typed secret and never echoes it back', async () => {
      const snapshot = await service.get('/config', q());
      const values = Object.assign({}, snapshot.body.pluginConfig.entry.options, {
        tokenDraft: 'NEWSECRET',
        jevTokenDraft: '',
      });
      const res = await service.post('/config', q(), { kind: 'plugin', values });
      assert.equal(res.status, 200);
      const config = readConfigFile(globalConfigPath(fixture));
      assert.equal(config.plugins[1].options.token, 'NEWSECRET');
      const after = await service.get('/config', q());
      assert.equal(after.body.pluginConfig.entry.options.token, undefined);
    });

    it('converts a string plugin entry in place', async () => {
      const fixture2 = makeFixture({
        pluginConfig: JSON.stringify({ plugins: ['some-other-plugin', '@dianlight/opencode-modelselect-plugin'] }),
      });
      const service2 = await startService(fixture2);
      try {
        const snap = await service2.get('/config', { directory: fixture2.project });
        assert.equal(snap.body.pluginConfig.entry.form, 'string');
        const res = await service2.post('/config', { directory: fixture2.project }, {
          kind: 'plugin',
          values: Object.assign({}, snap.body.pluginConfig.entry.options, { historyChars: 2500 }),
        });
        assert.equal(res.status, 200);
        const plugins = readConfigFile(globalConfigPath(fixture2)).plugins;
        assert.equal(plugins[0], 'some-other-plugin');
        assert.equal(plugins[1].package, '@dianlight/opencode-modelselect-plugin');
        assert.equal(plugins[1].options.historyChars, 2500);
      } finally {
        service2.stop();
      }
    });

    it('adds a bare entry only when there is none', async () => {
      const fixture3 = makeFixture({ pluginConfig: JSON.stringify({ plugins: [] }) });
      const service3 = await startService(fixture3);
      try {
        const first = await service3.post('/config', { directory: fixture3.project }, { kind: 'plugin-add' });
        assert.equal(first.status, 200);
        assert.equal(first.body.added, true);
        const second = await service3.post('/config', { directory: fixture3.project }, { kind: 'plugin-add' });
        assert.equal(second.body.added, false);
        const plugins = readConfigFile(globalConfigPath(fixture3)).plugins;
        assert.equal(plugins.filter((p) => p && p.package === '@dianlight/opencode-modelselect-plugin').length, 1);
      } finally {
        service3.stop();
      }
    });

    it('refuses to write an unparseable global config', async () => {
      const fixture4 = makeFixture({ pluginConfig: '{ not json' });
      const service4 = await startService(fixture4);
      try {
        const snap = await service4.get('/config', { directory: fixture4.project });
        assert.equal(snap.body.pluginConfig.parseOk, false);
        assert.match(snap.body.pluginConfig.parseError, /not valid JSON/);
        const res = await service4.post('/config', { directory: fixture4.project }, {
          kind: 'plugin',
          values: { tier: 'auto' },
        });
        assert.equal(res.status, 409);
        assert.match(res.body.message, /not valid JSON/);
        assert.equal(fs.readFileSync(globalConfigPath(fixture4), 'utf8'), '{ not json');
      } finally {
        service4.stop();
      }
    });

    it('saves the extension config and keeps unknown keys', async () => {
      const res = await service.post('/config', q(), {
        kind: 'extension',
        values: {
          autoSmallModel: false,
          autoWalkthroughModel: true,
          smallModelTask: 'small-model',
          walkthroughModelTask: 'review',
        },
      });
      assert.equal(res.status, 200);
      const ext = JSON.parse(fs.readFileSync(extConfigPath(fixture), 'utf8'));
      assert.equal(ext.autoSmallModel, false);
      assert.equal(ext.autoWalkthroughModel, true);
      assert.equal(ext.walkthroughModelTask, 'review');
      assert.equal(ext.keep, 'me');
    });

    it('answers 400 without a project', async () => {
      const res = await service.get('/config', {});
      assert.equal(res.status, 400);
      assert.match(res.body.message, /No project/);
    });
  });

  describe('/chain', () => {
    it('returns the pick and one row per model, with usage bars', async () => {
      const res = await service.get('/chain', { directory: fixture.project, task: 'generic' });
      assert.equal(res.status, 200);
      const view = res.body;
      assert.equal(view.found, true);
      // The fixture latches the free model, so auto fails over to the go side.
      assert.equal(view.side, 'go');
      assert.match(view.pick, /opencode-go\//);
      assert.ok(view.chain.length >= 3);
      const pick = view.chain.find((r) => r.status === 'pick');
      assert.ok(pick, 'one row is the pick');
      assert.equal(pick.bar.tone, 'ok');
      assert.match(pick.bar.label, /PICK/);
      const latched = view.chain.find((r) => /quota latched/.test(r.reason || ''));
      assert.ok(latched, 'the latched free row is excluded');
      assert.equal(latched.bar.tone, 'err');
      assert.equal(latched.bar.pct, 100);
    });

    it('says so when the task is not in the cache', async () => {
      const res = await service.get('/chain', { directory: fixture.project, task: 'nope' });
      assert.equal(res.body.found, false);
    });
  });

  describe('/pick', () => {
    it('summarises one session\'s pick for the background action', async () => {
      const res = await service.get('/pick', { directory: fixture.project, session: 'ses_test' });
      assert.equal(res.status, 200);
      assert.match(res.body.text, /bugfix · free · opencode\/zen-free · High/);
      assert.equal(res.body.stale, false);
    });

    it('answers 404 for a session that never routed', async () => {
      const res = await service.get('/pick', { directory: fixture.project, session: 'ses_none' });
      assert.equal(res.status, 404);
      assert.match(res.body.message, /first turn/);
    });
  });

  describe('/quota', () => {
    it('reports the snapshot of the project the section last named', async () => {
      // The quota call itself carries no directory; /status above set it.
      const res = await service.post('/quota', {}, { method: 'usage.read' });
      assert.equal(res.status, 200);
      const data = res.body.data;
      assert.equal(data.ok, true);
      assert.equal(data.configured, true);
      assert.equal(data.usage.windows.monthly.usedPercent, 42);
      assert.deepEqual(data.usage.models, {}, 'the fixture has no Console budgets');
      // OpenChamber rejects the whole provider when nulls or an `error: null`
      // leak onto the wire — keep this payload aligned with the host schema.
      const parsed = quotaProviderSchemasV1.usage.safeParse(data);
      assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
    });

    it('refuses an unknown quota request without throwing', async () => {
      const res = await service.post('/quota', {}, { method: 'nope' });
      assert.equal(res.body.ok, false);
      assert.match(res.body.error.message, /Unexpected quota request/);
    });
  });
});

describe('service without a bearer', () => {
  it('rejects a wrong token', async () => {
    const fixture = makeFixture();
    const service = await startService(fixture);
    try {
      const res = await fetch(service.base + '/status', {
        headers: { Authorization: 'Bearer ' + TOKEN + 'x' },
      });
      assert.equal(res.status, 401);
    } finally {
      service.stop();
    }
  });
});
