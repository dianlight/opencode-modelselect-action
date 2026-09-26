'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ACTION = path.join(ROOT, 'src', 'index.js');

const FIXTURE = {
  'task-types': {
    'pr-review': { go: 'opencode-go/model-a', free: 'opencode/model-b-free' },
  },
};

function run(inputs, { config = FIXTURE } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'select-model-'));
  const configPath = path.join(dir, 'model-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  const outPath = path.join(dir, 'github-output.txt');
  const env = { ...process.env, GITHUB_OUTPUT: outPath };
  for (const [k, v] of Object.entries(inputs)) {
    env[`INPUT_${k.replace(/ /g, '_').toUpperCase()}`] = v;
  }
  let exit = 0;
  let stderr = '';
  try {
    execFileSync('node', [ACTION], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    exit = err.status ?? 1;
    stderr = String(err.stderr ?? '');
  }
  const outputs = {};
  if (fs.existsSync(outPath)) {
    for (const line of fs.readFileSync(outPath, 'utf8').split('\n')) {
      const i = line.indexOf('=');
      if (i > 0) outputs[line.slice(0, i)] = line.slice(i + 1);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { exit, stderr, outputs };
}

function localInputs(configPath, extra = {}) {
  return {
    'TASK-TYPE': 'pr-review',
    'CONFIG-PATH': configPath,
    'CONFIG-URL': '',
    ...extra,
  };
}

describe('select-model action', () => {
  it('resolves the go model when requested', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'select-model-'));
    const configPath = path.join(dir, 'model-config.json');
    fs.writeFileSync(configPath, JSON.stringify(FIXTURE));
    const { exit, outputs } = run(localInputs(configPath, { TIER: 'go' }));
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(exit, 0);
    assert.equal(outputs.model, 'opencode-go/model-a');
    assert.equal(outputs['model-go'], 'opencode-go/model-a');
    assert.equal(outputs['model-free'], 'opencode/model-b-free');
    assert.equal(outputs['config-source'], 'local');
    assert.equal(outputs['task-type'], 'pr-review');
  });

  it('resolves the free tier and matches task-type case-insensitively', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'select-model-'));
    const configPath = path.join(dir, 'model-config.json');
    fs.writeFileSync(configPath, JSON.stringify(FIXTURE));
    const { exit, outputs } = run(localInputs(configPath, { 'TASK-TYPE': 'PR-REVIEW', TIER: 'free' }));
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(exit, 0);
    assert.equal(outputs.model, 'opencode/model-b-free');
    assert.equal(outputs['task-type'], 'pr-review');
  });

  it('defaults to free when tier is omitted and no token is set', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'select-model-'));
    const configPath = path.join(dir, 'model-config.json');
    fs.writeFileSync(configPath, JSON.stringify(FIXTURE));
    const saved = process.env.OPENCODE_API_KEY;
    delete process.env.OPENCODE_API_KEY;
    const { exit, outputs } = run(localInputs(configPath, { 'CONFIG-URL': '' }));
    if (saved === undefined) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = saved;
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(exit, 0);
    assert.equal(outputs.model, 'opencode/model-b-free');
    assert.equal(outputs['tier-selected'], 'free');
  });

  it('fails closed on a missing task-type without fallback', () => {
    const { exit, stderr } = run({
      'TASK-TYPE': 'nope',
      'CONFIG-PATH': 'data/model-config.json',
      'CONFIG-URL': '',
    });
    assert.equal(exit, 1);
    assert.match(stderr, /No model resolved/);
  });

  it('uses fallback-model with a warning when the entry is missing', () => {
    const { exit, outputs } = run({
      'TASK-TYPE': 'nope',
      'CONFIG-PATH': 'data/model-config.json',
      'CONFIG-URL': '',
      'FALLBACK-MODEL': 'opencode/fallback',
    });
    assert.equal(exit, 0);
    assert.equal(outputs.model, 'opencode/fallback');
    assert.equal(outputs['config-source'], 'local+fallback');
  });

  it('rejects an invalid tier', () => {
    const { exit, stderr } = run({
      'TASK-TYPE': 'pr-review',
      TIER: 'ultra',
      'CONFIG-PATH': 'data/model-config.json',
      'CONFIG-URL': '',
    });
    assert.equal(exit, 1);
    assert.match(stderr, /tier/);
  });
});

const RANKED_FIXTURE = {
  'task-types': {
    'pr-review': {
      go: 'opencode-go/pricey',
      free: 'opencode/cheap-free',
      go_ranked: [
        { model: 'opencode-go/pricey', score: 90, input_cost: 10, output_cost: 50, blended_cost: 20 },
        { model: 'opencode-go/mid', score: 88, input_cost: 1, output_cost: 3, blended_cost: 1.5 },
        { model: 'opencode-go/unknown', score: 87, input_cost: null, output_cost: null, blended_cost: null },
      ],
      free_ranked: [
        { model: 'opencode/cheap-free', score: 75, input_cost: 0, output_cost: 0, blended_cost: 0 },
      ],
    },
  },
};

