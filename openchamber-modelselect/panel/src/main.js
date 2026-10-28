/* openchamber-modelselect — settings panel source (ESM, bundled to IIFE).
 *
 * SOURCE FILE — do not edit panel/main.js by hand. Rebuild with:
 *   bun install && bun run build
 * and commit the bundle (panel/index.html loads ./main.js).
 *
 * Visual configuration for both halves of modelselect:
 * - "Plugin" tab: the modelselect entry's `options` inside the OpenChamber
 *   managed OpenCode config (~/.config/openchamber/opencode.managed.json —
 *   the only OpenCode config OpenChamber's own server loads; the global
 *   opencode.json(c) is shown as a read-only note). Options load at server
 *   start, so a successful save shows a "reopen OpenChamber" banner.
 * - "Extension" tab: the router-sync switch (project
 *   .opencode/.modelselect-cache/routing-sync.json, same file the status
 *   section toggles) plus ~/.config/openchamber/modelselect.json
 *   (autoSmallModel / autoWalkthroughModel / smallModelTask /
 *   walkthroughModelTask). Applies on the next turn — no restart.
 *
 * Safety contracts (keep in sync with plugin/src/shared/select.js
 * normalizeOptions and core/routing.js parseJsonLenient):
 * - An unparseable managed config is NEVER rewritten (error banner, no
 *   form for the plugin tab).
 * - Saves are read-modify-write: unknown keys inside the entry's `options`
 *   and unknown top-level config keys are preserved; the panel only
 *   sets/deletes the keys it manages.
 * - `token` / `jevToken` are write-only: blank = keep the stored value,
 *   stored values are never rendered.
 * - maxCost is a slider 0..catalog-max blended $/1M; the rightmost
 *   position is "No limit" (key removed). Tick labels show the model
 *   catalog's min/max blended cost from the plugin's config cache
 *   (fallback 0..8).
 *
 * UI-kit handles expose only { update, dispose } — every field here is a
 * "cell" ({ value|checked, update }) that mirrors the committed value so
 * Save can read the current state.
 */

import { connectHost } from '@openchamber/sdk';
import {
  applyHostReady,
  mountBanner,
  mountButton,
  mountSelect,
  mountSwitch,
  mountTabs,
  mountTextField,
} from '@openchamber/sdk/ui';
import { computeModelsView } from './models.js';

var host = connectHost();

var MANAGED_CONFIG_PATH = '~/.config/openchamber/opencode.managed.json';
var GLOBAL_NOTE_PATHS = [
  '~/.config/opencode/opencode.json',
  '~/.config/opencode/opencode.jsonc'
];
var MODELSELECT_CONFIG_PATH = '~/.config/openchamber/modelselect.json';
var CACHE_DIR = '.opencode/.modelselect-cache';
var CONFIG_CACHE_FILE = CACHE_DIR + '/model-config-cache.json';
var ROUTING_SYNC_FILE = CACHE_DIR + '/routing-sync.json';
var FREE_QUOTA_FILE = CACHE_DIR + '/free-quota.json';
var PLUGIN_PACKAGE = 'opencode-modelselect-plugin';
var MIN_HEIGHT = 240;
var MAX_HEIGHT = 1600;

// Plugin defaults (mirror plugin/src/shared — keep in sync).
var DEFAULT_CONFIG_URL =
  'https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/model-config.json';
var DEFAULT_TASK_TYPES_URL =
  'https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/task-types.json';
var DEFAULT_JEV_ENDPOINT = 'https://opencode.ai/zen/v1/systemone';
var DEFAULT_HISTORY_CHARS = 2000;
var DEFAULT_REFRESH_MINUTES = 1440;
var DEFAULT_JEV_THRESHOLD = 0.6;
var DEFAULT_JEV_TIMEOUT_MS = 10000;
// Fallback catalog bounds when the plugin's config cache is absent.
var FALLBACK_COST_MIN = 0;
var FALLBACK_COST_MAX = 8;

function $(id) { return document.getElementById(id); }

function text(str) {
  return document.createTextNode(str == null ? '' : String(str));
}

function noop() { /* best-effort host call */ }

function el(tag, cls) {
  var node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function toPromise(fn) {
  try {
    return Promise.resolve(fn());
  } catch (e) {
    return Promise.reject(e);
  }
}

function errCode(err) {
  return String((err && err.code) || (err && err.message) || err || '');
}

function capErrorNote(err) {
  var code = errCode(err);
  if (code === 'NOT_GRANTED') return 'file access not granted for this extension';
  if (code === 'BAD_PATH') return 'path outside the allowed scope';
  return String((err && err.message) || err || 'unreadable');
}

function fitHeight() {
  var run = function () {
    try {
      var h = (document.documentElement && document.documentElement.scrollHeight) || MIN_HEIGHT;
      h = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, h));
      Promise.resolve(host.setHeight(h)).then(noop, noop);
    } catch (e) { /* host height is best-effort */ }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else run();
}

function readText(path) {
  return toPromise(function () { return host.readFile(path); }).then(function (res) {
    return String((res && res.content) || '');
  });
}

function readJson(path) {
  return readText(path).then(function (raw) { return JSON.parse(raw); });
}

function existsPath(path) {
  return toPromise(function () { return host.stat(path); }).then(
    function () { return true; },
    function () { return false; }
  );
}

function writeJson(path, value) {
  return toPromise(function () {
    return host.writeFile(path, JSON.stringify(value, null, 2) + '\n');
  });
}

function shallowCopy(obj) {
  var out = {};
  if (obj && typeof obj === 'object') {
    Object.keys(obj).forEach(function (k) { out[k] = obj[k]; });
  }
  return out;
}

// Option read helpers: accept the plugin's camelCase and kebab-case
// aliases (mirror plugin/src/shared/select.js / jev.js / continuation.js).
function optOf(raw, camel, kebab, dflt) {
  if (!raw || typeof raw !== 'object') return dflt;
  if (raw[camel] !== undefined && raw[camel] !== null) return raw[camel];
  if (kebab && raw[kebab] !== undefined && raw[kebab] !== null) return raw[kebab];
  return dflt;
}

function str(v) { return v == null ? '' : String(v); }

function trim(v) { return str(v).trim(); }

function roundCost(v) { return Math.round(v * 100) / 100; }

// --- field cells (UI-kit handles carry no value state) -----------------------

