/* openchamber-modelselect — models-chain adapter (ESM, bundled with the
 * panel).
 *
 * Pure preview of the plugin's per-task resolution: which models form the
 * chain for a task-type, in the order the plugin would use them, and why
 * each row is usable or excluded. Mirrors
 * `plugin/src/shared/select.js` resolveModel minus the live network probe
 * (Go quota check) — the panel has no token (write-only) and makes no
 * network calls, so `auto` follows the configured preference with the
 * latch failover applied. Labelled as a preview in the UI.
 *
 * Inputs:
 * - catalogConfig: the parsed `model-config-cache.json` `config` object
 *   (`config['task-types'][task] = { go, free, go_ranked[], free_ranked[] }`,
 *   rows `{ model, score, input_cost, output_cost, blended_cost }`).
 * - options: the saved modelselect plugin options (camelCase/kebab-case
 *   aliases tolerated, like the plugin).
 * - latchData: the parsed `free-quota.json` (or null when unreadable).
 */

import lookupShared from '../../../core/lookup.js';
import modelRefShared from '../../../core/model-ref.js';
import budgetShared from '../../../core/budget.js';
import freeQuotaShared from '../../../core/free-quota.js';

const { entryFor } = lookupShared;
const { firstPaidModel } = modelRefShared;
const { selectWithinBudget } = budgetShared;
const { latchEntries, freeQuotaFresh, latchKeyApplies } = freeQuotaShared;

function str(v) { return v == null ? '' : String(v); }

function optOf(raw, camel, kebab, dflt) {
  if (!raw || typeof raw !== 'object') return dflt;
  if (raw[camel] !== undefined && raw[camel] !== null) return raw[camel];
  if (kebab && raw[kebab] !== undefined && raw[kebab] !== null) return raw[kebab];
  return dflt;
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function rowCost(row) {
  if (!row || typeof row !== 'object') return null;
  const c = row.blended_cost;
  return typeof c === 'number' && Number.isFinite(c) && c >= 0 ? c : null;
}

// Same ordering the budget step uses: score best-first, cheaper first,
// cost-unknown last. (Mirrors core/budget.js; kept in sync by eye.)
function sortRanked(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r.model === 'string' && r.model)
    .slice()
    .sort((a, b) => {
      const sa = typeof a.score === 'number' ? a.score : -Infinity;
      const sb = typeof b.score === 'number' ? b.score : -Infinity;
      if (sb !== sa) return sb - sa;
      const ca = rowCost(a);
      const cb = rowCost(b);
      if (ca === null && cb === null) return 0;
      if (ca === null) return 1;
      if (cb === null) return -1;
      return ca - cb;
    });
}

function splitName(model) {
  const s = str(model);
  const i = s.indexOf('/');
  if (i < 0) return { provider: '—', id: s };
  return { provider: s.slice(0, i) || '—', id: s.slice(i + 1) };
}

function formatCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + (s % 60) + 's';
  return s + 's';
}

