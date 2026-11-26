'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ACTION = path.join(__dirname, '..', 'src', 'index.js');

function run(inputs, { opencodeExit = 0, probeStatuses } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-'));
  const binDir = path.join(dir, '.opencode', 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const bin = path.join(binDir, 'opencode');
  const argsFile = path.join(dir, 'opencode-args.txt');
  fs.writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 'opencode 2.3.0'; exit 0; fi\nprintf '%s\\n' "$@" > "$OPENCODE_ARGS_FILE"\nexit ${opencodeExit}\n`, { mode: 0o755 });
  // The action resolves the bundled plugin two levels above src/.
  fs.mkdirSync(path.join(dir, 'plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin', 'index.js'), 'module.exports = {};\n');
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'data', 'model-config.json'),
    JSON.stringify({
      'task-types': {
        review: {
          go: 'opencode-go/go-model',
          free: 'opencode/free-model',
          free_ranked: [{ model: 'opencode/free-model', score: 90, blended_cost: 1 }],
          go_ranked: [{ model: 'opencode-go/go-model', score: 90, blended_cost: 1 }],
        },
        auto: { go: 'opencode-go/go-model', free: 'opencode/free-model' },
        generic: { go: 'opencode-go/go-model', free: 'opencode/free-model' },
      },
    }),
  );
  const out = path.join(dir, 'github-output.txt');
  const env = {
    ...process.env,
    HOME: dir,
    GITHUB_WORKSPACE: dir,
    GITHUB_OUTPUT: out,
    OPENCODE_ARGS_FILE: argsFile,
    ...inputs,
  };
  if (Array.isArray(probeStatuses)) {
    const statusesPath = path.join(dir, 'probe-statuses.json');
    const preloadPath = path.join(dir, 'probe-fetch.cjs');
    fs.writeFileSync(statusesPath, JSON.stringify(probeStatuses));
    fs.writeFileSync(preloadPath, `
      const fs = require('node:fs');
      const statuses = JSON.parse(fs.readFileSync(process.env.PROBE_STATUSES_FILE, 'utf8'));
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        if (String(url).startsWith('https://opencode.ai/zen/v1/chat/completions')) {
          const status = statuses.shift() ?? 200;
          return { ok: status >= 200 && status < 300, status };
        }
        return originalFetch ? originalFetch(url, init) : Promise.reject(new Error('fetch unavailable'));
      };
    `);
    env.PROBE_STATUSES_FILE = statusesPath;
    env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --require=${preloadPath}`.trim();
  }
  let exit = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = String(execFileSync(process.execPath, [ACTION], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) ?? '');
  } catch (err) {
    exit = err.status ?? 1;
    stdout = String(err.stdout ?? '');
    stderr = String(err.stderr ?? '');
  }
  const outputs = {};
  if (fs.existsSync(out)) {
    for (const line of fs.readFileSync(out, 'utf8').trim().split('\n')) {
      if (!line) continue;
      const at = line.indexOf('=');
      outputs[line.slice(0, at)] = line.slice(at + 1);
    }
  }
  return {
    dir,
    exit,
    stdout,
    stderr,
    outputs,
    bin,
    opencodeArgs: fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf8').trim().split('\n') : [],
  };
}