// Select cell: keeps `value` current through onChange; update() merges into
// the handle AND the mirror.
function mkSelect(root, props) {
  var cell = { value: props.value };
  var handle = mountSelect(root, {
    label: props.label,
    value: props.value,
    options: props.options,
    searchable: props.searchable,
    searchPlaceholder: props.searchPlaceholder,
    onChange: function (id) {
      cell.value = id;
      handle.update({ value: id });
      notifyEdit(props);
    }
  });
  cell.update = function (next) {
    if (next && next.value !== undefined) cell.value = next.value;
    handle.update(next);
  };
  return cell;
}

// Switch cell: keeps `checked` current through onChange.
function mkSwitch(root, props) {
  var cell = { checked: Boolean(props.checked) };
  var handle = mountSwitch(root, {
    label: props.label,
    checked: Boolean(props.checked),
    description: props.description,
    onChange: function (c) {
      cell.checked = Boolean(c);
      handle.update({ checked: cell.checked });
      notifyEdit(props);
    }
  });
  cell.update = function (next) {
    if (next && next.checked !== undefined) cell.checked = Boolean(next.checked);
    handle.update(next);
  };
  return cell;
}

// Text/number/password cell: keeps `value` current through onChange.
function mkText(root, props) {
  var cell = { value: props.value == null ? '' : String(props.value) };
  var handle = mountTextField(root, {
    label: props.label,
    value: cell.value,
    placeholder: props.placeholder,
    password: props.password,
    multiline: props.multiline,
    rows: props.rows,
    helper: props.helper,
    mono: props.mono,
    onChange: function (v) {
      cell.value = v;
      notifyEdit(props);
    }
  });
  cell.update = function (next) {
    if (next && next.value !== undefined) cell.value = String(next.value);
    handle.update(next);
  };
  return cell;
}

// Custom maxCost slider (the UI kit has no range control). value: number
// or null (= no limit, parked at the catalog max). Returns a cell whose
// get() yields the rounded cost or null.
function mountCostSlider(root, initial) {
  var wrap = el('div', 'mp-cost');
  var label = el('span', 'oc-sdk-field-label');
  label.textContent = initial.label || 'maxCost';
  var input = el('input', 'oc-sdk-input mp-cost-input');
  input.type = 'range';
  input.min = String(initial.min);
  input.max = String(initial.max);
  input.step = String(Math.max(0.01, roundCost(initial.max) / 200));
  var valueEl = el('span', 'mp-cost-value');
  var ticks = el('div', 'mp-cost-ticks');
  var tickMin = el('span', 'mp-cost-tick');
  tickMin.textContent = '$' + roundCost(initial.min).toFixed(2) + ' catalog min';
  var tickMax = el('span', 'mp-cost-tick mp-cost-tick-end');
  tickMax.textContent = '$' + roundCost(initial.max).toFixed(2) + ' catalog max · No limit';
  ticks.append(tickMin, tickMax);
  var note = el('span', 'oc-sdk-field-note');
  note.textContent = 'Blended $/1M cap over the ranked catalog; rightmost = no cap.';
  wrap.append(label, input, valueEl, ticks, note);
  root.append(wrap);

  var max = initial.max;
  var cell = { value: initial.value };
  var paint = function () {
    if (cell.value == null) {
      input.value = String(max);
      valueEl.textContent = 'No limit';
    } else {
      input.value = String(cell.value);
      valueEl.textContent = '$' + roundCost(cell.value).toFixed(2) + ' / 1M';
    }
  };
  input.addEventListener('input', function () {
    var v = Number(input.value);
    // Parked at the catalog max = "No limit" (the key is removed on save).
    cell.value = (!isFinite(v) || v >= max - 1e-9) ? null : v;
    paint();
    notifyEdit(initial);
  });
  // Numeric cost or null — what buildPluginOptions expects.
  cell.get = function () { return cell.value == null ? null : roundCost(cell.value); };
  paint();
  return cell;
}

// Read a numeric text cell; returns { value } or { error }.
function parseNumCell(cell, name, opts) {
  var raw = trim(cell.value);
  if (raw === '') {
    if (opts && opts.required) return { error: name + ' is required' };
    return { value: opts && opts.emptyValue !== undefined ? opts.emptyValue : null };
  }
  var n = Number(raw);
  if (!isFinite(n)) return { error: name + ' must be a number' };
  if (opts && opts.min !== undefined && n < opts.min) {
    return { error: name + ' must be >= ' + opts.min };
  }
  if (opts && opts.max !== undefined && n > opts.max) {
    return { error: name + ' must be <= ' + opts.max };
  }
  if (opts && opts.integer && Math.floor(n) !== n) {
    return { error: name + ' must be an integer' };
  }
  return { value: n };
}

// --- loading -----------------------------------------------------------------

// Locate the modelselect entry inside a parsed OpenCode config. Supports
// the v2 object form { package, options } and the v1 string / tuple form.
function findPluginEntry(config) {
  var plugins = config && Array.isArray(config.plugins) ? config.plugins : [];
  for (var i = 0; i < plugins.length; i += 1) {
    var entry = plugins[i];
    if (typeof entry === 'string' && /modelselect/i.test(entry)) {
      return { form: 'string', index: i, package: entry, options: {} };
    }
    if (Array.isArray(entry) && typeof entry[0] === 'string' && /modelselect/i.test(entry[0])) {
      return {
        form: 'tuple',
        index: i,
        package: entry[0],
        options: (entry[1] && typeof entry[1] === 'object') ? entry[1] : {}
      };
    }
    if (entry && typeof entry === 'object' && typeof entry.package === 'string' &&
        /modelselect/i.test(entry.package)) {
      return {
        form: 'object',
        index: i,
        package: entry.package,
        options: (entry.options && typeof entry.options === 'object') ? entry.options : {}
      };
    }
  }
  return { form: 'missing', index: -1, package: PLUGIN_PACKAGE, options: {} };
}

// Task-type names + blended-cost bounds come ONLY from the plugin's own
// config cache (relative read) — never hardcoded (status view convention).
function loadCatalog() {
  return readJson(CONFIG_CACHE_FILE).then(function (data) {
    // Real cache shape is { fetchedAt, config } with the table at
    // config['task-types']; tolerate a bare table too.
    var cfg = (data && data.config) || data || {};
    var bucket = (cfg['task-types'] || cfg.taskTypes) || {};
    var types = Object.keys(bucket);
    var costs = [];
    types.forEach(function (t) {
      var entry = bucket[t] || {};
      ['go_ranked', 'free_ranked'].forEach(function (side) {
        var rows = Array.isArray(entry[side]) ? entry[side] : [];
        rows.forEach(function (row) {
          var c = row && typeof row.blended_cost === 'number' ? row.blended_cost : null;
          if (c != null && isFinite(c)) costs.push(c);
        });
      });
    });
    var bounds = { min: FALLBACK_COST_MIN, max: FALLBACK_COST_MAX };
    if (costs.length) {
      bounds.min = Math.min.apply(null, costs);
      bounds.max = Math.max.apply(null, costs);
      if (bounds.max <= bounds.min) bounds.max = bounds.min + 1;
    }
    return { types: types, bounds: bounds, config: (data && data.config) || null };
  }, function () {
    return { types: [], bounds: { min: FALLBACK_COST_MIN, max: FALLBACK_COST_MAX }, config: null };
  });
}

