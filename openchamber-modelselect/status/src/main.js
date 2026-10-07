/* openchamber-modelselect — status view source (ESM, bundled to IIFE).
 *
 * SOURCE FILE — do not edit status/main.js by hand. Rebuild with:
 *   bun install && bunx openchamber-guest-bundle status/src/main.js status/main.js
 * and commit the bundle (index.html loads ../main.js).
 *
 * Surfaces the modelselect plugin's per-session pick plus the
 * auto-update router on/off switch inside the Work Status section.
 *
 * Layout follows the SDK UI kit standard (like other panels): host theme
 * via applyHostReady, mountTabs for the router-sync switch, mountBadge for state,
 * mountBanner for the plugin-missing error, and a header + key grid for
 * the pick itself.
 *
 * Contracts (mirror plugin/src/shared/status.js — keep in sync):
 * - Status file: `<project>/.opencode/.modelselect-cache/status-<sessionID>.json`
 *   sessionID sanitized to [A-Za-z0-9-_] (128 cap, empty -> "default").
 *   Fields: sessionID, taskType, tier, model ("provider/id"), jev, goOk
 *   (true|false|null), think (default|minimal|low|medium|high|xhigh|null),
 *   variant (manual picker override, same level vocabulary | null —
 *   effective effort is variant ?? think), freeExhausted
 *   (true|false|null, 12h free-tier latch), source, suggestOnly,
 *   updatedAt (epoch ms).
 * - Free-tier latch (PER MODEL): `<project>/.opencode/.modelselect-cache/free-quota.json`
 *   = `{ version: 2, models: { "<provider/id>": { at, until, kind, detail,
 *   updatedAt } } }` where `kind` is `exhaustion` (spent quota, 12h
 *   window) or `rate-limit` (transient rate limiting, 1h window) and
 *   `until` is the retry time (epoch ms). Legacy v1 files (a single
 *   entry with an optional `model` field; a model-less one is the global
 *   `'*'` latch) still read through `latchEntries`. Rendered
 *   mode-independently as ONE live countdown row per freshly latched
 *   model (shared `plugin/src/shared/routing.js` `latchEntries` +
 *   `freeQuotaFresh`); hidden when missing or expired.
 * - Router-sync file: `<project>/.opencode/.modelselect-cache/routing-sync.json` =
 *   {"sync":true|false}; missing/invalid means the plugin's per-turn
 *   routing.json refresh stays ON — only an explicit `false` pauses it.
 * - Session map (host-detection evidence; single writer: this extension)
 *   — `<project>/.opencode/.modelselect-cache/openchamber-sessions.json` =
 *   `{version:1, sessions:{<sessionID>: lastSeenEpochMs}}`. Touched for
 *   the active session on ready / session updates (throttled: at most one
 *   write per 60s per entry), age-pruned on every write (30d — keep in
 *   sync with the plugin read window in plugin/src/shared/host.js), and
 *   prune-updated from ready `onSessions` workspace snapshots (archived
 *   or deleted sessions removed; needs the `sessions` capability). The
 *   plugin only reads it: a fresh entry marks the project as
 *   OpenChamber-hosted — the mobile-proof signal, since this extension
 *   runs on web/desktop while the app drives the same server and project.
 * - Session-dependent rendering: a session whose model is empty/unset
 *   (OpenChamber auto) or a virtual `modelselect/auto-*` pick shows the
 *   pick grid (Task, Agent, Tier, Model, Think, Jev, Source) + state
 *   badges from the status file (Agent comes from the live session
 *   snapshot) — the plugin routes only virtual sessions now. Any other
 *   model is the user's hands-off choice, so its row shows only the live
 *   session Model + Agent. A missing plugin shows the fix banner instead.
 * - NOTE: the plugin routes only virtual (`modelselect/auto-free-first` / `modelselect/auto-go-first`) sessions and
 *   refreshes routing.json per turn as a courtesy (shared
 *   `plugin/src/shared/routing.js`) while the router sync is on — this
 *   view mirrors that. The on/off/auto modes are gone; the router-sync
 *   switch replaces them.
 *
 * Task-type / model names are read ONLY from the plugin's
 * model-config-cache.json (same directory, relative read). Routing
 * categories sync the same way from task-types-cache.json
 * (`jev_criteria` + `agent`) into the OpenChamber `routing.json`
 * deviations file (shared core `plugin/src/shared/routing.js`, host
 * adapter in routing-sync.js): `autoPreference` from the
 * modelselect plugin options picks the go/free side, empty criteria are
 * ignored, stale entries are disabled, `agent` is only set when the task
 * type defines one. No model lists are hardcoded here. Remote fallback
 * for reference only — the view never fetches it:
 * https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/model-config.json
 */
