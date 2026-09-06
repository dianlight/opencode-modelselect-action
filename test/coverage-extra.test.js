'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const ACTION = path.join(ROOT, 'src', 'index.js');

const FIXTURE = {
  'task-types': {
    'pr-review': { go: 'opencode-go/model-a', free: 'opencode/model-b-free' },
  },
};

function runSync(inputs, { config = FIXTURE, workspace = null, useStdout = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'select-extra-'));
  let configPathArg = inputs['CONFIG-PATH'];
  if (config !== null && !configPathArg?.startsWith('http')) {
    const cfgFile = path.join(dir, 'model-config.json');
    fs.writeFileSync(cfgFile, typeof config === 'string' ? config : JSON.stringify(config));
    configPathArg = cfgFile;
  }
  const outPath = path.join(dir, 'github-output.txt');
  const env = { ...process.env, ...(useStdout ? {} : { GITHUB_OUTPUT: outPath }) };
  delete env.GITHUB_OUTPUT;
  if (!useStdout) env.GITHUB_OUTPUT = outPath;
  // Isolate workspace when requested so local file lookup misses on purpose.
  if (workspace === 'isolated') env.GITHUB_WORKSPACE = dir;
  else if (workspace) env.GITHUB_WORKSPACE = workspace;
  else delete env.GITHUB_WORKSPACE;
  // Ensure OPENCODE_API_KEY does not leak between tests unless explicitly set.
  const finalInputs = { ...inputs };
  if (configPathArg !== undefined) finalInputs['CONFIG-PATH'] = configPathArg;
  for (const [k, v] of Object.entries(finalInputs)) {
    env[`INPUT_${k.replace(/ /g, '_').toUpperCase()}`] = v;
  }
  let exit = 0;
  let stderr = '';
  let stdout = '';
  try {
    stdout = execFileSync('node', [ACTION], { env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  } catch (err) {
    exit = err.status ?? 1;
    stderr = String(err.stderr ?? '');
    stdout = String(err.stdout ?? '');
  }
  const outputs = {};
  if (!useStdout && fs.existsSync(outPath)) {
    for (const line of fs.readFileSync(outPath, 'utf8').split('\n')) {
      const i = line.indexOf('=');
      if (i > 0) outputs[line.slice(0, i)] = line.slice(i + 1);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { exit, stderr, stdout, outputs };
}

function runAsync(inputs, { workspace = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'select-extra-'));
  const configPath = path.join(dir, 'model-config.json');
  fs.writeFileSync(configPath, JSON.stringify(FIXTURE));
  const outPath = path.join(dir, 'github-output.txt');
  const env = { ...process.env, GITHUB_OUTPUT: outPath };
  if (workspace === 'isolated') env.GITHUB_WORKSPACE = dir;
  else delete env.GITHUB_WORKSPACE;
  const finalInputs = { 'CONFIG-PATH': configPath, ...inputs };
  for (const [k, v] of Object.entries(finalInputs)) {
    env[`INPUT_${k.replace(/ /g, '_').toUpperCase()}`] = v;
  }
  return new Promise((resolve) => {
    execFile('node', [ACTION], { env }, (err, _stdout, stderr) => {
      const outputs = {};
      if (fs.existsSync(outPath)) {
        for (const line of fs.readFileSync(outPath, 'utf8').split('\n')) {
          const i = line.indexOf('=');
          if (i > 0) outputs[line.slice(0, i)] = line.slice(i + 1);
        }
      }
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ exit: err ? (err.code ?? 1) : 0, stderr: String(stderr ?? ''), outputs });
    });
  });
}

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const goAvailable = {
  rollingUsage: { status: 'ok', usagePercent: 10, resetInSec: 100 },
  weeklyUsage: { status: 'ok', usagePercent: 20, resetInSec: 200 },
  monthlyUsage: { status: 'ok', usagePercent: 30, resetInSec: 300 },
};
const goExhausted = {
  usage: {
    rolling: { status: 'ok', percent: 100, resetsAt: new Date(Date.now() + 60000).toISOString() },
    weekly: { status: 'ok', percent: 20, resetsAt: new Date(Date.now() + 60000).toISOString() },
    monthly: { status: 'ok', percent: 30, resetsAt: new Date(Date.now() + 60000).toISOString() },
  },
};