function loadFreeQuota() {
  return readJson(FREE_QUOTA_FILE).then(
    function (data) { return data; },
    function () { return null; } // missing/unreadable = no latch data
  );
}

function loadRoutingSync() {
  return existsPath(ROUTING_SYNC_FILE).then(function (exists) {
    if (!exists) return true; // missing = default on (status view semantics)
    return readJson(ROUTING_SYNC_FILE).then(
      function (data) { return !(data && data.sync === false); },
      function () { return true; } // bad JSON = default on
    );
  }, function () { return true; });
}

// Managed config: parseOk=false means no plugin-tab form — an unparseable
// config must never be clobbered.
function loadManaged() {
  return existsPath(MANAGED_CONFIG_PATH).then(function (exists) {
    if (!exists) {
      return { parseOk: true, config: { plugins: [] }, entry: findPluginEntry({}) };
    }
    return readText(MANAGED_CONFIG_PATH).then(function (raw) {
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return {
          parseOk: false,
          config: null,
          entry: findPluginEntry({}),
          parseError: capErrorNote(e)
        };
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
          parseOk: false,
          config: null,
          entry: findPluginEntry({}),
          parseError: 'managed config is not a JSON object'
        };
      }
      return { parseOk: true, config: parsed, entry: findPluginEntry(parsed) };
    }, function (err) {
      if (errCode(err) === 'NOT_GRANTED' || errCode(err) === 'BAD_PATH') throw err;
      return {
        parseOk: false,
        config: null,
        entry: findPluginEntry({}),
        parseError: capErrorNote(err)
      };
    });
  });
}

function loadExtensionConfig() {
  return readJson(MODELSELECT_CONFIG_PATH).then(
    function (data) {
      return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    },
    function () { return {}; }
  );
}

function loadGlobalNote() {
  var checks = GLOBAL_NOTE_PATHS.map(function (p) {
    return existsPath(p).then(
      function (ok) { return ok ? p : null; },
      function () { return null; }
    );
  });
  return Promise.all(checks).then(function (found) {
    return found.filter(function (p) { return p != null; });
  });
}

// --- plugin tab --------------------------------------------------------------

var pluginState = null;
var extState = null;

function typeOptions(types, withAuto) {
  var opts = [];
  if (withAuto) opts.push({ id: 'auto', label: 'auto (detect from prompt)' });
  var seen = {};
  types.forEach(function (t) { seen[t] = true; });
  seen.generic = true; // plugin fallback type — always selectable
  Object.keys(seen).forEach(function (t) {
    if (withAuto && t === 'auto') return;
    opts.push({ id: t, label: t });
  });
  return opts;
}

function collectPluginFields() {
  var f = pluginState.fields;
  var errors = [];
  var out = {
    tier: f.tier.value,
    autoPreference: f.autoPreference.value,
    taskType: f.taskType.value,
    defaultTaskType: f.defaultTaskType.value,
    announce: f.announce.value,
    openchamber: f.openchamber.value,
    verbose: f.verbose.checked,
    suggestOnly: f.suggestOnly.checked,
    continuation: f.continuation.checked,
    configUrl: trim(f.configUrl.value),
    taskTypesUrl: trim(f.taskTypesUrl.value),
    jevEndpoint: trim(f.jevEndpoint.value),
    jevModel: trim(f.jevModel.value),
    fallbackModel: trim(f.fallbackModel.value),
    agentTaskMapText: f.agentTaskMap.value,
    tokenDraft: trim(f.token.value),
    jevTokenDraft: trim(f.jevToken.value),
    maxCost: f.cost.get()
  };
  function grab(key, name, opts) {
    var r = parseNumCell(f[key], name, opts);
    if (r.error) errors.push(r.error);
    else out[key] = r.value;
  }
  grab('historyChars', 'historyChars',
    { min: 0, integer: true, required: true, emptyValue: DEFAULT_HISTORY_CHARS });
  grab('configRefreshMinutes', 'configRefreshMinutes',
    { min: 0, integer: true, required: true, emptyValue: DEFAULT_REFRESH_MINUTES });
  grab('jevThreshold', 'jevThreshold',
    { min: 0, max: 1, required: true, emptyValue: DEFAULT_JEV_THRESHOLD });
  grab('jevTimeoutMs', 'jevTimeoutMs',
    { min: 1, integer: true, required: true, emptyValue: DEFAULT_JEV_TIMEOUT_MS });
  var map = null;
  try {
    var parsedMap = JSON.parse(trim(out.agentTaskMapText) || '{}');
    if (!parsedMap || typeof parsedMap !== 'object' || Array.isArray(parsedMap)) {
      errors.push('agentTaskMap must be a JSON object');
    } else {
      map = parsedMap;
    }
  } catch (e) {
    errors.push('agentTaskMap is not valid JSON: ' + String(e && e.message));
  }
  out.agentTaskMap = map;
  return { values: out, errors: errors };
}

// Build the next `options` object: start from the existing one (unknown
// keys preserved) and set/delete only the keys the panel manages.
function buildPluginOptions(base, v) {
  var next = shallowCopy(base);
  next.tier = v.tier;
  next.autoPreference = v.autoPreference;
  next.taskType = v.taskType;
  next.defaultTaskType = v.defaultTaskType;
  next.announce = v.announce;
  next.openchamber = v.openchamber;
  next.verbose = Boolean(v.verbose);
  next.suggestOnly = Boolean(v.suggestOnly);
  next.continuation = Boolean(v.continuation);
  next.historyChars = v.historyChars;
  next.configRefreshMinutes = v.configRefreshMinutes;
  next.configUrl = v.configUrl || DEFAULT_CONFIG_URL;
  next.taskTypesUrl = v.taskTypesUrl || DEFAULT_TASK_TYPES_URL;
  next.jevEndpoint = v.jevEndpoint || DEFAULT_JEV_ENDPOINT;
  next.jevThreshold = v.jevThreshold;
  next.jevTimeoutMs = v.jevTimeoutMs;
  next.agentTaskMap = v.agentTaskMap;
  if (v.maxCost == null) delete next.maxCost; // No limit
  else next.maxCost = v.maxCost;
  if (v.jevModel) next.jevModel = v.jevModel; else delete next.jevModel;
  if (v.fallbackModel) next.fallbackModel = v.fallbackModel; else delete next.fallbackModel;
  // Write-only secrets: blank draft = keep whatever is stored.
  if (v.tokenDraft) next.token = v.tokenDraft;
  if (v.jevTokenDraft) next.jevToken = v.jevTokenDraft;
  return next;
}

