'use strict';

/**
 * Selection chain — shared pure decision core (no dependencies).
 *
 * Vendored into `github-action/src/shared/core/` and
 * `plugin/src/shared/core/` by `scripts/build-core.js`; edit `core/`,
 * never the vendored copies.
 *
 * One algorithm for both consumers (the GitHub Action preselects, the
 * plugin re-picks every turn). The inputs differ only in how availability
 * is known:
 *   - action: static availability (declared providers, Go plan, budgets
 *     when the console answers)
 *   - plugin: live availability (enabled models, quota meters, budgets,
 *     per-model failure latches)
 *
 * A chain is an ordered list of `{ provider, model, ref, canonical, class,
 * cost, score }` candidates for ONE task type, best first. The first entry
 * is the pick; every later entry is the failover.
 *
 * Rules (identical in both consumers):
 *   - candidates are the catalog rows of each ranked model, in rank order;
 *     within one model the cheapest provider variant comes first;
 *   - a row must pass the availability filters: provider allowed and
 *     reachable, model present in the live inventory (when known),
 *     model not latched, budget remaining, context window large
 *     enough, requested input media supported (unknown = fail-open), cost
 *     within `maxCost` when known;
 *   - tier (`free` / `go`) is a partition of the chain, never a separate
 *     ranking: `free-first` walks free then paid, `go-first` the reverse,
 *     `abs` walks by score across both.
 */

const { indexCatalog, rowsForModel, rowKey, classOf } = require('./catalog');

const TIER_CLASSES = {
  free: ['free'],
  paid: ['go-plan', 'zen-paid', 'external'],
};

function isAllowedProvider(row, providers) {
  if (!Array.isArray(providers) || providers.length === 0) return true;
  const slug = String(row.provider).toLowerCase();
  return providers.some((p) => {
    const wanted = String(p == null ? '' : p).trim().toLowerCase();
    return wanted && (wanted === slug || wanted === String(row.providerID ?? '').toLowerCase());
  });
}

function providerState(availability, row) {
  const providers = availability && availability.providers;
  if (!providers) return {};
  const key = String(row.provider).toLowerCase();
  const state = Object.prototype.hasOwnProperty.call(providers, key)
    ? providers[key]
    : Object.prototype.hasOwnProperty.call(providers, row.providerID)
      ? providers[row.providerID]
      : undefined;
  if (state === undefined || state === true) return {};
  if (state === false) return { unavailable: true };
  if (state && typeof state === 'object') return state;
  return {};
}

function latched(availability, row) {
  const list = availability && availability.latched;
  if (!list) return false;
  const key = rowKey(row);
  if (!key) return false;
  if (typeof list.has === 'function') return list.has(key);
  return Array.isArray(list) && list.includes(key);
}

/**
 * Per-model runtime inventory gate. `availability.models` holds the enabled
 * `provider/model` keys from the live `/api/model` inventory (a Set or an
 * array). Unlike `providerState` — which only asks whether a provider has
 * ANY enabled model — this rejects a row that the runtime cannot dispatch,
 * e.g. `opencode/qwen3.8-flash` when only `opencode-go/qwen3.8-flash` is
 * served. Absent inventory (CI/action path, offline plugin) fails open.
 */
function modelPresent(availability, row) {
  const list = availability && availability.models;
  if (!list) return true;
  const key = rowKey(row);
  if (!key) return true;
  if (typeof list.has === 'function') return list.has(key);
  if (Array.isArray(list)) return list.includes(key);
  return true;
}

function supportsMedia(row, media) {
  if (!Array.isArray(media) || media.length === 0) return true;
  if (!Array.isArray(row.media_in) || row.media_in.length === 0) return true;
  const have = new Set(row.media_in.map((m) => String(m).toLowerCase()));
  return media.every((m) => have.has(String(m).toLowerCase()));
}

function withinContext(row, contextNeed) {
  if (!(contextNeed > 0)) return true;
  const context = Number(row.context);
  if (!Number.isFinite(context) || context <= 0) return true; // unknown = fail-open
  return context >= contextNeed;
}

function withinBudget(row, maxCost) {
  if (maxCost === null || maxCost === undefined) return true;
  const cost = row.blended_cost;
  if (cost === null || cost === undefined) return true; // unknown = fail-open
  return Number(cost) <= Number(maxCost);
}

function withinSpend(row, state) {
  if (!state || state.budget_remaining === undefined || state.budget_remaining === null) return true;
  const remaining = Number(state.budget_remaining);
  if (!Number.isFinite(remaining)) return true;
  return remaining > 0;
}

/** Ranked models of a task entry, as `{ model, score }` in rank order. */
function rankedModels(entry, tier) {
  if (!entry || typeof entry !== 'object') return [];
  const out = [];
  const seen = new Set();
  const push = (model, score) => {
    const value = String(model == null ? '' : model).trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ model: value, score: typeof score === 'number' ? score : null });
  };
  const ranked = Array.isArray(entry.ranked) ? entry.ranked : [];
  for (const row of ranked) {
    if (tier && tier !== 'abs' && row && !rowMatchesTier(row, tier)) continue;
    push(row && row.model, row && row.score);
  }
  if (out.length > 0) return out;
  // Legacy shape: go_ranked / free_ranked rows (strings `provider/id`).
  const lists = tier === 'free'
    ? ['free_ranked']
    : tier === 'go'
      ? ['go_ranked']
      : ['go_ranked', 'free_ranked'];
  for (const field of lists) {
    const list = Array.isArray(entry[field]) ? entry[field] : [];
    for (const row of list) push(row && row.model, row && row.score);
  }
  if (out.length === 0) {
    push(entry.go, null);
    push(entry.free, null);
  }
  return out;
}

