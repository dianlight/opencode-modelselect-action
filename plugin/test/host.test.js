'use strict';

/**
 * Host detection (shared/host.js): explicit `openchamber` option →
 * `MODELSELECT_OPENCHAMBER` env → extension-written session map →
 * standalone default, plus the mtime-cached session-map reader and the
 * 30d freshness window (mirrors the extension's prune).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  SESSION_MAP_FILE,
  SESSION_MAP_TTL_MS,
  normalizeOpenChamberOption,
  resolveOpenChamberEnv,
  readSessionMap,
  clearSessionMapCache,
  sessionMapHit,
  sessionMapAnyHit,
  resolveHost,
} = require('../src/shared/host');
const { normalizeOptions } = require('../src/shared/select');

// The plugin passes `cacheDir` (<dir>/.opencode/.modelselect-cache) to the
// reader — the session map lives inside the cache dir, not the project root.
const cacheOf = (dir) => path.join(dir, '.opencode', '.modelselect-cache');

function writeMap(dir, sessions) {
  const cache = cacheOf(dir);
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, SESSION_MAP_FILE), JSON.stringify({ version: 1, sessions }));
  return cache;
}

function tmp() {
  clearSessionMapCache();
  return fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-host-'));
}

describe('openchamber option', () => {
  it('defaults to auto and accepts on/off case-insensitively', () => {
    assert.equal(normalizeOpenChamberOption(undefined), 'auto');
    assert.equal(normalizeOpenChamberOption('auto'), 'auto');
    assert.equal(normalizeOpenChamberOption(' OFF '), 'off');
    assert.equal(normalizeOpenChamberOption('On'), 'on');
  });

  it('rejects unknown values', () => {
    assert.throws(() => normalizeOpenChamberOption('sometimes'), /Invalid openchamber/);
    assert.throws(() => normalizeOpenChamberOption('yes'), /Invalid openchamber/);
  });

  it('normalizeOptions carries the option, default and alias', () => {
    assert.equal(normalizeOptions({}).openchamber, 'auto');
    assert.equal(normalizeOptions({ openchamber: 'on' }).openchamber, 'on');
    assert.equal(normalizeOptions({ 'open-chamber': 'OFF' }).openchamber, 'off');
    assert.throws(() => normalizeOptions({ openchamber: 'maybe' }), /Invalid openchamber/);
  });
});

describe('MODELSELECT_OPENCHAMBER env', () => {
  it('parses truthy/falsy spellings', () => {
    for (const v of ['1', 'true', 'TRUE', 'on', 'yes']) {
      assert.equal(resolveOpenChamberEnv({ MODELSELECT_OPENCHAMBER: v }), 'on', v);
    }
    for (const v of ['0', 'false', 'FALSE', 'off', 'no']) {
      assert.equal(resolveOpenChamberEnv({ MODELSELECT_OPENCHAMBER: v }), 'off', v);
    }
  });

  it('unset or unrecognized values skip (null)', () => {
    assert.equal(resolveOpenChamberEnv({}), null);
    assert.equal(resolveOpenChamberEnv(undefined), null);
    assert.equal(resolveOpenChamberEnv({ MODELSELECT_OPENCHAMBER: '' }), null);
    assert.equal(resolveOpenChamberEnv({ MODELSELECT_OPENCHAMBER: 'maybe' }), null);
  });
});

describe('resolveHost precedence', () => {
  it('explicit option wins over env and session map', () => {
    assert.deepEqual(
      resolveHost({
        options: { openchamber: 'on' },
        env: { MODELSELECT_OPENCHAMBER: '0' },
        hasSessionHit: () => false,
      }),
      { host: 'openchamber', source: 'option' },
    );
    assert.deepEqual(
      resolveHost({
        options: { openchamber: 'off' },
        env: { MODELSELECT_OPENCHAMBER: '1' },
        hasSessionHit: () => true,
      }),
      { host: 'standalone', source: 'option' },
    );
  });

  it('env wins over the session map', () => {
    assert.deepEqual(
      resolveHost({ options: {}, env: { MODELSELECT_OPENCHAMBER: '1' }, hasSessionHit: () => false }),
      { host: 'openchamber', source: 'env' },
    );
    assert.deepEqual(
      resolveHost({ options: {}, env: { MODELSELECT_OPENCHAMBER: '0' }, hasSessionHit: () => true }),
      { host: 'standalone', source: 'env' },
    );
  });

  it('session-map hit decides when option and env are auto', () => {
    let asked = 0;
    assert.deepEqual(
      resolveHost({
        options: { openchamber: 'auto' },
        env: {},
        hasSessionHit: () => {
          asked += 1;
          return true;
        },
      }),
      { host: 'openchamber', source: 'session-map' },
    );
    assert.equal(asked, 1, 'the hit check is only consulted when undecided');
    assert.deepEqual(
      resolveHost({ options: {}, env: {}, hasSessionHit: () => false }),
      { host: 'standalone', source: 'default' },
    );
    assert.deepEqual(
      resolveHost({ options: {}, env: {} }),
      { host: 'standalone', source: 'default' },
      'a boolean hit works too',
    );
  });
});

describe('session map reader', () => {
  it('missing or malformed files read as an empty map', () => {
    const dir = tmp();
    try {
      assert.deepEqual(readSessionMap(cacheOf(dir)), {});
      assert.equal(sessionMapAnyHit(cacheOf(dir)), false);
      assert.equal(sessionMapHit(cacheOf(dir), 's1'), false);

      const cache = cacheOf(dir);
      fs.mkdirSync(cache, { recursive: true });
      fs.writeFileSync(path.join(cache, SESSION_MAP_FILE), 'not json{');
      clearSessionMapCache();
      assert.deepEqual(readSessionMap(cacheOf(dir)), {});

      fs.writeFileSync(path.join(cache, SESSION_MAP_FILE), JSON.stringify({ version: 1, sessions: 'nope' }));
      clearSessionMapCache();
      assert.deepEqual(readSessionMap(cacheOf(dir)), {});
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fresh entries hit, stale (>30d) entries do not', () => {
    const dir = tmp();
    try {
      const now = Date.now();
      writeMap(dir, {
        fresh: now - 1000,
        stale: now - SESSION_MAP_TTL_MS - 60 * 1000,
        future: now + 60 * 60 * 1000, // clock skew still counts as fresh
        junk: 'not-a-number',
      });
      clearSessionMapCache();
      assert.equal(sessionMapHit(cacheOf(dir), 'fresh', now), true);
      assert.equal(sessionMapHit(cacheOf(dir), 'stale', now), false);
      assert.equal(sessionMapHit(cacheOf(dir), 'future', now), true);
      assert.equal(sessionMapHit(cacheOf(dir), 'junk', now), false);
      assert.equal(sessionMapHit(cacheOf(dir), 'missing', now), false);
      assert.equal(sessionMapHit(cacheOf(dir), '', now), false);
      assert.equal(sessionMapAnyHit(cacheOf(dir), now), true, 'one fresh entry is enough');

      writeMap(dir, { onlyStale: now - SESSION_MAP_TTL_MS - 1 });
      clearSessionMapCache();
      assert.equal(sessionMapAnyHit(cacheOf(dir), now), false, 'stale-only map is no evidence');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('re-parses on size change and reads deletion as empty', () => {
    const dir = tmp();
    try {
      const now = Date.now();
      writeMap(dir, { s1: now });
      assert.deepEqual(Object.keys(readSessionMap(cacheOf(dir))), ['s1']);
      // rewrite with a different size: the mtime+size stamp must invalidate
      writeMap(dir, { s1: now, s2: now });
      assert.deepEqual(Object.keys(readSessionMap(cacheOf(dir))).sort(), ['s1', 's2']);
      fs.rmSync(path.join(cacheOf(dir), SESSION_MAP_FILE));
      assert.deepEqual(readSessionMap(cacheOf(dir)), {});
      assert.equal(sessionMapAnyHit(cacheOf(dir)), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
