'use strict';

/**
 * OpenChamber Jev routing sync — shared core (pure, dependency-free).
 *
 * Keeps `~/.config/openchamber/routing.json` (stored-deviations shape) in
 * sync with the modelselect task types: every task type with a non-empty
 * `jev_criteria` becomes a user category (`builtin: false`) whose
 * description is the criteria verbatim — that text is what Jev reads as
 * the choice question. Task types with an empty criteria are ignored
 * (never created; an existing entry is disabled).
 *
 * Consumers (both inject an IO adapter, no built-ins required here):
 * - plugin (src/v2.js): `shared/routing-io.js` — plain fs, `~` resolved
 *   against the user home; sync runs per turn before the mode check.
 * - Work Status bundle (openchamber-modelselect/status/src/routing-sync.js)
 *   — host `readFile`/`writeFile` adapter, sync runs on every refresh.
 *
 * Rules:
 * - Category + fallback models come from the plugin's model-config cache,
 *   picking the `go` or `free` side per the plugin `autoPreference`
 *   (`go-first` vs `free-first`, read from the modelselect plugin options
 *   in the managed/global OpenCode config; default `free-first`).
 * - `agent` is set only when the task type defines one; otherwise the
 *   user's existing value is left alone (never cleared).
 * - Stale entries (stored ids that are not task types, or ignored ones)
 *   are disabled (`disabled: true`), never deleted. Built-in overrides
 *   keep `builtin: true`.
 * - Never writes from an unusable payload: a cache written before
 *   `jev_criteria` existed (or a payload where no type carries one) marks
 *   every stored entry stale, which would disable the whole category list.
 *   Such a payload is skipped entirely — routing is left untouched until
 *   the plugin refreshes its cache.
 * - Writes only when something changed. All failures are swallowed: sync
 *   is best-effort and must never break a turn or the status view.
 *
 * IO adapter contract (both methods never reject for reads):
 * - `readJson(logicalPath)` -> Promise<value|null>
 * - `writeJson(logicalPath, value)` -> Promise<void>
 * Paths are logical (`~/...` for global files, project-relative for the
 * plugin caches); the adapter resolves them.
 */

const ROUTING_PATH = '~/.config/openchamber/routing.json';
const GLOBAL_CONFIG_PATHS = [
  '~/.config/openchamber/opencode.managed.json',
  '~/.config/opencode/opencode.json',
  '~/.config/opencode/opencode.jsonc'
];
const MODEL_CACHE_FILE = '.opencode/.modelselect-cache/model-config-cache.json';
const TASK_TYPES_CACHE_FILE = '.opencode/.modelselect-cache/task-types-cache.json';
const CATEGORY_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function isObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

