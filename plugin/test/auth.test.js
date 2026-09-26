'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  resolveToken,
  readAuthToken,
  clearAuthCache,
  authFileCandidates,
  keyFromEntry,
  PROVIDER_IDS,
} = require('../src/shared/auth');
const { normalizeOptions } = require('../src/shared/select');
const { refineTaskTypeWithJev } = require('../src/shared/jev');

let dir;
let saved;

/** Point every auth.json candidate at a temp dir (no real key on dev boxes). */
function isolate(dir) {
  process.env.OPENCODE_AUTH_JSON = path.join(dir, 'auth.json');
  process.env.XDG_DATA_HOME = path.join(dir, 'data');
  process.env.HOME = dir;
  clearAuthCache();
}

function writeAuth(contents) {
  const file = path.join(dir, 'auth.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  clearAuthCache();
  return file;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-auth-'));
  saved = {
    OPENCODE_AUTH_JSON: process.env.OPENCODE_AUTH_JSON,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    OPENCODE_API_KEY: process.env.OPENCODE_API_KEY,
    HOME: process.env.HOME,
  };
  delete process.env.OPENCODE_API_KEY;
  isolate(dir);
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  clearAuthCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('auth store lookup', () => {
  it('reads the opencode (Zen) key from auth.json', () => {
    writeAuth({ opencode: { type: 'api', key: 'sk-zen' } });
    const got = readAuthToken();
    assert.equal(got.token, 'sk-zen');
    assert.equal(got.source, 'opencode');
  });

  it('falls back to opencode-go when Zen is absent', () => {
    writeAuth({ 'opencode-go': { type: 'api', key: 'sk-go' } });
    const got = readAuthToken();
    assert.equal(got.token, 'sk-go');
    assert.equal(got.source, 'opencode-go');
  });

  it('prefers Zen over Go when both exist', () => {
    writeAuth({ 'opencode-go': { type: 'api', key: 'sk-go' }, opencode: { type: 'api', key: 'sk-zen' } });
    assert.equal(readAuthToken().token, 'sk-zen');
  });

  it('finds the XDG data dir layout', () => {
    delete process.env.OPENCODE_AUTH_JSON;
    const file = path.join(dir, 'data', 'opencode', 'auth.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ opencode: { type: 'api', key: 'sk-xdg' } }));
    clearAuthCache();
    assert.equal(readAuthToken().token, 'sk-xdg');
    assert.deepEqual(authFileCandidates(), [path.join(dir, 'data', 'opencode', 'auth.json')]);
  });

  it('returns empty for missing file, bad JSON, oauth and empty entries', () => {
    assert.deepEqual(readAuthToken(), { token: '', source: '' });
    writeAuth('{ not json');
    assert.deepEqual(readAuthToken(), { token: '', source: '' });
    writeAuth({ opencode: { type: 'oauth', tokens: { access: 'x' } } });
    assert.deepEqual(readAuthToken(), { token: '', source: '' });
    writeAuth({ opencode: { type: 'api' } });
    assert.deepEqual(readAuthToken(), { token: '', source: '' });
    writeAuth({ anthropic: { type: 'api', key: 'sk-other' } });
    assert.deepEqual(readAuthToken(), { token: '', source: '' });
  });

  it('keyFromEntry accepts a bare string and rejects non-objects', () => {
    assert.equal(keyFromEntry('  sk-bare  '), 'sk-bare');
    assert.equal(keyFromEntry(null), '');
    assert.equal(keyFromEntry({ type: 'api', key: 42 }), '');
  });

  it('memorizes the read until cleared', () => {
    writeAuth({ opencode: { type: 'api', key: 'sk-one' } });
    assert.equal(readAuthToken().token, 'sk-one');
    fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({ opencode: { type: 'api', key: 'sk-two' } }));
    assert.equal(readAuthToken().token, 'sk-one'); // cached
    clearAuthCache();
    assert.equal(readAuthToken().token, 'sk-two');
  });
});

describe('resolveToken chain', () => {
  it('option beats env and auth.json', () => {
    writeAuth({ opencode: { type: 'api', key: 'sk-file' } });
    process.env.OPENCODE_API_KEY = 'sk-env';
    clearAuthCache();
    assert.deepEqual(resolveToken({ token: 'sk-opt' }), { token: 'sk-opt', source: 'option' });
    assert.deepEqual(resolveToken({ 'opencode-token': 'sk-opt2' }), { token: 'sk-opt2', source: 'option' });
    assert.deepEqual(resolveToken({}), { token: 'sk-env', source: 'env' });
  });

  it('falls back to auth.json when the env var is missing (OpenChamber)', () => {
    writeAuth({ opencode: { type: 'api', key: 'sk-file' } });
    assert.deepEqual(resolveToken({}), { token: 'sk-file', source: 'auth.json:opencode' });
  });

  it('reports none when nothing is available', () => {
    assert.deepEqual(resolveToken({}), { token: '', source: 'none' });
  });
});

describe('normalizeOptions wiring', () => {
  it('exposes token and tokenSource from the auth store', () => {
    writeAuth({ 'opencode-go': { type: 'api', key: 'sk-go' } });
    const opts = normalizeOptions({});
    assert.equal(opts.token, 'sk-go');
    assert.equal(opts.tokenSource, 'auth.json:opencode-go');
  });

  it('the env var still wins over the auth store', () => {
    writeAuth({ opencode: { type: 'api', key: 'sk-file' } });
    process.env.OPENCODE_API_KEY = 'sk-env';
    clearAuthCache();
    const opts = normalizeOptions({});
    assert.equal(opts.token, 'sk-env');
    assert.equal(opts.tokenSource, 'env');
  });
});

describe('jev token fallback', () => {
  it('uses the auth store when no token option or env var is set', async () => {
    writeAuth({ opencode: { type: 'api', key: 'sk-file' } });
    const realFetch = globalThis.fetch;
    let auth = null;
    globalThis.fetch = async (_url, init) => {
      auth = init.headers.Authorization;
      return { ok: true, status: 200, json: async () => ({ answers: { task: { choice: 'review', confidence: 0.9 } } }) };
    };
    try {
      const opts = normalizeOptions({ jevModel: 'jev-1.13-free' });
      const r = await refineTaskTypeWithJev({ heuristic: 'generic', prompt: 'review this', opts });
      assert.equal(auth, 'Bearer sk-file');
      assert.equal(r.taskType, 'review');
      assert.equal(r.status, 'ok');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('stays no-token (no network) when the store is empty', async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; throw new Error('must not be called'); };
    try {
      const r = await refineTaskTypeWithJev({
        heuristic: 'generic',
        prompt: 'hi',
        opts: { jevModel: 'jev-1.13-free', token: '', jevToken: '', jevThreshold: 0.6, verbose: false },
      });
      assert.equal(r.status, 'no-token');
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('provider ids probed', () => {
  it('covers Zen then Go', () => {
    assert.deepEqual(PROVIDER_IDS, ['opencode', 'opencode-go']);
  });
});