async function withMocks({ usageBody = goAvailable, usageStatus = 200, probeStatus = 200, rawUsage = null } = {}, fn) {
  const usage = await startServer((req, res) => {
    if (rawUsage !== null) {
      res.writeHead(usageStatus, { 'Content-Type': 'application/json' });
      res.end(rawUsage);
      return;
    }
    json(res, usageStatus, usageBody);
  });
  const probe = await startServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      void body;
      if (probeStatus === 200) json(res, 200, { choices: [{ message: { content: 'pong' } }] });
      else json(res, probeStatus, { error: { message: `probe http ${probeStatus}` } });
    });
  });
  try {
    return await fn({ usageUrl: usage.url, probeUrl: probe.url });
  } finally {
    usage.server.close();
    probe.server.close();
  }
}

function autoInputs(urls, extra = {}) {
  return {
    'TASK-TYPE': 'pr-review',
    TIER: 'auto',
    'OPENCODE-TOKEN': 'test-token',
    'USAGE-URL': urls.usageUrl,
    'PROBE-URL': urls.probeUrl,
    'CONFIG-URL': '',
    ...extra,
  };
}

describe('select-model input validation', () => {
  it('fails when task-type input is missing', () => {
    const { exit, stderr } = runSync({ 'CONFIG-PATH': 'data/model-config.json', 'CONFIG-URL': '' });
    assert.equal(exit, 1);
    assert.match(stderr, /task-type/);
  });

  it('rejects invalid max-wait-seconds', () => {
    for (const bad of ['-1', 'abc']) {
      const { exit, stderr } = runSync({
        'TASK-TYPE': 'pr-review', TIER: 'go', 'MAX-WAIT-SECONDS': bad, 'CONFIG-URL': '',
      });
      assert.equal(exit, 1);
      assert.match(stderr, /max-wait-seconds/);
    }
  });

  it('rejects invalid poll-interval-seconds', () => {
    for (const bad of ['0', '-5', 'abc']) {
      const { exit, stderr } = runSync({
        'TASK-TYPE': 'pr-review', TIER: 'go', 'POLL-INTERVAL-SECONDS': bad, 'CONFIG-URL': '',
      });
      assert.equal(exit, 1);
      assert.match(stderr, /poll-interval-seconds/);
    }
  });
});

