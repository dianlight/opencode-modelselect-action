'use strict';

/**
 * Runtime model inventory + catalog-miss ledger (fail-soft, Node-only).
 *
 * The remote catalog (`data/provider-catalog.json`, `model-registry-v2.json`)
 * says where a model COULD be served. It cannot see this machine's runtime:
 * a Zen model can be published on models.dev yet absent from OpenCode's
 * provider catalog for this account/config (e.g. `opencode/qwen3.8-flash`
 * while only `opencode-go/qwen3.8-flash` is served). Picking such a ref fails
 * before dispatch with `ModelNotFoundError` — retrying the same ref is
 * pointless.
 *
 * This module snapshots the live `GET /api/model` inventory (the same source
 * `live-catalog.js` reads) and exposes its ENABLED `provider/model` keys to
 * the shared chain filters. It also records observed catalog misses so
 * `/modelselect doctor` and the status section can explain them. Everything
 * here fails open: no server, no cache or unreadable files → null, and the
 * resolver keeps its previous behavior.
 */

const fs = require('node:fs');
const path = require('node:path');
const { fetchLiveInventory } = require('./live-catalog');

const RUNTIME_INVENTORY_BASENAME = 'runtime-inventory.json';
const RUNTIME_INVENTORY_TTL_MS = 60 * 1000;
const CATALOG_MISS_BASENAME = 'catalog-miss.json';
const CATALOG_MISS_TTL_MS = 15 * 60 * 1000;

function inventoryFile(cacheDir) {
  return path.join(String(cacheDir), RUNTIME_INVENTORY_BASENAME);
}

function missFile(cacheDir) {
  return path.join(String(cacheDir), CATALOG_MISS_BASENAME);
}

function readJson(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** The persisted snapshot (or null). Never throws. */
function readRuntimeInventory(cacheDir) {
  if (!cacheDir) return null;
  const raw = readJson(inventoryFile(cacheDir));
  if (!raw || typeof raw.fetchedAt !== 'number' || !Array.isArray(raw.models)) return null;
  return raw;
}

/** Enabled `provider/model` keys of a snapshot, as a Set. */
function inventoryKeySet(snapshot) {
  const keys = new Set();
  if (!snapshot || !Array.isArray(snapshot.models)) return keys;
  for (const m of snapshot.models) {
    if (!m || m.enabled === false) continue;
    const provider = String(m.providerID ?? '').trim().toLowerCase();
    const id = String(m.id ?? '').trim();
    if (provider && id) keys.add(`${provider}/${id}`);
  }
  return keys;
}

/** Fresh snapshot keys, or null when absent/stale (callers fail open). */
function freshInventoryKeys(cacheDir, now = Date.now(), ttlMs = RUNTIME_INVENTORY_TTL_MS) {
  const snap = readRuntimeInventory(cacheDir);
  if (!snap || !(Number(now) - Number(snap.fetchedAt) <= Number(ttlMs))) return null;
  const keys = inventoryKeySet(snap);
  return keys.size ? keys : null;
}

/**
 * Fetch and persist a fresh snapshot. Live fetch wins; a failure returns null
 * (fail open) without overwriting the previous snapshot, which `doctor` can
 * still report. Never throws.
 */
async function refreshRuntimeInventory(cacheDir, { env, fetchFn, timeoutMs, now = Date.now() } = {}) {
  let live = null;
  try {
    live = await fetchLiveInventory({ env, fetchFn, timeoutMs, now });
  } catch {
    live = null;
  }
  if (!live || !Array.isArray(live.models) || !live.models.length) return null;
  const snapshot = { fetchedAt: Number(now), models: live.models };
  if (!writeJson(inventoryFile(cacheDir), snapshot)) return null;
  return snapshot;
}

/** Fresh catalog-miss records as `{ key, at, until, count, source }[]`. */
function readCatalogMisses(cacheDir, now = Date.now()) {
  const raw = cacheDir ? readJson(missFile(cacheDir)) : null;
  const misses = raw && typeof raw.misses === 'object' && !Array.isArray(raw.misses) ? raw.misses : {};
  const out = [];
  for (const [key, value] of Object.entries(misses)) {
    if (!value || !(Number(value.until) > Number(now))) continue;
    out.push({ key, at: Number(value.at), until: Number(value.until), count: Number(value.count) || 0, source: String(value.source ?? '') });
  }
  return out;
}

function modelMissFresh(cacheDir, ref, now = Date.now()) {
  const key = String(ref ?? '').trim();
  if (!key) return false;
  return readCatalogMisses(cacheDir, now).some((e) => e.key === key);
}

/** Record a catalog miss for one ref (window runs from the first detection). */
function recordModelMiss(cacheDir, ref, { now = Date.now(), source = '' } = {}) {
  const key = String(ref ?? '').trim();
  if (!cacheDir || !key) return null;
  const raw = readJson(missFile(cacheDir)) || { version: 1, misses: {} };
  const prev = raw.misses && typeof raw.misses === 'object' && !Array.isArray(raw.misses)
    ? raw.misses[key]
    : null;
  const fresh = prev && Number(prev.until) > Number(now);
  const entry = {
    at: fresh ? Number(prev.at) : Number(now),
    until: fresh ? Number(prev.until) : Number(now) + CATALOG_MISS_TTL_MS,
    count: (fresh ? Number(prev.count) || 0 : 0) + 1,
    source: String(source ?? '').slice(0, 60),
  };
  const misses = {};
  for (const [k, v] of Object.entries(raw.misses && typeof raw.misses === 'object' && !Array.isArray(raw.misses) ? raw.misses : {})) {
    if (v && Number(v.until) > Number(now)) misses[k] = v;
  }
  misses[key] = entry;
  writeJson(missFile(cacheDir), { version: 1, misses });
  return { key, ...entry };
}

module.exports = {
  RUNTIME_INVENTORY_BASENAME,
  RUNTIME_INVENTORY_TTL_MS,
  CATALOG_MISS_BASENAME,
  CATALOG_MISS_TTL_MS,
  inventoryFile,
  missFile,
  readRuntimeInventory,
  inventoryKeySet,
  freshInventoryKeys,
  refreshRuntimeInventory,
  readCatalogMisses,
  modelMissFresh,
  recordModelMiss,
};
