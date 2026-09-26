'use strict';

/**
 * Shared model selection: loads the central model config with a
 * time-based cache (`configRefreshMinutes`, 0 = always refetch,
 * default 1440 = 24h) and resolves go/free/auto tiers.
 *
 * Tier probing mirrors src/index.js (Go usage endpoint + free probe);
 * kept best-effort here so a live-quota failure degrades to the
 * preferred tier instead of failing the session.
 */

const fs = require('node:fs');
const path = require('node:path');
const { TASK_TYPES, normalizeAgentMap } = require('./detect');
const { DEFAULT_TASK_TYPES_URL } = require('./tasktypes');
const { resolveToken } = require('./auth');

const DEFAULT_CONFIG_URL =
  'https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/model-config.json';
const DEFAULT_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const FETCH_TIMEOUT_MS = 10000;

function normalizeOptions(raw = {}) {
  const tier = String(raw.tier ?? 'auto').toLowerCase();
  if (!['go', 'free', 'auto'].includes(tier)) throw new Error(`Invalid tier '${raw.tier}'.`);
  const announce = String(raw.announce ?? 'switch').toLowerCase();
  if (!['switch', 'always', 'off'].includes(announce)) throw new Error(`Invalid announce '${raw.announce}'.`);
  const preference = String(raw.autoPreference ?? raw['auto-preference'] ?? 'free-first').toLowerCase();
  // Option > OPENCODE_API_KEY > the opencode / opencode-go key in OpenCode's
  // auth store (see auth.js: GUI hosts like OpenChamber start their own
  // OpenCode server without the shell env, but /connect already wrote the key
  // to auth.json). `tokenSource` is for verbose diagnostics only — never log
  // the token itself.
  const { token, source: tokenSource } = resolveToken(raw);
  let refresh = raw.configRefreshMinutes ?? raw.refreshMinutes ?? 1440;
  refresh = Number(refresh);
  if (!Number.isFinite(refresh) || refresh < 0) throw new Error('configRefreshMinutes must be >= 0.');
  let defaultTaskType = String(raw.defaultTaskType ?? raw['default-task-type'] ?? 'generic').toLowerCase();
  if (defaultTaskType === 'auto') defaultTaskType = 'generic';
  if (!TASK_TYPES.includes(defaultTaskType)) {
    throw new Error(`Unknown defaultTaskType '${raw.defaultTaskType ?? raw['default-task-type']}'.`);
  }
  return {
    taskType: String(raw.taskType ?? raw['task-type'] ?? 'auto'),
    defaultTaskType,
    agentTaskMap: normalizeAgentMap(
      raw.agentTaskMap ?? raw['agent-task-map'] ?? raw.agentMap ?? raw['agent-map'] ?? {},
    ),
    tier,
    autoPreference: preference === 'go-first' ? 'go-first' : 'free-first',
    configUrl: String(raw.configUrl ?? raw['config-url'] ?? DEFAULT_CONFIG_URL),
    configRefreshMinutes: refresh,
    taskTypesUrl: String(
      raw.taskTypesUrl ?? raw['task-types-url'] ?? raw.tasktypesUrl ?? DEFAULT_TASK_TYPES_URL,
    ),
    fallbackModel: String(raw.fallbackModel ?? raw['fallback-model'] ?? '').trim(),
    maxCost: raw.maxCost ?? raw['max-cost'] ?? '',
    token,
    tokenSource,
    usageUrl: String(raw.usageUrl ?? raw['usage-url'] ?? DEFAULT_USAGE_URL),
    verbose: Boolean(raw.verbose ?? false),
    suggestOnly: Boolean(raw.suggestOnly ?? raw['suggest-only'] ?? raw.suggest_only ?? false),
    announce,
    ...require('./jev').normalizeJevOptions(raw),
    ...require('./continuation').normalizeHistoryOptions(raw),
  };
}

/** Terse chat-visible pick line. suggestOnly turns `→` into `would use`. */
function formatAnnounce({ taskType, tier, model, suggestOnly, jev }) {
  const verb = suggestOnly ? 'would use' : '→';
  const tail = jev ? ` jev=${jev}` : '';
  return `[modelselect: task=${taskType} tier=${tier} ${verb} ${model}${tail}]`;
}

/**
 * Switch-mode dedup: emit on the first turn (no applied/announced key yet)
 * and whenever the pick differs from both the applied pick (sticky/applied,
 * which never moves in suggestOnly) and the last announced pick.
 */
function shouldAnnounce(mode, key, appliedKey, announcedKey) {
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  return key !== appliedKey && key !== announcedKey;
}

function cacheFile(cacheDir) {
  return path.join(cacheDir, 'model-config-cache.json');
}

function readCache(cacheDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(cacheDir), 'utf8'));
    if (raw && typeof raw === 'object' && raw.config && typeof raw.fetchedAt === 'number') return raw;
  } catch {
    // no usable cache
  }
  return null;
}

function writeCache(cacheDir, config) {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile(cacheDir), JSON.stringify({ fetchedAt: Date.now(), config }), 'utf8');
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

