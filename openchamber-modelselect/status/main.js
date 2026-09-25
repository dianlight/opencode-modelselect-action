/* openchamber-modelselect — status view (vanilla JS, IIFE, no dependencies).
 *
 * Surfaces the modelselect plugin's per-session pick plus the global
 * on/off/auto mode switch inside the Work Status section.
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
 * model-config-cache.json (same directory, relative read). No model lists
 * are hardcoded here. Remote fallback (for reference only — the view never
 * fetches it):
 * https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/model-config.json
 */
(function () {
  'use strict';

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
  var GLOBAL_CONFIG_PATHS = [
    '~/.config/opencode/opencode.json',
    '~/.config/opencode/opencode.jsonc'
  ];

  var host = null;
  try {
    host = (typeof connectHost === 'function') ? connectHost() : null;
  } catch (e) {
    host = null;
  }

  var currentSession = null;
  var currentMode = 'on';
  var modeBusy = false;

  function $(id) { return document.getElementById(id); }

  function text(str) {
    return document.createTextNode(str == null ? '' : String(str));
  }

  function pill(txt, cls) {
    var s = document.createElement('span');
    s.className = 'pill' + (cls ? ' ' + cls : '');
    s.appendChild(text(txt));
    return s;
  }

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
        if (host && typeof host.setHeight === 'function') host.setHeight(h);
      } catch (e) { /* host height is best-effort */ }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else run();
  }

  // Reads are relative to the project root via the host `files` capability.
  function readJson(relPath) {
    if (!host || typeof host.readFile !== 'function') {
      return Promise.reject(new Error('files capability unavailable'));
    }
    return toPromise(function () { return host.readFile(relPath); }).then(function (raw) {
      return JSON.parse(String(raw));
    });
  }

  function statPath(relPath) {
    if (!host || typeof host.stat !== 'function') {
      return Promise.reject(new Error('files capability unavailable'));
    }
    return toPromise(function () { return host.stat(relPath); });
  }

  function loadStatus(sessionID) {
    var rel = statusPathFor(sessionID);
    return statPath(rel).then(
      function () { return readJson(rel).then(function (data) { return { found: true, data: data }; }); },
      function (statErr) { return { found: false, statErr: statErr }; }
    ).then(
      function (res) { return res; },
      function (readErr) { return { found: false, readErr: readErr }; }
    );
  }

  function loadMode() {
    return statPath(MODE_FILE).then(
      function () {
        return readJson(MODE_FILE).then(
          function (data) {
            var m = (data && typeof data.mode === 'string') ? data.mode.toLowerCase().trim() : '';
            return VALID_MODES.indexOf(m) !== -1 ? m : 'on';
          },
          function () { return 'on'; } // bad JSON = on (plugin contract)
        );
      },
      function () { return 'on'; } // missing = on (plugin contract)
    ).then(
      function (m) { return m; },
      function () { return 'on'; }
    );
  }

  // Advisory installed-check: does any readable global config mention the
  // plugin? (OpenChamber itself uses its managed config — see the fix hint.)
  function loadGlobalEntry() {
    if (!host || typeof host.readFile !== 'function') {
      return Promise.resolve({ checked: false, entry: false });
    }
    var checks = GLOBAL_CONFIG_PATHS.map(function (p) {
      return toPromise(function () { return host.readFile(p); }).then(
        function (raw) { return /modelselect/i.test(String(raw)); },
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

  function goLabel(goOk) {
    if (goOk === true) return { label: 'Go ok', cls: 'ok' };
    if (goOk === false) return { label: 'Go out', cls: 'warn' };
    return { label: 'unknown', cls: 'dim' };
  }

  function renderStatsRow(root, status, knownTypes, autoSession) {
    var row = document.createElement('div');
    row.className = 'row';

    var stale = false;
    if (status && typeof status.updatedAt === 'number') {
      stale = (Date.now() - status.updatedAt) > STALE_MS;
    }
    if (stale) row.className += ' stale';

    var b = document.createElement('strong');
    b.appendChild(text('ModelSelect'));
    row.appendChild(b);

    if (!status) {
      row.appendChild(pill('no pick yet', 'dim'));
      if (autoSession) row.appendChild(pill('Auto', 'dim'));
      root.appendChild(row);
      return;
    }

    row.appendChild(pill('task: ' + (status.taskType || '—')));
    row.appendChild(pill('tier: ' + (status.tier || '—')));
    var modelTxt = 'model: ' + (status.model || '—');
    if (Array.isArray(knownTypes) && knownTypes.length && status.taskType &&
        knownTypes.indexOf(status.taskType) === -1) {
      modelTxt += ' (unlisted task)';
    }
    var modelPill = pill(modelTxt, 'mono');
    row.appendChild(modelPill);
    row.appendChild(pill('jev: ' + (status.jev || '—')));
    var go = goLabel(status.goOk);
    row.appendChild(pill(go.label, go.cls));
    if (status.source) row.appendChild(pill('src: ' + status.source, 'dim'));
    if (status.suggestOnly) row.appendChild(pill('suggest-only', 'warn'));
    if (stale) row.appendChild(pill('last known', 'warn'));
    if (autoSession) row.appendChild(pill('Auto', 'dim'));
    root.appendChild(row);
  }

  function renderModeRow(root, mode) {
    var row = document.createElement('div');
    row.className = 'row';
    var lab = document.createElement('span');
    lab.className = 'label';
    lab.appendChild(text('Mode'));
    row.appendChild(lab);

    var seg = document.createElement('div');
    seg.className = 'seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'ModelSelect routing mode');
    VALID_MODES.forEach(function (m) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.appendChild(text(m === 'on' ? 'On' : m === 'off' ? 'Off' : 'Auto'));
      btn.setAttribute('aria-pressed', m === mode ? 'true' : 'false');
      btn.disabled = modeBusy;
      btn.addEventListener('click', function () { setMode(m); });
      seg.appendChild(btn);
    });
    row.appendChild(seg);

    var hint = document.createElement('span');
    hint.className = 'note';
    hint.appendChild(text(mode === 'off'
      ? 'routing paused'
      : mode === 'auto' ? 'routes until you pick a model' : 'routes every turn'));
    row.appendChild(hint);
    root.appendChild(row);
  }

  function renderError(root, msg) {
    var row = document.createElement('div');
    row.className = 'row';
    var s = document.createElement('span');
    s.className = 'error';
    s.appendChild(text(msg));
    row.appendChild(s);
    root.appendChild(row);
  }

  function renderFixHint(root) {
    var row = document.createElement('div');
    row.className = 'row';
    var s = document.createElement('span');
    s.className = 'note';
    s.appendChild(text(
      'Fix: add the modelselect plugin to the OpenChamber managed config ' +
      '<dataDir>/opencode.managed.json ' +
      '(default ~/.config/openchamber/opencode.managed.json) and reopen OpenChamber.'
    ));
    row.appendChild(s);
    root.appendChild(row);
  }

  function render(state) {
    var root = $('root');
    while (root.firstChild) root.removeChild(root.firstChild);

    if (!host) {
      renderError(root, 'ModelSelect: extension host bridge unavailable.');
      fitHeight();
      return;
    }
    if (!currentSession) {
      var row = document.createElement('div');
      row.className = 'row';
      var s = document.createElement('span');
      s.className = 'note';
      s.appendChild(text('No active session — open a session to see the model pick.'));
      row.appendChild(s);
      root.appendChild(row);
      renderModeRow(root, currentMode);
      fitHeight();
      return;
    }

    var autoSession = isAutoSession(currentSession);
    if (!state.status || !state.status.found) {
      var err = (state.status && (state.status.readErr || state.status.statErr)) || null;
      if (!state.globalEntry.entry) {
        renderError(root, 'ModelSelect plugin not detected' +
          (err ? ' (' + capErrorNote(err) + ')' : '') + '.');
        renderFixHint(root);
      } else {
        var row2 = document.createElement('div');
        row2.className = 'row';
        row2.appendChild(pill('ModelSelect', ''));
        row2.appendChild(pill('no pick yet', 'dim'));
        if (autoSession) row2.appendChild(pill('Auto', 'dim'));
        root.appendChild(row2);
      }
      renderModeRow(root, currentMode);
      fitHeight();
      return;
    }

    renderStatsRow(root, state.status.data, state.knownTypes, autoSession);
    renderModeRow(root, currentMode);
    fitHeight();
  }

  function setMode(mode) {
    if (VALID_MODES.indexOf(mode) === -1 || modeBusy) return;
    if (!host || typeof host.writeFile !== 'function') return;
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
      if (!store) return;
      if (typeof store.set === 'function') return store.set(STORAGE_MODE_KEY, mode);
      if (typeof store.setItem === 'function') return store.setItem(STORAGE_MODE_KEY, mode);
    } catch (e) { /* storage mirror is best-effort */ }
  }

  var refreshQueued = false;
  function refresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    var run = function () {
      refreshQueued = false;
      if (!host) { render({}); return; }
      var sid = sessionIDOf(currentSession) || 'default';
      Promise.all([loadStatus(sid), loadMode(), loadGlobalEntry(), loadKnownTaskTypes()]).then(
        function (parts) {
          currentMode = parts[1] || 'on';
          render({ status: parts[0], globalEntry: parts[2], knownTypes: parts[3] });
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
    if (!host) { render({}); return; }
    try {
      if (typeof host.onReady === 'function') host.onReady(refresh);
    } catch (e) { /* fall through to direct refresh */ }
    try {
      if (typeof host.onSession === 'function') {
        host.onSession(function (snap) {
          currentSession = snap || null;
          refresh();
        });
      }
    } catch (e) { /* session updates are best-effort */ }
    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
