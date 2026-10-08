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
 * - `<cacheDir>/free-quota.json` = PER-MODEL latches:
 *   `{ version: 2, models: { "<provider/model>": { at, until, kind,
 *      detail, updatedAt } } }`. `at` is the FIRST detection for that
 *   model and `until = at + ttl`, where quota exhaustion uses
 *   FREE_QUOTA_TTL_MS (12h) and rate-limiting uses
 *   FREE_RATE_LIMIT_TTL_MS (1h). The window is never extended while
 *   fresh, so after `until` the latch clears and the next real failure
 *   may register again (the "new check"). A latch only affects ITS
 *   model: other free models keep routing free. The key `'*'` is the
 *   legacy global latch (a model-less v1 entry still read through
 *   `latchEntries` in shared/routing.js) and affects every free model.
 * - Consumers of a fresh entry for the model at hand:
 *     - `shared/routing.js` syncs that task's `routing.json` row to the
 *       `go` side (OpenChamber's Jev categories follow),
 *     - `shared/select.js` resolves the pick to `go` while fresh.
 *
 * Fingerprint mirrors the field-tested free-probe classification in
 * `core/probe.js` (`classifyFreeProbe`, fail-closed action variant):
 * 402/429 are the
 * quota-spent statuses. A bare 503/529 on a live conversation is usually
 * transient overload — and a 12h latch is expensive — so those and other
 * 4xx statuses only count with quota wording in the body. A rate-limit
 * signal, including "Rate limit exceeded. Please try again later.",
 * instead receives the shorter rate-limit window. 401 is auth,
 * never exhaustion.
 *
 * Node-only (fs). The pure side (`freeQuotaFresh`, the latch matchers and
 * the failure classifiers) lives in the shared core (`core/free-quota.js`,
 * vendored under `shared/core/` and re-exported by `shared/routing.js`).
 * Nothing here ever throws: a soft-error latch must never break a turn.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  FREE_QUOTA_FILE,
  FREE_QUOTA_TTL_MS,
  freeQuotaFresh,
  latchEntries,
  latchKeyApplies,
} = require('./routing');
const {
  FREE_RATE_LIMIT_TTL_MS,
  EXHAUST_BODY_RE,
  RATE_LIMIT_BODY_RE,
  RATE_LIMIT_MESSAGE_RE,
  UNAVAILABLE_MODEL_RE,
  DEPRECATED_MODEL_RE,
  PROTOCOL_MISMATCH_RE,
  mismatchHaystack,
  isProtocolMismatch,
  classifyFreeExhaustion,
  classifyFreeFailure,
  isFreeModelRef,
} = require('./core/free-quota');

const FREE_QUOTA_BASENAME = path.basename(FREE_QUOTA_FILE);

function freeQuotaFile(cacheDir) {
  return path.join(String(cacheDir), FREE_QUOTA_BASENAME);
}

/** Read the raw latch file; missing/unusable files read as null. Never throws. */
function readFreeQuota(cacheDir) {
  if (!cacheDir) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(freeQuotaFile(cacheDir), 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * True while a latch is fresh for `model` ("provider/model"; bare ids
 * tolerated). With no `model` argument any fresh latch counts (legacy
 * callers / "is something latched?" probes). Keyed per model: an
 * exhausted model never suspends its siblings; the legacy global `'*'`
 * entry applies to every free model. Missing/unusable files read as
 * false. `now` is injectable for tests (defaults to Date.now()).
 */
function isFreeQuotaFresh(cacheDir, now, model) {
  if (!cacheDir) return false;
  const t = now === undefined ? Date.now() : now;
  const fresh = latchEntries(readFreeQuota(cacheDir)).filter((e) => freeQuotaFresh(e, t));
  if (!fresh.length) return false;
  const s = String(model ?? '').trim();
  if (!s) return true;
  for (let i = 0; i < fresh.length; i++) {
    if (latchKeyApplies(fresh[i].key, s)) return true;
  }
  return false;
}

/**
 * Register a soft error for ONE model. `kind` is `'exhaustion'` for
 * spent quota or `'rate-limit'` for transient rate limiting; `model` is
 * the `"provider/model"` key (a missing model latches the legacy global
 * `'*'` entry). While that key's entry is fresh the original `at`,
 * `until`, and `kind` are kept (the window runs from the first
 * detection; later failures never extend or shorten it); only an
 * expired latch starts a new window. Other models' entries are preserved
 * (expired ones are pruned). Returns the stored entry (with `key` +
 * `model`), or null when it could not be written. Never throws.
 */
function markFreeQuota(cacheDir, fields = {}, now = Date.now()) {
  if (!cacheDir) return null;
  try {
    const prevEntries = latchEntries(readFreeQuota(cacheDir));
    const modelRaw = fields.model == null ? '' : String(fields.model).trim();
    const key = modelRaw || '*';
    const prev = prevEntries.find((e) => e.key === key) || null;
    const fresh = prev ? freeQuotaFresh(prev, now) : false;
    const kind = fields.kind === 'rate-limit' ? 'rate-limit' : 'exhaustion';
    const windowKind =
      fresh && (prev.kind === 'rate-limit' || prev.kind === 'exhaustion') ? prev.kind : kind;
    const ttl = windowKind === 'rate-limit' ? FREE_RATE_LIMIT_TTL_MS : FREE_QUOTA_TTL_MS;
    const at = fresh ? Number(prev.at) : now;
    const until = fresh ? Number(prev.until) : now + ttl;
    const entry = {
      at,
      until,
      kind: windowKind,
      detail: String(fields.detail ?? '').slice(0, 200),
      updatedAt: now,
    };
    // Preserve every other model's still-fresh entry; expired ones die here.
    const models = {};
    for (let i = 0; i < prevEntries.length; i++) {
      const e = prevEntries[i];
      if (e.key === key || !freeQuotaFresh(e, now)) continue;
      models[e.key] = { at: e.at, until: e.until, kind: e.kind, detail: e.detail, updatedAt: e.updatedAt };
    }
    models[key] = entry;
    fs.mkdirSync(String(cacheDir), { recursive: true });
    fs.writeFileSync(freeQuotaFile(cacheDir), JSON.stringify({ version: 2, models }), 'utf8');
    return { version: 2, key, model: key === '*' ? null : key, ...entry };
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

module.exports = {
  FREE_QUOTA_BASENAME,
  FREE_RATE_LIMIT_TTL_MS,
  EXHAUST_BODY_RE,
  RATE_LIMIT_BODY_RE,
  RATE_LIMIT_MESSAGE_RE,
  UNAVAILABLE_MODEL_RE,
  DEPRECATED_MODEL_RE,
  PROTOCOL_MISMATCH_RE,
  mismatchHaystack,
  isProtocolMismatch,
  classifyFreeExhaustion,
  classifyFreeFailure,
  isFreeModelRef,
  isFreeQuotaFresh,
  markFreeQuota,
  readFreeQuota,
  readModelTable,
};
