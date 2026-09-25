'use strict';

/**
 * Remote task-type definitions (option B).
 *
 * The Jev `choice` criteria are built from this file — not from a hardcoded
 * map — so adding a task type to `config/task-types.yaml` (published to
 * `data/task-types.json` by the maintenance run) needs no plugin change.
 *
 * Loading mirrors the model config (`select.js`): same
 * `configRefreshMinutes` cadence, same cache directory, separate
 * `task-types-cache.json` file, stale cache surviving fetch failures.
 * Only the Jev path uses it (Jev is the only consumer of the full
 * type list); when the remote is unreachable with no cache the caller
 * fails open to the heuristic task-type, so this module never breaks
 * routing on its own.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TASK_TYPES_URL =
  'https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/task-types.json';
const TASK_TYPES_CACHE_NAME = 'task-types-cache.json';
const FETCH_TIMEOUT_MS = 10000;

function taskTypesCacheFile(cacheDir) {
  return path.join(cacheDir, TASK_TYPES_CACHE_NAME);
}

function readTaskTypesCache(cacheDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(taskTypesCacheFile(cacheDir), 'utf8'));
    if (raw && typeof raw === 'object' && raw.taskTypes && typeof raw.fetchedAt === 'number') return raw;
  } catch {
    // no usable cache
  }
  return null;
}

function writeTaskTypesCache(cacheDir, taskTypes) {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(taskTypesCacheFile(cacheDir), JSON.stringify({ fetchedAt: Date.now(), taskTypes }), 'utf8');
}

function isFresh(cached, refreshMinutes) {
  if (!cached) return false;
  if (refreshMinutes === 0) return false; // 0 = refetch every time
  return Date.now() - cached.fetchedAt < refreshMinutes * 60 * 1000;
}

async function fetchRemote(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'opencode-modelselect-plugin/0.1' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalize a decoded task-types payload to `{ name: { label, description } }`.
 * Accepts the published shape (`{ "task-types": {...} }`, either hyphen or
 * underscore key) or a bare name -> meta map. String metas are treated as
 * bare descriptions. Returns null when nothing usable is found.
 */
function normalizeTaskTypes(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const table = data['task-types'] ?? data.task_types ?? data;
  if (!table || typeof table !== 'object' || Array.isArray(table)) return null;
  const out = {};
  for (const [name, meta] of Object.entries(table)) {
    const key = String(name).toLowerCase().trim();
    if (!key) continue;
    if (typeof meta === 'string') {
      if (!meta.trim()) continue;
      out[key] = { label: name, description: meta.trim() };
    } else if (meta && typeof meta === 'object') {
      const description = String(meta.description ?? meta.label ?? '').trim();
      if (!description) continue;
      out[key] = { label: String(meta.label ?? name), description };
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Load task-type definitions honoring configRefreshMinutes; stale cache
 * survives fetch failures. Throws only when the remote is unreachable and
 * no cache exists — callers fail open to heuristics in that case.
 */
async function loadTaskTypes(opts, cacheDir) {
  const cached = readTaskTypesCache(cacheDir);
  if (isFresh(cached, opts.configRefreshMinutes)) {
    return { taskTypes: cached.taskTypes, source: 'cache', stale: false };
  }
  let remote = null;
  let error = null;
  try {
    remote = normalizeTaskTypes(await fetchRemote(opts.taskTypesUrl));
  } catch (err) {
    error = err;
  }
  if (remote) {
    writeTaskTypesCache(cacheDir, remote);
    return { taskTypes: remote, source: 'remote', stale: false };
  }
  if (cached) return { taskTypes: cached.taskTypes, source: 'cache-stale', stale: true, error };
  throw new Error(`Task types unreachable (${opts.taskTypesUrl}): ${error?.message ?? 'no cache'}`);
}

module.exports = {
  loadTaskTypes,
  normalizeTaskTypes,
  taskTypesCacheFile,
  DEFAULT_TASK_TYPES_URL,
};