// Lenient JSON parse: plain JSON first, then a string-aware comment
// stripper for jsonc (// and /* */ outside strings).
function parseJsonLenient(text) {
  const raw = String(text == null ? '' : text);
  try {
    return JSON.parse(raw);
  } catch (firstErr) {
    let out = '';
    let inStr = false;
    let esc = false;
    let i = 0;
    while (i < raw.length) {
      const c = raw[i];
      if (esc) {
        out += c;
        esc = false;
        i++;
        continue;
      }
      if (c === '\\') {
        out += c;
        esc = true;
        i++;
        continue;
      }
      if (c === '"') {
        inStr = !inStr;
        out += c;
        i++;
        continue;
      }
      if (!inStr && c === '/' && raw[i + 1] === '/') {
        while (i < raw.length && raw[i] !== '\n') i++;
        continue;
      }
      if (!inStr && c === '/' && raw[i + 1] === '*') {
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
  const lists = [];
  if (Array.isArray(config.plugins)) lists.push(config.plugins);
  if (Array.isArray(config.plugin)) lists.push(config.plugin);
  for (let li = 0; li < lists.length; li++) {
    const list = lists[li];
    for (let ei = 0; ei < list.length; ei++) {
      const entry = list[ei];
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
        const pkg = entry.package || entry.name || entry.module || entry.id;
        if (pkg && isModelselectEntry(pkg)) {
          return isObject(entry.options) || isObject(entry.opts)
            ? (entry.options || entry.opts)
            : {};
        }
      }
    }
  }
  return {};
}

function autoPreferenceOf(options) {
  const p = String(
    (options && (options.autoPreference || options['auto-preference'])) || 'free-first'
  ).toLowerCase().trim();
  return p === 'go-first' ? 'go-first' : 'free-first';
}

function splitModelRef(model) {
  const s = String(model == null ? '' : model).trim();
  const i = s.indexOf('/');
  if (i <= 0 || i === s.length - 1) return null;
  return { providerID: s.slice(0, i), modelID: s.slice(i + 1) };
}

// Build the desired user categories from the task-type map
// ({ name: { label, jev_criteria, agent? } }) and the model-config table
// ({ name: { go, free } }). Returns { desired, ignored, unusable } where
// desired maps id -> { name, description, model?, agent? }, ignored lists
// the ids with an empty criteria, and `unusable` flags a payload that
// carries no criteria at all (pre-jev_criteria cache or a shape change):
// there the "everything else is stale" rule would wipe the whole list.
function buildDesired(taskTypes, modelTable, preference) {
  const desired = {};
  const ignored = [];
  let withCriteria = 0;
  const names = Object.keys(taskTypes || {});
  for (let ni = 0; ni < names.length; ni++) {
    const id = String(names[ni]).toLowerCase().trim();
    if (!CATEGORY_ID_RE.test(id)) continue;
    const meta = taskTypes[names[ni]] || {};
    const crit = String(meta.jev_criteria || meta.jevCriteria || '').trim();
    if (!crit) {
      ignored.push(id);
      continue;
    }
    withCriteria++;
    const cat = {
      name: String(meta.label || id),
      description: crit
    };
    const tableKey = Object.keys(modelTable || {}).filter(
      (k) => String(k).toLowerCase() === id
    )[0];
    const entry = tableKey ? modelTable[tableKey] : null;
    const side = preference === 'go-first' ? (entry && entry.go) : (entry && entry.free);
    // Fall back to the other side when the preferred one is unconfigured.
    const ref = splitModelRef(side) || splitModelRef(entry && entry.free) || splitModelRef(entry && entry.go);
    if (ref) cat.model = ref;
    const agent = String(meta.agent || '').trim();
    if (agent) cat.agent = agent;
    desired[id] = cat;
  }
  return { desired, ignored, unusable: withCriteria === 0 };
}

function stableStringify(v) {
  if (Array.isArray(v)) {
    return '[' + v.map(stableStringify).join(',') + ']';
  }
  if (isObject(v)) {
    const keys = Object.keys(v).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

// Merge desired categories into the stored deviations shape. Returns the
// next `categories` record, or null when nothing changed.
function mergeCategories(storedCats, desired, ignored) {
  const stored = isObject(storedCats) ? storedCats : {};
  const next = {};
  let changed = false;
  const desiredIds = Object.keys(desired);
  for (let di = 0; di < desiredIds.length; di++) {
    const id = desiredIds[di];
    const want = desired[id];
    const cur = stored[id];
    let cat;
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
  const storedIds = Object.keys(stored);
  for (let si = 0; si < storedIds.length; si++) {
    const sid = storedIds[si];
    if (next[sid] !== undefined) continue;
    const curStale = stored[sid];
    if (!isObject(curStale)) continue;
    const disabled = {};
    for (const k in curStale) disabled[k] = curStale[k];
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

// First readable entry wins (config search order); null when none is.
function readFirst(io, paths) {
  return paths
    .reduce(
      (prev, p) =>
        prev.then((acc) => {
          if (acc !== null) return acc;
          return Promise.resolve(io.readJson(p)).then(
            (v) => (v === undefined || v === null ? null : v),
            () => null
          );
        }),
      Promise.resolve(null)
    );
}

// Best-effort sync: reads caches + routing.json through the IO adapter,
// writes back only on diff. Resolves { written: boolean } and never rejects.
function syncRouting(io) {
  if (!io || typeof io.readJson !== 'function' || typeof io.writeJson !== 'function') {
    return Promise.resolve({ written: false });
  }
  const chain = Promise.all([
    readFirst(io, GLOBAL_CONFIG_PATHS),
    readFirst(io, [MODEL_CACHE_FILE]),
    readFirst(io, [TASK_TYPES_CACHE_FILE]),
    readFirst(io, [ROUTING_PATH])
  ]);
  return chain.then((parts) => {
    try {
      const managed = parts[0];
      const modelCache = parts[1];
      const ttCache = parts[2];
      const routing = parts[3];
      const preference = autoPreferenceOf(findPluginOptions(managed));
      let modelTable = null;
      if (modelCache && isObject(modelCache.config)) {
        modelTable = modelCache.config['task-types'] || modelCache.config.task_types || null;
      }
      let taskTypes = null;
      if (ttCache) {
        if (isObject(ttCache.taskTypes)) taskTypes = ttCache.taskTypes;
        else if (isObject(ttCache['task-types'])) taskTypes = ttCache['task-types'];
        else if (isObject(ttCache)) {
          // Tolerate a bare map (tests): treat as the map when it looks
          // like one (values with jev_criteria/label keys).
          taskTypes = ttCache;
        }
      }
      if (!isObject(taskTypes) || !isObject(modelTable)) return { written: false };
      const built = buildDesired(taskTypes, modelTable, preference);
      // A payload with no criteria anywhere is unrecognised (stale cache
      // written before jev_criteria existed): leave routing alone rather
      // than disable every stored category as stale.
      if (built.unusable) return { written: false };
      // Also skip when the payload yields no category: with an empty
      // desired set every stored id looks stale, so a write could only
      // ever disable.
      if (!Object.keys(built.desired).length) return { written: false };
      const stored = isObject(routing) ? routing : {};
      const nextCats = mergeCategories(stored.categories, built.desired, built.ignored);
      // Fallback follows `generic` under the same preference.
      const generic = built.desired.generic;
      let nextFallback = null;
      if (generic && generic.model) {
        const curFb = isObject(stored.fallback) ? stored.fallback : null;
        const wantFb = { model: generic.model };
        if (curFb && curFb.variant !== undefined) wantFb.variant = curFb.variant;
        if (stableStringify(wantFb) !== stableStringify(curFb)) nextFallback = wantFb;
      }
      if (nextCats === null && nextFallback === null) return { written: false };
      const next = {};
      for (const sk in stored) next[sk] = stored[sk];
      if (next.version === undefined) next.version = 1;
      if (nextCats !== null) next.categories = nextCats;
      if (nextFallback !== null) next.fallback = nextFallback;
      return Promise.resolve(io.writeJson(ROUTING_PATH, next)).then(
        () => ({ written: true }),
        () => ({ written: false })
      );
    } catch (e) {
      return { written: false };
    }
  }).then(
    (r) => r,
    () => ({ written: false })
  );
}

module.exports = {
  ROUTING_PATH,
  GLOBAL_CONFIG_PATHS,
  MODEL_CACHE_FILE,
  TASK_TYPES_CACHE_FILE,
  parseJsonLenient,
  findPluginOptions,
  autoPreferenceOf,
  splitModelRef,
  buildDesired,
  mergeCategories,
  stableStringify,
  syncRouting
};
