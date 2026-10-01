'use strict';

/**
 * max-cost budget selection — shared pure decision core.
 *
 * Vendored into `github-action/src/shared/core/` and
 * `plugin/src/shared/core/` by `scripts/build-core.js`; edit `core/`,
 * never the vendored copies.
 *
 * Extracted verbatim from the fail-closed GitHub Action, with one
 * policy-preserving change: the missing-ranking branch THROWS (the
 * action catches and fails with the identical message) instead of
 * calling the action's `fail()` helper — core stays side-effect free.
 */

const { normModelName } = require('./model-ref');

function rankedCost(row) {
  if (!row || typeof row !== 'object') return null;
  const c = row.blended_cost;
  return typeof c === 'number' && Number.isFinite(c) && c >= 0 ? c : null;
}

function selectWithinBudget(entry, taskKey, tier, recommended, maxCost) {
  const ranked = entry ? entry[`${tier}_ranked`] : null;
  if (!Array.isArray(ranked)) {
    throw new Error(
      `Input 'max-cost' needs a '${tier}_ranked' best-to-worst ranking for ` +
        `task-type='${taskKey}' in the model config; regenerate ` +
        'data/model-config.json via maintenance.',
    );
  }
  const ordered = ranked
    .filter((r) => r && typeof r.model === 'string' && r.model)
    .slice()
    .sort((a, b) => {
      const sa = typeof a.score === 'number' ? a.score : -Infinity;
      const sb = typeof b.score === 'number' ? b.score : -Infinity;
      if (sb !== sa) return sb - sa;
      const ca = rankedCost(a);
      const cb = rankedCost(b);
      if (ca === null && cb === null) return 0;
      if (ca === null) return 1;
      if (cb === null) return -1;
      return ca - cb;
    });
  const wanted = normModelName(recommended);
  const rec = ordered.find((r) => normModelName(r.model) === wanted);
  const recCost = rec ? rankedCost(rec) : null;
  if (recCost !== null && recCost <= maxCost) {
    return { model: recommended, cost: String(recCost) };
  }
  for (const row of ordered) {
    const c = rankedCost(row);
    if (c !== null && c <= maxCost) return { model: row.model, cost: String(c) };
  }
  const known = ordered.map(rankedCost).filter((c) => c !== null);
  const cheapest = known.length ? Math.min(...known) : null;
  return {
    model: null,
    hint:
      cheapest === null
        ? 'no ranked model has a known cost'
        : `cheapest ranked model costs $${cheapest}/1M`,
  };
}

module.exports = {
  rankedCost,
  selectWithinBudget,
};
