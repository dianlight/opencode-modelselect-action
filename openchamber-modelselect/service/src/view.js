/* openchamber-modelselect — status view builder (ESM, pure).
 *
 * `contributes.statusSection.source` makes the HOST draw the Work Status
 * section: it polls `GET /status` on our local service (`./main.js`) and
 * refuses the whole answer unless it passes `guestStatusViewSchema`
 * (`@openchamber/sdk/schemas`). This module turns the project's modelselect
 * cache files into that answer and touches no I/O, so the tests can drive
 * every state without a process.
 *
 * Scope: the 2.6.1 source contract sends only `?directory=` and
 * `?locale=` — no session id — so the section is PROJECT-scoped: it shows
 * the newest pick in the project (`status-*.json` with the greatest
 * `updatedAt`), not the session the user is looking at. The live session
 * model/agent the old iframe read from `ready.session` is gone with it.
 *
 * Contracts (mirror plugin/src/shared/status.js — keep in sync):
 * - Status file: `<project>/.opencode/.modelselect-cache/status-<sessionID>.json`
 *   Fields: sessionID, taskType, tier, model ("provider/id"), jev, goOk
 *   (true|false|null), think (default|minimal|low|medium|high|xhigh|null),
 *   variant (manual picker override, same vocabulary | null — effective
 *   effort is variant ?? think), freeExhausted (true|false|null, 12h
 *   free-tier latch), goPercent, goLimited, budgetLimited, source,
 *   suggestOnly, updatedAt (epoch ms).
 * - Free-tier latch: `free-quota.json` (per model, `latchEntries`).
 * - Usage snapshot: `usage-limits.json` (see plugin/src/shared/usage.js).
 * - Router-sync file: `routing-sync.json` = {"sync":true|false}; anything
 *   else means ON.
 *
 * Every string is clamped to the schema's limits (ids match
 * `^[a-z][a-z0-9-]{0,39}$`), colours are theme tones only, and the router
 * row is always kept — the section is useless without its switch.
 */
import routingShared from '../../../core/routing.js';

const { freeQuotaFresh, latchEntries } = routingShared;

const STALE_MS = 10 * 60 * 1000;
// guestStatusViewSchema: 16 rows, ids unique, control ids unique across
// the view. Latches get what is left after the fixed rows.
const ROWS_MAX = 16;
const LABEL_MAX = 60;
const VALUE_MAX = 80;
const TEXT_MAX = 200;
const NOTE_MAX = 300;

/** The plugin's tier option: `auto` follows autoPreference. */
export const TIER_OPTIONS = [
  { value: 'auto', label: 'auto' },
  { value: 'go', label: 'go' },
  { value: 'free', label: 'free' }
];

const MISSING_NOTE = 'ModelSelect plugin not in opencode.managed.json — ' +
  'the extension card shows the fix; only this section stays empty.';

function str(v) {
  return v == null ? '' : String(v);
}

function cut(s, max) {
  const t = str(s);
  return t.length <= max ? t : t.slice(0, max - 1) + '…';
}