import { connectHost } from '@openchamber/sdk';
import { applyHostReady, mountBadge, mountBanner, mountTabs } from '@openchamber/sdk/ui';
import { syncRouting, FREE_QUOTA_FILE, freeQuotaFresh, latchEntries } from './routing-sync.js';

var host = connectHost();

var CACHE_DIR = '.opencode/.modelselect-cache';
var ROUTING_SYNC_FILE = CACHE_DIR + '/routing-sync.json';
var SESSION_MAP_FILE = CACHE_DIR + '/openchamber-sessions.json';
// Age window for session-map entries — must match the plugin read window
// (plugin/src/shared/host.js SESSION_MAP_TTL_MS).
var SESSION_MAP_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Throttle: an entry fresher than this needs no rewrite unless a prune
// removes something (detection only needs "recently seen", not live).
var SESSION_MAP_TOUCH_MIN_MS = 60 * 1000;
var MODELSELECT_CONFIG_FILE = '~/.config/openchamber/modelselect.json';
var CONFIG_CACHE_FILE = CACHE_DIR + '/model-config-cache.json';
var STORAGE_SYNC_KEY = 'modelselect:sync';
var STALE_MS = 10 * 60 * 1000;
var MIN_HEIGHT = 24;
var MAX_HEIGHT = 320;
// Extension session snapshot `model` is ABSENT/empty while the user never
// picked a model — that is OpenChamber Auto. Hardening for explicit
// auto-ish sentinel values.
var AUTO_MODEL_RE = /^(auto|default|unset)/i;
// Includes the OpenChamber managed config: OpenChamber runs its own
// OpenCode server that ignores the global opencode.json(c).
var GLOBAL_CONFIG_PATHS = [
  '~/.config/opencode/opencode.json',
  '~/.config/opencode/opencode.jsonc',
  '~/.config/openchamber/opencode.managed.json'
];

var currentSession = null;
var currentSync = true;
var syncBusy = false;
// Session-map state: read-modify-writes serialize on this chain so
// concurrent touches cannot lose entries, and the prune subscription is
// resolved once per open directory (denied/missing workspace access is
// swallowed — the 30d age prune on write is the backstop).
var sessionMapChain = Promise.resolve();
var sessionPruneDirectory = null;
// Live countdown handles for the per-model free-tier suspension rows
// (setTimeout chain — setInterval is not assumed in the guest frame).
// Cleared on every render; each row's expiry triggers a refresh so the
// row disappears and the routing sync can flip that task back to the
// configured preference.
var freeQuotaTimers = [];

function $(id) { return document.getElementById(id); }

function text(str) {
  return document.createTextNode(str == null ? '' : String(str));
}

function noop() { /* best-effort host call */ }

function sanitizeSessionID(id) {
  var clean = String(id == null ? 'default' : id).replace(/[^A-Za-z0-9-_]/g, '_').slice(0, 128);
  return clean || 'default';
}

function statusPathFor(sessionID) {
  return CACHE_DIR + '/status-' + sanitizeSessionID(sessionID) + '.json';
}

function sessionIDOf(snap) {
  if (!snap || typeof snap !== 'object') return '';
  return snap.sessionID || snap.sessionId || snap.id || '';
}

function modelOf(snap) {
  if (!snap || typeof snap !== 'object') return '';
  var m = snap.model;
  if (typeof m === 'string') return m;
  if (m && typeof m === 'object') {
    // Tolerate a structured ref without assuming its field names.
    var joined = [m.providerID, m.provider, m.id, m.modelID, m.model]
      .filter(function (p) { return typeof p === 'string' && p; })
      .join('/');
    if (joined) return joined;
  }
  return '';
}

