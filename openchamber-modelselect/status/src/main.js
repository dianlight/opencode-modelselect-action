/* openchamber-modelselect — status view source (ESM, bundled to IIFE).
 *
 * SOURCE FILE — do not edit status/main.js by hand. Rebuild with:
 *   bun install && bunx openchamber-guest-bundle status/src/main.js status/main.js
 * and commit the bundle (index.html loads ../main.js).
 *
 * Surfaces the modelselect plugin's per-session pick plus the global
 * on/off/auto mode switch inside the Work Status section.
 *
 * Layout follows the SDK UI kit standard (like other panels): host theme
 * via applyHostReady, mountTabs for the mode switch, mountBadge for state,
 * mountBanner for the plugin-missing error, and a header + key grid for
 * the pick itself.
 *
 * Contracts (mirror plugin/src/shared/status.js — keep in sync):
 * - Status file: `<project>/.opencode/.modelselect-cache/status-<sessionID>.json`
 *   sessionID sanitized to [A-Za-z0-9-_] (128 cap, empty -> "default").
 *   Fields: sessionID, taskType, tier, model ("provider/id"), jev, goOk
 *   (true|false|null), source, suggestOnly, updatedAt (epoch ms).
 * - Mode file: `<project>/.opencode/.modelselect-cache/mode.json` =
 *   {"mode":"on"|"off"|"auto"}; missing/invalid means "on".
 * - NOTE: skipped auto turns do NOT rewrite the status file, so a stale
 *   file means "last applied pick".
 *
 * Task-type / model names are read ONLY from the plugin's
 * model-config-cache.json (same directory, relative read). Routing
 * categories sync the same way from task-types-cache.json
 * (`jev_criteria` + `agent`) into the OpenChamber `routing.json`
 * deviations file (see routing-sync.js): `autoPreference` from the
 * modelselect plugin options picks the go/free side, empty criteria are
 * ignored, stale entries are disabled, `agent` is only set when the task
 * type defines one. No model lists are hardcoded here. Remote fallback
 * for reference only — the view never fetches it:
 * https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/model-config.json
 */
import { connectHost } from '@openchamber/sdk';
import { applyHostReady, mountBadge, mountBanner, mountTabs } from '@openchamber/sdk/ui';
import { syncRouting } from './routing-sync.js';

var host = connectHost();

var CACHE_DIR = '.opencode/.modelselect-cache';
var MODE_FILE = CACHE_DIR + '/mode.json';
var CONFIG_CACHE_FILE = CACHE_DIR + '/model-config-cache.json';
var STORAGE_MODE_KEY = 'modelselect:mode';
var STALE_MS = 10 * 60 * 1000;
var MIN_HEIGHT = 24;
var MAX_HEIGHT = 320;
// Extension session snapshot `model` is ABSENT/empty while the user never
// picked a model — that is OpenChamber Auto. Hardening for explicit
// auto-ish sentinel values.
var AUTO_MODEL_RE = /^(auto|default|unset)/i;
var VALID_MODES = ['on', 'off', 'auto'];
// Includes the OpenChamber managed config: OpenChamber runs its own
// OpenCode server that ignores the global opencode.json(c).
var GLOBAL_CONFIG_PATHS = [
  '~/.config/opencode/opencode.json',
  '~/.config/opencode/opencode.jsonc',
  '~/.config/openchamber/opencode.managed.json'
];

var currentSession = null;
var currentMode = 'on';
var modeBusy = false;

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
  return AUTO_MODEL_RE.test(m.trim());
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

