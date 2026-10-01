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
 * Global modelselect config (solution 3: external file, user-editable):
 * - `~/.config/openchamber/modelselect.json` =
 *   `{ "mode": "on"|"off"|"auto" (default "auto"),
 *      "autoSmallModel": bool (default false),
 *      "autoWalkthroughModel": bool (default false),
 *      "smallModelTask": "small-model",
 *      "walkthroughModelTask": "review" }`
 *   Missing/unreadable/unparseable means all defaults. Unknown `mode`
 *   values mean `"auto"`.
 * - When `autoSmallModel` is true the sync also writes the resolved small
 *   task model into OpenChamber's `settings.json` (flat legacy copy) +
 *   `preferences.json` (profile `{ version: 1, fields }` shape) as
 *   `smallModelOverride` (+ `smallModelUseDefault: false`); when
 *   `autoWalkthroughModel` is true it writes `walkthroughModelOverride`
 *   (the Settings → Sessions → Changes Walkthrough Model row; the
 *   per-panel "Walkthrough model" picker defaults to the small model, so
 *   keeping the small override fresh covers it). Writes happen only on
 *   diff; all failures are silent so the view never breaks.
 *
 * Rules:
 * - Category + fallback models come from the plugin's model-config cache,
 *   picking the `go` or `free` side per the plugin `autoPreference`
 *   (`go-first` vs `free-first`, read from the modelselect plugin options
 *   in the managed/global OpenCode config; default `free-first`).
 * - Exception: while the free-tier soft-error latch is fresh
 *   (`free-quota.json`, 12h — written by the plugin on a real free-side
 *   exhaustion, see `shared/freequota.js`) the side is forced to `go`,
 *   whatever `autoPreference` says. Zen publishes no free-quota endpoint
 *   to pre-check, so the routing table follows the observed failure;
 *   once the latch expires the configured preference takes over again.
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
const MODELSELECT_CONFIG_PATH = '~/.config/openchamber/modelselect.json';
const SETTINGS_PATH = '~/.config/openchamber/settings.json';
const PREFERENCES_PATH = '~/.config/openchamber/preferences.json';
const GLOBAL_CONFIG_PATHS = [
  '~/.config/openchamber/opencode.managed.json',
  '~/.config/opencode/opencode.json',
  '~/.config/opencode/opencode.jsonc'
];
const MODEL_CACHE_FILE = '.opencode/.modelselect-cache/model-config-cache.json';
const TASK_TYPES_CACHE_FILE = '.opencode/.modelselect-cache/task-types-cache.json';
// Free-tier soft-error latch written by shared/freequota.js (node side).
const FREE_QUOTA_FILE = '.opencode/.modelselect-cache/free-quota.json';
// Default quota-exhaustion window; transient rate limiting is stored with
// its own shorter `until` by the writer.
const FREE_QUOTA_TTL_MS = 12 * 60 * 60 * 1000; // fresh for 12h from the first detection
const CATEGORY_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function isObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