function isAutoSession(snap) {
  var m = modelOf(snap);
  if (!m || !m.trim()) return true;
  m = m.trim();
  // A virtual `modelselect/auto-*` model IS the plugin's routing switch: a
  // session on it routes every turn, so its row shows the full pick grid.
  if (m === 'modelselect/auto-free-first' || m === 'modelselect/auto-go-first' || m.indexOf('modelselect/') === 0) return true;
  return AUTO_MODEL_RE.test(m);
}

// The selected agent from the live session snapshot: a plain string, or an
// object with name/id (tolerated without assuming a fixed shape).
function agentOf(snap) {
  if (!snap || typeof snap !== 'object') return '';
  var a = snap.agent;
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object') {
    var n = a.name || a.id;
    if (typeof n === 'string') return n;
  }
  return '';
}

// Display a Think effort level ("high" -> "High"); empty/null renders '—'.
// Values are lowercase in the status file (plugin-normalized), only the
// label is capitalized here.
function capitalize(v) {
  var s = v == null ? '' : String(v);
  if (!s) return '—';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Think row value: effective effort — the manual picker variant when set,
// else the task default — with the task default kept visible next to a
// manual override ("Low (manual, task High)"). Equal values collapse to
// "(manual)" since the effective behavior matches the default.
function thinkLabel(status) {
  if (!status) return capitalize(null);
  if (!status.variant) return capitalize(status.think);
  var suffix = status.variant !== status.think ? ', task ' + capitalize(status.think) : '';
  return capitalize(status.variant) + ' (manual' + suffix + ')';
}

function toPromise(fn) {
  try {
    var r = fn();
    if (r && typeof r.then === 'function') return r;
    return Promise.resolve(r);
  } catch (e) {
    return Promise.reject(e);
  }
}

function errCode(err) {
  if (!err) return '';
  if (typeof err.code === 'string' && err.code) return err.code;
  var msg = String((err && err.message) || err);
  if (/NOT_GRANTED/i.test(msg)) return 'NOT_GRANTED';
  if (/BAD_PATH/i.test(msg)) return 'BAD_PATH';
  return '';
}

function capErrorNote(err) {
  var code = errCode(err);
  if (code === 'NOT_GRANTED') return 'file access not granted for this extension';
  if (code === 'BAD_PATH') return 'path outside the allowed scope';
  return 'unreadable';
}

function fitHeight() {
  var run = function () {
    try {
      var h = (document.documentElement && document.documentElement.scrollHeight) || 120;
      h = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, h));
      Promise.resolve(host.setHeight(h)).then(noop, noop);
    } catch (e) { /* host height is best-effort */ }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else run();
}

// Reads are relative to the project root via the host `files` capability.
// host.readFile resolves { content } (SDK FileReadResult).
function readJson(relPath) {
  return toPromise(function () { return host.readFile(relPath); }).then(function (res) {
    return JSON.parse(String(res && res.content));
  });
}

// host.stat resolves { kind, size, mtime } — a missing path is
// `kind: 'missing'`, not an error. Resolves true when the path exists.
function existsPath(relPath) {
  return toPromise(function () { return host.stat(relPath); }).then(
    function (res) { return !res || res.kind !== 'missing'; },
    function () { return false; } // stat errors (NOT_GRANTED etc.) = treat as absent, keep the read error
  );
}

function loadStatus(sessionID) {
  var rel = statusPathFor(sessionID);
  return existsPath(rel).then(function (exists) {
    if (!exists) return { found: false };
    return readJson(rel).then(
      function (data) { return { found: true, data: data }; },
      function (readErr) { return { found: false, readErr: readErr }; }
    );
  });
}

// Router-sync switch: default ON — a missing/unreadable file, bad JSON, or
// a non-boolean `sync` all mean the plugin's per-turn routing.json refresh
// stays on; only an explicit `false` pauses it. No global fallback
// (`modelselect.json` `mode` key is gone with the on/off/auto modes).
function loadRoutingSync() {
  return existsPath(ROUTING_SYNC_FILE).then(function (exists) {
    if (exists) {
      return readJson(ROUTING_SYNC_FILE).then(
        function (data) { return !(data && data.sync === false); },
        function () { return true; } // bad JSON = default on
      );
    }
    return true; // missing = default on
  }).then(
    function (v) { return v; },
    function () { return true; }
  );
}