function setBanner(handle, tone, title, body) {
  if (!handle) return;
  try {
    handle.update({ tone: tone, title: title, body: body || '' });
  } catch (e) { /* banner is best-effort */ }
}

// Dirty tracking for the plugin form: the Save button stays disabled
// until something differs from the loaded values. Secrets count as dirty
// only while a draft is typed (blank = keep stored = clean).
var PLUGIN_SELECT_KEYS = ['tier', 'autoPreference', 'taskType', 'defaultTaskType', 'announce', 'openchamber'];
var PLUGIN_SWITCH_KEYS = ['verbose', 'suggestOnly', 'continuation'];
var PLUGIN_TEXT_KEYS = ['configUrl', 'taskTypesUrl', 'jevEndpoint', 'jevModel', 'fallbackModel',
  'agentTaskMap', 'historyChars', 'configRefreshMinutes', 'jevThreshold', 'jevTimeoutMs'];

function snapshotPluginFields(f) {
  var s = {};
  PLUGIN_SELECT_KEYS.forEach(function (k) { s[k] = f[k].value; });
  PLUGIN_SWITCH_KEYS.forEach(function (k) { s[k] = f[k].checked; });
  PLUGIN_TEXT_KEYS.forEach(function (k) { s[k] = f[k].value; });
  s.maxCost = String(f.cost.get());
  return s;
}

function isPluginDirty(f, snap) {
  var i;
  for (i = 0; i < PLUGIN_SELECT_KEYS.length; i += 1) {
    if (f[PLUGIN_SELECT_KEYS[i]].value !== snap[PLUGIN_SELECT_KEYS[i]]) return true;
  }
  for (i = 0; i < PLUGIN_SWITCH_KEYS.length; i += 1) {
    if (f[PLUGIN_SWITCH_KEYS[i]].checked !== snap[PLUGIN_SWITCH_KEYS[i]]) return true;
  }
  for (i = 0; i < PLUGIN_TEXT_KEYS.length; i += 1) {
    if (f[PLUGIN_TEXT_KEYS[i]].value !== snap[PLUGIN_TEXT_KEYS[i]]) return true;
  }
  if (String(f.cost.get()) !== snap.maxCost) return true;
  if (trim(f.token.value) !== '' || trim(f.jevToken.value) !== '') return true;
  return false;
}

function notifyEdit(props) {
  refreshPluginSave();
  try {
    if (props && typeof props.onEdit === 'function') props.onEdit();
  } catch (e) { /* per-field hook is best-effort */ }
}

function refreshPluginSave() {
  var st = pluginState;
  if (!st || !st.fields || !st.saveHandle || !st.snap) return;
  try {
    st.saveHandle.update({ disabled: !isPluginDirty(st.fields, st.snap) });
  } catch (e) { /* save gating is best-effort */ }
}

function savePlugin() {
  var st = pluginState;
  if (!st || !st.managed || !st.fields) return;
  if (!st.managed.parseOk) {
    setBanner(st.banner, 'error', 'Not saved',
      'The managed config is not valid JSON — nothing was written. Fix the file first.');
    return;
  }
  var got = collectPluginFields();
  if (got.errors.length) {
    setBanner(st.banner, 'error', 'Not saved', got.errors.join(' · '));
    fitHeight();
    return;
  }
  var managed = st.managed;
  var config = managed.config;
  if (!Array.isArray(config.plugins)) config.plugins = [];
  var nextOptions = buildPluginOptions(managed.entry.options, got.values);
  var entry = managed.entry;
  if (entry.form === 'missing') {
    config.plugins.push({ package: PLUGIN_PACKAGE, options: nextOptions });
  } else if (entry.form === 'object') {
    config.plugins[entry.index].options = nextOptions;
  } else {
    // string / tuple form: convert in place, preserving position + package.
    config.plugins[entry.index] = { package: entry.package, options: nextOptions };
  }
  writeJson(MANAGED_CONFIG_PATH, config).then(function () {
    managed.entry = findPluginEntry(config);
    // Secrets are write-only: clear the drafts, re-snapshot, and gate
    // the button again — nothing left to save.
    if (st.fields) {
      st.fields.token.update({ value: '' });
      st.fields.jevToken.update({ value: '' });
      st.snap = snapshotPluginFields(st.fields);
      refreshPluginSave();
    }
    // No programmatic reload exists: the SDK exposes no server/config
    // reload call, and a raw file write bypasses the Settings-save path
    // that restarts OpenChamber's managed server — so this stays a
    // manual-reopen notice, not a confirm-then-reload flow.
    setBanner(st.banner, 'warning', 'Plugin options saved — restart required',
      'Quit and reopen OpenChamber so its server reloads the plugin options. ' +
      'Extensions cannot trigger the reload themselves.');
    fitHeight();
  }, function (err) {
    setBanner(st.banner, 'error', 'Save failed', capErrorNote(err));
    fitHeight();
  });
}

function sectionTitle(container, title) {
  var h = el('div', 'mp-section');
  h.textContent = title;
  container.append(h);
}