function runRanked(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'select-model-'));
  const configPath = path.join(dir, 'model-config.json');
  fs.writeFileSync(configPath, JSON.stringify(RANKED_FIXTURE));
  const result = run(localInputs(configPath, extra));
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

describe('select-model max-cost', () => {
  it('keeps the resolved model and reports its cost when within budget', () => {
    const { exit, outputs } = runRanked({ TIER: 'go', 'MAX-COST': '25' });
    assert.equal(exit, 0);
    assert.equal(outputs.model, 'opencode-go/pricey');
    assert.equal(outputs['model-cost'], '20');
  });

  it('walks best-to-worst to the first model within budget', () => {
    const { exit, outputs } = runRanked({ TIER: 'go', 'MAX-COST': '10' });
    assert.equal(exit, 0);
    assert.equal(outputs.model, 'opencode-go/mid');
    assert.equal(outputs['model-cost'], '1.5');
  });

  it('skips models with unknown cost and fails when nothing fits', () => {
    const { exit, stderr } = runRanked({ TIER: 'go', 'MAX-COST': '0.5' });
    assert.equal(exit, 1);
    assert.match(stderr, /fits max-cost/);
  });

  it('uses fallback-model when nothing fits the budget', () => {
    const { exit, outputs } = runRanked({
      TIER: 'go',
      'MAX-COST': '0.5',
      'FALLBACK-MODEL': 'opencode/fallback',
    });
    assert.equal(exit, 0);
    assert.equal(outputs.model, 'opencode/fallback');
    assert.equal(outputs['model-cost'], '');
  });

  it('selects the free model at zero budget', () => {
    const { exit, outputs } = runRanked({ TIER: 'free', 'MAX-COST': '0' });
    assert.equal(exit, 0);
    assert.equal(outputs.model, 'opencode/cheap-free');
    assert.equal(outputs['model-cost'], '0');
  });

  it('rejects a non-numeric or negative max-cost', () => {
    for (const bad of ['abc', '-1']) {
      const { exit, stderr } = runRanked({ TIER: 'go', 'MAX-COST': bad });
      assert.equal(exit, 1);
      assert.match(stderr, /max-cost/);
    }
  });

  it('fails when the config has no ranking for max-cost filtering', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'select-model-'));
    const configPath = path.join(dir, 'model-config.json');
    fs.writeFileSync(configPath, JSON.stringify(FIXTURE));
    const { exit, stderr } = run(localInputs(configPath, { TIER: 'go', 'MAX-COST': '5' }));
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(exit, 1);
    assert.match(stderr, /max-cost/);
  });
});