// Advisory installed-check: does any readable global config mention the
// plugin? Covers the OpenChamber managed config (its own server ignores
// the global opencode.json) — see the fix hint.
function loadGlobalEntry() {
  var checks = GLOBAL_CONFIG_PATHS.map(function (p) {
    return toPromise(function () { return host.readFile(p); }).then(
      function (res) { return /modelselect/i.test(String(res && res.content)); },
      function () { return null; } // unreadable (missing/denied) — not evidence
    );
  });
  return Promise.all(checks).then(function (results) {
    var readable = results.filter(function (r) { return r !== null; });
    if (!readable.length) return { checked: false, entry: false };
    return {
      checked: true,
      entry: readable.some(function (r) { return r === true; })
    };
  });
}

// Known task-type names come ONLY from the plugin's own config cache
// (relative read); never hardcoded.
function loadKnownTaskTypes() {
  return readJson(CONFIG_CACHE_FILE).then(
    function (data) {
      var bucket = (data && (data['task-types'] || data.taskTypes)) || {};
      return Object.keys(bucket);
    },
    function () { return []; }
  );
}

// Free-tier soft-error latch (`free-quota.json`, written by
// plugin/src/shared/freequota.js on a real free-side failure). Never
// rejects — missing/unreadable means "no suspension".
function loadFreeQuota() {
  return existsPath(FREE_QUOTA_FILE).then(function (exists) {
    if (!exists) return { found: false };
    return readJson(FREE_QUOTA_FILE).then(
      function (data) { return { found: true, data: data }; },
      function () { return { found: false }; }
    );
  }).then(
    function (r) { return r; },
    function () { return { found: false }; }
  );
}

// --- session map (host-detection evidence) ------------------------------
// Single writer for SESSION_MAP_FILE = `{version:1, sessions:{<id>:
// lastSeenEpochMs}}`. The plugin only reads it (shared/host.js): a fresh
// entry marks the project as OpenChamber-hosted, which drives its
// virtual-model registration and /modelselect host line.

function sessionsOf(data) {
  return data && data.sessions && typeof data.sessions === 'object' ? data.sessions : {};
}

// Drop entries older than the TTL (and non-numeric junk) — same window
// as the plugin read. Returns how many were removed.
function pruneSessionMapByAge(sessions, now) {
  var removed = 0;
  Object.keys(sessions).forEach(function (id) {
    var seen = sessions[id];
    if (typeof seen !== 'number' || !Number.isFinite(seen) || now - seen > SESSION_MAP_TTL_MS) {
      delete sessions[id];
      removed += 1;
    }
  });
  return removed;
}

function writeSessionMap(sessions) {
  return toPromise(function () {
    return host.writeFile(SESSION_MAP_FILE, JSON.stringify({ version: 1, sessions: sessions }));
  }).then(noop, noop);
}

function readSessionMap() {
  return readJson(SESSION_MAP_FILE).then(sessionsOf, function () { return {}; });
}

// Touch the active session: age-prune first, then stamp `sid` with now —
// unless it is already fresher than the throttle and nothing was pruned
// (then the file is left alone). Serialized on sessionMapChain; never
// rejects, runs fire-and-forget from ready/session events.
function touchSessionMap(sessionID) {
  var sid = sessionID || sessionIDOf(currentSession) || '';
  if (!sid) return;
  sessionMapChain = sessionMapChain.then(function () {
    return readSessionMap().then(function (sessions) {
      var now = Date.now();
      var removed = pruneSessionMapByAge(sessions, now);
      var stored = sessions[sid];
      if (!removed && typeof stored === 'number' && now - stored < SESSION_MAP_TOUCH_MIN_MS) return;
      sessions[sid] = now;
      return writeSessionMap(sessions);
    });
  }).catch(noop);
}