describe('select-model config loading', () => {
  it('prints outputs to stdout when GITHUB_OUTPUT is unset', () => {
    const { exit, stdout } = runSync(
      { 'TASK-TYPE': 'pr-review', TIER: 'go', 'CONFIG-URL': '' },
      { useStdout: true },
    );
    assert.equal(exit, 0);
    assert.match(stdout, /model=opencode-go\/model-a/);
  });

  it('fails on invalid local JSON', () => {
    const { exit, stderr } = runSync(
      { 'TASK-TYPE': 'pr-review', 'CONFIG-URL': '' },
      { config: '{not-json' },
    );
    assert.equal(exit, 1);
    assert.match(stderr, /Invalid or unreadable/);
  });

  // Async: must not block the event loop or the in-process mock server
  // cannot answer the child's fetch (same reason as the auto-tier tests).
  function runRemoteAsync(inputs, configUrl) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'select-extra-'));
    const outPath = path.join(dir, 'github-output.txt');
    const env = {
      ...process.env,
      GITHUB_OUTPUT: outPath,
      GITHUB_WORKSPACE: dir,
      [`INPUT_CONFIG-PATH`]: 'does/not-exist.json',
      [`INPUT_CONFIG-URL`]: configUrl,
    };
    for (const [k, v] of Object.entries(inputs)) {
      env[`INPUT_${k.replace(/ /g, '_').toUpperCase()}`] = v;
    }
    return new Promise((resolve) => {
      execFile('node', [ACTION], { env }, (err, _stdout, stderr) => {
        const outputs = {};
        if (fs.existsSync(outPath)) {
          for (const line of fs.readFileSync(outPath, 'utf8').split('\n')) {
            const i = line.indexOf('=');
            if (i > 0) outputs[line.slice(0, i)] = line.slice(i + 1);
          }
        }
        fs.rmSync(dir, { recursive: true, force: true });
        resolve({ exit: err ? (err.code ?? 1) : 0, stderr: String(stderr ?? ''), outputs });
      });
    });
  }

  it('loads remote config when local file is missing', async () => {
    const remote = await startServer((_req, res) => json(res, 200, FIXTURE));
    try {
      const { exit, outputs } = await runRemoteAsync(
        { 'TASK-TYPE': 'pr-review', TIER: 'free' }, remote.url,
      );
      assert.equal(exit, 0);
      assert.equal(outputs.model, 'opencode/model-b-free');
      assert.equal(outputs['config-source'], 'remote');
    } finally {
      remote.server.close();
    }
  });

  it('fails when remote returns non-ok and no local copy exists', async () => {
    const remote = await startServer((_req, res) => json(res, 500, { error: 'x' }));
    try {
      const { exit, stderr } = await runRemoteAsync(
        { 'TASK-TYPE': 'pr-review' }, remote.url,
      );
      assert.equal(exit, 1);
      assert.match(stderr, /unreachable/);
    } finally {
      remote.server.close();
    }
  });

  it('fails when remote returns invalid JSON', async () => {
    const remote = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('not-json{{{');
    });
    try {
      const { exit, stderr } = await runRemoteAsync(
        { 'TASK-TYPE': 'pr-review' }, remote.url,
      );
      assert.equal(exit, 1);
      assert.match(stderr, /unreachable/);
    } finally {
      remote.server.close();
    }
  });

  it('fails when no config is reachable at all', () => {
    const { exit, stderr } = runSync(
      { 'TASK-TYPE': 'pr-review', 'CONFIG-PATH': 'does/not-exist.json', 'CONFIG-URL': '' },
      { config: null, workspace: 'isolated' },
    );
    assert.equal(exit, 1);
    assert.match(stderr, /unreachable/);
  });

  it('fails on missing task-types object', () => {
    const { exit, stderr } = runSync(
      { 'TASK-TYPE': 'pr-review', 'CONFIG-URL': '' },
      { config: { foo: 1 } },
    );
    assert.equal(exit, 1);
    assert.match(stderr, /task-types/);
  });

  it('fails when the task-type entry is not an object', () => {
    const { exit, stderr } = runSync(
      { 'TASK-TYPE': 'pr-review', 'CONFIG-URL': '' },
      { config: { 'task-types': { 'pr-review': 'nope' } } },
    );
    assert.equal(exit, 1);
    assert.match(stderr, /must be an object/);
  });

  it('fails when a tier value is not a string', () => {
    const { exit, stderr } = runSync(
      { 'TASK-TYPE': 'pr-review', 'CONFIG-URL': '' },
      { config: { 'task-types': { 'pr-review': { go: 123, free: 'x' } } } },
    );
    assert.equal(exit, 1);
    assert.match(stderr, /must be a string/);
  });
});