function renderPluginForm(container, managed, catalog) {
  var entry = managed.entry;
  var raw = entry.options || {};
  var types = catalog.types;
  var fields = {};

  sectionTitle(container, 'Routing');
  fields.tier = mkSelect(container, {
    label: 'tier',
    value: str(optOf(raw, 'tier', null, 'auto')),
    options: [
      { id: 'auto', label: 'auto', hint: 'follow autoPreference' },
      { id: 'go', label: 'go', hint: 'paid Go tier' },
      { id: 'free', label: 'free', hint: 'free tier only' }
    ]
  });
  fields.autoPreference = mkSelect(container, {
    label: 'autoPreference',
    value: str(optOf(raw, 'autoPreference', 'auto-preference', 'free-first')),
    options: [
      { id: 'free-first', label: 'free-first' },
      { id: 'go-first', label: 'go-first' }
    ]
  });
  fields.taskType = mkSelect(container, {
    label: 'taskType',
    value: str(optOf(raw, 'taskType', 'task-type', 'auto')),
    options: typeOptions(types, true),
    searchable: true,
    searchPlaceholder: 'Filter task types…'
  });
  fields.defaultTaskType = mkSelect(container, {
    label: 'defaultTaskType',
    value: str(optOf(raw, 'defaultTaskType', 'default-task-type', 'generic')),
    options: typeOptions(types, false),
    searchable: true,
    searchPlaceholder: 'Filter task types…'
  });
  fields.announce = mkSelect(container, {
    label: 'announce',
    value: str(optOf(raw, 'announce', null, 'switch')),
    options: [
      { id: 'switch', label: 'switch' },
      { id: 'always', label: 'always' },
      { id: 'off', label: 'off' }
    ]
  });
  fields.openchamber = mkSelect(container, {
    label: 'openchamber (host force)',
    value: str(optOf(raw, 'openchamber', 'open-chamber', 'auto')),
    options: [
      { id: 'auto', label: 'auto (detect)' },
      { id: 'on', label: 'on (always OpenChamber)' },
      { id: 'off', label: 'off (always standalone)' }
    ]
  });

  sectionTitle(container, 'Budget & behavior');
  var maxCostRaw = optOf(raw, 'maxCost', null, null);
  fields.cost = mountCostSlider(container, {
    label: 'maxCost (blended $/1M)',
    min: catalog.bounds.min,
    max: catalog.bounds.max,
    value: (typeof maxCostRaw === 'number' && isFinite(maxCostRaw)) ? maxCostRaw : null
  });
  fields.verbose = mkSwitch(container, {
    label: 'verbose',
    checked: Boolean(optOf(raw, 'verbose', null, false)),
    description: 'Log routing decisions to the OpenCode output.'
  });
  fields.suggestOnly = mkSwitch(container, {
    label: 'suggestOnly',
    checked: Boolean(optOf(raw, 'suggestOnly', 'suggest-only', false)),
    description: 'Announce the pick without switching the model.'
  });
  fields.continuation = mkSwitch(container, {
    label: 'continuation',
    checked: Boolean(optOf(raw, 'continuation', null, true)),
    description: 'Re-announce a stale pick when the conversation continues.'
  });
  fields.historyChars = mkText(container, {
    label: 'historyChars',
    value: optOf(raw, 'historyChars', 'history-chars', DEFAULT_HISTORY_CHARS),
    helper: 'Chars of history considered for continuation (>= 0).',
    mono: true
  });
  fields.configRefreshMinutes = mkText(container, {
    label: 'configRefreshMinutes',
    value: optOf(raw, 'configRefreshMinutes', null, DEFAULT_REFRESH_MINUTES),
    helper: 'Minutes before the model config cache refetches (0 = every time).',
    mono: true
  });

  sectionTitle(container, 'Jev (refinement)');
  fields.jevEndpoint = mkText(container, {
    label: 'jevEndpoint',
    value: str(optOf(raw, 'jevEndpoint', 'jev-endpoint', DEFAULT_JEV_ENDPOINT)),
    mono: true
  });
  fields.jevModel = mkText(container, {
    label: 'jevModel',
    value: str(optOf(raw, 'jevModel', 'jev-model', '')),
    placeholder: 'provider/id (empty = tier default)',
    mono: true
  });
  fields.jevThreshold = mkText(container, {
    label: 'jevThreshold',
    value: optOf(raw, 'jevThreshold', 'jev-threshold', DEFAULT_JEV_THRESHOLD),
    helper: '0..1 — minimum improvement to accept a refinement.',
    mono: true
  });
  fields.jevTimeoutMs = mkText(container, {
    label: 'jevTimeoutMs',
    value: optOf(raw, 'jevTimeoutMs', 'jev-timeout-ms', DEFAULT_JEV_TIMEOUT_MS),
    helper: 'Refinement request timeout in ms (> 0).',
    mono: true
  });

  sectionTitle(container, 'Sources & fallback');
  fields.configUrl = mkText(container, {
    label: 'configUrl',
    value: str(optOf(raw, 'configUrl', 'config-url', DEFAULT_CONFIG_URL)),
    mono: true
  });
  fields.taskTypesUrl = mkText(container, {
    label: 'taskTypesUrl',
    value: str(optOf(raw, 'taskTypesUrl', null, DEFAULT_TASK_TYPES_URL)),
    mono: true
  });
  fields.fallbackModel = mkText(container, {
    label: 'fallbackModel',
    value: str(optOf(raw, 'fallbackModel', 'fallback-model', '')),
    placeholder: 'provider/id (empty = none)',
    mono: true
  });
  fields.agentTaskMap = mkText(container, {
    label: 'agentTaskMap (JSON)',
    value: JSON.stringify(optOf(raw, 'agentTaskMap', 'agent-task-map', {}), null, 2),
    multiline: true,
    rows: 4,
    mono: true,
    helper: 'Map of agent name → task type.'
  });

  sectionTitle(container, 'Secrets (write-only)');
  fields.token = mkText(container, {
    label: 'token',
    value: '',
    password: true,
    helper: 'Leave blank to keep the stored token — it is never shown here.'
  });
  fields.jevToken = mkText(container, {
    label: 'jevToken',
    value: '',
    password: true,
    helper: 'Leave blank to keep the stored token — it is never shown here.'
  });

  var foot = el('div', 'mp-foot');
  var saveHandle = mountButton(foot, {
    label: 'Save plugin settings',
    variant: 'default',
    disabled: true, // pristine form — enabled by refreshPluginSave on edit
    onClick: savePlugin
  });
  container.append(foot);
  pluginState.saveHandle = saveHandle;
  pluginState.snap = snapshotPluginFields(fields);
  refreshPluginSave();
  return fields;
}

