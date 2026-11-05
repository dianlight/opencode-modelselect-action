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

const FIX_TEXT = 'ModelSelect plugin not detected. Fix: add the modelselect ' +
  'plugin to the OpenChamber managed config <dataDir>/opencode.managed.json ' +
  '(default ~/.config/openchamber/opencode.managed.json) and reopen OpenChamber.';

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
  rows.push(line({ id: 'tier', label: 'Tier', value: status.tier || '—',
    dot: status.goOk === true ? 'success' : status.goOk === false ? 'error' : 'muted',
    tooltip: goHint(status.goOk) }));
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
      rows.push(note('plugin-missing', FIX_TEXT, 'error'));
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

export { FIX_TEXT, STALE_MS, ROWS_MAX };
