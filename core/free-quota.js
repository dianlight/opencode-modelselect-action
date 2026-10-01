'use strict';

/**
 * Free-tier quota latch + failure classifiers — shared pure decision core
 * (no dependencies, browser-safe).
 *
 * Vendored into `github-action/src/shared/core/` and
 * `plugin/src/shared/core/` by `scripts/build-core.js`; edit `core/`,
 * never the vendored copies.
 *
 * Two origins, moved verbatim (no policy unification):
 * - latch freshness/matching (`freeQuotaFresh`, `latchEntries`,
 *   `latchKeyApplies`, `latchPredicate`) lived in the routing sync;
 * - failure classifiers + windows (`classifyFreeExhaustion`,
 *   `classifyFreeFailure`, `isRateLimitSignal`, `isFreeModelRef`, the
 *   regexes, the TTL constants) lived in the plugin free-quota writer.
 *
 * `now` is injectable for tests; defaults to Date.now() so the status
 * bundle (browser) works unchanged. Nothing here ever throws.
 */

function isObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

// Default quota-exhaustion window; transient rate limiting is stored with
// its own shorter `until` by the writer.
const FREE_QUOTA_TTL_MS = 12 * 60 * 60 * 1000; // fresh for 12h from the first detection

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

// Free-tier soft-error latch freshness: `at` is the FIRST detection and
// `until` is the kind-specific deadline stored by the writer (spent quota
// uses 12h; transient rate limiting uses 1h). Fresh => that model's free
// side is known to be unavailable and consumers must prefer `go` for it;
// after `until` the latch clears and the next real failure may register
// again. `now` is injectable for tests; defaults to Date.now() so the
// status bundle (browser) works unchanged.
function freeQuotaFresh(entry, now) {
  if (!isObject(entry)) return false;
  const at = Number(entry.at);
  const until = Number(entry.until);
  if (!Number.isFinite(at) || !Number.isFinite(until) || until <= at) return false;
  return until > (now === undefined ? Date.now() : now);
}

// Normalize a `free-quota.json` payload into per-model latch entries.
// The latch is PER MODEL, keyed by `"provider/model"`; the key `'*'` is
// the legacy global latch (a v1 entry written without a model) and
// applies to every free model. Both shapes are understood:
// - v1 `{ version: 1, at, until, kind, model, detail, updatedAt }`
//   -> one entry keyed by `model` (or `'*'` when the model is unknown),
// - v2 `{ version: 2, models: { "<key>": { at, until, kind, ... } } }`.
// Returns `[{ key, model, at, until, kind, detail, updatedAt }]`; an
// unusable payload reads as `[]`. Pure (browser-safe), never throws.
function latchEntries(raw) {
  if (!isObject(raw)) return [];
  const out = [];
  if (isObject(raw.models)) {
    const keys = Object.keys(raw.models);
    for (let i = 0; i < keys.length; i++) {
      const key = String(keys[i]).trim();
      const e = raw.models[keys[i]];
      if (!key || !isObject(e)) continue;
      out.push({
        key,
        model: key === '*' ? null : key,
        at: e.at,
        until: e.until,
        kind: e.kind,
        detail: e.detail,
        updatedAt: e.updatedAt,
      });
    }
    return out;
  }
  if (raw.at !== undefined || raw.until !== undefined) {
    const model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : '*';
    out.push({
      key: model,
      model: model === '*' ? null : model,
      at: raw.at,
      until: raw.until,
      kind: raw.kind,
      detail: raw.detail,
      updatedAt: raw.updatedAt,
    });
  }
  return out;
}

// Does the latch entry `key` apply to `model` ("provider/model", bare id
// tolerated)? `'*'` is the legacy global latch (applies to everything);
// otherwise exact match, with a lenient suffix match so a bare model id
// and its `"provider/id"` form hit the same entry.
function latchKeyApplies(key, model) {
  const k = String(key ?? '').trim();
  const s = String(model ?? '').trim();
  if (!k || !s) return false;
  if (k === '*') return true;
  return k === s || k.endsWith('/' + s) || s.endsWith('/' + k);
}

// Build a per-model latch predicate from a fresh-entry list (see
// `latchEntries` + `freeQuotaFresh`). Returns `(model) => bool`: true
// while that model (or the legacy global `'*'` entry) is latched.
function latchPredicate(freshEntries) {
  const list = Array.isArray(freshEntries) ? freshEntries : [];
  return (model) => {
    for (let i = 0; i < list.length; i++) {
      if (latchKeyApplies(list[i].key, model)) return true;
    }
    return false;
  };
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
  FREE_QUOTA_TTL_MS,
  FREE_RATE_LIMIT_TTL_MS,
  EXHAUST_BODY_RE,
  RATE_LIMIT_BODY_RE,
  RATE_LIMIT_MESSAGE_RE,
  classifyFreeExhaustion,
  classifyFreeFailure,
  isRateLimitSignal,
  isFreeModelRef,
  freeQuotaFresh,
  latchEntries,
  latchKeyApplies,
  latchPredicate,
};