function renderPluginPane(pane, managed, catalog, globalPaths) {
  clearNode(pane);
  pluginState = { managed: managed, fields: null, banner: null, saveHandle: null, snap: null };

  var note = el('div', 'mp-file');
  note.textContent = managed.parseOk
    ? 'Writes: ' + MANAGED_CONFIG_PATH
    : 'Read-only: managed config could not be parsed';
  pane.append(note);

  if (globalPaths && globalPaths.length) {
    var g = el('div', 'mp-note');
    g.textContent = 'Also present (ignored by OpenChamber\'s server): ' + globalPaths.join(', ');
    pane.append(g);
  }

  pluginState.banner = mountBanner(pane, { tone: 'info', title: '', body: '' });

  if (!managed.parseOk) {
    setBanner(pluginState.banner, 'error', 'Managed config is not valid JSON',
      'Nothing will be written until the file parses. Error: ' +
      (managed.parseError || 'parse failed'));
    fitHeight();
    return;
  }

  var formRoot = el('div', 'mp-form');
  pane.append(formRoot);

  var showForm = function () {
    clearNode(formRoot);
    var entry = managed.entry;
    if (entry.form === 'string' || entry.form === 'tuple') {
      setBanner(pluginState.banner, 'info', 'Entry is installed in plain form',
        'Save converts it to { "package": …, "options": {…} } in place, keeping its position.');
    } else if (entry.form === 'missing') {
      setBanner(pluginState.banner, 'warning', 'No modelselect entry in the managed config',
        'Add the plugin, then configure and save.');
    } else {
      setBanner(pluginState.banner, 'info', 'Editing: ' + entry.package, '');
    }
    pluginState.fields = renderPluginForm(formRoot, managed, catalog);
    fitHeight();
  };

  if (managed.entry.form === 'missing') {
    setBanner(pluginState.banner, 'warning', 'No modelselect entry in the managed config',
      'Add the plugin below, then configure and save.');
    var addWrap = el('div', 'mp-foot');
    mountButton(addWrap, {
      label: 'Add to managed config',
      variant: 'default',
      onClick: function () {
        if (managed.entry.form !== 'missing') return; // already added
        var config = managed.config;
        if (!Array.isArray(config.plugins)) config.plugins = [];
        config.plugins.push({ package: PLUGIN_PACKAGE, options: {} });
        managed.entry = findPluginEntry(config);
        addWrap.remove(); // the entry exists now — the button must go
        showForm();
      }
    });
    pane.append(addWrap);
  } else {
    showForm();
  }
  fitHeight();
}

// --- extension tab -----------------------------------------------------------

function collectExtFields() {
  var f = extState.fields;
  return {
    values: {
      sync: Boolean(f.sync.checked),
      autoSmallModel: Boolean(f.autoSmallModel.checked),
      autoWalkthroughModel: Boolean(f.autoWalkthroughModel.checked),
      smallModelTask: f.smallModelTask.value,
      walkthroughModelTask: f.walkthroughModelTask.value
    },
    errors: []
  };
}

function saveExtension() {
  var st = extState;
  if (!st || !st.fields) return;
  var v = collectExtFields().values;
  // Router-sync: same project file the status section toggles.
  var syncJob = readJson(ROUTING_SYNC_FILE).then(
    function (data) { return (data && typeof data === 'object') ? shallowCopy(data) : {}; },
    function () { return {}; }
  ).then(function (data) {
    data.sync = v.sync;
    return writeJson(ROUTING_SYNC_FILE, data);
  });
  // modelselect.json: read-modify-write, unknown keys preserved.
  var extJob = readJson(MODELSELECT_CONFIG_PATH).then(
    function (data) {
      return (data && typeof data === 'object' && !Array.isArray(data)) ? shallowCopy(data) : {};
    },
    function () { return {}; }
  ).then(function (data) {
    data.autoSmallModel = v.autoSmallModel;
    data.autoWalkthroughModel = v.autoWalkthroughModel;
    data.smallModelTask = v.smallModelTask;
    data.walkthroughModelTask = v.walkthroughModelTask;
    return writeJson(MODELSELECT_CONFIG_PATH, data);
  });
  Promise.all([syncJob, extJob]).then(function () {
    setBanner(st.banner, 'success', 'Extension settings saved',
      'Applies on the next turn — no restart needed.');
    fitHeight();
  }, function (err) {
    setBanner(st.banner, 'error', 'Save failed', capErrorNote(err));
    fitHeight();
  });
}

function renderExtPane(pane, extConfig, syncOn, catalog) {
  clearNode(pane);
  extState = { fields: null, banner: null };

  var note = el('div', 'mp-file');
  note.textContent = 'Writes: ' + MODELSELECT_CONFIG_PATH + ' · routing-sync.json';
  pane.append(note);

  extState.banner = mountBanner(pane, { tone: 'info', title: '', body: '' });

  var fields = {};
  sectionTitle(pane, 'Router');
  fields.sync = mkSwitch(pane, {
    label: 'auto-update routing.json',
    checked: syncOn,
    description: 'Refresh the stored routing deviations each turn (same switch as the status section).'
  });

  sectionTitle(pane, 'Auto model picks');
  fields.autoSmallModel = mkSwitch(pane, {
    label: 'autoSmallModel',
    checked: Boolean(extConfig.autoSmallModel),
    description: 'Route small/mechanical tasks to the small-model pick.'
  });
  fields.autoWalkthroughModel = mkSwitch(pane, {
    label: 'autoWalkthroughModel',
    checked: Boolean(extConfig.autoWalkthroughModel),
    description: 'Route walkthrough/tutorial sessions to the walkthrough pick.'
  });
  fields.smallModelTask = mkSelect(pane, {
    label: 'smallModelTask',
    value: str(extConfig.smallModelTask) || 'generic',
    options: typeOptions(catalog.types, false),
    searchable: true,
    searchPlaceholder: 'Filter task types…'
  });
  fields.walkthroughModelTask = mkSelect(pane, {
    label: 'walkthroughModelTask',
    value: str(extConfig.walkthroughModelTask) || 'generic',
    options: typeOptions(catalog.types, false),
    searchable: true,
    searchPlaceholder: 'Filter task types…'
  });

  var foot = el('div', 'mp-foot');
  mountButton(foot, {
    label: 'Save extension settings',
    variant: 'default',
    onClick: saveExtension
  });
  pane.append(foot);

  extState.fields = fields;
  fitHeight();
}

// --- models tab ----------------------------------------------------------------

var modelsState = null;

function initialModelsTask(types, options) {
  var preferred = str(optOf(options, 'defaultTaskType', 'default-task-type', ''));
  if (preferred && types.indexOf(preferred) >= 0) return preferred;
  if (types.indexOf('generic') >= 0) return 'generic';
  return types[0] || '';
}

function formatCost(v) {
  return '$' + (Math.round(v * 100) / 100).toFixed(2);
}

function formatCtx(v) {
  if (v >= 1000000) {
    return (Math.round(v / 10000) / 100) + 'M';
  }
  if (v >= 1000) return Math.round(v / 1000) + 'k';
  return String(v);
}

