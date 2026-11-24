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
  fs.writeFileSync(bin, `#!/bin/sh\nexit ${opencodeExit}\n`, { mode: 0o755 });
  // The action resolves the bundled plugin two levels above src/.
  fs.mkdirSync(path.join(dir, 'plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin', 'index.js'), 'module.exports = {};\n');
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
    assert.equal(r.outputs.model, 'modelselect/auto-free-first');
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

  it('picks the go anchor for tier auto with go-first', () => {
    const r = run({ 'INPUT_TIER': 'auto', 'INPUT_AUTO-PREFERENCE': 'go-first' });
    assert.equal(r.exit, 0, r.stderr);
    assert.equal(r.outputs.model, 'modelselect/auto-go-first');
  });

  it('fails on an invalid tier', () => {
    const r = run({ 'INPUT_TIER': 'unknown' });
    assert.equal(r.exit, 1);
    assert.match(r.stderr, /Input 'tier'/);
  });

  it('propagates a failing opencode run but still writes outputs', () => {
    const r = run({ 'INPUT_TIER': 'free' }, { opencodeExit: 7 });
    assert.equal(r.exit, 7);
    assert.equal(r.outputs.model, 'modelselect/auto-free-first');
  });

  it('does not persist tokens into the plugin config', () => {
    const r = run({ 'INPUT_TIER': 'free', 'INPUT_OPENCODE-TOKEN': 'super-secret' });
    assert.equal(r.exit, 0, r.stderr);
    const cfg = readConfig(r.dir, '.config/opencode/opencode.json');
    assert.ok(!JSON.stringify(cfg).includes('super-secret'));
  });
});
