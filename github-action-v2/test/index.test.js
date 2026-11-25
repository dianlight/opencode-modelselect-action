'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ACTION = path.join(__dirname, '..', 'src', 'index.js');

function run(inputs, { opencodeExit = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-v2-'));
  const binDir = path.join(dir, '.opencode', 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const bin = path.join(binDir, 'opencode');
  fs.writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 'opencode 2.3.0'; exit 0; fi\nexit ${opencodeExit}\n`, { mode: 0o755 });
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
    ...inputs,
  };
  let exit = 0;
  let stderr = '';
  try {
    execFileSync(process.execPath, [ACTION], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    exit = err.status ?? 1;
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
  return { dir, exit, stderr, outputs, bin };
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
});