function readConfig(dir, rel) {
  const p = path.join(dir, rel);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

describe('opencode + modelselect v2 action', () => {
  it('uses a virtual anchor and writes the plugin into both opencode configs', () => {
    const r = run({
      'INPUT_TIER': 'free',
      'INPUT_TASK-TYPE': 'review',
      'INPUT_VERBOSE': 'true',
      'INPUT_MAX-COST': '1.5',
      'INPUT_AGENT-TASK-MAP': '{"reviewer":"review"}',
    });
    assert.equal(r.exit, 0, r.stderr);
    assert.equal(r.outputs.model, 'opencode/free-model');
    for (const rel of ['.config/opencode/opencode.json', '.opencode/opencode.json']) {
      const cfg = readConfig(r.dir, rel);
      assert.ok(cfg, `${rel} was written`);
      const entry = cfg.plugins.find((p) => p.package === r.outputs['plugin-source']);
      assert.ok(entry, `${rel} has our plugin`);
      assert.equal(entry.options.taskType, 'review');
      assert.equal(entry.options.tier, 'free');
      assert.equal(entry.options.maxCost, 1.5);
      assert.deepEqual(entry.options.agentTaskMap, { reviewer: 'review' });
      assert.equal(entry.options.verbose, true);
    }
  });

  it('honours an explicit model and go-first preference', () => {
    const r = run({ 'INPUT_MODEL': 'opencode/gpt-5.6-luna', 'INPUT_TIER': 'auto', 'INPUT_AUTO-PREFERENCE': 'go-first' });
    assert.equal(r.exit, 0, r.stderr);
    assert.equal(r.outputs.model, 'opencode/gpt-5.6-luna');
  });

  it('preselects the go model when tier is go', () => {
    const r = run({ 'INPUT_TIER': 'go', 'INPUT_TASK-TYPE': 'review' });
    assert.equal(r.exit, 0, r.stderr);
    assert.equal(r.outputs.model, 'opencode-go/go-model');
  });

  it('fails on an invalid tier', () => {
    const r = run({ 'INPUT_TIER': 'unknown' });
    assert.equal(r.exit, 1);
    assert.match(r.stderr, /Input 'tier'/);
  });

  it('runs the V2 CLI with --model, --auto and the prompt as a positional message', () => {
    const prompt = 'Fix coverage issues\nUse two sources';
    const r = run({
      'INPUT_TIER': 'free',
      'INPUT_MODEL': 'opencode/free-model',
      'INPUT_AGENT': 'reviewer',
      'INPUT_VARIANT': 'high',
      'INPUT_PROMPT': prompt,
    });
    assert.equal(r.exit, 0, r.stderr);
    assert.deepEqual(r.opencodeArgs, [
      'run',
      '--model',
      'opencode/free-model#high',
      '--auto',
      '--agent',
      'reviewer',
      '--',
      'Fix coverage issues',
      'Use two sources',
    ]);
  });

  it('passes an empty prompt by omitting the positional message', () => {
    const r = run({ 'INPUT_TIER': 'free' });
    assert.equal(r.exit, 0, r.stderr);
    assert.deepEqual(r.opencodeArgs, ['run', '--model', 'opencode/free-model', '--auto']);
  });

  it('propagates a failing opencode run but still writes outputs', () => {
    const r = run({ 'INPUT_TIER': 'free' }, { opencodeExit: 7 });
    assert.equal(r.exit, 7);
    assert.equal(r.outputs.model, 'opencode/free-model');
  });

  it('does not persist tokens into the plugin config', () => {
    const r = run({ 'INPUT_TIER': 'free', 'INPUT_OPENCODE-TOKEN': 'super-secret' });
    assert.equal(r.exit, 0, r.stderr);
    const cfg = readConfig(r.dir, '.config/opencode/opencode.json');
    assert.ok(!JSON.stringify(cfg).includes('super-secret'));
  });

  it('warns with the exact probe status when a rate limit rejects the chain', () => {
    const r = run({
      'INPUT_TIER': 'free',
      'INPUT_TASK-TYPE': 'review',
      'INPUT_PROBE-MODEL-ACCESS': 'true',
      'INPUT_OPENCODE-TOKEN': 'test-token',
    }, { probeStatuses: [429] });
    assert.equal(r.exit, 0, r.stderr);
    assert.equal(r.outputs.model, 'opencode/free-model');
    assert.match(r.stdout, /Model 'opencode\/free-model' was rejected by the access probe \(rate-limited \(HTTP 429\)\)/);
    assert.match(r.stdout, /No accessible chain candidate — checked 1: opencode\/free-model \(rate-limited \(HTTP 429\)\); keeping 'opencode\/free-model'/);
  });

  it('distinguishes a disabled model from a rate limit in the probe warning', () => {
    const r = run({
      'INPUT_TIER': 'free',
      'INPUT_TASK-TYPE': 'review',
      'INPUT_PROBE-MODEL-ACCESS': 'true',
      'INPUT_OPENCODE-TOKEN': 'test-token',
    }, { probeStatuses: [403] });
    assert.equal(r.exit, 0, r.stderr);
    assert.match(r.stdout, /No accessible chain candidate — checked 1: opencode\/free-model \(model access disabled \(HTTP 403\)\)/);
  });

  it('writes V2 permission rules to both configs so unattended runs cannot hang on an ask', () => {
    const rules = [
      { action: 'external_directory', resource: '/tmp/*', effect: 'allow' },
      { action: 'read', resource: '/tmp/*', effect: 'allow' },
    ];
    const r = run({ 'INPUT_TIER': 'free', 'INPUT_PERMISSIONS': JSON.stringify(rules) });
    assert.equal(r.exit, 0, r.stderr);
    for (const rel of ['.config/opencode/opencode.json', '.opencode/opencode.json']) {
      assert.deepEqual(readConfig(r.dir, rel).permissions, rules);
      assert.equal(readConfig(r.dir, rel).permission, undefined);
    }
  });

  it('preserves existing permission rules and appends caller rules last', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-perms-'));
    const existing = [{ action: 'external_directory', resource: '*', effect: 'ask' }];
    for (const rel of ['.config/opencode/opencode.json', '.opencode/opencode.json']) {
      const p = path.join(dir, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify({ permissions: existing }));
    }
    const binDir = path.join(dir, '.opencode', 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'opencode'), "#!/bin/sh\necho 'opencode 2.3.0'\nexit 0\n", { mode: 0o755 });
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'data', 'model-config.json'),
      JSON.stringify({ 'task-types': { auto: { go: 'opencode-go/go-model', free: 'opencode/free-model' } } }),
    );
    const out = path.join(dir, 'github-output.txt');
    const env = {
      ...process.env, HOME: dir, GITHUB_WORKSPACE: dir, GITHUB_OUTPUT: out,
      'INPUT_TIER': 'free',
      'INPUT_PERMISSIONS': JSON.stringify([{ action: 'external_directory', resource: '/tmp/*', effect: 'allow' }]),
    };
    execFileSync(process.execPath, [ACTION], { env, encoding: 'utf8', stdio: 'ignore' });
    for (const rel of ['.config/opencode/opencode.json', '.opencode/opencode.json']) {
      assert.deepEqual(readConfig(dir, rel).permissions, [
        ...existing,
        { action: 'external_directory', resource: '/tmp/*', effect: 'allow' },
      ]);
    }
  });

  it('rejects invalid permission rules instead of writing a broken config', () => {
    const r = run({ 'INPUT_TIER': 'free', 'INPUT_PERMISSIONS': '[{"action":"read","resource":"*","effect":"maybe"}]' });
    assert.equal(r.exit, 1);
    assert.match(r.stderr, /Input 'permissions'/);
  });

  it('writes websearch: false to both configs when requested', () => {
    const r = run({ 'INPUT_TIER': 'free', 'INPUT_WEBSEARCH': 'false' });
    assert.equal(r.exit, 0, r.stderr);
    for (const rel of ['.config/opencode/opencode.json', '.opencode/opencode.json']) {
      assert.equal(readConfig(r.dir, rel).websearch, false);
    }
  });

  it('writes a websearch provider object without disturbing other config', () => {
    const r = run({ 'INPUT_TIER': 'free', 'INPUT_WEBSEARCH': '{"provider":"exa"}' });
    assert.equal(r.exit, 0, r.stderr);
    assert.deepEqual(readConfig(r.dir, '.config/opencode/opencode.json').websearch, { provider: 'exa' });
  });

  it('rejects invalid websearch config before writing configs', () => {
    const r = run({ 'INPUT_TIER': 'free', 'INPUT_WEBSEARCH': 'true' });
    assert.equal(r.exit, 1);
    assert.match(r.stderr, /Input 'websearch'/);
    assert.equal(readConfig(r.dir, '.config/opencode/opencode.json'), null);
  });
});
