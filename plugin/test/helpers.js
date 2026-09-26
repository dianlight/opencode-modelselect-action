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

function seedCache(dir, config) {
  const cache = path.join(dir, '.opencode', '.modelselect-cache');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(
    path.join(cache, 'model-config-cache.json'),
    JSON.stringify({ fetchedAt: Date.now(), config }),
  );
}

function seedTaskTypes(dir, taskTypes) {
  const cache = path.join(dir, '.opencode', '.modelselect-cache');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(
    path.join(cache, 'task-types-cache.json'),
    JSON.stringify({ fetchedAt: Date.now(), taskTypes }),
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

module.exports = { seedCache, seedTaskTypes, isolateAuth, writeAuthFile };