function rowMatchesTier(row, tier) {
  if (!row || typeof row !== 'object') return false;
  if (row.free === undefined && row.class === undefined) return true;
  const isFree = row.free === true || String(row.class).toLowerCase() === 'free';
  return tier === 'free' ? isFree : !isFree;
}

function sortRows(rows) {
  return rows.slice().sort((a, b) => {
    const ca = a.blended_cost;
    const cb = b.blended_cost;
    if (ca === null && cb === null) return 0;
    if (ca === null) return 1;
    if (cb === null) return -1;
    if (ca !== cb) return ca - cb;
    return String(a.provider).localeCompare(String(b.provider));
  });
}

/**
 * Build the ordered chain for a task entry.
 *
 * @param {object} input
 * @param {object} input.entry        task entry from the model config
 * @param {object|Array} input.catalog provider catalog (`data/provider-catalog.json`)
 * @param {object} [input.availability] `{ providers: {slug: bool|{budget_remaining}}, latched: string[]|Set }`
 * @param {'free'|'go'|'auto'|'abs'} [input.mode]
 * @param {'free-first'|'go-first'} [input.preference]
 * @param {string[]} [input.media]    required input modalities
 * @param {number} [input.contextNeed] tokens the turn needs
 * @param {number|null} [input.maxCost] blended $/1M cap
 * @param {string[]|null} [input.providers] provider slugs the caller can reach
 * @returns {Array<object>} chain, best first
 */
function buildChain({
  entry,
  catalog,
  availability,
  mode = 'auto',
  preference = 'free-first',
  media,
  contextNeed = 0,
  maxCost = null,
  providers = null,
} = {}) {
  const index = indexCatalog(catalog);
  const tier = mode === 'free' ? 'free' : mode === 'go' ? 'go' : 'abs';
  const seen = new Set();
  const candidates = [];
  for (const ranked of rankedModels(entry, tier)) {
    const rows = sortRows(rowsForModel(index, ranked.model));
    for (const row of rows) {
      if (!row.key || seen.has(row.key)) continue;
      seen.add(row.key);
      if (!isAllowedProvider(row, providers)) continue;
      const state = providerState(availability, row);
      if (state.unavailable === true || state.available === false) continue;
      if (!withinSpend(row, state)) continue;
      if (!modelPresent(availability, row)) continue;
      if (latched(availability, row)) continue;
      if (!supportsMedia(row, media)) continue;
      if (!withinContext(row, contextNeed)) continue;
      if (!withinBudget(row, maxCost)) continue;
      candidates.push({
        provider: row.provider,
        model: row.id,
        ref: row.key,
        canonical: row.canonical,
        class: classOf(row),
        cost: row.blended_cost,
        context: row.context,
        media_in: row.media_in,
        score: ranked.score,
      });
    }
  }

  if (mode === 'abs') {
    return candidates
      .slice()
      .sort((a, b) => {
        const sa = a.score === null ? -Infinity : a.score;
        const sb = b.score === null ? -Infinity : b.score;
        if (sb !== sa) return sb - sa;
        return (a.cost === null ? Infinity : a.cost) - (b.cost === null ? Infinity : b.cost);
      });
  }

  const free = candidates.filter((c) => c.class === 'free');
  const paid = candidates.filter((c) => c.class !== 'free');
  const freeFirst = mode === 'free' ? true : mode === 'go' ? false : preference !== 'go-first';
  return freeFirst ? free.concat(paid) : paid.concat(free);
}

/**
 * Failover step: first chain entry not in `tried` (array of refs or
 * `provider/model` strings). Null when the chain is exhausted.
 */
function nextCandidate(chain, tried) {
  if (!Array.isArray(chain)) return null;
  const done = new Set(
    (Array.isArray(tried) ? tried : [])
      .map((t) => String(t == null ? '' : t).trim())
      .filter(Boolean),
  );
  for (const row of chain) {
    if (!row) continue;
    const ref = String(row.ref ?? `${row.provider}/${row.model}`);
    if (!done.has(ref)) return row;
  }
  return null;
}

/** Tier partition of a chain, for callers that need both sides. */
function partitionTiers(chain) {
  const free = [];
  const paid = [];
  for (const row of Array.isArray(chain) ? chain : []) {
    if (!row) continue;
    (row.class === 'free' ? free : paid).push(row);
  }
  return { free, paid };
}

module.exports = {
  TIER_CLASSES,
  buildChain,
  nextCandidate,
  partitionTiers,
  rankedModels,
  // Shared availability filters, reused by the v2 registry path so both
  // layers reject a candidate for exactly the same reasons.
  isAllowedProvider,
  providerState,
  latched,
  modelPresent,
  supportsMedia,
  withinContext,
  withinBudget,
  withinSpend,
  sortRows,
};
