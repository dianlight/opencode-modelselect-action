'use strict';

/**
 * Shared per-session status reporting + router-sync switch.
 *
 * - Router-sync file: `<cacheDir>/routing-sync.json` = `{"sync":true|false}`.
 *   Default ON: a missing file, unreadable file, bad JSON, or a non-boolean
 *   `sync` all fall back to `true` — only an explicit `false` pauses the
 *   plugin's per-turn `~/.config/openchamber/routing.json` refresh (lets a
 *   user freeze OpenChamber's Jev routing table). No global fallback: the
 *   external `~/.config/openchamber/modelselect.json` `mode` key is gone
 *   with the on/off/auto modes.
 * - Status file: `<cacheDir>/status-<sessionID>.json` (sessionID sanitized
 *   to `[A-Za-z0-9-_]`, best-effort, never throws — including suggestOnly
 *   runs). Schema:
 *   `{ sessionID, taskType, tier, model, jev, goOk, think, freeExhausted,
 *      source, suggestOnly, updatedAt }`
 *   where `model` is `"provider/id"`, `jev` is `off|pinned|<choice>@<conf>`
 *   or `kept:<reason>`, `goOk` is the last quota-probe result
 *   (`true|false|null` when unknown / no probe ran), `think` is the task
 *   type's reasoning-effort hint
 *   (`default|minimal|low|medium|high|xhigh|null`, normalized
 *   case-insensitively), `freeExhausted` is the free-tier soft-error
 *   latch (`true|false|null`; 12h for spent quota, 1h for transient
 *   rate limiting — see shared/freequota.js),
 *   `source` is the config source (`remote|cache|cache-stale…`), and
 *   `updatedAt` is epoch ms.
 *
 * Zero dependencies, Node >= 20.
 */

const fs = require('node:fs');
const path = require('node:path');

/** Sanitize a session ID for use in a file name: [A-Za-z0-9-_], max 128. */
function sanitizeSessionID(id) {
  const clean = String(id ?? 'default').replace(/[^A-Za-z0-9-_]/g, '_').slice(0, 128);
  return clean || 'default';
}

function routingSyncFile(cacheDir) {
  return path.join(String(cacheDir), 'routing-sync.json');
}

function statusFile(cacheDir, sessionID) {
  return path.join(String(cacheDir), `status-${sanitizeSessionID(sessionID)}.json`);
}

/**
 * Read the router-sync switch. Default ON — anything unusable (missing,
 * unreadable, bad JSON, non-boolean `sync`) means `true`; only an explicit
 * `false` pauses the per-turn routing.json refresh. Never throws, no
 * mtime cache (the file is tiny and read at most a couple of times per
 * turn).
 */
function readRoutingSync(cacheDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(routingSyncFile(cacheDir), 'utf8'));
    return Boolean(raw) && raw.sync === false ? false : true;
  } catch {
    return true;
  }
}

/**
 * Write the router-sync switch (`/modelselect sync on|off` path). Validates
 * a boolean, creates the cache dir. Best-effort: never throws, returns
 * true on success / false otherwise.
 */
function writeRoutingSync(cacheDir, sync) {
  try {
    if (typeof sync !== 'boolean') return false;
    const dir = String(cacheDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(routingSyncFile(dir), JSON.stringify({ sync }), 'utf8');
    return true;
  } catch {
    return false;
  }
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
      think: ['default', 'minimal', 'low', 'medium', 'high', 'xhigh']
        .includes(String(fields.think ?? '').toLowerCase())
        ? String(fields.think).toLowerCase()
        : null,
      freeExhausted: typeof fields.freeExhausted === 'boolean' ? fields.freeExhausted : null,
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
  readRoutingSync,
  writeRoutingSync,
  routingSyncFile,
  writeStatus,
  statusFile,
};
