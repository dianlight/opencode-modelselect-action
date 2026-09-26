/* openchamber-modelselect — routing sync (ESM, bundled with the status view).
 *
 * Syncs OpenChamber's Jev routing categories (`~/.config/openchamber/
 * routing.json`, stored deviations shape) with the modelselect task types:
 * every task type with a non-empty `jev_criteria` becomes a user category
 * (`builtin: false`) whose description is the criteria verbatim — that text
 * is what Jev reads as the choice question. Task types with an empty
 * criteria are ignored (never created; an existing entry is disabled).
 *
 * - Category + fallback models come from the plugin's model-config cache,
 *   picking the `go` or `free` side per the plugin `autoPreference`
 *   (`go-first` vs `free-first`, read from the modelselect plugin options
 *   in the managed/global OpenCode config; default `free-first`).
 * - `agent` is set only when the task type defines one; otherwise the
 *   user's existing value is left alone (never cleared).
 * - Stale entries (stored ids that are not task types, or ignored ones)
 *   are disabled (`disabled: true`), never deleted. Built-in overrides
 *   keep `builtin: true`.
 * - Writes only when something changed. All failures are silent: sync is
 *   best-effort and must never break the status view.
 */

var ROUTING_PATH = '~/.config/openchamber/routing.json';
var MANAGED_CONFIG_PATH = '~/.config/openchamber/opencode.managed.json';
var GLOBAL_CONFIG_PATHS = [
  '~/.config/openchamber/opencode.managed.json',
  '~/.config/opencode/opencode.json',
  '~/.config/opencode/opencode.jsonc'
];
var MODEL_CACHE_FILE = '.opencode/.modelselect-cache/model-config-cache.json';
var TASK_TYPES_CACHE_FILE = '.opencode/.modelselect-cache/task-types-cache.json';
var CATEGORY_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function isObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

