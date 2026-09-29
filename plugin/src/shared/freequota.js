'use strict';

/**
 * Free-tier soft-error latch (fail-soft detection).
 *
 * OpenCode Zen publishes no free-quota endpoint (upstream
 * anomalyco/opencode#18648 is still open), so exhaustion can only be
 * observed from a real failed request — there is deliberately NO probe
 * here. When a free-side model call comes back exhausted the plugin
 * registers the failure once:
 *
 * - `<cacheDir>/free-quota.json` = `{ version, at, until, kind, model,
 *   detail, updatedAt }`. `at` is the FIRST detection and `until = at +
 *   ttl`, where quota exhaustion uses FREE_QUOTA_TTL_MS (12h) and
 *   rate-limiting uses FREE_RATE_LIMIT_TTL_MS (1h). The window is never
 *   extended while fresh, so after `until` the latch clears and the next
 *   real failure may register again (the "new check").
 * - Consumers of a fresh entry:
 *     - `shared/routing.js` syncs `~/.config/openchamber/routing.json`
 *       to the `go` side (OpenChamber's Jev categories follow),
 *     - `shared/select.js` resolves the pick to `go` while fresh.
 *
 * Fingerprint mirrors the field-tested free-probe classification in
 * `github-action/src/index.js` (`classifyFreeProbe`): 402/429 are the
 * quota-spent statuses. A bare 503/529 on a live conversation is usually
 * transient overload — and a 12h latch is expensive — so those and other
 * 4xx statuses only count with quota wording in the body. A rate-limit
 * signal, including "Rate limit exceeded. Please try again later.",
 * instead receives the shorter rate-limit window. 401 is auth,
 * never exhaustion.
 *
 * Node-only (fs). Pure freshness (`freeQuotaFresh`) lives in
 * `shared/routing.js` because the Work Status bundle inlines that module.
 * Nothing here ever throws: a soft-error latch must never break a turn.
 */

const fs = require('node:fs');
const path = require('node:path');
const { FREE_QUOTA_FILE, FREE_QUOTA_TTL_MS, freeQuotaFresh } = require('./routing');

const FREE_QUOTA_BASENAME = path.basename(FREE_QUOTA_FILE);

// Transient rate limiting gets a shorter recovery window than spent quota.
const FREE_RATE_LIMIT_TTL_MS = 60 * 60 * 1000;

// Body fingerprints for statuses that are not quota-spent by themselves
// (400/403-style rejections, 503/529 overload with a quota note, ...).
const EXHAUST_BODY_RE =
  /rate\s*limit|too many requests|quota|exhaust|out of (?:credits|quota|capacity)|daily\s*limit|usage\s*limit|upstream (?:provider|error)/i;

// Explicit vendor wording for transient rate limiting. This is matched
// separately so it also counts when it arrives with an unexpected failure
// status.
const RATE_LIMIT_MESSAGE_RE = /rate\s*limit\s*exceeded\.?\s*please\s+try\s+again\s+later\.?/i;
const RATE_LIMIT_BODY_RE = /rate\s*limit|too many requests/i;

/**
 * Classify a failed model response: does it signal free-quota exhaustion?
 * Accepts a status-less value (0/NaN, e.g. a retry error object with only
 * a message) and falls back to the body text alone in that case.
 */
function classifyFreeExhaustion(status, bodyText) {
  const s = Number(status);
  const text = String(bodyText ?? '');
  const failure = !Number.isFinite(s) || s <= 0 || s >= 400;
  if (!failure) return false;
  if (RATE_LIMIT_MESSAGE_RE.test(text)) return true;
  if (!Number.isFinite(s) || s <= 0) return EXHAUST_BODY_RE.test(text);
  if (s === 401) return false; // key rejected, not quota
  if (s === 402 || s === 429) return true;
  if (s < 500) return EXHAUST_BODY_RE.test(text);
  // 503/529 only with quota wording: bare overload is transient.
  if (s === 503 || s === 529) return EXHAUST_BODY_RE.test(text);
  return false;
}

/**
 * Distinguish transient rate limiting from spent quota. Both switch away
 * from free; only their latch windows differ.
 */
function isRateLimitSignal(status, bodyText) {
  const s = Number(status);
  const text = String(bodyText ?? '');
  if (!Number.isFinite(s) || s <= 0) {
    return RATE_LIMIT_BODY_RE.test(text) || RATE_LIMIT_MESSAGE_RE.test(text);
  }
  if (s < 400) return false;
  return s === 429 || RATE_LIMIT_BODY_RE.test(text) || RATE_LIMIT_MESSAGE_RE.test(text);
}

/**
 * Classify a failed model response as `{ exhausted, rateLimited }`.
 * The exact vendor message "Rate limit exceeded. Please try again later."
 * is always treated as transient rate limiting when it accompanies a
 * failure.
 */