// Preview the chain for one task-type. Never throws: bad shapes yield
// `{ found: false }` and the UI shows the fallback line.
function computeModelsView({ taskType, catalogConfig, options, latchData, now }) {
  const at = typeof now === 'number' ? now : Date.now();
  const table = (catalogConfig && (catalogConfig['task-types'] || catalogConfig.task_types)) || {};
  let key = null;
  let entry = null;
  try {
    const found = entryFor({ 'task-types': table }, taskType);
    key = found.key;
    entry = found.entry;
  } catch (e) {
    return { found: false, taskType: str(taskType) };
  }
  if (!key || !entry) return { found: false, taskType: str(taskType) };

  const tier = str(optOf(options, 'tier', null, 'auto')).toLowerCase();
  const preference = str(optOf(options, 'autoPreference', 'auto-preference', 'free-first')).toLowerCase();
  const order = preference === 'go-first' ? ['go', 'free'] : ['free', 'go'];
  const maxCost = numOrNull(optOf(options, 'maxCost', null, null));
  const fallback = str(optOf(options, 'fallbackModel', 'fallback-model', '')).trim();
  const refOf = (side) => str(side === 'go' ? entry.go : entry.free).trim();

  let fresh = [];
  try {
    fresh = latchEntries(latchData || {}).filter((e) => freeQuotaFresh(e, at));
  } catch (e) { fresh = []; }
  const latchHitFor = (model) => {
    for (let i = 0; i < fresh.length; i += 1) {
      const e = fresh[i];
      if (!e.model || latchKeyApplies(e.key, model)) return e;
    }
    return null;
  };
  const latched = (model) => Boolean(model && latchHitFor(model));

  // Side selection mirrors resolveModel without the live Go probe.
  let side;
  let sideNote;
  const pinned = tier === 'go' || tier === 'free';
  if (pinned) {
    side = tier;
    sideNote = 'tier=' + tier;
    if (!refOf(side) && refOf(side === 'go' ? 'free' : 'go')) {
      side = side === 'go' ? 'free' : 'go';
      sideNote += ' empty → ' + side;
    }
  } else {
    side = refOf(order[0]) ? order[0] : order[1];
    sideNote = 'auto → ' + preference;
    const other = side === 'go' ? 'free' : 'go';
    if (refOf(side) && latched(refOf(side)) && refOf(other)) {
      side = other;
      sideNote += ' · latched → failover';
    }
  }
  const otherSide = side === 'go' ? 'free' : 'go';

  let model = refOf(side);
  let pickNote = '';
  if (model && latched(model)) {
    const paid = firstPaidModel(entry);
    if (paid) {
      model = paid;
      side = 'go';
      pickNote = 'latched → paid failover';
    }
  }
  // pickName marks the chain row the plugin would use. Empty while a
  // fallback (or nothing) answers instead.
  let pickName = model;
  let pickSource = model ? 'chain' : null;
  if (!model && fallback) {
    return {
      found: true, key, side, sideNote, maxCost, fallback,
      pick: fallback, pickSource: 'fallback',
      pickNote: 'No chain model configured — fallback',
      chain: [],
    };
  }
  if (maxCost !== null && model) {
    let budgeted = null;
    try {
      budgeted = selectWithinBudget(entry, key, side, model, maxCost);
    } catch (e) { budgeted = null; }
    if (budgeted && budgeted.model) {
      if (budgeted.model !== model) pickNote = 'over budget → $' + budgeted.cost + '/1M pick';
      model = budgeted.model;
      pickName = model;
    } else {
      pickName = '';
      pickSource = fallback ? 'fallback' : null;
      return {
        found: true, key, side, sideNote, maxCost, fallback,
        pick: fallback || null, pickSource,
        pickNote: fallback ? 'Nothing fits maxCost — fallback' : 'Nothing fits maxCost',
        chain: buildChain(),
      };
    }
  }

  function buildChain() {
    const rows = [];
    [side, otherSide].forEach((s) => {
      sortRanked(entry[s + '_ranked']).forEach((row) => {
        rows.push(describeRow(row, s));
      });
    });
    return rows;
  }

  function describeRow(row, s) {
    const name = str(row.model);
    const parts = splitName(name);
    const cost = rowCost(row);
    const score = typeof row.score === 'number' ? row.score : null;
    const view = { model: name, provider: parts.provider, id: parts.id, score, cost,
      context: typeof row.context === 'number' && row.context > 0 ? row.context : null,
      modalities: Array.isArray(row.modalities)
        ? row.modalities.filter(function (m) { return typeof m === 'string' && m; })
        : null,
      inputCost: typeof row.input_cost === 'number' ? row.input_cost : null,
      outputCost: typeof row.output_cost === 'number' ? row.output_cost : null,
      side: s, status: 'ok', reason: '', latchText: '' };
    if (name === pickName && pickSource === 'chain') {
      const hit = latchHitFor(name);
      if (hit) {
        view.status = 'excluded';
        view.reason = 'quota latched · retry in ' + formatCountdown(hit.until - at);
        view.latchText = view.reason;
        return view;
      }
      view.status = 'pick';
      return view;
    }
    const hit = latchHitFor(name);
    if (hit) {
      view.status = 'excluded';
      view.reason = (hit.kind === 'rate-limit' ? 'rate-limited' : 'quota latched') +
        ' · retry in ' + formatCountdown(hit.until - at);
      view.latchText = view.reason;
      return view;
    }
    if (maxCost !== null && (cost === null || cost > maxCost)) {
      view.status = 'excluded';
      view.reason = cost === null ? 'no cost data (cap set)' : 'over maxCost $' + maxCost;
      return view;
    }
    if (s !== side) {
      view.status = 'excluded';
      view.reason = 'off-side · ' + sideNote;
      return view;
    }
    return view;
  }

  return {
    found: true, key, side, sideNote, maxCost, fallback,
    pick: pickName || fallback || null,
    pickSource,
    pickNote: pickNote || (pickName ? '' : 'No model configured'),
    chain: buildChain(),
  };
}

export { computeModelsView };