// Ready `onSessions` snapshots prune map entries whose session was
// archived (`archivedAt` set) or deleted (absent from the snapshot); the
// active session is always kept. Nothing to remove means no write.
// Without a subscription (workspace access denied or unavailable) the
// age prune on every touch still cleans the file.
function pruneSessionMap(snapshot) {
  if (!snapshot || snapshot.kind !== 'sessions' || snapshot.state !== 'ready' ||
      !Array.isArray(snapshot.sessions)) return;
  var keep = {};
  var drop = {};
  snapshot.sessions.forEach(function (rec) {
    if (!rec || typeof rec.id !== 'string') return;
    if (rec.archivedAt !== null && rec.archivedAt !== undefined) drop[rec.id] = true;
    else keep[rec.id] = true;
  });
  var active = sessionIDOf(currentSession) || '';
  sessionMapChain = sessionMapChain.then(function () {
    return readSessionMap().then(function (sessions) {
      var removed = pruneSessionMapByAge(sessions, Date.now());
      Object.keys(sessions).forEach(function (id) {
        if (id === active) return; // the live session is evidence by itself
        if (drop[id] || !keep[id]) {
          delete sessions[id];
          removed += 1;
        }
      });
      if (!removed) return;
      return writeSessionMap(sessions);
    });
  }).catch(noop);
}

// Resolve the open project and subscribe to its `onSessions` snapshots
// for pruning. Workspace access may be denied (NOT_GRANTED) or missing
// (older hosts, tests) — fire and forget, resolved once per directory:
// when no subscription runs, the 30d age prune on every write is the
// backstop.
function subscribeSessionPrune(directory) {
  if (!directory || sessionPruneDirectory === directory) return;
  sessionPruneDirectory = directory;
  toPromise(function () { return host.listProjects(); }).then(function (snap) {
    var projects = (snap && snap.projects) || [];
    for (var i = 0; i < projects.length; i += 1) {
      var p = projects[i];
      if (p && p.id && p.directory === directory) {
        return toPromise(function () { return host.onSessions(p.id, pruneSessionMap); });
      }
    }
    return null;
  }).then(noop, noop);
}

// Human-readable remaining time: "2h 15m" over an hour, "5m 30s" over a
// minute, "42s" below it. Seconds are dropped at hour scale so the row
// stays compact; the minute flip still ticks live.
function formatCountdown(ms) {
  var s = Math.max(0, Math.ceil(ms / 1000));
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + sec + 's';
  return sec + 's';
}

function isStale(status) {
  return Boolean(status && typeof status.updatedAt === 'number' &&
    (Date.now() - status.updatedAt) > STALE_MS);
}

function syncHint(sync) {
  return sync ? 'routing.json refreshes every turn' : 'router update paused';
}

function badge(root, label, tone) {
  try {
    mountBadge(root, { label: label, tone: tone || 'neutral' });
  } catch (e) {
    // Kit fallback: plain text keeps the frame readable if the kit fails.
    var s = document.createElement('span');
    s.className = 'ms-fallback-badge';
    s.appendChild(text(label));
    root.appendChild(s);
  }
}

function renderHeader(root, sync) {
  var head = document.createElement('div');
  head.className = 'ms-head';
  var title = document.createElement('span');
  title.className = 'ms-title';
  title.appendChild(text('Auto-update router'));
  head.appendChild(title);
  var tabsSlot = document.createElement('div');
  tabsSlot.className = 'ms-tabs';
  head.appendChild(tabsSlot);
  root.appendChild(head);
  var activeId = sync ? 'on' : 'off';
  try {
    mountTabs(tabsSlot, {
      items: [
        { id: 'on', label: 'On' },
        { id: 'off', label: 'Off' }
      ],
      activeId: activeId,
      trackBackground: true,
      onChange: function (next) { setRoutingSync(next === 'on'); }
    });
  } catch (e) {
    // Kit fallback: native buttons keep the switch usable.
    ['on', 'off'].forEach(function (m) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ms-fallback-tab' + (m === activeId ? ' on' : '');
      btn.appendChild(text(m === 'on' ? 'On' : 'Off'));
      btn.disabled = syncBusy;
      btn.addEventListener('click', function () { setRoutingSync(m === 'on'); });
      tabsSlot.appendChild(btn);
    });
  }
  var hint = document.createElement('div');
  hint.className = 'ms-hint';
  hint.appendChild(text(syncHint(sync)));
  root.appendChild(hint);
}