function classifyFreeFailure(status, bodyText) {
  const exhausted = classifyFreeExhaustion(status, bodyText);
  if (!exhausted) return { exhausted: false, rateLimited: false };
  return { exhausted: true, rateLimited: isRateLimitSignal(status, bodyText) };
}

function freeQuotaFile(cacheDir) {
  return path.join(String(cacheDir), FREE_QUOTA_BASENAME);
}

/** Read the latch entry; missing/unusable files read as null. Never throws. */
function readFreeQuota(cacheDir) {
  if (!cacheDir) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(freeQuotaFile(cacheDir), 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** True while the latch is fresh (within its first-detection window). */
function isFreeQuotaFresh(cacheDir, now) {
  if (!cacheDir) return false;
  return freeQuotaFresh(readFreeQuota(cacheDir), now);
}

/**
 * Register a soft error. `kind` is `'exhaustion'` for spent quota or
 * `'rate-limit'` for transient rate limiting. While the entry is fresh
 * the original `at`, `until`, and `kind` are kept (the window runs from
 * the first detection; later failures never extend or shorten it); only
 * an expired latch starts a new window. Returns the stored entry, or
 * null when it could not be written. Never throws.
 */
function markFreeQuota(cacheDir, fields = {}, now = Date.now()) {
  if (!cacheDir) return null;
  try {
    const prev = readFreeQuota(cacheDir);
    const fresh = freeQuotaFresh(prev, now);
    const kind = fields.kind === 'rate-limit' ? 'rate-limit' : 'exhaustion';
    const windowKind =
      fresh && (prev.kind === 'rate-limit' || prev.kind === 'exhaustion') ? prev.kind : kind;
    const ttl = windowKind === 'rate-limit' ? FREE_RATE_LIMIT_TTL_MS : FREE_QUOTA_TTL_MS;
    const at = fresh ? Number(prev.at) : now;
    const until = fresh ? Number(prev.until) : now + ttl;
    const entry = {
      version: 1,
      at,
      until,
      kind: windowKind,
      model: fields.model == null ? null : String(fields.model),
      detail: String(fields.detail ?? '').slice(0, 200),
      updatedAt: now,
    };
    fs.mkdirSync(String(cacheDir), { recursive: true });
    fs.writeFileSync(freeQuotaFile(cacheDir), JSON.stringify(entry), 'utf8');
    return entry;
  } catch {
    return null;
  }
}

/**
 * The task-model table (`{ name: { go, free } }`) from the plugin's
 * model-config cache; null when absent/unusable (callers then fall back
 * to the `-free` suffix heuristic in `isFreeModelRef`).
 */
function readModelTable(cacheDir) {
  if (!cacheDir) return null;
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(String(cacheDir), 'model-config-cache.json'), 'utf8'),
    );
    const cfg = raw && typeof raw === 'object' ? raw.config : null;
    const table = cfg && typeof cfg === 'object' ? cfg['task-types'] ?? cfg.task_types : null;
    return table && typeof table === 'object' && !Array.isArray(table) ? table : null;
  } catch {
    return null;
  }
}

/**
 * True when `ref` is a FREE-side model. Accepts Model.Ref
 * (`{ providerID, id }`) and splitModelRef shapes
 * (`{ providerID, modelID }`). Match order: any configured `free`
 * entry wins; a configured `go` entry means paid (never latch a paid
 * pick); otherwise the Zen `-free` suffix is the fallback — models like
 * `big-pickle` do not carry it, which is why the table match is
 * preferred whenever the cache exists.
 */
function isFreeModelRef(ref, modelTable) {
  if (!ref || typeof ref !== 'object') return false;
  const providerID = String(ref.providerID ?? '');
  const id = String(ref.id ?? ref.modelID ?? '');
  if (!id) return false;
  const key = providerID ? `${providerID}/${id}` : id;
  const hit = (v) => {
    const s = String(v ?? '').trim();
    return s === key || s === id;
  };
  if (modelTable && typeof modelTable === 'object') {
    const entries = Object.values(modelTable).filter((e) => e && typeof e === 'object');
    if (entries.some((e) => hit(e.free))) return true;
    if (entries.some((e) => hit(e.go))) return false;
  }
  return /-free$/i.test(id);
}

module.exports = {
  FREE_QUOTA_BASENAME,
  FREE_RATE_LIMIT_TTL_MS,
  EXHAUST_BODY_RE,
  RATE_LIMIT_BODY_RE,
  RATE_LIMIT_MESSAGE_RE,
  classifyFreeExhaustion,
  classifyFreeFailure,
  isFreeModelRef,
  isFreeQuotaFresh,
  markFreeQuota,
  readFreeQuota,
  readModelTable,
};
