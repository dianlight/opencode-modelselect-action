'use strict';

/**
 * Shared fixture for the two integration tests.
 *
 * Builds a throwaway home + project with the files the plugin writes and the
 * configs the panel edits, spawns the committed service bundle exactly as
 * OpenChamber does (loopback port + bearer token in the env, HOME pointed at
 * the fixture so `~/...` resolves there), and hands back the wire helpers.
 *
 * Run `bun run build` first — both tests exercise the shipped bundles.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BUNDLE = path.join(__dirname, '..', '..', 'service', 'main.js');
const CACHE = '.opencode/.modelselect-cache';
const TOKEN = 'test-service-token';

const MANAGED = '~/.config/openchamber/opencode.managed.json';
const EXTCONF = '~/.config/openchamber/modelselect.json';

const MANAGED_OBJECT = JSON.stringify({
  theme: 'dark',
  plugins: [
    'some-other-plugin',
    {
      package: 'opencode-modelselect-plugin',
      options: {
        tier: 'go',
        verbose: false,
        maxCost: 3,
        historyChars: 1200,
        agentTaskMap: { build: 'code' },
        fallbackModel: '',
        token: 'SUPERSECRET',
        futureOption: { keep: true },
      },
    },
  ],
}, null, 2);

const CATALOG = {
  fetchedAt: 0,
  config: {
    'task-types': {
      generic: {
        go: 'opencode-go/gpt-5.6-luna',
        free: 'opencode/deepseek-v4.1-flash-free',
        go_ranked: [
          { model: 'opencode-go/gemini-4-argon', score: 95.1, input_cost: 4, output_cost: 20, blended_cost: 8, context: 1048576, modalities: ['text', 'image'] },
          { model: 'opencode-go/gpt-5.6-luna', score: 93, input_cost: 0.2, output_cost: 1.2, blended_cost: 0.5, context: 1050000, modalities: ['text', 'image', 'pdf'] },
        ],
        free_ranked: [
          { model: 'opencode/deepseek-v4.1-flash-free', score: 90, input_cost: 0, output_cost: 0, blended_cost: 0, context: 128000, modalities: ['text'] },
        ],
      },
      code: {
        go: 'opencode-go/gpt-5.6-luna',
        free: 'opencode/x-free',
        go_ranked: [
          { model: 'opencode-go/gpt-5.6-luna', score: 93, input_cost: 0.2, output_cost: 1.2, blended_cost: 0.5, context: 1050000, modalities: ['text', 'image', 'pdf'] },
        ],
        free_ranked: [
          { model: 'opencode/x-free', score: 80, input_cost: 0, output_cost: 0, blended_cost: 0 },
        ],
      },
      bugfix: { go: 'opencode-go/gpt-5.6-luna', free: 'opencode/zen-free', go_ranked: [], free_ranked: [] },
      review: { go_ranked: [], free_ranked: [] },
    },
  },
};

const STATUS = {
  sessionID: 'ses_test',
  taskType: 'bugfix',
  tier: 'free',
  model: 'opencode/zen-free',
  jev: 'pinned@0.8',
  goOk: true,
  think: 'high',
  variant: null,
  freeExhausted: false,
  source: 'auto',
  suggestOnly: false,
};

/**
 * Create the fixture tree. Returns absolute paths plus the `files` map the
 * panel test hands to its fake host (logical path -> content) is not needed
 * any more: the service reads the real files.
 */
function makeFixture(overrides) {
  overrides = overrides || {};
  const now = Date.now();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const cache = path.join(project, CACHE);
  const configDir = path.join(home, '.config', 'openchamber');
  fs.mkdirSync(cache, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });

  const write = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  };

  write(path.join(configDir, 'opencode.managed.json'),
    overrides.managed === undefined ? MANAGED_OBJECT : overrides.managed);
  write(path.join(configDir, 'modelselect.json'),
    overrides.extConfig === undefined
      ? { autoSmallModel: true, autoWalkthroughModel: true, smallModelTask: 'small-model', keep: 'me' }
      : overrides.extConfig);
  write(path.join(cache, 'model-config-cache.json'),
    overrides.catalog === undefined ? Object.assign({ fetchedAt: now }, CATALOG) : overrides.catalog);
  write(path.join(cache, 'status-ses_test.json'),
    Object.assign({}, STATUS, { updatedAt: now - 60 * 1000 }, overrides.status || {}));
  write(path.join(cache, 'usage-limits.json'), {
    fetchedAt: now,
    source: 'limits',
    go: { monthly: { percent: 42, limited: false, resetsAt: now + 3600 * 1000 } },
  });
  write(path.join(cache, 'free-quota.json'), {
    version: 2,
    models: {
      'opencode/deepseek-v4.1-flash-free': {
        at: now - 1000,
        until: now + 3 * 3600 * 1000 + 5 * 60 * 1000,
        kind: 'exhaustion',
        detail: 'spent',
        updatedAt: now,
      },
    },
  });

  return { root, home, project, cache, configDir, write };
}

function managedPath(fixture) {
  return path.join(fixture.configDir, 'opencode.managed.json');
}

function extConfigPath(fixture) {
  return path.join(fixture.configDir, 'modelselect.json');
}

function waitForPort(child) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('service did not announce a port in 5 s')), 5000);
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      const m = buffer.match(/listening on 127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.stderr.on('data', (chunk) => { buffer += String(chunk); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('service exited early (' + code + '): ' + buffer));
    });
  });
}

/** Spawn the bundle on an ephemeral port; resolves a tiny client. */
async function startService(fixture) {
  if (!fs.existsSync(BUNDLE)) {
    throw new Error('service/main.js is missing — run `bun run build` first');
  }
  const child = spawn(process.execPath, [BUNDLE], {
    env: Object.assign({}, process.env, {
      OPENCHAMBER_SERVICE_PORT: '0',
      OPENCHAMBER_SERVICE_TOKEN: TOKEN,
      OPENCHAMBER_HOST_CALLBACK_URL: '',
      HOME: fixture.home,
      USERPROFILE: fixture.home,
      MODELSELECT_STATE_FILE: path.join(fixture.root, 'last-project.json'),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const port = await waitForPort(child);
  const base = 'http://127.0.0.1:' + port;
  const auth = { Authorization: 'Bearer ' + TOKEN };

  const client = {
    base,
    child,
    token: TOKEN,
    auth,
    stop() {
      if (child.exitCode === null) child.kill('SIGTERM');
    },
    async get(pathname, query) {
      const url = new URL(pathname, base);
      Object.entries(query || {}).forEach(([k, v]) => url.searchParams.set(k, v));
      const res = await fetch(url, { headers: auth });
      return { status: res.status, body: await res.json() };
    },
    async post(pathname, query, body, headers) {
      const url = new URL(pathname, base);
      Object.entries(query || {}).forEach(([k, v]) => url.searchParams.set(k, v));
      const res = await fetch(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, auth, headers || {}),
        body: JSON.stringify(body || {}),
      });
      return { status: res.status, body: await res.json() };
    },
  };
  return client;
}

module.exports = {
  BUNDLE,
  CACHE,
  TOKEN,
  MANAGED,
  EXTCONF,
  MANAGED_OBJECT,
  CATALOG,
  STATUS,
  makeFixture,
  managedPath,
  extConfigPath,
  startService,
};