describe('select-model auto tier', () => {
  const http = require('node:http');
  const { execFile } = require('node:child_process');

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

  // Async variant of run(): must not block the event loop, otherwise the
  // in-process mock usage/probe servers cannot answer the child.
  function runAsync(inputs, { config = FIXTURE } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'select-model-'));
    const configPath = path.join(dir, 'model-config.json');
    fs.writeFileSync(configPath, JSON.stringify(config));
    const outPath = path.join(dir, 'github-output.txt');
    const env = { ...process.env, GITHUB_OUTPUT: outPath };
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

  async function withMocks({ usageBody = goAvailable, usageStatus = 200, probeStatus = 200 } = {}, fn) {
    const usage = await startServer((req, res) => json(res, usageStatus, usageBody));
    const probe = await startServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
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

  function autoInputs(configPath, urls, extra = {}) {
    return localInputs(configPath, {
      TIER: 'auto',
      'OPENCODE-TOKEN': 'test-token',
      'USAGE-URL': urls.usageUrl,
      'PROBE-URL': urls.probeUrl,
      ...extra,
    });
  }

  function writeConfig() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'select-model-'));
    const configPath = path.join(dir, 'model-config.json');
    fs.writeFileSync(configPath, JSON.stringify(FIXTURE));
    return { dir, configPath };
  }

  it('fails when auto has no token', () => {
    const { dir, configPath } = writeConfig();
    const saved = process.env.OPENCODE_API_KEY;
    delete process.env.OPENCODE_API_KEY;
    const { exit, stderr } = run(localInputs(configPath, { TIER: 'auto', 'CONFIG-URL': '' }));
    if (saved === undefined) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = saved;
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(exit, 1);
    assert.match(stderr, /opencode-token/);
  });

  it('prefers free when the free probe succeeds', async () => {
    const { dir, configPath } = writeConfig();
    const result = await withMocks({}, async (urls) => runAsync(autoInputs(configPath, urls)));
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(result.exit, 0);
    assert.equal(result.outputs.model, 'opencode/model-b-free');
    assert.equal(result.outputs['tier-selected'], 'free');
  });

  it('defaults to auto probing when tier is omitted but a token is set', async () => {
    const { dir, configPath } = writeConfig();
    const result = await withMocks({}, async (urls) =>
      runAsync(localInputs(configPath, {
        'OPENCODE-TOKEN': 'test-token',
        'USAGE-URL': urls.usageUrl,
        'PROBE-URL': urls.probeUrl,
        'CONFIG-URL': '',
      })),
    );
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(result.exit, 0);
    assert.equal(result.outputs.model, 'opencode/model-b-free');
    assert.equal(result.outputs['tier-selected'], 'free');
  });

  it('falls back to go when free is rate-limited and go has quota', async () => {
    const { dir, configPath } = writeConfig();
    const result = await withMocks({ probeStatus: 429 }, async (urls) => runAsync(autoInputs(configPath, urls)));
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(result.exit, 0);
    assert.equal(result.outputs.model, 'opencode-go/model-a');
    assert.equal(result.outputs['tier-selected'], 'go');
  });

  it('uses go-first order when requested', async () => {
    const { dir, configPath } = writeConfig();
    const result = await withMocks({}, async (urls) =>
      runAsync(autoInputs(configPath, urls, { 'AUTO-PREFERENCE': 'go-first' })),
    );
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(result.exit, 0);
    assert.equal(result.outputs.model, 'opencode-go/model-a');
    assert.equal(result.outputs['tier-selected'], 'go');
  });

  it('fails fast when both tiers are exhausted', async () => {
    const { dir, configPath } = writeConfig();
    const result = await withMocks(
      { usageBody: goExhausted, probeStatus: 429 },
      async (urls) => runAsync(autoInputs(configPath, urls)),
    );
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /No model available/);
  });

  it('waits for quota and then succeeds', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'select-model-'));
    const configPath = path.join(dir, 'model-config.json');
    fs.writeFileSync(configPath, JSON.stringify(FIXTURE));
    const outPath = path.join(dir, 'github-output.txt');
    let calls = 0;
    const usage = await startServer((req, res) => {
      calls += 1;
      if (calls === 1) json(res, 200, goExhausted);
      else json(res, 200, goAvailable);
    });
    const probe = await startServer((req, res) => {
      req.resume();
      req.on('end', () => json(res, 429, { error: { message: 'limited' } }));
    });
    let result;
    const childEnv = { ...process.env, GITHUB_OUTPUT: outPath };
    for (const [k, v] of Object.entries(localInputs(configPath, {
      TIER: 'auto',
      'OPENCODE-TOKEN': 'test-token',
      'USAGE-URL': usage.url,
      'PROBE-URL': probe.url,
      'MAX-WAIT-SECONDS': '5',
      'POLL-INTERVAL-SECONDS': '1',
    }))) {
      childEnv[`INPUT_${k.replace(/ /g, '_').toUpperCase()}`] = v;
    }
    try {
      result = await new Promise((resolve) => {
        execFile('node', [ACTION], { env: childEnv }, (err, _stdout, stderr) => {
          const outputs = {};
          if (fs.existsSync(outPath)) {
            for (const line of fs.readFileSync(outPath, 'utf8').split('\n')) {
              const i = line.indexOf('=');
              if (i > 0) outputs[line.slice(0, i)] = line.slice(i + 1);
            }
          }
          resolve({ exit: err ? (err.code ?? 1) : 0, stderr: String(stderr ?? ''), outputs });
        });
      });
    } finally {
      usage.server.close();
      probe.server.close();
    }
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(result.exit, 0);
    assert.equal(result.outputs['tier-selected'], 'go');
  });

  it('reads the token from OPENCODE_API_KEY', async () => {
    const { dir, configPath } = writeConfig();
    const saved = process.env.OPENCODE_API_KEY;
    process.env.OPENCODE_API_KEY = 'env-token';
    const result = await withMocks({}, async (urls) =>
      runAsync(localInputs(configPath, {
        TIER: 'auto',
        'USAGE-URL': urls.usageUrl,
        'PROBE-URL': urls.probeUrl,
      })),
    );
    if (saved === undefined) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = saved;
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(result.exit, 0);
    assert.equal(result.outputs['tier-selected'], 'free');
  });

  it('rejects an invalid auto-preference', () => {
    const { dir, configPath } = writeConfig();
    const { exit, stderr } = run(
      localInputs(configPath, { TIER: 'auto', 'AUTO-PREFERENCE': 'cheapest' }),
    );
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(exit, 1);
    assert.match(stderr, /auto-preference/);
  });
});