function field(grid, key, value, mono, icon) {
  var cell = document.createElement('div');
  cell.className = 'ms-field';
  var k = document.createElement('span');
  k.className = 'ms-k';
  k.appendChild(text(key));
  var v = document.createElement('span');
  v.className = 'ms-v' + (mono ? ' mono' : '');
  v.appendChild(text(value));
  if (mono && value && value !== '—') v.setAttribute('title', value);
  cell.appendChild(k);
  cell.appendChild(v);
  if (icon) {
    var ico = document.createElement('span');
    ico.className = 'ms-ico ' + icon.cls;
    ico.setAttribute('title', icon.tip);
    ico.appendChild(text(icon.glyph));
    (function (toast) {
      ico.addEventListener('click', function () {
        // Native title tooltips don't surface in the sandboxed frame,
        // so the explanation goes through the host toast instead.
        toPromise(function () {
          return host.toast({ kind: toast.kind, message: toast.message });
        }).then(noop, noop);
      });
    })(icon.toast);
    v.appendChild(text(' '));
    v.appendChild(ico);
  }
  grid.appendChild(cell);
}

function goIcon(goOk) {
  if (goOk === true) {
    return {
      glyph: '✓', cls: 'go-ok', tip: 'Go auth OK — quota available',
      toast: { kind: 'success', message: 'Go auth OK — quota available, the paid tier can be used.' }
    };
  }
  if (goOk === false) {
    return {
      glyph: '✕', cls: 'go-out', tip: 'Go auth exhausted — quota is out',
      toast: { kind: 'warning', message: 'Go auth exhausted — quota is out, the free tier is used.' }
    };
  }
  return {
    glyph: '?', cls: 'go-unknown', tip: 'Go quota unknown — no probe ran',
    toast: { kind: 'info', message: 'Go quota unknown — no probe ran (no token found).' }
  };
}

function suggestIcon() {
  return {
    glyph: '!', cls: 'suggest', tip: 'Suggest-only trial mode',
    toast: { kind: 'info', message: 'Suggest-only trial mode — the pick is logged but never applied.' }
  };
}

function renderBadges(root, status, stale, autoSession, unlisted) {
  var wrap = document.createElement('div');
  wrap.className = 'ms-badges';
  var any = false;
  var add = function (label, tone) { badge(wrap, label, tone); any = true; };
  if (!status) {
    add('no pick yet', 'neutral');
  } else {
    if (stale) add('last known', 'warning');
    if (unlisted) add('unlisted task', 'warning');
    // 12h free-tier soft-error latch (plugin/src/shared/freequota.js).
    if (status.freeExhausted) add('free exhausted', 'warning');
  }
  if (autoSession) add('Auto', 'info');
  if (any) root.appendChild(wrap);
}

function renderStatusGrid(root, status, knownTypes, autoSession) {
  var stale = isStale(status);
  var unlisted = Boolean(Array.isArray(knownTypes) && knownTypes.length && status &&
    status.taskType && knownTypes.indexOf(status.taskType) === -1);
  var grid = document.createElement('div');
  grid.className = 'ms-grid' + (stale ? ' stale' : '');
  field(grid, 'Task', (status && status.taskType) || '—');
  field(grid, 'Agent', agentOf(currentSession) || '—');
  field(grid, 'Tier', (status && status.tier) || '—', false, status && goIcon(status.goOk));
  field(grid, 'Model', (status && status.model) || '—', true,
    status && status.suggestOnly ? suggestIcon() : null);
  field(grid, 'Think', thinkLabel(status));
  field(grid, 'Jev', (status && status.jev) || '—', true);
  field(grid, 'Source', (status && status.source) || '—');
  root.appendChild(grid);
  renderBadges(root, status, stale, autoSession, unlisted);
}

// auto/off: the status file is never rewritten in these modes, so it is
// stale by design — hide the whole pick grid and badges and show only the
// live session snapshot (Model + Agent). The mode hint under the header
// carries the rest.
function renderLiveGrid(root) {
  var grid = document.createElement('div');
  grid.className = 'ms-grid';
  field(grid, 'Model', modelOf(currentSession) || '—', true);
  field(grid, 'Agent', agentOf(currentSession) || '—');
  root.appendChild(grid);
}

