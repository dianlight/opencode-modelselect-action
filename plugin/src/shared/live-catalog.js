'use strict';

/**
 * Live provider availability for the plugin's chain resolution (F4).
 *
 * The GitHub Action reads a static, key-agnostic provider catalog
 * (`data/provider-catalog.json`) and applies static availability (declared
 * providers, Go plan, budgets). The plugin runs the SAME chain
 * (`core/chain.js`) but must know what is actually usable RIGHT NOW on the
 * machine it runs on: which provider models are enabled, whether the Go
 * plan still has spend left, and which free models carry a fresh exhaustion
 * latch. This module answers the network half of that:
 *
 *   - `GET /api/model` on the local OpenCode server(s) (port from
 *     `OPENCODE_PORT` / `OPENCODE_SERVER_PORT` / `PORT`, default 4096) →
 *     the live provider/model inventory with enabled flags + capabilities;
 *   - the usage snapshot (`GET /api/experimental/usage/limits` local, Zen
 *     fallback) → the Go spend verdict (veto / budget remaining).
 *
 * The module is fail-soft by contract: no server, no token, offline dev
 * machines → `null` availability, and the resolver keeps its legacy
 * tier/preference logic (the chain then runs unfiltered, like the action's
 * static path).
 */

const { usagePorts, goVetoFromSnapshot, refreshUsageLimits, readUsageLimits, fetchLimitsSnapshot, fetchZenSnapshot } = require('./usage');
const { latchEntries, freeQuotaFresh } = require('./core/free-quota');
const { readFreeQuota } = require('./freequota');

const MODEL_ENDPOINT = '/api/model';
const DEFAULT_TIMEOUT_MS = 2500;