// Free-tier soft-error latch freshness: `at` is the FIRST detection and
// `until` is the kind-specific deadline stored by the writer (spent quota
// uses 12h; transient rate limiting uses 1h). Fresh => the free side is
// known to be unavailable and every consumer must prefer `go`; after
// `until` the latch clears and the next real failure may register again.
// `now` is injectable for tests; defaults to Date.now() so the status
// bundle (browser) works unchanged.
function freeQuotaFresh(entry, now) {
  if (!isObject(entry)) return false;
  const at = Number(entry.at);
  const until = Number(entry.until);
  if (!Number.isFinite(at) || !Number.isFinite(until) || until <= at) return false;
  return until > (now === undefined ? Date.now() : now);
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

// Global modelselect config (`~/.config/openchamber/modelselect.json`,
// solution 3 external file). Missing/unusable -> all defaults; unknown
// `mode` -> `"auto"`. Accepts kebab-case aliases for the auto flags.
function normalizeModelselectConfig(raw) {
  const src = isObject(raw) ? raw : {};
  const m = String(src.mode ?? 'auto').toLowerCase().trim();
  const mode = m === 'on' || m === 'off' || m === 'auto' ? m : 'auto';
  const boolOf = (v) => v === true || String(v ?? '').toLowerCase().trim() === 'true';
  const autoSmallModel = boolOf(
    src.autoSmallModel ?? src['auto-small-model'] ?? src.autosetSmallModel ?? src['autoset-small-model'] ?? false,
  );
  const autoWalkthroughModel = boolOf(
    src.autoWalkthroughModel ??
      src['auto-walkthrough-model'] ??
      src.autosetWalkthroughModel ??
      src.autoChangesWalkthroughModel ??
      false,
  );
  const smallTask = String(src.smallModelTask ?? src['small-model-task'] ?? 'small-model')
    .toLowerCase()
    .trim();
  const walkTask = String(
    src.walkthroughModelTask ??
      src['walkthrough-model-task'] ??
      src.changesWalkthroughModelTask ??
      'review',
  )
    .toLowerCase()
    .trim();
  return {
    mode,
    autoSmallModel,
    autoWalkthroughModel,
    smallModelTask: smallTask || 'small-model',
    walkthroughModelTask: walkTask || 'review',
  };
}

// Pick the `provider/model` string for one task type under a preference,
// falling back to the other side when the preferred one is unconfigured.
// When `avoidFree` is true (fresh free-quota latch) a free `go` value is
// skipped in favour of the first paid model in `go_ranked`; null is
// returned when no paid alternative exists so callers preserve the stored
// value instead of writing a free model. Returns the `"provider/model"`
// string or null.
function pickSideRef(modelTable, taskName, preference, avoidFree = false) {
  const table = isObject(modelTable) ? modelTable : null;
  if (!table) return null;
  const want = String(taskName ?? '').toLowerCase().trim();
  if (!want) return null;
  const key = Object.keys(table).filter((k) => String(k).toLowerCase() === want)[0];
  const entry = key ? table[key] : null;
  if (!isObject(entry)) return null;
  if (avoidFree) {
    const paid = firstPaidModel(entry);
    if (paid) {
      const paidRef = splitModelRef(paid);
      if (paidRef) return `${paidRef.providerID}/${paidRef.modelID}`;
    }
    return null;
  }
  const side = preference === 'go-first' ? entry.go : entry.free;
  const ref = splitModelRef(side) || splitModelRef(entry.free) || splitModelRef(entry.go);
  if (!ref) return null;
  return `${ref.providerID}/${ref.modelID}`;
}

// Merge autoset values into a decoded OpenChamber `settings.json` (flat
// object). Returns the next object, or null when nothing changed. A
// missing/unusable stored doc means "no write" — the server owns that file.
function mergeSettingsOverrides(stored, updates) {
  if (!isObject(stored) || !isObject(updates)) return null;
  const keys = Object.keys(updates);
  if (!keys.length) return null;
  let changed = false;
  const next = {};
  for (const k in stored) next[k] = stored[k];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (next[k] !== updates[k]) {
      next[k] = updates[k];
      changed = true;
    }
  }
  return changed ? next : null;
}

// Merge autoset values into a decoded `preferences.json`
// (`{ version: 1, fields: { key: { value, updatedAt, surfaces? } } }`).
// Preserves every other field (including `surfaces`). Returns the next doc,
// or null when nothing changed. A missing doc is created with just our keys;
// an unusable (non-object) doc means "no write".
function mergePreferencesOverrides(stored, updates, now) {
  if (!isObject(updates) || !Object.keys(updates).length) return null;
  if (stored === null || stored === undefined) {
    const fields = {};
    const keys = Object.keys(updates);
    for (let i = 0; i < keys.length; i++) {
      fields[keys[i]] = { value: updates[keys[i]], updatedAt: now };
    }
    return { version: 1, fields };
  }
  if (!isObject(stored)) return null;
  const storedFields = isObject(stored.fields) ? stored.fields : {};
  let changed = false;
  const fields = {};
  for (const k in storedFields) fields[k] = storedFields[k];
  const keys = Object.keys(updates);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const cur = isObject(fields[k]) ? fields[k].value : undefined;
    if (cur !== updates[k]) {
      const nextEntry = { value: updates[k], updatedAt: now };
      if (isObject(fields[k]) && fields[k].surfaces !== undefined) nextEntry.surfaces = fields[k].surfaces;
      fields[k] = nextEntry;
      changed = true;
    }
  }
  if (!changed) return null;
  const next = {};
  for (const k in stored) next[k] = stored[k];
  next.fields = fields;
  if (next.version === undefined) next.version = 1;
  return next;
}