// Free-tier suspension rows, rendered mode-independently while the latch
// is fresh — ONE row per freshly latched model: "Free tier exhausted —
// retry in 2h 15m" for spent quota or "Rate limited — retry in 5m 30s"
// for transient rate limiting, labelled with the suspended model (the
// legacy global `'*'` latch renders without one). Each countdown ticks
// live (setTimeout chain); on expiry it refreshes so the row disappears.
// Hidden entirely when no latch is fresh. Clicking a row toasts that
// latch's detail (model + reason), since native title tooltips don't
// surface in the sandboxed frame.
function renderFreeQuota(root, data) {
  var fresh = latchEntries(data).filter(function (e) { return freeQuotaFresh(e); });
  for (var i = 0; i < fresh.length; i++) renderFreeQuotaRow(root, fresh[i]);
}

function renderFreeQuotaRow(root, entry) {
  var rateLimited = entry.kind === 'rate-limit';
  var row = document.createElement('div');
  row.className = 'ms-freequota' + (rateLimited ? ' rate-limit' : ' exhausted');
  var label = document.createElement('span');
  label.className = 'ms-fq-label';
  var labelText = rateLimited ? 'Rate limited' : 'Free tier exhausted';
  if (entry.model) labelText += ' — ' + entry.model;
  label.appendChild(text(labelText));
  var count = document.createElement('span');
  count.className = 'ms-fq-count';
  row.appendChild(label);
  row.appendChild(count);
  root.appendChild(row);

  var detail = String((entry && entry.detail) || '').trim();
  var tip = (entry.model ? entry.model + ' — ' : '') + (detail || 'free tier temporarily unavailable');
  row.setAttribute('title', tip);
  row.addEventListener('click', function () {
    toPromise(function () {
      return host.toast({ kind: 'warning', message: tip });
    }).then(noop, noop);
  });

  var until = Number(entry.until);
  // One cell per row so render-time cleanup clears the pending handle
  // without bookkeeping per tick (the array would otherwise grow every
  // second between renders).
  var cell = { handle: null };
  freeQuotaTimers.push(cell);
  var tick = function () {
    cell.handle = null;
    var left = until - Date.now();
    if (left <= 0) {
      refresh(); // latch just expired — hide the row, re-sync routing
      return;
    }
    while (count.firstChild) count.removeChild(count.firstChild);
    count.appendChild(text('retry in ' + formatCountdown(left)));
    fitHeight();
    try {
      cell.handle = setTimeout(tick, 1000);
      // Don't hold the host/test process open for the next tick.
      if (cell.handle && typeof cell.handle.unref === 'function') {
        try { cell.handle.unref(); } catch (e) { /* best-effort */ }
      }
    } catch (e) { /* one-shot countdown is fine without timers */ }
  };
  tick();
}

function renderFixBanner(root, err) {
  try {
    mountBanner(root, {
      tone: 'error',
      title: 'ModelSelect plugin not detected' + (err ? ' (' + capErrorNote(err) + ')' : ''),
      body: 'Fix: add the modelselect plugin to the OpenChamber managed config ' +
        '<dataDir>/opencode.managed.json ' +
        '(default ~/.config/openchamber/opencode.managed.json) and reopen OpenChamber.'
    });
  } catch (e) {
    var row = document.createElement('div');
    row.className = 'ms-error';
    row.appendChild(text('ModelSelect plugin not detected. Fix: add the modelselect plugin ' +
      'to the OpenChamber managed config <dataDir>/opencode.managed.json ' +
      '(default ~/.config/openchamber/opencode.managed.json) and reopen OpenChamber.'));
    root.appendChild(row);
  }
}