// Lenient JSON parse: plain JSON first, then a string-aware comment
// stripper for jsonc (// and /* */ outside strings).
function parseJsonLenient(text) {
  var raw = String(text == null ? '' : text);
  try {
    return JSON.parse(raw);
  } catch (firstErr) {
    var out = '';
    var inStr = false;
    var esc = false;
    var i = 0;
    while (i < raw.length) {
      var c = raw[i];
      if (inStr) {
        out += c;
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        i++;
        continue;
      }
      if (c === '"') {
        inStr = true;
        out += c;
        i++;
        continue;
      }
      if (c === '/' && raw[i + 1] === '/') {
        while (i < raw.length && raw[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && raw[i + 1] === '*') {
        i += 2;
        while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    return JSON.parse(out);
  }
}

function isModelselectEntry(name) {
  return /modelselect/i.test(String(name == null ? '' : name));
}

// Find the modelselect plugin options in a decoded OpenCode config.
// Supports v2 `plugins` (string | { package, options }) and v1 `plugin`
// (string | [name, options] tuples).
function findPluginOptions(config) {
  if (!isObject(config)) return {};
  var lists = [];
  if (Array.isArray(config.plugins)) lists.push(config.plugins);
  if (Array.isArray(config.plugin)) lists.push(config.plugin);
  for (var li = 0; li < lists.length; li++) {
    var list = lists[li];
    for (var ei = 0; ei < list.length; ei++) {
      var entry = list[ei];
      if (typeof entry === 'string') {
        if (isModelselectEntry(entry)) return {};
        continue;
      }
      if (Array.isArray(entry)) {
        if (entry.length >= 1 && isModelselectEntry(entry[0])) {
          return isObject(entry[1]) ? entry[1] : {};
        }
        continue;
      }
      if (isObject(entry)) {
        var pkg = entry.package || entry.name || entry.module || entry.id;
        if (pkg && isModelselectEntry(pkg)) {
          return isObject(entry.options) || isObject(entry.opts) ?
            (entry.options || entry.opts) : {};
        }
      }
    }
  }
  return {};
}

function autoPreferenceOf(options) {
  var p = String(
    (options && (options.autoPreference || options['auto-preference'])) || 'free-first'
  ).toLowerCase().trim();
  return p === 'go-first' ? 'go-first' : 'free-first';
}

function splitModelRef(model) {
  var s = String(model == null ? '' : model).trim();
  var i = s.indexOf('/');
  if (i <= 0 || i === s.length - 1) return null;
  return { providerID: s.slice(0, i), modelID: s.slice(i + 1) };
}

// Build the desired user categories from the task-type map
// ({ name: { label, jev_criteria, agent? } }) and the model-config table
// ({ name: { go, free } }). Returns { desired, ignored } where desired maps
// id -> { name, description, model?, agent? } and ignored lists the ids
// with an empty criteria.
function buildDesired(taskTypes, modelTable, preference) {
  var desired = {};
  var ignored = [];
  var names = Object.keys(taskTypes || {});
  for (var ni = 0; ni < names.length; ni++) {
    var id = String(names[ni]).toLowerCase().trim();
    if (!CATEGORY_ID_RE.test(id)) continue;
    var meta = taskTypes[names[ni]] || {};
    var crit = String(meta.jev_criteria || meta.jevCriteria || '').trim();
    if (!crit) {
      ignored.push(id);
      continue;
    }
    var cat = {
      name: String(meta.label || id),
      description: crit
    };
    var tableKey = Object.keys(modelTable || {}).filter(function (k) {
      return String(k).toLowerCase() === id;
    })[0];
    var entry = tableKey ? modelTable[tableKey] : null;
    var side = preference === 'go-first' ? (entry && entry.go) : (entry && entry.free);
    // Fall back to the other side when the preferred one is unconfigured.
    var ref = splitModelRef(side) || splitModelRef(entry && entry.free) || splitModelRef(entry && entry.go);
    if (ref) cat.model = ref;
    var agent = String(meta.agent || '').trim();
    if (agent) cat.agent = agent;
    desired[id] = cat;
  }
  return { desired: desired, ignored: ignored };
}

function stableStringify(v) {
  if (Array.isArray(v)) {
    return '[' + v.map(stableStringify).join(',') + ']';
  }
  if (isObject(v)) {
    var keys = Object.keys(v).sort();
    return '{' + keys.map(function (k) {
      return JSON.stringify(k) + ':' + stableStringify(v[k]);
    }).join(',') + '}';
  }
  return JSON.stringify(v);
}

// Merge desired categories into the stored deviations shape. Returns the
// next `categories` record, or null when nothing changed.
function mergeCategories(storedCats, desired, ignored) {
  var stored = isObject(storedCats) ? storedCats : {};
  var next = {};
  var changed = false;
  var desiredIds = Object.keys(desired);
  var di;
  for (di = 0; di < desiredIds.length; di++) {
    var id = desiredIds[di];
    var want = desired[id];
    var cur = stored[id];
    var cat;
    if (isObject(cur) && cur.builtin === true) {
      cat = { builtin: true };
      if (cur.name !== undefined && cur.name !== want.name) cat.name = want.name;
      else if (cur.name !== undefined) cat.name = cur.name;
      else cat.name = want.name;
      if (cur.description !== undefined && cur.description !== want.description) {
        cat.description = want.description;
      } else if (cur.description !== undefined) cat.description = cur.description;
      else cat.description = want.description;
      cat.model = want.model || cur.model || null;
      if (!cat.model) delete cat.model;
      if (want.agent) cat.agent = want.agent;
      else if (cur.agent !== undefined) cat.agent = cur.agent;
      if (cur.variant !== undefined) cat.variant = cur.variant;
      if (cur.deleted !== undefined) cat.deleted = cur.deleted;
      // Desired categories are enabled: drop the disabled flag.
    } else {
      cat = { builtin: false, name: want.name, description: want.description };
      cat.model = want.model || (isObject(cur) && cur.model) || null;
      if (!cat.model) delete cat.model;
      if (want.agent) cat.agent = want.agent;
      else if (isObject(cur) && cur.agent !== undefined) cat.agent = cur.agent;
      if (isObject(cur) && cur.variant !== undefined) cat.variant = cur.variant;
    }
    next[id] = cat;
  }
  // Stale + ignored entries: disable, never delete.
  var storedIds = Object.keys(stored);
  for (var si = 0; si < storedIds.length; si++) {
    var sid = storedIds[si];
    if (next[sid] !== undefined) continue;
    var curStale = stored[sid];
    if (!isObject(curStale)) continue;
    var disabled = {};
    var k;
    for (k in curStale) disabled[k] = curStale[k];
    disabled.disabled = true;
    if (disabled.builtin !== true && disabled.builtin !== false) disabled.builtin = false;
    next[sid] = disabled;
  }
  // Explicitly ignored task types that already exist: disable as well
  // (covered above as stale, since they are not in desired).
  changed = stableStringify(next) !== stableStringify(stored);
  void ignored;
  return changed ? next : null;
}

function readHostJson(host, relPath) {
  var p;
  try {
    p = host.readFile(relPath);
  } catch (e) {
    return Promise.resolve(null);
  }
  return Promise.resolve(p).then(
    function (res) {
      try {
        return parseJsonLenient(res && res.content);
      } catch (e) {
        return null;
      }
    },
    function () { return null; }
  );
}

function readFirstHostJson(host, paths) {
  var chain = Promise.resolve(null);
  paths.forEach(function (p) {
    chain = chain.then(function (found) {
      if (found) return found;
      return readHostJson(host, p);
    });
  });
  return chain;
}

// Best-effort sync: reads caches + routing.json, writes back only on diff.
// Resolves { written: boolean } and never rejects.
function syncRouting(host) {
  if (!host || typeof host.readFile !== 'function') return Promise.resolve({ written: false });
  return Promise.all([
    readFirstHostJson(host, GLOBAL_CONFIG_PATHS),
    readHostJson(host, MODEL_CACHE_FILE),
    readHostJson(host, TASK_TYPES_CACHE_FILE),
    readHostJson(host, ROUTING_PATH)
  ]).then(function (parts) {
    var managed = parts[0];
    var modelCache = parts[1];
    var ttCache = parts[2];
    var routing = parts[3];
    var preference = autoPreferenceOf(findPluginOptions(managed));
    var modelTable = null;
    if (modelCache && isObject(modelCache.config)) {
      modelTable = modelCache.config['task-types'] || modelCache.config.task_types || null;
    }
    var taskTypes = null;
    if (ttCache) {
      if (isObject(ttCache.taskTypes)) taskTypes = ttCache.taskTypes;
      else if (isObject(ttCache['task-types'])) taskTypes = ttCache['task-types'];
      else if (isObject(ttCache)) {
        // Tolerate a bare map (tests): treat as the map when it looks like
        // one (values with jev_criteria/label keys).
        taskTypes = ttCache;
      }
    }
    if (!isObject(taskTypes) || !isObject(modelTable)) return { written: false };
    var built = buildDesired(taskTypes, modelTable, preference);
    if (!Object.keys(built.desired).length && !built.ignored.length) return { written: false };
    var stored = isObject(routing) ? routing : {};
    var nextCats = mergeCategories(stored.categories, built.desired, built.ignored);
    // Fallback follows `generic` under the same preference.
    var generic = built.desired.generic;
    var nextFallback = null;
    if (generic && generic.model) {
      var curFb = isObject(stored.fallback) ? stored.fallback : null;
      var wantFb = { model: generic.model };
      if (curFb && curFb.variant !== undefined) wantFb.variant = curFb.variant;
      if (stableStringify(wantFb) !== stableStringify(curFb)) nextFallback = wantFb;
    }
    if (nextCats === null && nextFallback === null) return { written: false };
    var next = {};
    var sk;
    for (sk in stored) next[sk] = stored[sk];
    if (next.version === undefined) next.version = 1;
    if (nextCats !== null) next.categories = nextCats;
    if (nextFallback !== null) next.fallback = nextFallback;
    return Promise.resolve(host.writeFile(ROUTING_PATH, JSON.stringify(next, null, 2))).then(
      function () { return { written: true }; },
      function () { return { written: false }; }
    );
  }).then(
    function (r) { return r; },
    function () { return { written: false }; }
  );
}

export { syncRouting, buildDesired, mergeCategories, findPluginOptions, autoPreferenceOf, splitModelRef, parseJsonLenient, ROUTING_PATH };
