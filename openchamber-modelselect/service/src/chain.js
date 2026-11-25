/* openchamber-modelselect — models-chain adapter (ESM, runs in the service).
 *
 * Pure preview of the plugin's per-task resolution: which models form the
 * chain for a task-type, in the order the plugin would use them, and why
 * each row is usable or excluded. Mirrors
 * `plugin/src/shared/select.js` resolveModel minus the live network probe
 * (Go quota check) — the service holds no token and makes no network calls,
 * so `auto` follows the configured preference with the latch failover
 * applied. Served to the panel as `GET /chain` and labelled as a preview.
 *
 * Inputs:
 * - catalogConfig: the parsed `model-config-cache.json` `config` object
 *   (`config['task-types'][task] = { go, free, go_ranked[], free_ranked[] }`,
 *   rows `{ model, score, input_cost, output_cost, blended_cost }`).
 * - configV2: the parsed `model-config-v2-cache.json` `config` object
 *   (`config['task-types-v2'][task] = { model }`), null when the plugin has
 *   not cached the v2 task table.
 * - options: the saved modelselect plugin options (camelCase/kebab-case
 *   aliases tolerated, like the plugin).
 * - latchData: the parsed `free-quota.json` (or null when unreadable).
 */

import lookupShared from '../../../core/lookup.js';
import modelRefShared from '../../../core/model-ref.js';
import budgetShared from '../../../core/budget.js';
import freeQuotaShared from '../../../core/free-quota.js';
import registryShared from '../../../core/registry.js';
import { usageMonthly } from './view.js';

const { entryFor } = lookupShared;
const { firstPaidModel } = modelRefShared;
const { selectWithinBudget } = budgetShared;
const { latchEntries, freeQuotaFresh, latchKeyApplies } = freeQuotaShared;
const { taskEntryV2, modelEntry, variantRows, buildV2Chain } = registryShared;

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

/**
 * Go-spend verdict from the plugin's `usage-limits.json`, mirroring the hard
 * signals of `plugin/src/shared/usage.js` `goVetoFromSnapshot`: any Go window
 * limited or at/over 100%, or any budget limited/at 100%. The plugin's soft
 * hysteresis veto is process state keyed by the token; the service has no
 * such state, so it reports only what the snapshot proves. Fail-open.
 */
function previewGoVeto(usage, token) {
  try {
    const go = usage && usage.go && typeof usage.go === 'object' ? usage.go : null;
    let hard = false;
    let percent = null;
    let resetsAt = null;
    if (go) {
      ['rolling', 'weekly', 'monthly'].forEach((k) => {
        const w = go[k];
        if (!w || typeof w !== 'object') return;
        const p = Number(w.percent);
        if (Number.isFinite(p) && (percent === null || p > percent)) percent = p;
        if (w.limited === true || (Number.isFinite(p) && p >= 100)) hard = true;
        if (w.limited === true && typeof w.resetsAt === 'number' && w.resetsAt > 0) resetsAt = w.resetsAt;
      });
    }
    let budget = false;
    const budgets = usage && Array.isArray(usage.budgets) ? usage.budgets : [];
    for (const b of budgets) {
      if (!b || typeof b !== 'object') continue;
      const p = Number(b.percent);
      if (b.limited === true || (Number.isFinite(p) && p >= 100)) budget = true;
    }
    return { veto: hard || budget, hard, budget, percent, resetsAt, token: Boolean(token) };
  } catch (e) {
    return { veto: false, hard: false, budget: false, percent: null, resetsAt: null, token: Boolean(token) };
  }
}