// Input-modality glyphs for the row's top-right corner. Unknown
// modalities render as their raw name so no support data is lost.
var MEDIA_ICONS = {
  text: '📝',
  image: '🖼️',
  pdf: '📄',
  audio: '🔊',
  video: '🎬',
  file: '📎'
};

function modelRow(row, scale) {
  var wrap = el('div', 'mp-mo' + (row.status === 'excluded' ? ' excluded' : ''));
  var head = el('div', 'mp-mo-head');
  var name = el('span', 'mp-mo-name');
  name.textContent = row.model;
  head.append(name);
  var right = el('span', 'mp-mo-right');
  (row.modalities || []).forEach(function (mod) {
    var ico = el('span', 'mp-mo-ico');
    ico.textContent = MEDIA_ICONS[mod] || mod;
    right.append(ico);
  });
  if (row.status === 'pick') {
    var pick = el('span', 'mp-mo-pick');
    pick.textContent = 'PICK';
    right.append(pick);
  } else if (row.status === 'excluded' && row.reason) {
    var why = el('span', 'mp-mo-why');
    why.textContent = row.reason;
    right.append(why);
  }
  head.append(right);
  wrap.append(head);

  var bits = [row.provider];
  if (row.context !== null) bits.push(formatCtx(row.context) + ' ctx');
  bits.push('score ' + (row.score === null ? '—' : row.score));
  if (row.cost !== null) {
    var costBit = formatCost(row.cost) + '/1M';
    if (row.inputCost !== null && row.outputCost !== null) {
      costBit += ' (in ' + formatCost(row.inputCost) + ' / out ' + formatCost(row.outputCost) + ')';
    }
    bits.push(costBit);
  } else {
    bits.push('cost unknown');
  }
  var meta = el('div', 'mp-mo-meta');
  meta.textContent = bits.join(' · ');
  wrap.append(meta);

  if (row.cost !== null && scale > 0) {
    var barWrap = el('div', 'mp-mo-barwrap');
    var bar = el('div', 'mp-mo-bar');
    var fill = el('div', 'mp-mo-fill');
    var pct = Math.max(0, Math.min(100, Math.round((row.cost / scale) * 100)));
    fill.style.width = pct + '%';
    bar.append(fill);
    barWrap.append(bar);
    var barLabel = el('span', 'mp-mo-barlabel');
    barLabel.textContent = formatCost(row.cost) + ' / ' + formatCost(scale) + ' limit';
    barWrap.append(barLabel);
    wrap.append(barWrap);
  }
  if (row.latchText) {
    var latch = el('div', 'mp-mo-latch');
    latch.textContent = row.latchText;
    wrap.append(latch);
  }
  return wrap;
}

function renderModelsPane(pane, ctx) {
  clearNode(pane);
  modelsState = { task: initialModelsTask(ctx.catalog.types, ctx.options), showExcluded: true };

  var note = el('div', 'mp-file');
  note.textContent = 'Read-only preview from the saved options + catalog cache. ' +
    'The live Go quota probe can still adjust the auto pick; monthly usage % ' +
    'needs the token and is not shown here.';
  pane.append(note);

  var cellRef = {};
  var eyeRef = {};
  var toolsRow = el('div', 'mp-mo-tools');
  var selectWrap = el('div', 'mp-mo-select');
  var eyeWrap = el('div', 'mp-mo-eye');
  toolsRow.append(selectWrap, eyeWrap);
  pane.append(toolsRow);
  var chainWrap = el('div', 'mp-mo-chain');
  var repaintChain = function () {
    clearNode(chainWrap);
    var view;
    try {
      view = computeModelsView({
        taskType: modelsState.task,
        catalogConfig: ctx.catalog.config,
        options: ctx.options,
        latchData: ctx.latch,
        now: Date.now()
      });
    } catch (e) {
      view = { found: false, taskType: modelsState.task };
    }
    var head = el('div', 'mp-mo-pickline');
    if (!view.found) {
      head.textContent = 'No models configured for task \u2018' + modelsState.task + '\u2019.';
      chainWrap.append(head);
    } else {
      var pickText = view.pick ? ('Pick: ' + view.pick) : 'Pick: none';
      if (view.pickSource === 'fallback') pickText += ' (fallback)';
      if (view.pickNote) pickText += ' — ' + view.pickNote;
      head.textContent = pickText + ' · ' + view.sideNote +
        (view.maxCost !== null ? ' · cap $' + view.maxCost + '/1M' : ' · no cap');
      chainWrap.append(head);
      var hasCaps = view.chain.some(function (r) {
        return r.context !== null || (r.modalities && r.modalities.length);
      });
      if (view.chain.length && !hasCaps) {
        var stale = el('div', 'mp-mo-empty');
        stale.textContent = 'No capability data in the plugin cache — rows predate ' +
          'context/modalities. Refresh the cache to see them: delete ' +
          '.opencode/.modelselect-cache/model-config-cache.json in the project ' +
          'and reopen this panel (it refetches automatically otherwise).';
        chainWrap.append(stale);
      }
      var rows = view.chain.filter(function (r) {
        return modelsState.showExcluded || r.status !== 'excluded';
      });
      if (!rows.length) {
        var empty = el('div', 'mp-mo-empty');
        empty.textContent = view.fallback
          ? 'No ranked rows — answering with the fallback model.'
          : (view.chain.length ? 'All rows excluded — toggle the eye to show them.' : 'No ranked rows for this task.');
        chainWrap.append(empty);
      }
      var scale = view.maxCost !== null ? view.maxCost : 0;
      if (view.maxCost === null) {
        rows.forEach(function (r) {
          if (r.cost !== null && r.cost > scale) scale = r.cost;
        });
        if (scale <= 0) scale = 1;
      }
      rows.forEach(function (row) {
        chainWrap.append(modelRow(row, scale));
      });
    }
    fitHeight();
  };

  eyeRef.handle = mountButton(eyeWrap, {
    label: '👁',
    size: 'xs',
    variant: 'secondary',
    onClick: function () {
      modelsState.showExcluded = !modelsState.showExcluded;
      try {
        eyeRef.handle.update({ label: modelsState.showExcluded ? '👁' : '🙈' });
      } catch (e) { /* label is best-effort */ }
      repaintChain();
    }
  });
  cellRef.cell = mkSelect(selectWrap, {
    label: 'task',
    value: modelsState.task,
    options: typeOptions(ctx.catalog.types, false),
    searchable: true,
    searchPlaceholder: 'Filter task types…',
    onEdit: function () {
      modelsState.task = cellRef.cell.value;
      repaintChain();
    }
  });
  pane.append(chainWrap);
  repaintChain();
  fitHeight();
}

