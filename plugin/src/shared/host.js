'use strict';

/**
 * OpenChamber host detection (v2): is this OpenCode server serving an
 * OpenChamber client (web/desktop/mobile app) or a standalone session
 * (TUI, `opencode run`, SDK embeds)?
 *
 * Detection order (first decisive source wins):
 *   1. explicit `openchamber` option — `'on'` forces OpenChamber,
 *      `'off'` forces standalone, `'auto'` (default) falls through.
 *   2. `MODELSELECT_OPENCHAMBER` env — `1|true|on|yes` /
 *      `0|false|off|no`; unset or unrecognized falls through.
 *   3. session map — `<cacheDir>/openchamber-sessions.json`, written by
 *      the OpenChamber Work Status extension (single writer: extension
 *      writes, plugin reads). A fresh entry (any session, <= 30 days old)
 *      means an OpenChamber client has used this project.
 *   4. default — standalone.
 *
 * The session map is the mobile-proof signal: extensions do not load on
 * mobile, but the extension's web/desktop session records the mobile
 * session into the same map file (same server, same project), so a
 * mobile-only usage pattern is still detected after the first
 * web/desktop open. Reads are guarded by a `{ mtimeMs, size }` cache
 * (same pattern as `modeCache` in shared/status.js) so the plugin only
 * re-parses the file when it changes.
 *
 * The 30d TTL on read mirrors the extension's prune window: stale
 * entries left behind by an uninstalled extension stop counting as
 * OpenChamber evidence without the plugin ever writing the file
 * (single-writer rule).
 *
 * Zero dependencies, Node >= 20.
 */

const fs = require('node:fs');
const path = require('node:path');

const SESSION_MAP_FILE = 'openchamber-sessions.json';
const SESSION_MAP_VERSION = 1;
// Keep in sync with the extension prune window (openchamber-modelselect).
const SESSION_MAP_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VALID_OPENCHAMBER = ['auto', 'on', 'off'];

/** Normalize/validate the `openchamber` plugin option. Throws on bad values. */
function normalizeOpenChamberOption(raw) {
  const v = String(raw ?? 'auto').toLowerCase().trim();
  if (!VALID_OPENCHAMBER.includes(v)) throw new Error(`Invalid openchamber '${raw}'.`);
  return v;
}

/**
 * Parse `MODELSELECT_OPENCHAMBER` from an env object.
 * Returns 'on' | 'off' | null (null = unset/unrecognized = skip).
 */
function resolveOpenChamberEnv(env) {
  const raw = String(env?.MODELSELECT_OPENCHAMBER ?? '').toLowerCase().trim();
  if (['1', 'true', 'on', 'yes'].includes(raw)) return 'on';
  if (['0', 'false', 'off', 'no'].includes(raw)) return 'off';
  return null;
}

// cacheDir -> { stamp, sessions }: stamp covers mtime + size so a rewrite
// in the same millisecond still invalidates (modeCache pattern).
const mapCache = new Map();

/**
 * Read the extension-written session map. Never throws: missing/unusable
 * files mean an empty map. Returns `{ <sessionID>: lastSeenEpochMs }`.
 */
function readSessionMap(cacheDir) {
  const key = String(cacheDir);
  try {
    const file = path.join(key, SESSION_MAP_FILE);
    let stamp = null;
    try {
      const st = fs.statSync(file);
      stamp = `${st.mtimeMs}:${st.size}`;
    } catch {
      mapCache.delete(key);
      return {}; // missing/unstatable = no evidence
    }
    const cached = mapCache.get(key);
    if (cached && cached.stamp === stamp) return cached.sessions;
    let sessions = {};
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && typeof raw === 'object' && raw.sessions && typeof raw.sessions === 'object') {
        sessions = raw.sessions;
      }
    } catch {
      sessions = {}; // bad JSON = no evidence
    }
    mapCache.set(key, { stamp, sessions });
    return sessions;
  } catch {
    return {};
  }
}

/** Clear the session-map mtime cache (tests / after external writes). */
function clearSessionMapCache() {
  mapCache.clear();
}

/** Fresh entry for one session: present AND within the 30d TTL. */
function sessionMapHit(cacheDir, sessionID, now = Date.now()) {
  if (!sessionID) return false;
  const seen = readSessionMap(cacheDir)[sessionID];
  return typeof seen === 'number' && Number.isFinite(seen) && now - seen <= SESSION_MAP_TTL_MS;
}

/** Any fresh entry in the map (setup-time check: no session known yet). */
function sessionMapAnyHit(cacheDir, now = Date.now()) {
  const sessions = readSessionMap(cacheDir);
  return Object.values(sessions).some(
    (seen) => typeof seen === 'number' && Number.isFinite(seen) && now - seen <= SESSION_MAP_TTL_MS,
  );
}

/**
 * Resolve the host. `hasSessionHit` is a callback (or boolean) answering
 * "is there a fresh session-map hit?" — a callback so tests inject state
 * and the setup-time path can pass `() => sessionMapAnyHit(cacheDir)`
 * while the command path can pass `() => sessionMapHit(cacheDir, id)`.
 *
 * Returns `{ host: 'openchamber'|'standalone',
 *            source: 'option'|'env'|'session-map'|'default' }`.
 */
function resolveHost({ options = {}, env = process.env, hasSessionHit = false } = {}) {
  const opt = normalizeOpenChamberOption(options.openchamber ?? options['open-chamber']);
  if (opt === 'on') return { host: 'openchamber', source: 'option' };
  if (opt === 'off') return { host: 'standalone', source: 'option' };
  const fromEnv = resolveOpenChamberEnv(env);
  if (fromEnv === 'on') return { host: 'openchamber', source: 'env' };
  if (fromEnv === 'off') return { host: 'standalone', source: 'env' };
  const hit = typeof hasSessionHit === 'function' ? Boolean(hasSessionHit()) : Boolean(hasSessionHit);
  if (hit) return { host: 'openchamber', source: 'session-map' };
  return { host: 'standalone', source: 'default' };
}

module.exports = {
  SESSION_MAP_FILE,
  SESSION_MAP_VERSION,
  SESSION_MAP_TTL_MS,
  normalizeOpenChamberOption,
  resolveOpenChamberEnv,
  readSessionMap,
  clearSessionMapCache,
  sessionMapHit,
  sessionMapAnyHit,
  resolveHost,
};