/** Enabled `provider/model` keys from the plugin's runtime snapshot, or null (fail open). */
function inventoryKeys(snapshot, now) {
  try {
    if (!snapshot || typeof snapshot.fetchedAt !== 'number' ||
        (Number(now) - snapshot.fetchedAt) > 60 * 1000 || !Array.isArray(snapshot.models)) return null;
    const keys = new Set();
    for (const m of snapshot.models) {
      if (!m || m.enabled === false) continue;
      const provider = str(m.providerID).trim().toLowerCase();
      const id = str(m.id).trim();
      if (provider && id) keys.add(provider + '/' + id);
    }
    return keys.size ? keys : null;
  } catch (e) {
    return null;
  }
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

// Usage-status bar for one chain row: Go rows show the consumed quota
// window (width = percent, tone by limited/thresholds); free rows have no
// quota endpoint, so the bar shows their availability instead (fully
// available unless latched). Cost stays as text in the meta line — the
// bar is about current usage status, not cost. Returns
// `{ pct, tone, label }` where tone is ok|warn|err|muted.
function usageBar(row, usage, at) {
  if (row.status === 'excluded') {
    const reason = row.reason || 'excluded';
    let tone = 'muted';
    if (/quota latched|rate-limited|over maxCost|no cost data|quota spent|not in runtime inventory/.test(reason)) tone = 'err';
    return { pct: 100, tone: tone, label: reason };
  }
  const u = usageMonthly(usage);
  if (row.side === 'go' && u && u.percent !== null) {
    const pct = Math.max(3, Math.min(100, Math.round(u.percent)));
    const tone = (u.limited || u.percent >= 100) ? 'err' : (u.percent >= 70 ? 'warn' : 'ok');
    let label = 'Go monthly ' + Math.round(u.percent) + '%';
    if (u.limited) {
      label += ' · limited';
      const left = typeof u.resetsAt === 'number' && u.resetsAt > 0
        ? formatCountdown(u.resetsAt - (typeof at === 'number' ? at : Date.now())) : '';
      if (left) label += ' · resets ' + left;
    } else if (row.status === 'pick') {
      label = 'PICK · ' + label;
    }
    return { pct: pct, tone: tone, label: label };
  }
  if (row.status === 'pick') {
    return { pct: 100, tone: 'ok', label: row.side === 'free' ? 'PICK · free' : 'PICK' };
  }
  return { pct: 45, tone: 'muted', label: row.side === 'free' ? 'free · no quota cap' : 'standby' };
}

// Preview the chain for one task-type. Never throws: bad shapes yield
// `{ found: false }` and the UI shows the fallback line.
function computeModelsView({ taskType, catalogConfig, configV2, options, latchData, usage, registry, runtimeInventory, now }) {
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
  // Same default as the plugin's normalizeOptions: empty = allow any.
  const providersRaw = optOf(options, 'availableProviders', 'available-providers', '');
  const allowedProviders = (Array.isArray(providersRaw) ? providersRaw : str(providersRaw).split(','))
    .map((p) => str(p).trim().toLowerCase()).filter(Boolean);
  const providerAllowed = (provider) => allowedProviders.length === 0 ||
    allowedProviders.indexOf(str(provider).toLowerCase()) !== -1;
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

  // The same availability gates the plugin applies when it builds its chain:
  // a vetoed Go plan has no spend left, and a fresh runtime inventory rejects
  // variants the local OpenCode server does not actually serve. The preview
  // used to ignore both, which made a chain that had already fallen back look
  // perfectly usable. Latch filtering stays local (see `latchHitFor`) so the
  // legacy global `*` entry and the countdown reason behave exactly as before.
  const goVeto = previewGoVeto(usage, options && options.token);
  const availability = {
    providers: goVeto.veto ? { 'opencode-go': { budget_remaining: 0 } } : {},
    models: inventoryKeys(runtimeInventory, at),
  };
  const chainProviders = allowedProviders.length ? allowedProviders : null;
  const goBlocked = (provider) => goVeto.veto &&
    str(provider).toLowerCase() === 'opencode-go';
  const goReason = 'go quota spent' + (goVeto.resetsAt
    ? ' · resets ' + formatCountdown(goVeto.resetsAt - at)
    : '');

  // Provider-model v2: the task names ONE model id and the registry lists its
  // free/paid provider variants. Preview that chain when the registry is
  // available; an empty result keeps the v1 preview below.
  const v2Task = registry ? taskEntryV2(configV2 || {}, taskType) : null;
  if (v2Task) {
    const v2 = previewV2(v2Task);
    if (v2) return v2;
  }

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

  function previewV2(v2TaskEntry) {
    let ordered = [];
    try {
      ordered = buildV2Chain({
        taskEntry: v2TaskEntry.entry,
        registry,
        availability,
        preference,
        tier: tier === 'go' || tier === 'free' ? tier : null,
        maxCost,
        providers: chainProviders,
      });
    } catch (e) {
      return null;
    }
    let all = [];
    try {
      const modelIds = Array.isArray(v2TaskEntry.entry && v2TaskEntry.entry.models) && (v2TaskEntry.entry.models).length
        ? v2TaskEntry.entry.models
        : [v2TaskEntry.model];
      const seen = new Set();
      for (const mid of modelIds) {
        const e = modelEntry(registry, (typeof mid === 'string' ? mid : (mid && mid.model)));
        if (!e) continue;
        for (const row of variantRows(e)) {
          if (seen.has(row.key)) continue;
          seen.add(row.key);
          all.push(row);
        }
      }
    } catch (e) {
      all = [];
    }
    if (!all.length) return null;
    const hitFor = (variant) => latchHitFor(variant.ref) || latchHitFor(variant.model);
    const usable = ordered.filter((c) => !hitFor(c));
    const pickRow = usable[0] || null;
    const pickName = pickRow ? pickRow.ref : '';
    const side = pickRow
      ? (pickRow.class === 'free' ? 'free' : 'go')
      : (preference === 'go-first' ? 'go' : 'free');
    const rank = new Map();
    ordered.forEach((c, i) => rank.set(c.ref, i));
    const rows = all.slice()
      .sort((a, b) => (rank.has(a.ref) ? rank.get(a.ref) : 1000) - (rank.has(b.ref) ? rank.get(b.ref) : 1000))
      .map((variant) => {
        const rowSide = variant.class === 'free' ? 'free' : 'go';
        const view = {
          model: variant.ref,
          provider: variant.provider,
          id: variant.model,
          score: typeof variant.score === 'number' ? variant.score : null,
          cost: typeof variant.cost === 'number' ? variant.cost : null,
          context: typeof variant.context === 'number' && variant.context > 0 ? variant.context : null,
          output: typeof variant.output === 'number' && variant.output > 0 ? variant.output : null,
          monthlyUsage: variant.monthly_usage && typeof variant.monthly_usage === 'object'
            ? variant.monthly_usage : null,
          modalities: Array.isArray(variant.media_in)
            ? variant.media_in.filter(function (m) { return typeof m === 'string' && m; })
            : null,
          inputCost: typeof variant.input_cost === 'number' ? variant.input_cost : null,
          outputCost: typeof variant.output_cost === 'number' ? variant.output_cost : null,
          side: rowSide, status: 'ok', reason: '', latchText: '',
        };
        if (variant.ref === pickName) {
          view.status = 'pick';
          return view;
        }
        const hit = hitFor(variant);
        if (hit) {
          view.status = 'excluded';
          view.reason = (hit.kind === 'rate-limit' ? 'rate-limited' : 'quota latched') +
            ' · retry in ' + formatCountdown(hit.until - at);
          view.latchText = view.reason;
          return view;
        }
        if (!providerAllowed(variant.provider)) {
          view.status = 'excluded';
          view.reason = 'provider not allowed';
          return view;
        }
        if (goBlocked(variant.provider)) {
          view.status = 'excluded';
          view.reason = goReason;
          return view;
        }
        if (maxCost !== null && (view.cost === null || view.cost > maxCost)) {
          view.status = 'excluded';
          view.reason = view.cost === null ? 'no cost data (cap set)' : 'over maxCost $' + maxCost;
          return view;
        }
        if (availability.models && !availability.models.has(variant.ref)) {
          view.status = 'excluded';
          view.reason = 'not in runtime inventory';
          return view;
        }
        if (rank.has(variant.ref)) {
          view.status = 'standby';
          view.reason = 'failover #' + (rank.get(variant.ref) + 1);
          return view;
        }
        view.status = 'excluded';
        view.reason = 'unavailable in this runtime';
        return view;
      });
    rows.forEach((r) => { r.bar = usageBar(r, usage, at); });
    const fallbackPick = !pickName && fallback ? fallback : null;
    let blocked = '';
    if (!pickName) {
      const why = [];
      if (goVeto.veto) why.push('Go quota spent');
      if (fresh.length) why.push('free tier latched');
      if (maxCost !== null) why.push('maxCost $' + maxCost);
      if (availability.models) why.push('runtime inventory');
      blocked = why.length ? why.join(' + ') : 'no usable variant';
    }
    return {
      found: true, key, side,
      sideNote: 'v2 · model=' + str(v2TaskEntry.model) + ' · ' + preference,
      maxCost, fallback,
      pick: pickName || fallbackPick,
      pickSource: pickName ? 'chain' : (fallbackPick ? 'fallback' : null),
      pickNote: pickName
        ? ''
        : (fallbackPick ? 'All variants blocked (' + blocked + ') — fallback' : 'All variants blocked (' + blocked + ')'),
      chain: rows,
      registry: true,
    };
  }

  // Rows the plugin could actually dispatch: same gates as the shared chain
  // (latch, Go spend, maxCost, live inventory), in the preview's pick order.
  // Everything left is a failover candidate, not an "off-side" exclusion.
  const chainKeys = [];
  [side, otherSide].forEach((s) => {
    sortRanked(entry[s + '_ranked']).forEach((row) => {
      const key = str(row.model);
      if (!key || chainKeys.indexOf(key) !== -1) return;
      if (latchHitFor(key)) return;
      if (!providerAllowed(splitName(key).provider)) return;
      if (goBlocked(splitName(key).provider)) return;
      if (maxCost !== null && (rowCost(row) === null || rowCost(row) > maxCost)) return;
      if (availability.models && !availability.models.has(key)) return;
      chainKeys.push(key);
    });
  });

  function buildChain() {
    const rows = [];
    [side, otherSide].forEach((s) => {
      sortRanked(entry[s + '_ranked']).forEach((row) => {
        rows.push(describeRow(row, s));
      });
    });
    // The bar is computed here, not in the panel: usage is a service
    // concern (the panel has no snapshot of its own any more).
    rows.forEach((r) => { r.bar = usageBar(r, usage, at); });
    return rows;
  }

  function describeRow(row, s) {
    const name = str(row.model);
    const parts = splitName(name);
    const cost = rowCost(row);
    const score = typeof row.score === 'number' ? row.score : null;
    const view = { model: name, provider: parts.provider, id: parts.id, score, cost,
      context: typeof row.context === 'number' && row.context > 0 ? row.context : null,
      output: typeof row.output === 'number' && row.output > 0 ? row.output : null,
      monthlyUsage: row.monthly_usage && typeof row.monthly_usage === 'object'
        ? row.monthly_usage : null,
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
    if (!providerAllowed(parts.provider)) {
      view.status = 'excluded';
      view.reason = 'provider not allowed';
      return view;
    }
    if (goBlocked(parts.provider)) {
      view.status = 'excluded';
      view.reason = goReason;
      return view;
    }
    if (availability.models && !availability.models.has(name)) {
      view.status = 'excluded';
      view.reason = 'not in runtime inventory';
      return view;
    }
    const rank = chainKeys.indexOf(name);
    if (rank !== -1) {
      view.status = 'standby';
      view.reason = 'failover #' + (rank + 1);
      return view;
    }
    view.status = 'excluded';
    view.reason = s !== side ? 'off-side · ' + sideNote : 'unavailable in this runtime';
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
