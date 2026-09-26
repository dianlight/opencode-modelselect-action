'use strict';

/**
 * Shared per-session status reporting + global mode switch.
 *
 * - Mode file: `<cacheDir>/mode.json` = `{"mode":"on"|"off"|"auto"}`.
 *   Missing file, unreadable file, bad JSON, or an unknown value all fall
 *   back to `"on"` (today's behavior). Reads are guarded by a tiny
 *   `{ mtimeMs, size }` cache so the file is only re-parsed when it
 *   changes; the file is tiny so a stale/missing read just means `on`.
 * - Status file: `<cacheDir>/status-<sessionID>.json` (sessionID sanitized
 *   to `[A-Za-z0-9-_]`, best-effort, never throws — including suggestOnly
 *   runs). Schema:
 *   `{ sessionID, taskType, tier, model, jev, goOk, source, suggestOnly,
 *      updatedAt }`
 *   where `model` is `"provider/id"`, `jev` is `off|pinned|<choice>@<conf>`
 *   or `kept:<reason>`, `goOk` is the last quota-probe result
 *   (`true|false|null` when unknown / no probe ran), `source` is the
 *   config source (`remote|cache|cache-stale…`), and `updatedAt` is epoch
 *   ms.
 *
 * Zero dependencies, Node >= 20.
 */

const fs = require('node:fs');
const path = require('node:path');

const VALID_MODES = ['on', 'off', 'auto'];

// cacheDir -> { stamp, mode }; stamp covers mtime + size so a rewrite in
// the same millisecond still invalidates.
const modeCache = new Map();

/** Sanitize a session ID for use in a file name: [A-Za-z0-9-_], max 128. */
function sanitizeSessionID(id) {
  const clean = String(id ?? 'default').replace(/[^A-Za-z0-9-_]/g, '_').slice(0, 128);
  return clean || 'default';
}

function modeFile(cacheDir) {
  return path.join(String(cacheDir), 'mode.json');
}

function statusFile(cacheDir, sessionID) {
  return path.join(String(cacheDir), `status-${sanitizeSessionID(sessionID)}.json`);
}

/**
 * Read the global routing mode. Never throws — anything unusable means
 * `"on"` (current behavior).
 */
function readMode(cacheDir) {
  try {
    const file = modeFile(cacheDir);
    let stamp = null;
    try {
      const st = fs.statSync(file);
      stamp = `${st.mtimeMs}:${st.size}`;
    } catch {
      return 'on'; // missing/unstatable = on
    }
    const key = String(cacheDir);
    const cached = modeCache.get(key);
    if (cached && cached.stamp === stamp) return cached.mode;
    let mode = 'on';
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const m = typeof raw?.mode === 'string' ? raw.mode.toLowerCase().trim() : '';
      if (VALID_MODES.includes(m)) mode = m;
    } catch {
      mode = 'on'; // bad JSON = on
    }
    modeCache.set(key, { stamp, mode });
    return mode;
  } catch {
    return 'on';
  }
}

/** Clear the mode mtime cache (tests / long-lived hosts after writes). */
function clearModeCache() {
  modeCache.clear();
}

/**
 * Write the per-session status file. Best-effort: never throws, returns
 * the payload on success and null on failure.
 */
function writeStatus(cacheDir, sessionID, fields = {}) {
  try {
    const dir = String(cacheDir);
    fs.mkdirSync(dir, { recursive: true });
    const payload = {
      sessionID: String(sessionID ?? 'default'),
      taskType: fields.taskType ?? null,
      tier: fields.tier ?? null,
      model: fields.model ?? null,
      jev: fields.jev ?? null,
      goOk: typeof fields.goOk === 'boolean' ? fields.goOk : null,
      source: String(fields.source ?? ''),
      suggestOnly: Boolean(fields.suggestOnly ?? false),
      updatedAt: Date.now(),
    };
    fs.writeFileSync(statusFile(dir, sessionID), JSON.stringify(payload), 'utf8');
    return payload;
  } catch {
    return null;
  }
}

module.exports = {
  sanitizeSessionID,
  readMode,
  clearModeCache,
  writeStatus,
  modeFile,
  statusFile,
};