function render(state) {
  var root = $('root');
  // Stop the previous per-model countdowns before rebuilding the DOM
  // they write to.
  if (freeQuotaTimers.length) {
    for (var qi = 0; qi < freeQuotaTimers.length; qi++) {
      var handle = freeQuotaTimers[qi].handle;
      if (handle !== null && handle !== undefined) {
        try { clearTimeout(handle); } catch (e) { /* best-effort */ }
      }
    }
    freeQuotaTimers = [];
  }
  while (root.firstChild) root.removeChild(root.firstChild);
  var shell = document.createElement('div');
  shell.className = 'ms';
  root.appendChild(shell);

  if (!currentSession) {
    var note = document.createElement('div');
    note.className = 'ms-note';
    note.appendChild(text('No active session — open a session to see the model pick.'));
    shell.appendChild(note);
    renderFreeQuota(shell, state.freeQuota && state.freeQuota.data);
    renderHeader(shell, currentSync);
    fitHeight();
    return;
  }

  var autoSession = isAutoSession(currentSession);
  var statusFound = Boolean(state.status && state.status.found);
  var err = (state.status && (state.status.readErr || state.status.statErr)) || null;
  // Pick grid (status badges) only for auto sessions — the plugin routes
  // those. Any other model is the user's hands-off choice: live grid only.
  var showLiveGrid = !autoSession;
  if (!statusFound && !state.globalEntry.entry) {
    // Plugin-missing banner is session-mode-independent (kept for all).
    renderFixBanner(shell, err);
  } else if (showLiveGrid) {
    renderLiveGrid(shell);
  } else if (statusFound) {
    renderStatusGrid(shell, state.status.data, state.knownTypes, autoSession);
  } else {
    renderStatusGrid(shell, null, state.knownTypes, autoSession);
  }
  // Free-tier suspension is global (not per-session/mode): always last
  // before the router-sync switch, whenever the latch is fresh.
  renderFreeQuota(shell, state.freeQuota && state.freeQuota.data);
  renderHeader(shell, currentSync);
  fitHeight();
}

function setRoutingSync(sync) {
  if (syncBusy) return;
  syncBusy = true;
  currentSync = sync;
  refresh();
  toPromise(function () {
    return host.writeFile(ROUTING_SYNC_FILE, JSON.stringify({ sync: sync }));
  }).then(
    function () { mirrorSync(sync); },
    function () { /* keep optimistic UI; next mount re-reads */ }
  ).then(function () {
    syncBusy = false;
    refresh();
  });
}

function mirrorSync(sync) {
  try {
    var store = host && host.storage;
    if (!store || typeof store.set !== 'function') return;
    Promise.resolve(store.set(STORAGE_SYNC_KEY, sync)).then(noop, noop);
  } catch (e) { /* storage mirror is best-effort */ }
}

var refreshQueued = false;
function refresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  var run = function () {
    refreshQueued = false;
    var sid = sessionIDOf(currentSession) || 'default';
    Promise.all([loadStatus(sid), loadRoutingSync(), loadGlobalEntry(), loadKnownTaskTypes(), loadFreeQuota()]).then(
      function (parts) {
        currentSync = parts[1];
        render({ status: parts[0], globalEntry: parts[2], knownTypes: parts[3], freeQuota: parts[4] });
        // Best-effort routing sync: never blocks or breaks the view.
        try {
          var sync = syncRouting(host);
          if (sync && typeof sync.then === 'function') sync.then(noop, noop);
        } catch (e) { /* sync is best-effort */ }
      },
      function () {
        render({ status: { found: false }, globalEntry: { checked: false, entry: false }, knownTypes: [], freeQuota: { found: false } });
      }
    );
  };
  // Rebuild all state on mount: the frame only runs while Work Status is
  // visible, so every refresh re-reads status + mode from disk.
  run();
}

function mount() {
  try {
    host.onReady(function (ctx) {
      try {
        if (ctx && ctx.theme) applyHostReady(ctx, document.documentElement);
      } catch (e) { /* theme is best-effort */ }
      if (ctx && ctx.session) currentSession = ctx.session;
      if (ctx) subscribeSessionPrune(ctx.directory);
      touchSessionMap();
      refresh();
    });
  } catch (e) {
    var root = $('root');
    while (root.firstChild) root.removeChild(root.firstChild);
    try {
      mountBanner(root, { tone: 'error', title: 'ModelSelect: ' + String((e && e.message) || e) });
    } catch (ignored) {
      var row = document.createElement('div');
      row.className = 'ms-error';
      row.appendChild(text('ModelSelect: ' + String((e && e.message) || e)));
      root.appendChild(row);
    }
    fitHeight();
    return;
  }
  try {
    host.onSession(function (snap) {
      currentSession = snap || null;
      touchSessionMap();
      refresh();
    });
  } catch (e) { /* session updates are best-effort */ }
  try {
    // Re-resolve the prune subscription when the open project changes.
    // The ready message also emits through this listener; the same
    // directory is a no-op (subscribeSessionPrune resolves once per dir).
    host.onDirectory(function (directory) {
      subscribeSessionPrune(directory);
    });
  } catch (e) { /* workspace subscriptions are best-effort */ }
  refresh();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