/** Load config honoring configRefreshMinutes; stale cache survives fetch failures. */
async function loadConfig(opts, cacheDir) {
  const cached = readCache(cacheDir);
  if (isFresh(cached, opts.configRefreshMinutes)) return { config: cached.config, source: 'cache', stale: false };
  let remote = null;
  let error = null;
  try {
    remote = await fetchRemote(opts.configUrl);
  } catch (err) {
    error = err;
  }
  if (remote) {
    writeCache(cacheDir, remote);
    return { config: remote, source: 'remote', stale: false };
  }
  if (cached) return { config: cached.config, source: 'cache-stale', stale: true, error };
  throw new Error(`Model config unreachable (${opts.configUrl}): ${error?.message ?? 'no cache'}`);
}

function entryFor(config, taskType) {
  const table = config?.['task-types'] ?? config?.task_types;
  if (!table || typeof table !== 'object') throw new Error("Invalid model config: missing 'task-types'.");
  const key = Object.keys(table).find((k) => k.toLowerCase() === String(taskType).toLowerCase());
  if (!key) return { key: null, entry: null };
  return { key, entry: table[key] };
}

const GO_QUOTA_TTL_MS = 5 * 60 * 1000;
const goQuotaCache = new Map(); // token -> { ok, at }
let noTokenHinted = false; // verbose no-token hint, once per process

async function checkGoQuotaLive(token, usageUrl) {
  if (!token) return null; // unknown without a token: let preference decide
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(usageUrl, {
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403 || res.status === 404) return false;
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      const pct = data?.usage?.monthly?.percent ?? data?.usage?.monthly?.usagePercent ?? null;
      if (typeof pct === 'number' && pct >= 100) return false;
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/** Cached wrapper: one quota probe per token per 5 minutes. */
async function checkGoQuota(token, usageUrl) {
  if (!token) return null; // unknown without a token: let preference decide
  const cached = goQuotaCache.get(token);
  if (cached && Date.now() - cached.at < GO_QUOTA_TTL_MS) return cached.ok;
  const ok = await checkGoQuotaLive(token, usageUrl);
  goQuotaCache.set(token, { ok, at: Date.now() });
  return ok;
}

function clearQuotaCache() {
  goQuotaCache.clear();
  noTokenHinted = false;
}

/** Resolve the final model string for a task-type + tier. Never throws without fallback. */
async function resolveModel({ taskType, opts, cacheDir }) {
  const { config, source, stale } = await loadConfig(opts, cacheDir);
  const { key, entry } = entryFor(config, taskType);
  if (!key || !entry) {
    if (opts.fallbackModel) return { model: opts.fallbackModel, taskType, tier: opts.tier, source: `${source}+fallback`, goOk: null };
    throw new Error(`No model configured for task-type='${taskType}'.`);
  }
  const go = entry.go || '';
  const free = entry.free || '';
  let tier = opts.tier;
  let goOk = null; // last quota-probe result; null when no probe ran
  if (tier === 'auto') {
    const order = opts.autoPreference === 'go-first' ? ['go', 'free'] : ['free', 'go'];
    if (!opts.token) {
      tier = 'free';
      if (opts.verbose) {
        // Once per process: a GUI host without a key would otherwise log this
        // on every turn. Points at the auth store, not the env var, because
        // that is the miss people hit (OpenChamber spawns its own server).
        if (!noTokenHinted) {
          noTokenHinted = true;
          console.log(
            `[modelselect] no token (source=${opts.tokenSource || 'none'}): tier=auto falls back to free. ` +
              "Set the 'token' option, export OPENCODE_API_KEY, or run /connect so the opencode key " +
              'lands in OpenCode auth.json.',
          );
        }
      }
    } else {
      if (opts.verbose) console.log(`[modelselect] token source=${opts.tokenSource || 'option'}`);
      goOk = await checkGoQuota(opts.token, opts.usageUrl);
      if (order[0] === 'free') tier = 'free';
      else tier = goOk === false ? 'free' : 'go';
      if (tier === 'go' && !go) tier = 'free';
      if (tier === 'free' && !free) tier = 'go';
    }
  }
  const model = tier === 'go' ? go : free;
  if (!model) {
    if (opts.fallbackModel) return { model: opts.fallbackModel, taskType: key, tier, source: `${source}+fallback`, goOk };
    throw new Error(`No '${tier}' model for task-type='${key}'.`);
  }
  return { model, taskType: key, tier, source, stale: stale ?? false, goOk };
}

/** Split a "provider/model" string. v1 uses modelID, v2 uses id. */
function splitModelRef(model) {
  const s = String(model ?? '').trim();
  const i = s.indexOf('/');
  if (i <= 0 || i === s.length - 1) throw new Error(`Invalid model ref '${s}' (want provider/model).`);
  return { providerID: s.slice(0, i), id: s.slice(i + 1) };
}

module.exports = {
  normalizeOptions,
  formatAnnounce,
  shouldAnnounce,
  loadConfig,
  resolveModel,
  splitModelRef,
  checkGoQuota,
  clearQuotaCache,
  DEFAULT_CONFIG_URL,
};
