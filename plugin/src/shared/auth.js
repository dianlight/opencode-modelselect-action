'use strict';

/**
 * Token resolution for the Zen/Go probes (tier `auto` and Jev).
 *
 * Why this exists: `OPENCODE_API_KEY` only reaches the plugin when the
 * OpenCode server inherited the shell environment. GUI hosts do not —
 * OpenChamber (web/desktop) spawns its own OpenCode server from a managed
 * config, so `process.env.OPENCODE_API_KEY` is empty there and tier `auto`
 * silently degraded to `free` (Jev reported `kept:no-token`).
 *
 * The key is already on disk: `/connect` stores provider credentials in
 * OpenCode's auth store (`<data>/opencode/auth.json`, default
 * `~/.local/share/opencode/auth.json`). So the fallback chain is:
 *
 *   1. the `token` / `opencode-token` option (explicit wins)
 *   2. `OPENCODE_API_KEY` from the environment
 *   3. the `opencode` (Zen) key in auth.json, then `opencode-go`
 *
 * Anything unusable (no file, bad JSON, missing/non-api entry) yields an
 * empty token, which keeps the current behavior: tier `auto` degrades to
 * `free` instead of failing the session. The key is never logged.
 *
 * Zero dependencies, Node >= 20.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Provider ids in probe order: Zen first, then Go. Both hold the same key
// for accounts connected on opencode.ai/auth, but Go-only keys exist too.
const PROVIDER_IDS = ['opencode', 'opencode-go'];

/** Home directory from the environment (deterministic under tests), else os. */
function homeDir(env) {
  const home = String(env.HOME ?? env.USERPROFILE ?? '').trim();
  if (home) return home;
  try {
    return os.homedir();
  } catch {
    return '';
  }
}

/**
 * Candidate auth.json paths, most specific first. `OPENCODE_AUTH_JSON` is
 * honored when set (upstream configurable-location request); otherwise the
 * XDG data dir wins over the `~/.local/share` default. Duplicates removed.
 */
function authFileCandidates(env = process.env) {
  const out = [];
  const push = (p) => {
    if (p && !out.includes(p)) out.push(p);
  };
  push(String(env.OPENCODE_AUTH_JSON ?? '').trim());
  const dataHome = String(env.XDG_DATA_HOME ?? '').trim() || path.join(homeDir(env), '.local', 'share');
  if (dataHome) push(path.join(dataHome, 'opencode', 'auth.json'));
  return out;
}

/** First usable api key for a provider entry; '' for oauth/empty entries. */
function keyFromEntry(entry) {
  if (typeof entry === 'string') return entry.trim();
  if (!entry || typeof entry !== 'object') return '';
  if (typeof entry.type === 'string' && entry.type !== 'api') return ''; // oauth etc: unusable here
  return typeof entry.key === 'string' ? entry.key.trim() : '';
}

let cached; // undefined = not read yet; null = read, nothing usable found

/** Drop the memoized auth.json read (tests, and after a `/connect`). */
function clearAuthCache() {
  cached = undefined;
}

/**
 * Read the OpenCode auth store and return `{ token, source }`, where source
 * is the provider id it came from ('opencode' / 'opencode-go'). Never
 * throws: returns `{ token: '', source: '' }` when nothing is usable.
 */
function readAuthToken(env = process.env) {
  if (cached !== undefined) return cached;
  cached = { token: '', source: '' };
  for (const file of authFileCandidates(env)) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue; // missing / unreadable / bad JSON: try the next candidate
    }
    if (!data || typeof data !== 'object') continue;
    for (const id of PROVIDER_IDS) {
      const token = keyFromEntry(data[id]);
      if (token) {
        cached = { token, source: id };
        return cached;
      }
    }
  }
  return cached;
}

/**
 * Full resolution chain for the probe token. `source` is one of `option`,
 * `env`, `auth.json` (or the provider id), or `none`.
 */
function resolveToken(raw = {}, env = process.env) {
  const explicit = String(raw.token || raw['opencode-token'] || '').trim();
  if (explicit) return { token: explicit, source: 'option' };
  const fromEnv = String(env.OPENCODE_API_KEY ?? '').trim();
  if (fromEnv) return { token: fromEnv, source: 'env' };
  const fromAuth = readAuthToken(env);
  if (fromAuth.token) return { token: fromAuth.token, source: `auth.json:${fromAuth.source}` };
  return { token: '', source: 'none' };
}

module.exports = {
  resolveToken,
  readAuthToken,
  clearAuthCache,
  authFileCandidates,
  homeDir,
  keyFromEntry,
  PROVIDER_IDS,
};
