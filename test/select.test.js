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
  it('resolves the go model by default', () => {
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