describe('select-model go availability branches', () => {
  // NOTE: go-first order is required so the go endpoint is actually probed;
  // with free-first a healthy free probe would return before go is checked.
  const goFirst = { 'AUTO-PREFERENCE': 'go-first' };

  it('treats go 403 as unavailable and picks free', async () => {
    const r = await withMocks({ usageStatus: 403 }, (urls) => runAsync(autoInputs(urls, goFirst)));
    assert.equal(r.exit, 0);
    assert.equal(r.outputs['tier-selected'], 'free');
  });

  it('treats go 404 as unavailable and picks free', async () => {
    const r = await withMocks({ usageStatus: 404 }, (urls) => runAsync(autoInputs(urls, goFirst)));
    assert.equal(r.exit, 0);
    assert.equal(r.outputs['tier-selected'], 'free');
  });

  it('treats go 429 as unavailable and picks free', async () => {
    const r = await withMocks({ usageStatus: 429 }, (urls) => runAsync(autoInputs(urls, goFirst)));
    assert.equal(r.exit, 0);
    assert.equal(r.outputs['tier-selected'], 'free');
  });

  it('treats go 500 as transient and still picks free', async () => {
    const r = await withMocks({ usageStatus: 500 }, (urls) => runAsync(autoInputs(urls, goFirst)));
    assert.equal(r.exit, 0);
    assert.equal(r.outputs['tier-selected'], 'free');
  });

  it('treats go invalid JSON as transient and still picks free', async () => {
    const r = await withMocks({ rawUsage: 'not-json{{{', usageStatus: 200 }, (urls) => runAsync(autoInputs(urls, goFirst)));
    assert.equal(r.exit, 0);
    assert.equal(r.outputs['tier-selected'], 'free');
  });

  it('treats go unknown payload shape as transient and still picks free', async () => {
    const r = await withMocks({ usageBody: { hello: 'world' } }, (urls) => runAsync(autoInputs(urls, goFirst)));
    assert.equal(r.exit, 0);
    assert.equal(r.outputs['tier-selected'], 'free');
  });

  it('treats blocked status as exhausted and picks free first fallback', async () => {
    const blocked = {
      rollingUsage: { status: 'limited', usagePercent: 10, resetInSec: 5 },
      weeklyUsage: { status: 'ok', usagePercent: 10, resetInSec: 5 },
      monthlyUsage: { status: 'ok', usagePercent: 10, resetInSec: 5 },
    };
    const r = await withMocks({ usageBody: blocked, probeStatus: 429 }, (urls) => runAsync(autoInputs(urls)));
    assert.equal(r.exit, 1);
    assert.match(r.stderr, /No model available/);
  });

  it('fails on go 401 invalid token', async () => {
    const r = await withMocks({ usageStatus: 401 }, (urls) =>
      runAsync(autoInputs(urls, { 'AUTO-PREFERENCE': 'go-first' })));
    assert.equal(r.exit, 1);
    assert.match(r.stderr, /401/);
  });

  it('treats unreachable go usage as transient and picks free', async () => {
    const probe = await startServer((_req, res) => json(res, 200, { ok: true }));
    try {
      const r = await runAsync({
        'TASK-TYPE': 'pr-review',
        TIER: 'auto',
        'AUTO-PREFERENCE': 'go-first',
        'OPENCODE-TOKEN': 't',
        'USAGE-URL': 'http://127.0.0.1:1',
        'PROBE-URL': probe.url,
        'CONFIG-URL': '',
      });
      assert.equal(r.exit, 0);
      assert.equal(r.outputs['tier-selected'], 'free');
    } finally {
      probe.server.close();
    }
  });
});

describe('select-model free probe branches', () => {
  it('falls back to go on free 404', async () => {
    const r = await withMocks({ probeStatus: 404 }, (urls) => runAsync(autoInputs(urls)));
    assert.equal(r.exit, 0);
    assert.equal(r.outputs['tier-selected'], 'go');
  });

  it('falls back to go on free 403', async () => {
    const r = await withMocks({ probeStatus: 403 }, (urls) => runAsync(autoInputs(urls)));
    assert.equal(r.exit, 0);
    assert.equal(r.outputs['tier-selected'], 'go');
  });

  it('falls back to go on free 503', async () => {
    const r = await withMocks({ probeStatus: 503 }, (urls) => runAsync(autoInputs(urls)));
    assert.equal(r.exit, 0);
    assert.equal(r.outputs['tier-selected'], 'go');
  });

  it('falls back to go on free 500 transient', async () => {
    const r = await withMocks({ probeStatus: 500 }, (urls) => runAsync(autoInputs(urls)));
    assert.equal(r.exit, 0);
    assert.equal(r.outputs['tier-selected'], 'go');
  });

  it('fails on free 401 invalid token', async () => {
    const r = await withMocks({ probeStatus: 401 }, (urls) => runAsync(autoInputs(urls)));
    assert.equal(r.exit, 1);
    assert.match(r.stderr, /401/);
  });

  it('treats unreachable free probe as transient and picks go', async () => {
    const usage = await startServer((_req, res) => json(res, 200, goAvailable));
    try {
      const r = await runAsync({
        'TASK-TYPE': 'pr-review',
        TIER: 'auto',
        'OPENCODE-TOKEN': 't',
        'USAGE-URL': usage.url,
        'PROBE-URL': 'http://127.0.0.1:1',
        'CONFIG-URL': '',
      });
      assert.equal(r.exit, 0);
      assert.equal(r.outputs['tier-selected'], 'go');
    } finally {
      usage.server.close();
    }
  });
});

