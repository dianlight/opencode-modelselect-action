'use strict';

/**
 * Shared model selection: loads the central model config with a
 * time-based cache (`configRefreshMinutes`, 0 = always refetch,
 * default 1440 = 24h) and resolves go/free/auto tiers.
 *
 * Tier probing mirrors github-action/src/index.js (Go usage endpoint + free probe);
 * kept best-effort here so a live-quota failure degrades to the
 * preferred tier instead of failing the session.
 */

const fs = require('node:fs');
const path = require('node:path');
const { TASK_TYPES, normalizeAgentMap } = require('./detect');
const { DEFAULT_TASK_TYPES_URL } = require('./tasktypes');
const { resolveToken } = require('./auth');
const { isFreeQuotaFresh } = require('./freequota');
const { isFreeModelString, firstPaidModel, splitModelRefStrict } = require('./core/model-ref');
const { selectWithinBudget } = require('./core/budget');
const { entryFor, normalizeThink } = require('./core/lookup');

const DEFAULT_CONFIG_URL =
  'https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/model-config.json';
const DEFAULT_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const FETCH_TIMEOUT_MS = 10000;

function normalizeOptions(raw = {}, env = process.env) {
  const tier = String(raw.tier ?? 'auto').toLowerCase();
  if (!['go', 'free', 'auto'].includes(tier)) throw new Error(`Invalid tier '${raw.tier}'.`);
  const announce = String(raw.announce ?? 'switch').toLowerCase();
  if (!['switch', 'always', 'off'].includes(announce)) throw new Error(`Invalid announce '${raw.announce}'.`);
  const preference = String(raw.autoPreference ?? raw['auto-preference'] ?? 'free-first').toLowerCase();
  // Host detection force: 'auto' (default, detect) | 'on' (always
  // OpenChamber) | 'off' (always standalone). The `MODELSELECT_OPENCHAMBER`
  // env is read later by shared/host.js resolveHost — kept out of the
  // option so option/env/map precedence stays in one place.
  const openchamber = String(raw.openchamber ?? raw['open-chamber'] ?? 'auto').toLowerCase().trim();
  if (!['auto', 'on', 'off'].includes(openchamber)) {
    throw new Error(`Invalid openchamber '${raw.openchamber ?? raw['open-chamber']}'.`);
  }
  // Option > OPENCODE_API_KEY > the opencode / opencode-go key in OpenCode's
  // auth store (see auth.js: GUI hosts like OpenChamber start their own
  // OpenCode server without the shell env, but /connect already wrote the key
  // to auth.json). `tokenSource` is for verbose diagnostics only — never log
  // the token itself.
  const { token, source: tokenSource } = resolveToken(raw, env);
  let refresh = raw.configRefreshMinutes ?? raw.refreshMinutes ?? 1440;
  refresh = Number(refresh);
  if (!Number.isFinite(refresh) || refresh < 0) throw new Error('configRefreshMinutes must be >= 0.');
  let defaultTaskType = String(raw.defaultTaskType ?? raw['default-task-type'] ?? 'generic').toLowerCase();
  if (defaultTaskType === 'auto') defaultTaskType = 'generic';
  if (!TASK_TYPES.includes(defaultTaskType)) {
    throw new Error(`Unknown defaultTaskType '${raw.defaultTaskType ?? raw['default-task-type']}'.`);
  }
  // Budget cap: blended $/1M (same as the action's max-cost input).
  // Empty/absent = disabled (null); anything set must be a non-negative number.
  let maxCost = raw.maxCost ?? raw['max-cost'] ?? '';
  maxCost = String(maxCost).trim() === '' ? null : Number(maxCost);
  if (maxCost !== null && (!Number.isFinite(maxCost) || maxCost < 0)) {
    throw new Error(`maxCost must be a non-negative number (blended $/1M), got '${raw.maxCost ?? raw['max-cost']}'.`);
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
    maxCost,
    openchamber,
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
    // A failed cache write (permissions, disk full) must not lose a good
    // remote config: the fetch already succeeded, serve it anyway.
    try {
      writeCache(cacheDir, remote);
    } catch {
      // best-effort: next run refetches
    }
    return { config: remote, source: 'remote', stale: false };
  }
  if (cached) return { config: cached.config, source: 'cache-stale', stale: true, error };
  throw new Error(`Model config unreachable (${opts.configUrl}): ${error?.message ?? 'no cache'}`);
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

/**
 * Wire-protocol token ('responses' | 'messages' | 'chat' | 'systemone') for
 * a model from the config's top-level `endpoints` map ({bareId: token}).
 * Returns null when the config carries no entry — the provider default
 * protocol (chat) then applies, matching pre-endpoint behavior.
 *
 * FALLBACK_ENDPOINTS covers the same non-chat rows when the loaded config
 * predates the `endpoints` map (a 24h-cached config written before the
 * upgrade) or is unreachable offline: without it a stale cache resolves a
 * responses-only pick with no token, the virtual `api` stays on chat, and
 * Zen rejects the dispatch with ModelProtocolUnsupported. `chat` needs no
 * fallback row — it IS the provider default. Keep in sync with the
 * maintenance script's endpoint table (`scripts/opencode_maintenance.py`).
 */
const FALLBACK_ENDPOINTS = {
  'muse-spark-1.3-contributor-free': 'responses',
  'muse-spark-1.2-contributor-free': 'responses',
  'muse-spark-1.3-contributor': 'responses',
  'muse-spark-1.2-contributor': 'responses',
  'gpt-5.6-luna': 'responses',
  'gpt-6-luna': 'responses',
  'grok-4.5': 'responses',
  'grok-4.6': 'responses',
  'grok-4.7': 'responses',
  'qwen3.5-plus': 'messages',
  'qwen3.6-plus': 'messages',
  'qwen3.7-plus': 'messages',
  'qwen3.7-max': 'messages',
  'qwen3.8-flash': 'messages',
  'jev-1.13-free': 'systemone',
};
function endpointFor(config, model) {
  if (!model) return null;
  const id = String(model).split('/').pop();
  const map = config && config.endpoints;
  if (map && typeof map === 'object' && typeof map[id] === 'string') return map[id];
  return typeof FALLBACK_ENDPOINTS[id] === 'string' ? FALLBACK_ENDPOINTS[id] : null;
}

/** Resolve the final model string for a task-type + tier. Never throws without fallback. */
async function resolveModel({ taskType, opts, cacheDir }) {
  const { config, source: source0, stale } = await loadConfig(opts, cacheDir);
  let source = source0;
  const { key, entry } = entryFor(config, taskType);
  // Free-tier soft-error latch, PER MODEL (quota 12h / rate-limit 1h;
  // see shared/freequota.js): Zen has no free-quota endpoint, so a real
  // exhaustion registers there; while THIS task's free candidate is
  // latched the pick falls to `go` (also across routing sync —
  // shared/routing.js reads the same file). Other tasks' free models are
  // unaffected.
  const go = (entry && entry.go) || '';
  const free = (entry && entry.free) || '';
  const freeExhausted = free
    ? isFreeQuotaFresh(cacheDir, undefined, free)
    : isFreeQuotaFresh(cacheDir); // no entry: report "something is latched"
  if (!key || !entry) {
    if (opts.fallbackModel) return { model: opts.fallbackModel, taskType, tier: opts.tier, source: `${source}+fallback`, goOk: null, think: null, freeExhausted, endpoint: endpointFor(config, opts.fallbackModel) };
    throw new Error(`No model configured for task-type='${taskType}'.`);
  }
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
      if (freeExhausted && go) tier = 'go';
      else if (order[0] === 'free') tier = 'free';
      else tier = goOk === false ? 'free' : 'go';
      if (tier === 'go' && !go) tier = 'free';
      if (tier === 'free' && !free) tier = 'go';
    }
  } else if (tier === 'free' && freeExhausted && go && opts.token) {
    // Pinned free with live evidence it is spent: the pin cannot work
    // during the latch window — fail soft to `go` (the key is what auths
    // it; without a token nothing else can work either, keep free).
    tier = 'go';
  }
  // A fresh latch on the chosen model means its free side is exhausted,
  // but `go` is often free itself by the free-first policy — that would
  // re-select the spent tier. Prefer the first paid `go_ranked` row
  // instead (best-to-worst).
  let model = tier === 'go' ? go : free;
  const modelLatched = model ? isFreeQuotaFresh(cacheDir, undefined, model) : false;
  if (modelLatched) {
    const paid = firstPaidModel(entry);
    const canUsePaid = Boolean(opts.token) || tier === 'go';
    if (paid && canUsePaid && isFreeModelString(model)) {
      tier = 'go';
      model = paid;
    }
  }
  if (!model) {
    if (opts.fallbackModel) return { model: opts.fallbackModel, taskType: key, tier, source: `${source}+fallback`, goOk, think: normalizeThink(entry.think), freeExhausted, endpoint: endpointFor(config, opts.fallbackModel) };
    throw new Error(`No '${tier}' model for task-type='${key}'.`);
  }
  // Budget cap (mirrors the action): an over-budget pick is replaced by the
  // best-scoring ranked model within budget; nothing fitting falls back to
  // `fallbackModel` or throws (the context hook keeps the current model).
  if (opts.maxCost !== null && opts.maxCost !== undefined) {
    let budgeted;
    try {
      budgeted = selectWithinBudget(entry, key, tier, model, opts.maxCost);
    } catch (err) {
      if (!opts.fallbackModel) throw err;
      if (opts.verbose) console.log(`[modelselect] max-cost skipped: ${err.message}`);
      budgeted = null;
    }
    if (budgeted) {
      if (!budgeted.model) {
        const hint = `No '${tier}' model for task-type='${key}' fits max-cost=${opts.maxCost} (${budgeted.hint})`;
        if (!opts.fallbackModel) throw new Error(`${hint}; raise maxCost or set fallbackModel.`);
        if (opts.verbose) console.log(`[modelselect] ${hint}; using fallbackModel.`);
        model = opts.fallbackModel;
        source = `${source}+fallback`;
      } else {
        if (budgeted.model !== model && opts.verbose) {
          console.log(`[modelselect] over max-cost=${opts.maxCost} → ${budgeted.model} ($${budgeted.cost}/1M)`);
        }
        model = budgeted.model;
      }
    }
  }
  return { model, taskType: key, tier, source, stale: stale ?? false, goOk, think: normalizeThink(entry.think), freeExhausted: freeExhausted || modelLatched, endpoint: endpointFor(config, model) };
}

module.exports = {
  normalizeOptions,
  formatAnnounce,
  shouldAnnounce,
  loadConfig,
  resolveModel,
  splitModelRef: splitModelRefStrict,
  checkGoQuota,
  clearQuotaCache,
  DEFAULT_CONFIG_URL,
};
