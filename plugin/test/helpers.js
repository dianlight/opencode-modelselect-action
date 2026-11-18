'use strict';

/**
 * Test helpers shared by the plugin test files.
 *
 * `isolateAuth` is the important one: the plugin falls back to OpenCode's
 * auth store (`<data>/opencode/auth.json`) when `OPENCODE_API_KEY` is not in
 * the environment, so a dev machine with a real `/connect` key would make
 * "no token" tests probe the network. Every helper here points those lookups
 * at a temp dir and clears the memoized read.
 */

const fs = require('node:fs');
const path = require('node:path');
const { clearAuthCache } = require('../src/shared/auth');
const { TASK_TYPES_CACHE_VERSION } = require('../src/shared/tasktypes');

function seedCache(dir, config) {
  const cache = path.join(dir, '.opencode', '.modelselect-cache');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(
    path.join(cache, 'model-config-cache.json'),
    JSON.stringify({ fetchedAt: Date.now(), config }),
  );
  // Seed an EMPTY provider-model v2 table too: `resolveModel` fetches
  // `model-config-v2.json` whenever the cache misses, and a fetch that
  // fails is never cached — so without this every call would hit the
  // network (breaking fetch-counting tests), and once `main` hosts the
  // real v2 data the v2 path would override the seeded v1 picks. An empty
  // table keeps the v2 path inactive; call seedConfigV2(dir, cfg) with
  // real `task-types-v2` content to exercise it.
  fs.writeFileSync(
    path.join(cache, 'model-config-v2-cache.json'),
    JSON.stringify({ fetchedAt: Date.now(), config: {} }),
  );
  // The router-sync switch is ON by default; tests that want it off seed
  // routing-sync.json themselves before setup. The virtual model is the
  // routing switch, so there is no global mode file to pin here.
}

/**
 * Seed the provider-model v2 task table beside the v1 config. Without
 * this `resolveModel` fetches `model-config-v2.json` on every call when a
 * fetch stub keeps failing (failed fetches are never cached), which breaks
 * tests that count network calls. `{}` keeps the v2 path inactive (no
 * `task-types-v2` entry), so callers stay on the seeded v1 task entries.
 */
function seedConfigV2(dir, config = {}) {
  const cache = path.join(dir, '.opencode', '.modelselect-cache');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(
    path.join(cache, 'model-config-v2-cache.json'),
    JSON.stringify({ fetchedAt: Date.now(), config }),
  );
}

function seedTaskTypes(dir, taskTypes) {
  const cache = path.join(dir, '.opencode', '.modelselect-cache');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(
    path.join(cache, 'task-types-cache.json'),
    JSON.stringify({ v: TASK_TYPES_CACHE_VERSION, fetchedAt: Date.now(), taskTypes }),
  );
}

/** Route every auth.json candidate at `dir`; returns a restore function. */
function isolateAuth(dir) {
  const keys = ['OPENCODE_AUTH_JSON', 'XDG_DATA_HOME', 'OPENCODE_API_KEY', 'HOME'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.OPENCODE_AUTH_JSON = path.join(dir, 'auth.json');
  process.env.XDG_DATA_HOME = path.join(dir, 'data');
  process.env.HOME = dir;
  delete process.env.OPENCODE_API_KEY;
  clearAuthCache();
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    clearAuthCache();
  };
}

/** Write an auth.json (object or raw string) into the isolated dir. */
function writeAuthFile(dir, contents) {
  const file = path.join(dir, 'auth.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  clearAuthCache();
  return file;
}

module.exports = { seedCache, seedConfigV2, seedTaskTypes, isolateAuth, writeAuthFile };