function splitModelRef(model) {
  const s = String(model == null ? '' : model).trim();
  const i = s.indexOf('/');
  if (i <= 0 || i === s.length - 1) return null;
  return { providerID: s.slice(0, i), modelID: s.slice(i + 1) };
}

// True when a `"provider/model"` string routes to the free tier: the
// `opencode` provider, a `-free` suffix on either provider (paid mirrors
// like `opencode-go/longcat-2.5-preview-free` share the free quota), or
// the suffix-less `big-pickle` free model.
function isFreeModelString(s) {
  const str = String(s ?? '').trim();
  if (!str) return false;
  if (/big-pickle$/i.test(str)) return true;
  const ref = splitModelRef(str);
  if (!ref) return /-free$/i.test(str);
  if (/-free$/i.test(ref.modelID)) return true;
  return String(ref.providerID).toLowerCase() === 'opencode';
}

// First paid model for an entry: `go` when it is not free, else the first
// non-free row of `go_ranked` (best-to-worst). Null when the entry has no
// paid alternative (e.g. `go == free` by the free-first policy with no
// ranked paid row). Used while the free-quota latch is fresh so a
// `go-first` failover never re-selects a free model.
function firstPaidModel(entry) {
  if (!isObject(entry)) return null;
  if (typeof entry.go === 'string' && entry.go.trim() && !isFreeModelString(entry.go)) {
    return entry.go.trim();
  }
  const ranked = Array.isArray(entry.go_ranked) ? entry.go_ranked : null;
  if (ranked) {
    for (const row of ranked) {
      const m = row && typeof row.model === 'string' ? row.model.trim() : '';
      if (m && !isFreeModelString(m)) return m;
    }
  }
  return null;
}

