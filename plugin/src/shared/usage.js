'use strict';

/**
 * Usage snapshot for the Models-pane usage-status bar.
 *
 * The panel (OpenChamber guest frame) holds no token and makes no network
 * calls, so it cannot query quota itself. This module runs on the Node side
 * (the plugin, which already holds the probe token) and persists a small
 * snapshot the panel reads like `free-quota.json`:
 *
 *   `<cacheDir>/usage-limits.json` =
 *   `{ fetchedAt, source: 'limits'|'zen', go: { rolling, weekly, monthly },
 *      budgets: [{ id, percent, limited, resetsAt }] }`
 *
 * where each Go meter is `{ percent: 0..100|null, limited: bool,
 * resetsAt: epoch-ms|null }` — the same shape `GET
 * /api/experimental/usage/limits` publishes as `UsageLimits.Go`
 * (`UsageLimits.Meter`), and the `zen` source carries the same meters
 * parsed from the Zen Go usage endpoint (the data the local endpoint
 * itself aggregates).
 *
 * Primary source is the local OpenCode HTTP API
 * (`GET /api/experimental/usage/limits` on 127.0.0.1 — port from
 * `OPENCODE_PORT` / `OPENCODE_SERVER_PORT` / `PORT`, default 4096, first
 * answer wins); fallback is the Zen endpoint via the probe token. Refresh
 * is throttled to one fetch per 60s (file mtime via `fetchedAt`); callers
 * should invoke `refreshUsageLimits` fire-and-forget from the turn hooks
 * so a slow endpoint never blocks routing. Nothing here ever throws.
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseGoUsageWindows } = require('./core/probe');

const USAGE_LIMITS_BASENAME = 'usage-limits.json';
const USAGE_REFRESH_MS = 60 * 1000;
const LIMITS_TIMEOUT_MS = 2500;
const ZEN_TIMEOUT_MS = 8000;
const DEFAULT_PORT = 4096;
// Engine signals (model-select resolution):
// - SNAPSHOT_MAX_AGE_MS: a usage snapshot older than this carries no
//   veto weight (fail-open); the refresh throttle above stays 60s.
// - SNAPSHOT_SKIP_MS: a fresher snapshot lets the quota probe skip its
//   live fetch (unified caches).
// - SOFT_VETO_PCT / READMIT_PCT: hysteresis band for early avoidance —
//   veto `go` at >= 95, keep vetoing until back below 90 (no flapping).
const SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
const SNAPSHOT_SKIP_MS = 90 * 1000;
const SOFT_VETO_PCT = 95;
const READMIT_PCT = 90;

function usageLimitsFile(cacheDir) {
  return path.join(String(cacheDir), USAGE_LIMITS_BASENAME);
}

/** Read the raw snapshot; missing/unusable files read as null. Never throws. */
function readUsageLimits(cacheDir) {
  if (!cacheDir) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(usageLimitsFile(cacheDir), 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Persist a snapshot. Best-effort: never throws, returns true/false. */
function writeUsageLimits(cacheDir, snapshot) {
  if (!cacheDir || !snapshot || typeof snapshot !== 'object') return false;
  try {
    fs.mkdirSync(String(cacheDir), { recursive: true });
    fs.writeFileSync(usageLimitsFile(cacheDir), JSON.stringify(snapshot), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function numPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function numTime(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Normalize one `UsageLimits.Meter`-ish object. Never throws. */
function normalizeMeter(m) {
  if (!m || typeof m !== 'object') return { percent: null, limited: false, resetsAt: null };
  return {
    percent: numPct(m.percent ?? m.usagePercent ?? m.usage_percent),
    limited: Boolean(m.limited) || numPct(m.percent ?? m.usagePercent) >= 100,
    resetsAt: numTime(m.resetsAt ?? m.resetAt ?? m.resets_at),
  };
}

function emptyGo() {
  const blank = { percent: null, limited: false, resetsAt: null };
  return { rolling: { ...blank }, weekly: { ...blank }, monthly: { ...blank } };
}

/**
 * Normalize a `GET /api/experimental/usage/limits` (`UsageLimits.Info`)
 * payload. Returns null when it carries neither Go meters nor budgets.
 * Never throws.
 */
function normalizeLimitsPayload(data, now = Date.now()) {
  try {
    if (!data || typeof data !== 'object') return null;
    const go = data.go && typeof data.go === 'object' ? data.go : null;
    const out = {
      fetchedAt: now,
      source: 'limits',
      go: emptyGo(),
      budgets: [],
    };
    let any = false;
    if (go) {
      for (const k of ['rolling', 'weekly', 'monthly']) {
        if (go[k] && typeof go[k] === 'object') {
          out.go[k] = normalizeMeter(go[k]);
          if (out.go[k].percent !== null) any = true;
        }
      }
    }
    const budgets = Array.isArray(data.budgets) ? data.budgets : [];
    for (const b of budgets) {
      if (!b || typeof b !== 'object') continue;
      const limit = Number(b.limit);
      const spent = Number(b.spent);
      const pct =
        Number.isFinite(limit) && limit > 0 && Number.isFinite(spent)
          ? Math.max(0, Math.min(100, (spent / limit) * 100))
          : numPct(b.percent);
      out.budgets.push({
        id: typeof b.id === 'string' ? b.id : '',
        percent: pct,
        limited: pct !== null && pct >= 100,
        resetsAt: numTime(b.resetsAt ?? b.resetAt),
      });
      if (pct !== null) any = true;
    }
    return any ? out : null;
  } catch {
    return null;
  }
}

/**
 * Normalize a Zen Go usage endpoint payload via the shared core parser
 * (`core/probe.js parseGoUsageWindows`, same shapes as the action). Never
 * throws; null when nothing usable.
 */
function normalizeZenPayload(data, now = Date.now()) {
  try {
    const windows = parseGoUsageWindows(data);
    if (!windows || !windows.length) return null;
    const out = { fetchedAt: now, source: 'zen', go: emptyGo(), budgets: [] };
    let any = false;
    for (const w of windows) {
      if (!w || !out.go[w.name]) continue;
      out.go[w.name] = {
        percent: numPct(w.percent),
        limited:
          (typeof w.status === 'string' &&
            ['limited', 'exhausted', 'blocked', 'rate_limited', 'denied'].includes(w.status)) ||
          numPct(w.percent) >= 100,
        resetsAt:
          typeof w.resetSec === 'number' && Number.isFinite(w.resetSec) ? now + w.resetSec * 1000 : null,
      };
      if (out.go[w.name].percent !== null) any = true;
    }
    return any ? out : null;
  } catch {
    return null;
  }
}

/** Local server port candidates: env first, default 4096 last. Never throws. */
function usagePorts(env = process.env) {
  const out = [];
  const push = (v) => {
    const n = Number(String(v ?? '').trim());
    if (Number.isInteger(n) && n > 0 && n <= 65535 && !out.includes(n)) out.push(n);
  };
  try {
    push(env.OPENCODE_PORT);
    push(env.OPENCODE_SERVER_PORT);
    push(env.PORT);
  } catch {
    // env unreadable: default port only
  }
  push(DEFAULT_PORT);
  return out;
}

async function fetchJson(url, { timeoutMs, headers, fetchFn } = {}) {
  const impl = fetchFn || globalThis.fetch;
  if (typeof impl !== 'function') return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || LIMITS_TIMEOUT_MS);
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

/** First answering local endpoint wins; null when none answers. Never throws. */
async function fetchLimitsSnapshot({ env, fetchFn, timeoutMs, now } = {}) {
  try {
    const at = now === undefined ? Date.now() : now;
    const ports = usagePorts(env);
    for (let i = 0; i < ports.length; i++) {
      const data = await fetchJson(`http://127.0.0.1:${ports[i]}/api/experimental/usage/limits`, {
        timeoutMs: timeoutMs || LIMITS_TIMEOUT_MS,
        fetchFn,
      });
      if (!data) continue;
      const snap = normalizeLimitsPayload(data, at);
      if (snap) return snap;
    }
    return null;
  } catch {
    return null;
  }
}

/** Zen fallback via the probe token (same endpoint as the tier probe). Never throws. */
async function fetchZenSnapshot({ token, usageUrl, fetchFn, timeoutMs, now } = {}) {
  try {
    const t = String(token || '').trim();
    if (!t || !usageUrl) return null;
    const at = now === undefined ? Date.now() : now;
    const data = await fetchJson(String(usageUrl), {
      timeoutMs: timeoutMs || ZEN_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${t}` },
      fetchFn,
    });
    if (!data) return null;
    return normalizeZenPayload(data, at);
  } catch {
    return null;
  }
}

/**
 * Refresh the snapshot file: return the fresh file when younger than 60s;
 * else try the local limits endpoint, fall back to Zen (needs `token`),
 * persist the first usable snapshot and return it. Returns the previous
 * file (or null) when nothing fresh could be fetched. Never throws.
 */
async function refreshUsageLimits(cacheDir, opts = {}) {
  if (!cacheDir) return null;
  const at = opts.now === undefined ? Date.now() : opts.now;
  try {
    const prev = readUsageLimits(cacheDir);
    if (prev && typeof prev.fetchedAt === 'number' && at - prev.fetchedAt < USAGE_REFRESH_MS) {
      return prev;
    }
  } catch {
    // unreadable: fetch below
  }
  let snap = null;
  try {
    snap = await fetchLimitsSnapshot({
      env: opts.env,
      fetchFn: opts.fetchFn,
      timeoutMs: opts.timeoutMs,
      now: at,
    });
  } catch {
    snap = null;
  }
  if (!snap) {
    try {
      snap = await fetchZenSnapshot({
        token: opts.token,
        usageUrl: opts.usageUrl,
        fetchFn: opts.fetchFn,
        timeoutMs: opts.zenTimeoutMs,
        now: at,
      });
    } catch {
      snap = null;
    }
  }
  if (snap) {
    writeUsageLimits(cacheDir, snap);
    return snap;
  }
  try {
    return readUsageLimits(cacheDir);
  } catch {
    return null;
  }
}

/**
 * Engine signals: pure usage-snapshot veto for the resolver (proposals
 * 1/2/4/7). All fail-open — anything unusable reads as "no signal", so a
 * turn never fails because of quota data.
 *
 * Precedence (codified, proposal 7): the per-model free-quota latch is
 * supreme and sticky for the free side (only a real failed request sets
 * or clears it — snapshot data never touches it). The snapshot only ever
 * vetoes the `go` side. Both-sides-spent keeps `go` and lets the
 * fail-soft retry handle the real failure.
 */

// Sticky soft-veto state (proposal 2 hysteresis): token -> true while the
// worst window sits at/above SOFT_VETO_PCT, cleared once back below
// READMIT_PCT. In-memory per process; reset by clearUsageVeto (tests, and
// select.js clearQuotaCache).
const softVetoState = new Map();

/** Drop the sticky hysteresis state. Never throws. */
function clearUsageVeto() {
  try {
    softVetoState.clear();
  } catch {
    // never throws
  }
  return true;
}

/** A snapshot usable for decisions: parsed object, fresh timestamp. */
function snapshotUsable(snap, now) {
  try {
    const at = now === undefined ? Date.now() : now;
    if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return false;
    if (typeof snap.fetchedAt !== 'number' || !Number.isFinite(snap.fetchedAt)) return false;
    if (at - snap.fetchedAt >= SNAPSHOT_MAX_AGE_MS) return false;
    return true;
  } catch {
    return false;
  }
}

/** Worst Go window by percent ({ percent, limited, resetsAt } | null). */
function worstWindow(go) {
  try {
    if (!go || typeof go !== 'object') return null;
    let best = null;
    for (const k of ['rolling', 'weekly', 'monthly']) {
      const w = go[k];
      if (w && typeof w.percent === 'number' && Number.isFinite(w.percent)) {
        if (!best || w.percent > best.percent) {
          best = { percent: w.percent, limited: Boolean(w.limited), resetsAt: w.resetsAt };
        }
      }
    }
    return best;
  } catch {
    return null;
  }
}

/** True while any live budget is spent (limited flag or >= 100%). */
function anyBudgetLimited(snap) {
  try {
    const budgets = snap && Array.isArray(snap.budgets) ? snap.budgets : [];
    for (const b of budgets) {
      if (!b || typeof b !== 'object') continue;
      if (b.limited === true) return true;
      if (typeof b.percent === 'number' && Number.isFinite(b.percent) && b.percent >= 100) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Hysteresis gate for early avoidance (proposal 2): veto at/above
 * SOFT_VETO_PCT, stay vetoed until back below READMIT_PCT. Keyed by token
 * (quota is per account); empty token never vetoes. Never throws.
 */
function goSoftVeto(token, worstPercent) {
  try {
    const key = String(token || '').trim();
    const p = Number(worstPercent);
    if (!key || !Number.isFinite(p)) return false;
    if (softVetoState.get(key)) {
      if (p < READMIT_PCT) softVetoState.delete(key);
      return softVetoState.has(key);
    }
    if (p >= SOFT_VETO_PCT) {
      softVetoState.set(key, true);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Veto verdict for a usage snapshot (proposals 1/2/4). Returns null when
 * the snapshot carries no signal (missing/corrupt/stale — fail-open), else
 * `{ veto, percent, limited, resetsAt, budgetLimited, source }` where
 * `percent` is the worst-window percent (or null) and `veto` covers the
 * hard window veto, the hysteresis soft veto and the budget veto.
 * `opts.token` feeds the hysteresis gate; `opts.now` is injectable.
 * Never throws.
 */
function goVetoFromSnapshot(snap, opts = {}) {
  try {
    const at = opts.now === undefined ? Date.now() : opts.now;
    if (!snapshotUsable(snap, at)) return null;
    const go = snap.go && typeof snap.go === 'object' ? snap.go : null;
    let hard = false;
    let limited = false;
    if (go) {
      for (const k of ['rolling', 'weekly', 'monthly']) {
        const w = go[k];
        if (!w || typeof w !== 'object') continue;
        const p = Number(w.percent);
        if (w.limited === true || (Number.isFinite(p) && p >= 100)) {
          hard = true;
          limited = limited || w.limited === true;
        }
      }
    }
    const budgetLimited = anyBudgetLimited(snap);
    const worst = worstWindow(go);
    const soft = !hard && goSoftVeto(opts.token, worst ? worst.percent : NaN);
    const veto = hard || budgetLimited || soft;
    return {
      veto,
      percent: worst ? worst.percent : null,
      limited: limited || (worst ? worst.limited : false),
      resetsAt:
        worst && typeof worst.resetsAt === 'number' && Number.isFinite(worst.resetsAt) && worst.resetsAt > 0
          ? worst.resetsAt
          : null,
      budgetLimited,
      source: typeof snap.source === 'string' ? snap.source : '',
    };
  } catch {
    return null;
  }
}

module.exports = {
  USAGE_LIMITS_BASENAME,
  USAGE_REFRESH_MS,
  SNAPSHOT_MAX_AGE_MS,
  SNAPSHOT_SKIP_MS,
  SOFT_VETO_PCT,
  READMIT_PCT,
  usageLimitsFile,
  readUsageLimits,
  writeUsageLimits,
  normalizeMeter,
  normalizeLimitsPayload,
  normalizeZenPayload,
  usagePorts,
  fetchLimitsSnapshot,
  fetchZenSnapshot,
  refreshUsageLimits,
  clearUsageVeto,
  snapshotUsable,
  worstWindow,
  anyBudgetLimited,
  goSoftVeto,
  goVetoFromSnapshot,
};