function loadMode() {
  return existsPath(MODE_FILE).then(function (exists) {
    if (!exists) return 'on'; // missing = on (plugin contract)
    return readJson(MODE_FILE).then(
      function (data) {
        var m = (data && typeof data.mode === 'string') ? data.mode.toLowerCase().trim() : '';
        return VALID_MODES.indexOf(m) !== -1 ? m : 'on';
      },
      function () { return 'on'; } // bad JSON = on (plugin contract)
    );
  }).then(
    function (m) { return m; },
    function () { return 'on'; }
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

function isStale(status) {
  return Boolean(status && typeof status.updatedAt === 'number' &&
    (Date.now() - status.updatedAt) > STALE_MS);
}

function goBadge(goOk) {
  if (goOk === true) return { label: 'Go ok', tone: 'success' };
  if (goOk === false) return { label: 'Go out', tone: 'warning' };
  return { label: 'unknown', tone: 'neutral' };
}

function modeHint(mode) {
  if (mode === 'off') return 'routing paused';
  if (mode === 'auto') return 'routes until you pick a model';
  return 'routes every turn';
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

function renderHeader(root, mode) {
  var head = document.createElement('div');
  head.className = 'ms-head';
  var title = document.createElement('span');
  title.className = 'ms-title';
  title.appendChild(text('Mode'));
  head.appendChild(title);
  var tabsSlot = document.createElement('div');
  tabsSlot.className = 'ms-tabs';
  head.appendChild(tabsSlot);
  root.appendChild(head);
  try {
    mountTabs(tabsSlot, {
      items: [
        { id: 'on', label: 'On' },
        { id: 'off', label: 'Off' },
        { id: 'auto', label: 'Auto' }
      ],
      activeId: mode,
      trackBackground: true,
      onChange: function (next) { setMode(next); }
    });
  } catch (e) {
    // Kit fallback: native buttons keep the switch usable.
    VALID_MODES.forEach(function (m) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ms-fallback-tab' + (m === mode ? ' on' : '');
      btn.appendChild(text(m === 'on' ? 'On' : m === 'off' ? 'Off' : 'Auto'));
      btn.disabled = modeBusy;
      btn.addEventListener('click', function () { setMode(m); });
      tabsSlot.appendChild(btn);
    });
  }
  var hint = document.createElement('div');
  hint.className = 'ms-hint';
  hint.appendChild(text(modeHint(mode)));
  root.appendChild(hint);
}

function field(grid, key, value, mono) {
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
  grid.appendChild(cell);
}

function renderStatusBar(root, status) {
  if (!status) return;
  var bar = document.createElement('div');
  bar.className = 'ms-statusbar';
  var go = goBadge(status.goOk);
  var goIcon = document.createElement('span');
  goIcon.className = 'ms-ico ' + (status.goOk === true ? 'go-ok'
    : status.goOk === false ? 'go-out' : 'go-unknown');
  goIcon.setAttribute('title', status.goOk === true
    ? 'Go auth OK — quota available, the paid tier can be used'
    : status.goOk === false
      ? 'Go auth exhausted — quota is out, the free tier is used'
      : 'Go quota unknown — no probe ran (no token found)');
  goIcon.appendChild(text(status.goOk === true ? '✓' : status.goOk === false ? '✕' : '?'));
  bar.appendChild(goIcon);
  if (status.suggestOnly) {
    var sug = document.createElement('span');
    sug.className = 'ms-ico suggest';
    sug.setAttribute('title', 'Suggest-only trial mode — the pick is logged but never applied');
    sug.appendChild(text('!'));
    bar.appendChild(sug);
  }
  root.appendChild(bar);
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
  }
  if (autoSession) add('Auto', 'info');
  if (any) root.appendChild(wrap);
}

function renderGrid(root, status, knownTypes, autoSession) {
  var stale = isStale(status);
  var unlisted = Boolean(Array.isArray(knownTypes) && knownTypes.length && status &&
    status.taskType && knownTypes.indexOf(status.taskType) === -1);
  var grid = document.createElement('div');
  grid.className = 'ms-grid' + (stale ? ' stale' : '');
  field(grid, 'Task', (status && status.taskType) || '—');
  field(grid, 'Tier', (status && status.tier) || '—');
  field(grid, 'Model', (status && status.model) || '—', true);
  field(grid, 'Jev', (status && status.jev) || '—', true);
  field(grid, 'Source', (status && status.source) || '—');
  root.appendChild(grid);
  renderBadges(root, status, stale, autoSession, unlisted);
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
  while (root.firstChild) root.removeChild(root.firstChild);
  var shell = document.createElement('div');
  shell.className = 'ms';
  root.appendChild(shell);

  if (!currentSession) {
    var note = document.createElement('div');
    note.className = 'ms-note';
    note.appendChild(text('No active session — open a session to see the model pick.'));
    shell.appendChild(note);
    renderHeader(shell, currentMode);
    fitHeight();
    return;
  }

  var autoSession = isAutoSession(currentSession);
  if (!state.status || !state.status.found) {
    var err = (state.status && (state.status.readErr || state.status.statErr)) || null;
    if (!state.globalEntry.entry) {
      renderFixBanner(shell, err);
    } else {
      renderGrid(shell, null, state.knownTypes, autoSession);
    }
    renderHeader(shell, currentMode);
    fitHeight();
    return;
  }

  renderStatusBar(shell, state.status.data);
  renderGrid(shell, state.status.data, state.knownTypes, autoSession);
  renderHeader(shell, currentMode);
  fitHeight();
}

function setMode(mode) {
  if (VALID_MODES.indexOf(mode) === -1 || modeBusy) return;
  modeBusy = true;
  currentMode = mode;
  refresh();
  toPromise(function () {
    return host.writeFile(MODE_FILE, JSON.stringify({ mode: mode }));
  }).then(
    function () { mirrorMode(mode); },
    function () { /* keep optimistic UI; next mount re-reads */ }
  ).then(function () {
    modeBusy = false;
    refresh();
  });
}

function mirrorMode(mode) {
  try {
    var store = host && host.storage;
    if (!store || typeof store.set !== 'function') return;
    Promise.resolve(store.set(STORAGE_MODE_KEY, mode)).then(noop, noop);
  } catch (e) { /* storage mirror is best-effort */ }
}

var refreshQueued = false;
function refresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  var run = function () {
    refreshQueued = false;
    var sid = sessionIDOf(currentSession) || 'default';
    Promise.all([loadStatus(sid), loadMode(), loadGlobalEntry(), loadKnownTaskTypes()]).then(
      function (parts) {
        currentMode = parts[1] || 'on';
        render({ status: parts[0], globalEntry: parts[2], knownTypes: parts[3] });
        // Best-effort routing sync: never blocks or breaks the view.
        try {
          var sync = syncRouting(host);
          if (sync && typeof sync.then === 'function') sync.then(noop, noop);
        } catch (e) { /* sync is best-effort */ }
      },
      function () {
        render({ status: { found: false }, globalEntry: { checked: false, entry: false }, knownTypes: [] });
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
      refresh();
    });
  } catch (e) { /* session updates are best-effort */ }
  refresh();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