// Build the desired user categories from the task-type map
// ({ name: { label, jev_criteria, agent? } }) and the model-config table
// ({ name: { go, free } }). Returns { desired, ignored, unusable } where
// desired maps id -> { name, description, model?, agent? }, ignored lists
// the ids with an empty criteria, and `unusable` flags a payload that
// carries no criteria at all (pre-jev_criteria cache or a shape change):
// there the "everything else is stale" rule would wipe the whole list.
// When `avoidFree` is true (fresh free-quota latch) categories resolve to
// the first paid model; entries with no paid alternative omit `model` so
// the merge preserves the stored value instead of writing a free model.
function buildDesired(taskTypes, modelTable, preference, avoidFree = false) {
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
    let ref = null;
    if (avoidFree) {
      ref = splitModelRef(firstPaidModel(entry));
    } else {
      const side = preference === 'go-first' ? (entry && entry.go) : (entry && entry.free);
      // Fall back to the other side when the preferred one is unconfigured.
      ref = splitModelRef(side) || splitModelRef(entry && entry.free) || splitModelRef(entry && entry.go);
    }
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
// writes back only on diff. When the global modelselect config enables the
// autoset flags, the resolved small/walkthrough models are also merged into
// OpenChamber's settings.json + preferences.json (diff-only). Resolves
// { written, settingsWritten } and never rejects.
function syncRouting(io, opts) {
  if (!io || typeof io.readJson !== 'function' || typeof io.writeJson !== 'function') {
    return Promise.resolve({ written: false, settingsWritten: false });
  }
  const now = opts && Number.isFinite(opts.now) ? opts.now : Date.now();
  const chain = Promise.all([
    readFirst(io, GLOBAL_CONFIG_PATHS),
    readFirst(io, [MODEL_CACHE_FILE]),
    readFirst(io, [TASK_TYPES_CACHE_FILE]),
    readFirst(io, [ROUTING_PATH]),
    readFirst(io, [FREE_QUOTA_FILE]),
    readFirst(io, [MODELSELECT_CONFIG_PATH]),
    readFirst(io, [SETTINGS_PATH]),
    readFirst(io, [PREFERENCES_PATH])
  ]);
  return chain.then((parts) => {
    try {
      const managed = parts[0];
      const modelCache = parts[1];
      const ttCache = parts[2];
      const routing = parts[3];
      // Fresh free-tier soft-error latch: the free side is known
      // exhausted, so the table routes to paid models until the window
      // closes; expiry hands the choice back to the configured
      // preference (a later failure re-registers the latch). Paid means
      // the first non-free `go_ranked` row — `entry.go` itself is often
      // free by the free-first policy, which would otherwise re-select
      // the exhausted tier.
      const latchFresh = freeQuotaFresh(parts[4], now);
      const preference = latchFresh ? 'go-first' : autoPreferenceOf(findPluginOptions(managed));
      const avoidFree = latchFresh;
      const msConfig = normalizeModelselectConfig(parts[5]);
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
      if (!isObject(taskTypes) || !isObject(modelTable)) return { written: false, settingsWritten: false };
      const built = buildDesired(taskTypes, modelTable, preference, avoidFree);
      // A payload with no criteria anywhere is unrecognised (stale cache
      // written before jev_criteria existed): leave routing alone rather
      // than disable every stored category as stale.
      if (built.unusable) return { written: false, settingsWritten: false };
      // Also skip when the payload yields no category: with an empty
      // desired set every stored id looks stale, so a write could only
      // ever disable.
      if (!Object.keys(built.desired).length) return { written: false, settingsWritten: false };
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
      // Autoset: resolved task models follow the same preference/latch
      // into OpenChamber's Small Model + Changes Walkthrough rows.
      let settingsUpdates = null;
      if (msConfig.autoSmallModel || msConfig.autoWalkthroughModel) {
        settingsUpdates = {};
        if (msConfig.autoSmallModel) {
          const smallRef = pickSideRef(modelTable, msConfig.smallModelTask, preference, avoidFree);
          if (smallRef) {
            settingsUpdates.smallModelUseDefault = false;
            settingsUpdates.smallModelOverride = smallRef;
          }
        }
        if (msConfig.autoWalkthroughModel) {
          const walkRef = pickSideRef(modelTable, msConfig.walkthroughModelTask, preference, avoidFree);
          if (walkRef) settingsUpdates.walkthroughModelOverride = walkRef;
        }
        if (!Object.keys(settingsUpdates).length) settingsUpdates = null;
      }
      const routingDirty = nextCats !== null || nextFallback !== null;
      const writeRouting = routingDirty
        ? (function () {
            const next = {};
            for (const sk in stored) next[sk] = stored[sk];
            if (next.version === undefined) next.version = 1;
            if (nextCats !== null) next.categories = nextCats;
            if (nextFallback !== null) next.fallback = nextFallback;
            return Promise.resolve(io.writeJson(ROUTING_PATH, next)).then(
              () => true,
              () => false,
            );
          })()
        : Promise.resolve(false);
      const writeSettings = settingsUpdates
        ? (function () {
            const nextSettings = mergeSettingsOverrides(isObject(parts[6]) ? parts[6] : null, settingsUpdates);
            const nextPrefs = mergePreferencesOverrides(
              parts[7] === undefined ? null : parts[7],
              settingsUpdates,
              now,
            );
            const jobs = [];
            if (nextSettings !== null) {
              jobs.push(
                Promise.resolve(io.writeJson(SETTINGS_PATH, nextSettings)).then(
                  () => true,
                  () => false,
                ),
              );
            }
            if (nextPrefs !== null) {
              jobs.push(
                Promise.resolve(io.writeJson(PREFERENCES_PATH, nextPrefs)).then(
                  () => true,
                  () => false,
                ),
              );
            }
            if (!jobs.length) return Promise.resolve(false);
            return Promise.all(jobs).then((flags) => flags.some(Boolean));
          })()
        : Promise.resolve(false);
      return Promise.all([writeRouting, writeSettings]).then((flags) => ({
        written: flags[0],
        settingsWritten: flags[1],
      }));
    } catch (e) {
      return { written: false, settingsWritten: false };
    }
  }).then(
    (r) => r,
    () => ({ written: false, settingsWritten: false })
  );
}

module.exports = {
  ROUTING_PATH,
  MODELSELECT_CONFIG_PATH,
  SETTINGS_PATH,
  PREFERENCES_PATH,
  GLOBAL_CONFIG_PATHS,
  MODEL_CACHE_FILE,
  TASK_TYPES_CACHE_FILE,
  FREE_QUOTA_FILE,
  FREE_QUOTA_TTL_MS,
  freeQuotaFresh,
  parseJsonLenient,
  findPluginOptions,
  autoPreferenceOf,
  normalizeModelselectConfig,
  pickSideRef,
  mergeSettingsOverrides,
  mergePreferencesOverrides,
  splitModelRef,
  isFreeModelString,
  firstPaidModel,
  buildDesired,
  mergeCategories,
  stableStringify,
  syncRouting
};