describe('select-model auto missing config', () => {
  it('fails on unknown task-type with tier auto and no fallback', () => {
    const { exit, stderr } = runSync({
      'TASK-TYPE': 'nope', TIER: 'auto', 'OPENCODE-TOKEN': 't', 'CONFIG-URL': '',
    });
    assert.equal(exit, 1);
    assert.match(stderr, /No model resolved/);
  });

  it('uses fallback for unknown task-type with tier auto', () => {
    const { exit, outputs } = runSync({
      'TASK-TYPE': 'nope', TIER: 'auto', 'OPENCODE-TOKEN': 't',
      'FALLBACK-MODEL': 'opencode/fb', 'CONFIG-URL': '',
    });
    assert.equal(exit, 0);
    assert.equal(outputs.model, 'opencode/fb');
    assert.match(outputs['config-source'], /fallback/);
  });

  it('fails when entry has neither go nor free models', () => {
    const { exit, stderr } = runSync(
      { 'TASK-TYPE': 'empty', TIER: 'auto', 'OPENCODE-TOKEN': 't', 'CONFIG-URL': '' },
      { config: { 'task-types': { empty: {} } } },
    );
    assert.equal(exit, 1);
    assert.match(stderr, /No model resolved/);
  });

  it('uses fallback when entry has neither go nor free models', () => {
    const { exit, outputs } = runSync(
      {
        'TASK-TYPE': 'empty', TIER: 'auto', 'OPENCODE-TOKEN': 't',
        'FALLBACK-MODEL': 'opencode/fb', 'CONFIG-URL': '',
      },
      { config: { 'task-types': { empty: {} } } },
    );
    assert.equal(exit, 0);
    assert.equal(outputs.model, 'opencode/fb');
  });

  it('uses fallback when auto finds nothing available', async () => {
    const dir = require('node:os').tmpdir();
    void dir;
    const result = await withMocks({ usageBody: goExhausted, probeStatus: 429 }, async (urls) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'select-extra-'));
      const cfg = path.join(tmp, 'model-config.json');
      fs.writeFileSync(cfg, JSON.stringify(FIXTURE));
      const out = path.join(tmp, 'out.txt');
      const env = {
        ...process.env,
        GITHUB_OUTPUT: out,
        'INPUT_TASK-TYPE': 'pr-review',
        INPUT_TIER: 'auto',
        'INPUT_OPENCODE-TOKEN': 't',
        'INPUT_USAGE-URL': urls.usageUrl,
        'INPUT_PROBE-URL': urls.probeUrl,
        'INPUT_CONFIG-PATH': cfg,
        'INPUT_CONFIG-URL': '',
        'INPUT_FALLBACK-MODEL': 'opencode/fb',
      };
      delete env.GITHUB_WORKSPACE;
      const r = await new Promise((resolve) => {
        execFile('node', [ACTION], { env }, (err, _stdout, stderr) => {
          const outputs = {};
          if (fs.existsSync(out)) {
            for (const line of fs.readFileSync(out, 'utf8').split('\n')) {
              const i = line.indexOf('=');
              if (i > 0) outputs[line.slice(0, i)] = line.slice(i + 1);
            }
          }
          resolve({ exit: err ? (err.code ?? 1) : 0, stderr: String(stderr ?? ''), outputs });
        });
      });
      fs.rmSync(tmp, { recursive: true, force: true });
      return r;
    });
    assert.equal(result.exit, 0);
    assert.equal(result.outputs.model, 'opencode/fb');
  });

  it('prefers the only configured side when the other is missing', async () => {
    const goOnly = { 'task-types': { only: { go: 'opencode-go/only' } } };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'select-extra-'));
    const cfg = path.join(tmp, 'model-config.json');
    fs.writeFileSync(cfg, JSON.stringify(goOnly));
    const out = path.join(tmp, 'out.txt');
    const usage = await startServer((_req, res) => json(res, 200, goAvailable));
    const probe = await startServer((_req, res) => json(res, 429, { error: 'x' }));
    try {
      const env = {
        ...process.env,
        GITHUB_OUTPUT: out,
        'INPUT_TASK-TYPE': 'only',
        INPUT_TIER: 'auto',
        'INPUT_OPENCODE-TOKEN': 't',
        'INPUT_USAGE-URL': usage.url,
        'INPUT_PROBE-URL': probe.url,
        'INPUT_CONFIG-PATH': cfg,
        'INPUT_CONFIG-URL': '',
      };
      delete env.GITHUB_WORKSPACE;
      const r = await new Promise((resolve) => {
        execFile('node', [ACTION], { env }, (err, _stdout, stderr) => {
          const outputs = {};
          if (fs.existsSync(out)) {
            for (const line of fs.readFileSync(out, 'utf8').split('\n')) {
              const i = line.indexOf('=');
              if (i > 0) outputs[line.slice(0, i)] = line.slice(i + 1);
            }
          }
          resolve({ exit: err ? (err.code ?? 1) : 0, stderr: String(stderr ?? ''), outputs });
        });
      });
      assert.equal(r.exit, 0);
      assert.equal(r.outputs['tier-selected'], 'go');
    } finally {
      usage.server.close();
      probe.server.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('select-model max-cost edge cases', () => {
  const TIED = {
    'task-types': {
      'pr-review': {
        go: 'opencode-go/a',
        free: 'x',
        go_ranked: [
          { model: 'opencode-go/a', score: 90, blended_cost: 5 },
          { model: 'opencode-go/b', score: 90, blended_cost: 2 },
          { model: 'opencode-go/c', score: 90 },
          { model: 'opencode-go/d', score: 80, blended_cost: 1 },
        ],
      },
    },
  };
  const UNKNOWN_COSTS = {
    'task-types': {
      'pr-review': {
        go: 'opencode-go/a',
        free: 'x',
        go_ranked: [
          { model: 'opencode-go/a', score: 90 },
          { model: 'opencode-go/b', score: 80 },
        ],
      },
    },
  };

  it('breaks score ties by cheapest known cost', () => {
    const { exit, outputs } = runSync(
      { 'TASK-TYPE': 'pr-review', TIER: 'go', 'MAX-COST': '3', 'CONFIG-URL': '' },
      { config: TIED },
    );
    assert.equal(exit, 0);
    assert.equal(outputs.model, 'opencode-go/b');
  });

  it('reports no known cost when nothing has a cost', () => {
    const { exit, stderr } = runSync(
      { 'TASK-TYPE': 'pr-review', TIER: 'go', 'MAX-COST': '10', 'CONFIG-URL': '' },
      { config: UNKNOWN_COSTS },
    );
    assert.equal(exit, 1);
    assert.match(stderr, /no ranked model has a known cost/);
  });

  it('matches recommended model case-insensitively with provider prefix', () => {
    const cfg = {
      'task-types': {
        'pr-review': {
          go: 'OpenCode-Go/MODEL-A',
          free: 'x',
          go_ranked: [{ model: 'opencode-go/model-a', score: 90, blended_cost: 5 }],
        },
      },
    };
    const { exit, outputs } = runSync(
      { 'TASK-TYPE': 'pr-review', TIER: 'go', 'MAX-COST': '10', 'CONFIG-URL': '' },
      { config: cfg },
    );
    assert.equal(exit, 0);
    assert.equal(outputs.model, 'OpenCode-Go/MODEL-A');
    assert.equal(outputs['model-cost'], '5');
  });
});