// --- shell -------------------------------------------------------------------

function mountStyles() {
  try {
    var style = el('style');
    style.textContent = [
      '* { box-sizing: border-box; }',
      'html, body { margin: 0; padding: 0; background: transparent; color: var(--oc-fg); font: 12px/1.45 var(--oc-font); }',
      'body { padding: 8px 12px 12px; }',
      '.mp { display: flex; flex-direction: column; gap: 8px; }',
      '.mp-title { font-weight: 700; font-size: 13px; }',
      '.mp-note, .mp-file { font-size: 11px; color: var(--oc-muted); }',
      '.mp-section { margin-top: 10px; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--oc-muted); }',
      '.mp-form { display: flex; flex-direction: column; gap: 8px; }',
      '.mp-foot { display: flex; justify-content: flex-end; padding-top: 8px; }',
      '.mp-cost { display: flex; flex-direction: column; gap: 4px; }',
      '.mp-cost-value { font-variant-numeric: tabular-nums; font-weight: 600; }',
      '.mp-cost-ticks { display: flex; justify-content: space-between; font-size: 10px; color: var(--oc-muted); }',
      '.mp-cost-tick-end { text-align: right; }',
      '.mp-mo-chain { display: flex; flex-direction: column; gap: 6px; padding-top: 4px; }',
      '.mp-mo-tools { display: flex; gap: 6px; align-items: flex-end; }',
      '.mp-mo-select { flex: 1 1 auto; min-width: 0; }',
      '.mp-mo-eye { flex: 0 0 auto; padding-bottom: 1px; }',
      '.mp-mo-pickline { font-weight: 600; font-size: 12px; }',
      '.mp-mo-empty { font-size: 11px; color: var(--oc-muted); }',
      '.mp-mo { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border: 1px solid var(--oc-border); border-radius: 6px; }',
      '.mp-mo.excluded { opacity: 0.55; }',
      '.mp-mo-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }',
      '.mp-mo-name { font-family: var(--oc-mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.mp-mo-right { margin-left: auto; display: flex; gap: 4px; align-items: center; }',
      '.mp-mo-ico { font-size: 11px; line-height: 1; }',
      '.mp-mo-pick { flex: 0 0 auto; font-size: 10px; font-weight: 700; color: var(--oc-success-text); }',
      '.mp-mo-why { flex: 0 0 auto; font-size: 10px; color: var(--oc-muted); text-align: right; }',
      '.mp-mo-meta { font-size: 11px; color: var(--oc-muted); }',
      '.mp-mo-barwrap { display: flex; align-items: center; gap: 6px; }',
      '.mp-mo-bar { flex: 1 1 auto; height: 6px; border-radius: 3px; background: var(--oc-hover); overflow: hidden; }',
      '.mp-mo-fill { height: 100%; background: var(--oc-primary); }',
      '.mp-mo-barlabel { flex: 0 0 auto; font-size: 10px; font-variant-numeric: tabular-nums; color: var(--oc-muted); }',
      '.mp-mo-latch { font-size: 11px; color: var(--oc-warning-text); }'
    ].join('\n');
    document.head.append(style);
  } catch (e) { /* styles are best-effort */ }
}

function renderShell(data) {
  var root = $('root');
  clearNode(root);
  var shell = el('div', 'mp');
  root.append(shell);

  var title = el('div', 'mp-title');
  title.textContent = 'Model select settings';
  shell.append(title);
  var note = el('div', 'mp-note');
  note.textContent = 'Plugin options live in the OpenChamber managed OpenCode config; ' +
    'the global opencode.json(c) is ignored by OpenChamber\'s server.';
  shell.append(note);

  var panes = { plugin: null, extension: null, models: null };
  var tabs = mountTabs(shell, {
    items: [
      { id: 'plugin', label: 'Plugin' },
      { id: 'extension', label: 'Extension' },
      { id: 'models', label: 'Models' }
    ],
    activeId: 'plugin',
    onChange: function (id) {
      // Commit the selection back: without this the kit keeps thinking
      // 'plugin' is active and stops firing onChange for it.
      tabs.update({ activeId: id });
      panes.plugin.hidden = id !== 'plugin';
      panes.extension.hidden = id !== 'extension';
      panes.models.hidden = id !== 'models';
      fitHeight();
    }
  });

  panes.plugin = el('div', 'mp-pane');
  panes.extension = el('div', 'mp-pane');
  panes.extension.hidden = true;
  panes.models = el('div', 'mp-pane');
  panes.models.hidden = true;
  shell.append(panes.plugin, panes.extension, panes.models);

  renderPluginPane(panes.plugin, data.managed, data.catalog, data.globalPaths);
  renderExtPane(panes.extension, data.extConfig, data.syncOn, data.catalog);
  renderModelsPane(panes.models, {
    catalog: data.catalog,
    options: (data.managed.entry && data.managed.entry.options) || {},
    latch: data.latch
  });
  fitHeight();
}

function run() {
  Promise.all([
    loadManaged(),
    loadExtensionConfig(),
    loadRoutingSync(),
    loadCatalog(),
    loadGlobalNote(),
    loadFreeQuota()
  ]).then(function (parts) {
    renderShell({
      managed: parts[0],
      extConfig: parts[1],
      syncOn: parts[2],
      catalog: parts[3],
      globalPaths: parts[4],
      latch: parts[5]
    });
  }, function (err) {
    var root = $('root');
    clearNode(root);
    try {
      mountBanner(root, {
        tone: 'error',
        title: 'ModelSelect settings: ' + capErrorNote(err),
        body: 'Check the extension\'s files/filesystem capabilities.'
      });
    } catch (ignored) {
      root.append(text('ModelSelect settings: ' + capErrorNote(err)));
    }
    fitHeight();
  });
}

function mount() {
  mountStyles();
  try {
    host.onReady(function (ctx) {
      try {
        if (ctx && ctx.theme && ctx.theme.tokens) {
          applyHostReady(ctx, document.documentElement);
        }
      } catch (e) { /* theme is best-effort */ }
      run();
    });
  } catch (e) {
    var root = $('root');
    clearNode(root);
    try {
      mountBanner(root, { tone: 'error', title: 'ModelSelect: ' + str((e && e.message) || e) });
    } catch (ignored) {
      root.append(text('ModelSelect: ' + str((e && e.message) || e)));
    }
  }
}

mount();