async function fetchJson(url, { timeoutMs, headers, fetchFn } = {}) {
  const impl = fetchFn || globalThis.fetch;
  if (typeof impl !== 'function') return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const res = await impl(url, { signal: ctrl.signal, headers: headers || {} });
    if (!res || !res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalize a live `/api/model` payload into `{ providers, models }`.
 * Tolerates the envelope shapes seen across OpenCode versions:
 *   `{ models: [...] }`, `{ providers: [ { id, models: [...] } ] }`,
 *   `{ providers: { <slug>: { models: [...] } } }`.
 * Returns null when nothing usable came back. Never throws.
 */
function normalizeInventory(data) {
  if (!data || typeof data !== 'object') return null;
  const hasModels = Array.isArray(data.models);
  const hasProvidersList = Array.isArray(data.providers);
  const hasProvidersMap = Boolean(data.providers) && typeof data.providers === 'object' && !Array.isArray(data.providers);
  if (!hasModels && !hasProvidersList && !hasProvidersMap) return null;
  const models = [];
  const pushModel = (m, providerID) => {
    if (!m || typeof m !== 'object') return;
    const pid = String(providerID ?? m.providerID ?? m.provider ?? '').trim().toLowerCase();
    const id = String(m.id ?? m.modelID ?? m.model ?? '').trim();
    if (!pid || !id) return;
    models.push({
      providerID: pid,
      id,
      enabled: m.enabled === undefined ? true : Boolean(m.enabled),
      capabilities: m.capabilities && typeof m.capabilities === 'object' ? m.capabilities : null,
      blended_cost: typeof m.blended_cost === 'number' ? m.blended_cost : null,
      context: typeof m.context === 'number' ? m.context : null,
    });
  };
  const groups = [];
  if (Array.isArray(data.models)) {
    for (const m of data.models) groups.push([null, m]);
  } else if (Array.isArray(data.providers)) {
    for (const p of data.providers) {
      if (p && Array.isArray(p.models)) groups.push([String(p.id ?? p.provider ?? '').trim().toLowerCase(), null, p.models]);
    }
  } else if (data.providers && typeof data.providers === 'object' && !Array.isArray(data.providers)) {
    for (const [slug, p] of Object.entries(data.providers)) {
      if (p && Array.isArray(p.models)) groups.push([String(slug ?? '').trim().toLowerCase(), null, p.models]);
    }
  }
  for (const g of groups) {
    if (g[1]) pushModel(g[1], g[0]);
    if (g[2]) for (const m of g[2]) pushModel(m, g[0]);
  }
  if (!models.length) return null;
  const providers = {};
  const byProvider = new Map();
  for (const m of models) {
    if (!byProvider.has(m.providerID)) byProvider.set(m.providerID, []);
    byProvider.get(m.providerID).push(m);
  }
  for (const [slug, list] of byProvider) {
    providers[slug] = list.some((m) => m.enabled);
  }
  return { providers, models };
}

/**
 * Availability object for the shared chain core:
 *   `{ providers: { <slug>: bool | { unavailable?, budget_remaining? } },
 *      latched: string[] }`
 * - `providers` carries the LIVE enabled flags (a provider whose models are
 *   all disabled reads as unavailable) and the Go spend state (a vetoed Go
 *   plan reads as `{ budget_remaining: 0 }`, which the chain's spend filter
 *   turns into "skip").
 * - `latched` carries the keys (`provider/id`) of freshly-latched free
 *   models.
 *
 * Pure over its arguments (no fetch): callers pass the pieces in.
 */
function availabilityFromLive({ inventory, usage, latchData, now } = {}) {
  const providers = {};
  const latched = [];
  if (inventory && Array.isArray(inventory.models) && inventory.models.length) {
    const byProvider = new Map();
    for (const m of inventory.models) {
      const slug = String(m.providerID ?? '').trim().toLowerCase();
      if (!slug) continue;
      if (!byProvider.has(slug)) byProvider.set(slug, []);
      byProvider.get(slug).push(m);
    }
    for (const [slug, list] of byProvider) {
      providers[slug] = list.some((m) => m.enabled);
    }
  }
  let goVeto = null;
  try {
    goVeto = usage ? goVetoFromSnapshot(usage, { now }) : null;
  } catch {
    goVeto = null;
  }
  if (goVeto && goVeto.veto) {
    // Go plan spent: the chain's spend filter skips every go row.
    providers['opencode-go'] = { budget_remaining: 0 };
  }
  const at = typeof now === 'number' ? now : Date.now();
  for (const e of latchEntries(latchData)) {
    if (e && typeof e === 'object' && freeQuotaFresh(e, at)) {
      const key = String(e.key ?? '').trim();
      if (key) latched.push(key);
    }
  }
  return { providers, latched };
}

/** Live provider inventory: first answering local port wins. Never throws. */
async function fetchLiveInventory({ env, fetchFn, timeoutMs, now } = {}) {
  try {
    const ports = usagePorts(env || process.env);
    for (let i = 0; i < ports.length; i++) {
      const data = await fetchJson(`http://127.0.0.1:${ports[i]}${MODEL_ENDPOINT}`, { timeoutMs, fetchFn });
      const inv = normalizeInventory(data);
      if (inv) return inv;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Full live availability: inventory + Go spend verdict + free latches.
 * Never throws; `null` when no local server answered the inventory call.
 *
 * `writeSnapshot` (default true) also persists the refreshed usage
 * snapshot — the resolver-side availability read passes false so a
 * per-turn availability cache never doubles as the status-bar snapshot
 * writer (the turn hooks own that refresh).
 */
async function liveAvailability({ env, fetchFn, token, usageUrl, cacheDir, usage, now, writeSnapshot = true } = {}) {
  const inventory = await fetchLiveInventory({ env, fetchFn, now });
  let snap = usage;
  if (snap === undefined && writeSnapshot && cacheDir) {
    try {
      snap = await refreshUsageLimits(cacheDir, { env, token, usageUrl, fetchFn, now });
    } catch {
      snap = null;
    }
  }
  if (snap === undefined && !writeSnapshot && cacheDir) {
    try {
      snap = (await fetchLimitsSnapshot({ env, fetchFn, now })) || (await fetchZenSnapshot({ token, usageUrl, fetchFn, now }));
    } catch {
      snap = null;
    }
  }
  let latchData = null;
  try {
    latchData = readFreeQuota(cacheDir);
  } catch {
    latchData = null;
  }
  const avail = availabilityFromLive({ inventory, usage: snap, latchData, now });
  const providers = avail.providers && typeof avail.providers === 'object' ? avail.providers : {};
  const clean = {};
  for (const k of Object.keys(providers)) {
    if (providers[k] !== undefined) clean[k] = providers[k];
  }
  avail.providers = clean;
  return { ...avail, usage: snap };
}

module.exports = {
  MODEL_ENDPOINT,
  fetchJson,
  normalizeInventory,
  availabilityFromLive,
  fetchLiveInventory,
  liveAvailability,
};