/** A row id: lower-case, `-` for anything else, first char a letter. */
function idOf(s) {
  const clean = str(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return 'r-' + (clean.replace(/^[^a-z]+/, '') || 'x').slice(0, 36);
}

/** A `value` cell: never empty (the schema requires 1+ characters). */
function value(v) {
  const s = cut(v, VALUE_MAX);
  return s || '—';
}

function label(v) {
  const s = cut(v, LABEL_MAX);
  return s || '—';
}

function capitalize(v) {
  const s = str(v);
  if (!s) return '—';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Effective Think effort: the manual variant when set, else the task default. */
function thinkLabel(status) {
  if (!status) return capitalize(null);
  if (!status.variant) return capitalize(status.think);
  const suffix = status.variant !== status.think ? ', task ' + capitalize(status.think) : '';
  return capitalize(status.variant) + ' (manual' + suffix + ')';
}

function isStale(status, now) {
  return Boolean(status && typeof status.updatedAt === 'number' &&
    now - status.updatedAt > STALE_MS);
}

/** "just now" / "4m ago" / "3h ago" / "2d ago" — the pick's age. */
export function formatAge(now, at) {
  if (typeof at !== 'number' || !Number.isFinite(at)) return '—';
  const ms = Math.max(0, now - at);
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min + 'm ago';
  const hours = Math.floor(min / 60);
  if (hours < 24) return hours + 'h ago';
  return Math.floor(hours / 24) + 'd ago';
}

/** "2h 15m" / "5m 30s" / "42s" — the latch countdown. */
export function formatCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + sec + 's';
  return sec + 's';
}

/** "$12.34 / $50.00" or "$12.34 / no cap" for a model's budget window. */
function budgetValue(m) {
  const spent = typeof m.spent === 'number' && Number.isFinite(m.spent)
    ? '$' + (Math.round(m.spent * 100) / 100).toFixed(2)
    : '—';
  const limit = typeof m.limit === 'number' && Number.isFinite(m.limit) && m.limit > 0
    ? '$' + (Math.round(m.limit * 100) / 100).toFixed(2)
    : 'no cap';
  return spent + ' / ' + limit;
}

/** Budget-row tone: error at/over limit, warning at/above 70%, else success. */
function budgetTone(pct) {
  if (pct === null) return 'muted';
  if (pct >= 100) return 'error';
  if (pct >= 70) return 'warning';
  return 'success';
}

/** One per-model budget row: label, value, bar, tooltip. */
function budgetRow(b, m, now) {
  const name = m.name || m.modelID || m.providerID || 'model';
  const rowLabel = (b.id ? b.id + ' — ' : '') + name;
  const pct = m.percent !== null ? Math.max(0, Math.min(100, Math.round(m.percent))) : null;
  const resets = typeof m.resetsAt === 'number' && m.resetsAt > 0
    ? ' — resets in ' + formatCountdown(m.resetsAt - now) : '';
  const tooltip = cut(rowLabel + ': ' + budgetValue(m) + resets, TEXT_MAX);
  const row = {
    id: 'budget-' + idOf(b.id || 'budget') + '-' + idOf(name),
    label: label(rowLabel),
    value: value(budgetValue(m)),
    valueTone: budgetTone(pct),
    tooltip: tooltip
  };
  if (pct !== null) {
    row.content = { kind: 'bar', value: pct, tone: budgetTone(pct) };
  }
  return row;
}

/** One line per model under each Console budget: spent/limit + progress bar. */
function budgetRows(usage, rows, now) {
  try {
    const budgets = usage && usage.budgets;
    if (!Array.isArray(budgets)) return;
    for (const b of budgets) {
      if (!b || typeof b !== 'object' || !Array.isArray(b.models)) continue;
      for (const m of b.models) {
        if (rows.length >= ROWS_MAX - 1) return;
        rows.push(line(budgetRow(b, m, now)));
      }
    }
  } catch (e) { /* never break the view */ }
}

/** Go tier explanation for the dot's tooltip (the iframe's icon toasts). */
function goHint(goOk) {
  if (goOk === true) return 'Go auth OK — quota available';
  if (goOk === false) return 'Go auth exhausted — quota is out';
  return 'Go quota unknown — no probe ran';
}

/**
 * The highest usable Go meter, preferring `monthly` and falling back to the
 * largest present window — same semantics as the old iframe bar. Percent is
 * clamped to 0..100 because `bar` content requires it.
 */
export function usageMonthly(usage) {
  try {
    const go = usage && usage.go;
    if (!go || typeof go !== 'object') return null;
    const usable = (m) => m && typeof m.percent === 'number' && Number.isFinite(m.percent);
    let meter = usable(go.monthly) ? go.monthly : null;
    if (!meter) {
      ['rolling', 'weekly', 'monthly'].forEach((k) => {
        const w = go[k];
        if (usable(w) && (!meter || w.percent > meter.percent)) meter = w;
      });
    }
    if (!meter) return null;
    const percent = Math.max(0, Math.min(100, meter.percent));
    return { percent, limited: Boolean(meter.limited), resetsAt: meter.resetsAt };
  } catch (e) {
    return null;
  }
}

function usageTone(percent, limited) {
  if (limited || percent >= 100) return 'error';
  if (percent >= 70) return 'warning';
  return 'success';
}

function usageDetail(u, now) {
  const resets = typeof u.resetsAt === 'number' && u.resetsAt > 0
    ? ' — resets in ' + formatCountdown(u.resetsAt - now) : '';
  return cut('Go monthly quota ' + Math.round(u.percent) + '%' +
    (u.limited ? ' — limited' : '') + resets, TEXT_MAX);
}

function line(row) {
  return {
    kind: 'line',
    id: row.id,
    label: label(row.label),
    ...(row.dot ? { dot: row.dot } : {}),
    ...(row.content ? { content: row.content } : {}),
    ...(row.value != null ? { value: value(row.value) } : {}),
    ...(row.valueTone ? { valueTone: row.valueTone } : {}),
    ...(row.badge ? { badge: { label: label(row.badge.label), ...(row.badge.tone ? { tone: row.badge.tone } : {}) } } : {}),
    ...(row.tooltip ? { tooltip: cut(row.tooltip, TEXT_MAX) } : {}),
    ...(row.actions && row.actions.length ? { actions: row.actions } : {})
  };
}

function note(id, text, tone) {
  return { kind: 'note', id: id, text: cut(text, NOTE_MAX), ...(tone ? { tone: tone } : {}) };
}

function statusRows(snap, rows) {
  const status = snap.status;
  const now = snap.now;
  const stale = isStale(status, now);
  const known = Array.isArray(snap.knownTypes) ? snap.knownTypes : [];
  const unlisted = Boolean(known.length && status.taskType && known.indexOf(status.taskType) === -1);

  rows.push(line({ id: 'task', label: 'Task', value: status.taskType || '—',
    ...(unlisted ? { badge: { label: 'unlisted task', tone: 'warning' } } : {}),
    ...(unlisted ? { tooltip: 'This task type is not in the plugin model config.' } : {}) }));
  // The tier is the one option worth changing without the panel: the
  // service writes it to the managed config and reloads OpenCode. The row's
  // value is the tier the last turn used; the control shows the stored
  // option, so the tooltip names both.
  rows.push(line({ id: 'tier', label: 'Tier', value: status.tier || '—',
    dot: status.goOk === true ? 'success' : status.goOk === false ? 'error' : 'muted',
    ...(snap.tierOption ? {
      actions: [{
        kind: 'select',
        id: 'tier',
        label: 'Tier',
        value: snap.tierOption,
        options: TIER_OPTIONS
      }]
    } : {}),
    tooltip: cut(goHint(status.goOk) + ' · last pick used ' + (status.tier || 'unknown') +
      (snap.tierOption
        ? ' · the control sets the plugin tier option (' + snap.tierOption + '; auto = autoPreference)'
        : ''), TEXT_MAX) }));
  rows.push(line({ id: 'model', label: 'Model', value: status.model || '—',
    ...(status.suggestOnly ? { badge: { label: 'suggest only', tone: 'info' } } : {}),
    tooltip: (status.suggestOnly ? 'Suggest-only trial mode — the pick is logged but never applied. ' : '') + str(status.model) }));
  rows.push(line({ id: 'think', label: 'Think', value: thinkLabel(status),
    tooltip: 'Effective effort' + (status.variant ? ' (manual override)' : ' (task default)') }));
  rows.push(line({ id: 'jev', label: 'Jev', value: status.jev || '—' }));
  rows.push(line({ id: 'source', label: 'Source', value: status.source || '—' }));
  rows.push(line({
    id: 'updated',
    label: 'Updated',
    value: formatAge(now, status.updatedAt),
    ...(stale ? { badge: { label: 'last known', tone: 'warning' } } : {}),
    tooltip: 'Session ' + (snap.sessionID || 'unknown') + ' · ' +
      (typeof status.updatedAt === 'number' ? new Date(status.updatedAt).toISOString() : 'no timestamp') +
      (stale ? ' — the pick has not been rewritten for a while (stale by design outside routed turns).' : '')
  }));
}

/**
 * One pick, as the background action's toast shows it: the fields plus a
 * single line to copy. `null` without a status file.
 */
export function pickSummary(status, now) {
  if (!status) return null;
  const at = typeof now === 'number' ? now : Date.now();
  const parts = [
    status.taskType || 'task?',
    status.tier || 'tier?',
    status.model || 'no model',
    thinkLabel(status)
  ];
  if (status.suggestOnly) parts.push('suggest only');
  parts.push(formatAge(at, status.updatedAt));
  if (isStale(status, at)) parts.push('last known');
  return {
    text: parts.join(' · '),
    taskType: str(status.taskType),
    tier: str(status.tier),
    model: str(status.model),
    think: thinkLabel(status),
    jev: str(status.jev),
    source: str(status.source),
    suggestOnly: Boolean(status.suggestOnly),
    updatedAt: typeof status.updatedAt === 'number' ? status.updatedAt : null,
    stale: isStale(status, at)
  };
}

/**
 * Build the `GuestStatusView` for one read.
 *
 * `snap`:
 * - `now` epoch ms
 * - `directory` the Work Status project, or null
 * - `status` the newest parsed status file (or null), `sessionID`, `found`
 * - `knownTypes` task-type names from `model-config-cache.json`
 * - `sync` router-sync switch (default true)
 * - `freeQuota`, `usage` parsed files (or null)
 * - `globalEntry` `{ checked, entry }` plugin-presence probe
 * - `tierOption` the plugin's stored `tier` option (or null when there is no
 *   entry) — present turns the Tier row into a select control
 */
export function buildView(snap) {
  const now = typeof snap.now === 'number' ? snap.now : Date.now();
  const rows = [];

  if (!snap.directory) {
    rows.push(note('no-project', 'Open a project to see the model pick.', 'muted'));
    return { rows: rows };
  }

  if (!snap.found) {
    if (snap.globalEntry && snap.globalEntry.entry) {
      rows.push(note('no-pick', 'No pick yet — the plugin routes on the first turn of a session.', 'muted'));
    } else {
      rows.push(note('plugin-missing', MISSING_NOTE, 'error'));
    }
  } else if (snap.status) {
    statusRows(snap, rows);
  }

  const u = usageMonthly(snap.usage);
  if (u) {
    rows.push(line({
      id: 'usage',
      label: 'Go monthly',
      content: { kind: 'bar', value: u.percent, tone: usageTone(u.percent, u.limited) },
      value: Math.round(u.percent) + '%',
      valueTone: u.limited ? 'error' : undefined,
      tooltip: usageDetail(u, now)
    }));
  }

  // Per-model Console budget windows: spent / limit + progress bar.
  budgetRows(snap.usage, rows, now);

  // One note per fresh latch: quota spent or rate limited, with the live
  // countdown recomputed on every poll (the service is the clock now).
  const fresh = latchEntries(snap.freeQuota).filter((entry) => freeQuotaFresh(entry, now));
  fresh.forEach((entry, index) => {
    if (rows.length >= ROWS_MAX - 1) return;
    const rateLimited = entry.kind === 'rate-limit';
    const head = (rateLimited ? 'Rate limited' : 'Free tier exhausted') +
      (entry.model ? ' — ' + entry.model : '');
    const detail = str(entry.detail).trim();
    const text = head + ' — retry in ' + formatCountdown(Number(entry.until) - now) +
      (detail ? ' · ' + detail : '');
    rows.push(note(idOf('free-' + (entry.model || 'all') + '-' + index), text, 'warning'));
  });

  // The switch always makes the cut: this row is the section's only control.
  rows.push(line({
    id: 'router',
    label: 'Auto-update router',
    content: {
      kind: 'segmented',
      id: 'routing-sync',
      label: snap.sync ? 'On' : 'Off',
      value: snap.sync ? 'on' : 'off',
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]
    },
    tooltip: snap.sync ? 'routing.json refreshes every turn' : 'router update paused'
  }));

  return { rows: rows.slice(0, ROWS_MAX) };
}

export { MISSING_NOTE, STALE_MS, ROWS_MAX, budgetRows };
