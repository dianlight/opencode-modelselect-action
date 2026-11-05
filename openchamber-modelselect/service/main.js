var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  if (mod && typeof mod === "object" || typeof mod === "function") {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(to, key))
        __defProp(to, key, {
          get: __accessProp.bind(mod, key),
          enumerable: true
        });
  }
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// ../core/model-ref.js
var require_model_ref = __commonJS(function(exports, module) {
  function isObject(v) {
    return Boolean(v) && typeof v === "object" && !Array.isArray(v);
  }
  function normModelName(value) {
    const s = String(value ?? "").trim();
    const i = s.lastIndexOf("/");
    return (i >= 0 ? s.slice(i + 1) : s).toLowerCase();
  }
  function splitModelRef(model) {
    const s = String(model == null ? "" : model).trim();
    const i = s.indexOf("/");
    if (i <= 0 || i === s.length - 1)
      return null;
    return { providerID: s.slice(0, i), modelID: s.slice(i + 1) };
  }
  function splitModelRefStrict(model) {
    const s = String(model ?? "").trim();
    const i = s.indexOf("/");
    if (i <= 0 || i === s.length - 1)
      throw new Error(`Invalid model ref '${s}' (want provider/model).`);
    return { providerID: s.slice(0, i), id: s.slice(i + 1) };
  }
  function isFreeModelString(s) {
    const str = String(s ?? "").trim();
    if (!str)
      return false;
    if (/big-pickle$/i.test(str))
      return true;
    const ref = splitModelRef(str);
    if (!ref)
      return /-free$/i.test(str);
    if (/-free$/i.test(ref.modelID))
      return true;
    return String(ref.providerID).toLowerCase() === "opencode";
  }
  function firstPaidModel(entry) {
    if (!isObject(entry))
      return null;
    if (typeof entry.go === "string" && entry.go.trim() && !isFreeModelString(entry.go)) {
      return entry.go.trim();
    }
    const ranked = Array.isArray(entry.go_ranked) ? entry.go_ranked : null;
    if (ranked) {
      for (const row of ranked) {
        const m = row && typeof row.model === "string" ? row.model.trim() : "";
        if (m && !isFreeModelString(m))
          return m;
      }
    }
    return null;
  }
  module.exports = {
    normModelName,
    splitModelRef,
    splitModelRefStrict,
    isFreeModelString,
    firstPaidModel
  };
});

// ../core/free-quota.js
var require_free_quota = __commonJS(function(exports, module) {
  function isObject(v) {
    return Boolean(v) && typeof v === "object" && !Array.isArray(v);
  }
  var FREE_QUOTA_TTL_MS = 12 * 60 * 60 * 1000;
  var FREE_RATE_LIMIT_TTL_MS = 60 * 60 * 1000;
  var EXHAUST_BODY_RE = /rate\s*limit|too many requests|quota|exhaust|out of (?:credits|quota|capacity)|daily\s*limit|usage\s*limit|upstream (?:provider|error)/i;
  var RATE_LIMIT_MESSAGE_RE = /rate\s*limit\s*exceeded\.?\s*please\s+try\s+again\s+later\.?/i;
  var RATE_LIMIT_BODY_RE = /rate\s*limit|too many requests/i;
  var UNAVAILABLE_MODEL_RE = /model\s+is\s+unavailable/i;
  var DEPRECATED_MODEL_RE = /has\s+been\s+deprecated|is\s+deprecated|model\s+has\s+been\s+(removed|retired|discontinued)|no\s+longer\s+(available|supported)/i;
  var PROTOCOL_MISMATCH_RE = /model\s+does\s+not\s+support\s+this\s+protocol|modelprotocolunsupported|provider request failed with http 404|no such model|model .* does not exist/i;
  var BARE_404_RE = /(^|\D)404(\D|$)/;
  var ROUTE_CONTEXT_RE = /model|provider|endpoint|protocol|route|no such/i;
  function mismatchHaystack(error, bodyText) {
    const parts = [];
    const seen = new Set;
    function push(v, depth) {
      if (v === undefined || v === null || depth > 4)
        return;
      if (typeof v === "string") {
        parts.push(v);
        return;
      }
      if (typeof v === "number") {
        parts.push(String(v));
        return;
      }
      if (typeof v !== "object")
        return;
      if (seen.has(v))
        return;
      seen.add(v);
      for (const k of [
        "type",
        "code",
        "message",
        "error",
        "data",
        "cause",
        "details",
        "detail",
        "response",
        "body",
        "text"
      ]) {
        if (v[k] !== undefined)
          push(v[k], depth + 1);
      }
      if (depth === 0) {
        try {
          parts.push(JSON.stringify(v));
        } catch {}
      }
    }
    push(error, 0);
    if (bodyText !== undefined && bodyText !== null)
      parts.push(String(bodyText));
    return parts.join(" ");
  }
  function isProtocolMismatch(error, bodyText) {
    try {
      if (typeof error === "string") {
        const text = bodyText === undefined ? error : `${error} ${bodyText ?? ""}`;
        if (PROTOCOL_MISMATCH_RE.test(text))
          return true;
        return BARE_404_RE.test(text) && ROUTE_CONTEXT_RE.test(text);
      }
      if (!error || typeof error !== "object") {
        const text = String(bodyText ?? "");
        if (PROTOCOL_MISMATCH_RE.test(text))
          return true;
        return BARE_404_RE.test(text) && ROUTE_CONTEXT_RE.test(text);
      }
      const hay = mismatchHaystack(error, bodyText);
      if (PROTOCOL_MISMATCH_RE.test(hay))
        return true;
      return BARE_404_RE.test(hay) && ROUTE_CONTEXT_RE.test(hay);
    } catch {
      return false;
    }
  }
  function classifyFreeExhaustion(status, bodyText) {
    const s = Number(status);
    const text = String(bodyText ?? "");
    const failure = !Number.isFinite(s) || s <= 0 || s >= 400;
    if (!failure)
      return false;
    if (RATE_LIMIT_MESSAGE_RE.test(text))
      return true;
    if (UNAVAILABLE_MODEL_RE.test(text))
      return true;
    if (DEPRECATED_MODEL_RE.test(text))
      return true;
    if (!Number.isFinite(s) || s <= 0)
      return EXHAUST_BODY_RE.test(text);
    if (s === 401)
      return false;
    if (s === 402 || s === 429)
      return true;
    if (s < 500)
      return EXHAUST_BODY_RE.test(text);
    if (s === 503 || s === 529)
      return EXHAUST_BODY_RE.test(text);
    return false;
  }
  function isRateLimitSignal(status, bodyText) {
    const s = Number(status);
    const text = String(bodyText ?? "");
    if (!Number.isFinite(s) || s <= 0) {
      return RATE_LIMIT_BODY_RE.test(text) || RATE_LIMIT_MESSAGE_RE.test(text);
    }
    if (s < 400)
      return false;
    return s === 429 || RATE_LIMIT_BODY_RE.test(text) || RATE_LIMIT_MESSAGE_RE.test(text);
  }
  function classifyFreeFailure(status, bodyText) {
    const exhausted = classifyFreeExhaustion(status, bodyText);
    if (!exhausted)
      return { exhausted: false, rateLimited: false };
    return { exhausted: true, rateLimited: isRateLimitSignal(status, bodyText) };
  }
  function freeQuotaFresh(entry, now) {
    if (!isObject(entry))
      return false;
    const at = Number(entry.at);
    const until = Number(entry.until);
    if (!Number.isFinite(at) || !Number.isFinite(until) || until <= at)
      return false;
    return until > (now === undefined ? Date.now() : now);
  }
  function latchEntries(raw) {
    if (!isObject(raw))
      return [];
    const out = [];
    if (isObject(raw.models)) {
      const keys = Object.keys(raw.models);
      for (let i = 0;i < keys.length; i++) {
        const key = String(keys[i]).trim();
        const e = raw.models[keys[i]];
        if (!key || !isObject(e))
          continue;
        out.push({
          key,
          model: key === "*" ? null : key,
          at: e.at,
          until: e.until,
          kind: e.kind,
          detail: e.detail,
          updatedAt: e.updatedAt
        });
      }
      return out;
    }
    if (raw.at !== undefined || raw.until !== undefined) {
      const model = typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : "*";
      out.push({
        key: model,
        model: model === "*" ? null : model,
        at: raw.at,
        until: raw.until,
        kind: raw.kind,
        detail: raw.detail,
        updatedAt: raw.updatedAt
      });
    }
    return out;
  }
  function latchKeyApplies(key, model) {
    const k = String(key ?? "").trim();
    const s = String(model ?? "").trim();
    if (!k || !s)
      return false;
    if (k === "*")
      return true;
    return k === s || k.endsWith("/" + s) || s.endsWith("/" + k);
  }
  function latchPredicate(freshEntries) {
    const list = Array.isArray(freshEntries) ? freshEntries : [];
    return (model) => {
      for (let i = 0;i < list.length; i++) {
        if (latchKeyApplies(list[i].key, model))
          return true;
      }
      return false;
    };
  }
  function isFreeModelRef(ref, modelTable) {
    if (!ref || typeof ref !== "object")
      return false;
    const providerID = String(ref.providerID ?? "");
    const id = String(ref.id ?? ref.modelID ?? "");
    if (!id)
      return false;
    const key = providerID ? `${providerID}/${id}` : id;
    const hit = (v) => {
      const s = String(v ?? "").trim();
      return s === key || s === id;
    };
    if (modelTable && typeof modelTable === "object") {
      const entries = Object.values(modelTable).filter((e) => e && typeof e === "object");
      if (entries.some((e) => hit(e.free)))
        return true;
      if (entries.some((e) => hit(e.go)))
        return false;
    }
    return /-free$/i.test(id);
  }
  module.exports = {
    FREE_QUOTA_TTL_MS,
    FREE_RATE_LIMIT_TTL_MS,
    EXHAUST_BODY_RE,
    RATE_LIMIT_BODY_RE,
    RATE_LIMIT_MESSAGE_RE,
    UNAVAILABLE_MODEL_RE,
    DEPRECATED_MODEL_RE,
    PROTOCOL_MISMATCH_RE,
    mismatchHaystack,
    isProtocolMismatch,
    classifyFreeExhaustion,
    classifyFreeFailure,
    isRateLimitSignal,
    isFreeModelRef,
    freeQuotaFresh,
    latchEntries,
    latchKeyApplies,
    latchPredicate
  };
});

// ../core/routing.js
var require_routing = __commonJS(function(exports, module) {
  var { splitModelRef, isFreeModelString, firstPaidModel } = require_model_ref();
  var {
    FREE_QUOTA_TTL_MS,
    freeQuotaFresh,
    latchEntries,
    latchKeyApplies,
    latchPredicate
  } = require_free_quota();
  var ROUTING_PATH = "~/.config/openchamber/routing.json";
  var MODELSELECT_CONFIG_PATH = "~/.config/openchamber/modelselect.json";
  var SETTINGS_PATH = "~/.config/openchamber/settings.json";
  var PREFERENCES_PATH = "~/.config/openchamber/preferences.json";
  var GLOBAL_CONFIG_PATHS = [
    "~/.config/openchamber/opencode.managed.json",
    "~/.config/opencode/opencode.json",
    "~/.config/opencode/opencode.jsonc"
  ];
  var MODEL_CACHE_FILE = ".opencode/.modelselect-cache/model-config-cache.json";
  var TASK_TYPES_CACHE_FILE = ".opencode/.modelselect-cache/task-types-cache.json";
  var FREE_QUOTA_FILE = ".opencode/.modelselect-cache/free-quota.json";
  var CATEGORY_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
  function isObject(v) {
    return Boolean(v) && typeof v === "object" && !Array.isArray(v);
  }
  function parseJsonLenient(text) {
    const raw = String(text == null ? "" : text);
    try {
      return JSON.parse(raw);
    } catch (firstErr) {
      let out = "";
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
        if (c === "\\") {
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
        if (!inStr && c === "/" && raw[i + 1] === "/") {
          while (i < raw.length && raw[i] !== `
`)
            i++;
          continue;
        }
        if (!inStr && c === "/" && raw[i + 1] === "*") {
          i += 2;
          while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/"))
            i++;
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
    return /modelselect/i.test(String(name == null ? "" : name));
  }
  function findPluginOptions(config) {
    if (!isObject(config))
      return {};
    const lists = [];
    if (Array.isArray(config.plugins))
      lists.push(config.plugins);
    if (Array.isArray(config.plugin))
      lists.push(config.plugin);
    for (let li = 0;li < lists.length; li++) {
      const list = lists[li];
      for (let ei = 0;ei < list.length; ei++) {
        const entry = list[ei];
        if (typeof entry === "string") {
          if (isModelselectEntry(entry))
            return {};
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
            return isObject(entry.options) || isObject(entry.opts) ? entry.options || entry.opts : {};
          }
        }
      }
    }
    return {};
  }
  function autoPreferenceOf(options) {
    const p = String(options && (options.autoPreference || options["auto-preference"]) || "free-first").toLowerCase().trim();
    return p === "go-first" ? "go-first" : "free-first";
  }
  function normalizeModelselectConfig(raw) {
    const src = isObject(raw) ? raw : {};
    const boolOf = (v) => v === true || String(v ?? "").toLowerCase().trim() === "true";
    const autoSmallModel = boolOf(src.autoSmallModel ?? src["auto-small-model"] ?? src.autosetSmallModel ?? src["autoset-small-model"] ?? false);
    const autoWalkthroughModel = boolOf(src.autoWalkthroughModel ?? src["auto-walkthrough-model"] ?? src.autosetWalkthroughModel ?? src.autoChangesWalkthroughModel ?? false);
    const smallTask = String(src.smallModelTask ?? src["small-model-task"] ?? "small-model").toLowerCase().trim();
    const walkTask = String(src.walkthroughModelTask ?? src["walkthrough-model-task"] ?? src.changesWalkthroughModelTask ?? "review").toLowerCase().trim();
    return {
      autoSmallModel,
      autoWalkthroughModel,
      smallModelTask: smallTask || "small-model",
      walkthroughModelTask: walkTask || "review"
    };
  }
  function entryAvoided(avoidFree, entry) {
    if (typeof avoidFree === "function") {
      const free = isObject(entry) ? entry.free : null;
      const go = isObject(entry) ? entry.go : null;
      if (avoidFree(free))
        return true;
      return Boolean(isFreeModelString(go)) && Boolean(avoidFree(go));
    }
    return Boolean(avoidFree);
  }
  function pickSideRef(modelTable, taskName, preference, avoidFree = false) {
    const table = isObject(modelTable) ? modelTable : null;
    if (!table)
      return null;
    const want = String(taskName ?? "").toLowerCase().trim();
    if (!want)
      return null;
    const key = Object.keys(table).filter((k) => String(k).toLowerCase() === want)[0];
    const entry = key ? table[key] : null;
    if (!isObject(entry))
      return null;
    if (entryAvoided(avoidFree, entry)) {
      const paid = firstPaidModel(entry);
      if (paid) {
        const paidRef = splitModelRef(paid);
        if (paidRef)
          return `${paidRef.providerID}/${paidRef.modelID}`;
      }
      return null;
    }
    const side = preference === "go-first" ? entry.go : entry.free;
    const ref = splitModelRef(side) || splitModelRef(entry.free) || splitModelRef(entry.go);
    if (!ref)
      return null;
    return `${ref.providerID}/${ref.modelID}`;
  }
  function mergeSettingsOverrides(stored, updates) {
    if (!isObject(stored) || !isObject(updates))
      return null;
    const keys = Object.keys(updates);
    if (!keys.length)
      return null;
    let changed = false;
    const next = {};
    for (const k in stored)
      next[k] = stored[k];
    for (let i = 0;i < keys.length; i++) {
      const k = keys[i];
      if (next[k] !== updates[k]) {
        next[k] = updates[k];
        changed = true;
      }
    }
    return changed ? next : null;
  }
  function mergePreferencesOverrides(stored, updates, now) {
    if (!isObject(updates) || !Object.keys(updates).length)
      return null;
    if (stored === null || stored === undefined) {
      const fields = {};
      const keys = Object.keys(updates);
      for (let i = 0;i < keys.length; i++) {
        fields[keys[i]] = { value: updates[keys[i]], updatedAt: now };
      }
      return { version: 1, fields };
    }
    if (!isObject(stored))
      return null;
    const storedFields = isObject(stored.fields) ? stored.fields : {};
    let changed = false;
    const fields = {};
    for (const k in storedFields)
      fields[k] = storedFields[k];
    const keys = Object.keys(updates);
    for (let i = 0;i < keys.length; i++) {
      const k = keys[i];
      const cur = isObject(fields[k]) ? fields[k].value : undefined;
      if (cur !== updates[k]) {
        const nextEntry = { value: updates[k], updatedAt: now };
        if (isObject(fields[k]) && fields[k].surfaces !== undefined)
          nextEntry.surfaces = fields[k].surfaces;
        fields[k] = nextEntry;
        changed = true;
      }
    }
    if (!changed)
      return null;
    const next = {};
    for (const k in stored)
      next[k] = stored[k];
    next.fields = fields;
    if (next.version === undefined)
      next.version = 1;
    return next;
  }
  function buildDesired(taskTypes, modelTable, preference, avoidFree = false) {
    const desired = {};
    const ignored = [];
    let withCriteria = 0;
    const names = Object.keys(taskTypes || {});
    for (let ni = 0;ni < names.length; ni++) {
      const id = String(names[ni]).toLowerCase().trim();
      if (!CATEGORY_ID_RE.test(id))
        continue;
      const meta = taskTypes[names[ni]] || {};
      const crit = String(meta.jev_criteria || meta.jevCriteria || "").trim();
      if (!crit) {
        ignored.push(id);
        continue;
      }
      withCriteria++;
      const cat = {
        name: String(meta.label || id),
        description: crit
      };
      const tableKey = Object.keys(modelTable || {}).filter((k) => String(k).toLowerCase() === id)[0];
      const entry = tableKey ? modelTable[tableKey] : null;
      let ref = null;
      if (entryAvoided(avoidFree, entry)) {
        ref = splitModelRef(firstPaidModel(entry));
      } else {
        const side = preference === "go-first" ? entry && entry.go : entry && entry.free;
        ref = splitModelRef(side) || splitModelRef(entry && entry.free) || splitModelRef(entry && entry.go);
      }
      if (ref)
        cat.model = ref;
      const agent = String(meta.agent || "").trim();
      if (agent)
        cat.agent = agent;
      desired[id] = cat;
    }
    return { desired, ignored, unusable: withCriteria === 0 };
  }
  function stableStringify(v) {
    if (Array.isArray(v)) {
      return "[" + v.map(stableStringify).join(",") + "]";
    }
    if (isObject(v)) {
      const keys = Object.keys(v).sort();
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
    }
    return JSON.stringify(v);
  }
  function mergeCategories(storedCats, desired, ignored) {
    const stored = isObject(storedCats) ? storedCats : {};
    const next = {};
    let changed = false;
    const desiredIds = Object.keys(desired);
    for (let di = 0;di < desiredIds.length; di++) {
      const id = desiredIds[di];
      const want = desired[id];
      const cur = stored[id];
      let cat;
      if (isObject(cur) && cur.builtin === true) {
        cat = { builtin: true };
        if (cur.name !== undefined && cur.name !== want.name)
          cat.name = want.name;
        else if (cur.name !== undefined)
          cat.name = cur.name;
        else
          cat.name = want.name;
        if (cur.description !== undefined && cur.description !== want.description) {
          cat.description = want.description;
        } else if (cur.description !== undefined)
          cat.description = cur.description;
        else
          cat.description = want.description;
        cat.model = want.model || cur.model || null;
        if (!cat.model)
          delete cat.model;
        if (want.agent)
          cat.agent = want.agent;
        else if (cur.agent !== undefined)
          cat.agent = cur.agent;
        if (cur.variant !== undefined)
          cat.variant = cur.variant;
        if (cur.deleted !== undefined)
          cat.deleted = cur.deleted;
      } else {
        cat = { builtin: false, name: want.name, description: want.description };
        cat.model = want.model || isObject(cur) && cur.model || null;
        if (!cat.model)
          delete cat.model;
        if (want.agent)
          cat.agent = want.agent;
        else if (isObject(cur) && cur.agent !== undefined)
          cat.agent = cur.agent;
        if (isObject(cur) && cur.variant !== undefined)
          cat.variant = cur.variant;
      }
      next[id] = cat;
    }
    const storedIds = Object.keys(stored);
    for (let si = 0;si < storedIds.length; si++) {
      const sid = storedIds[si];
      if (next[sid] !== undefined)
        continue;
      const curStale = stored[sid];
      if (!isObject(curStale))
        continue;
      const disabled = {};
      for (const k in curStale)
        disabled[k] = curStale[k];
      disabled.disabled = true;
      if (disabled.builtin !== true && disabled.builtin !== false)
        disabled.builtin = false;
      next[sid] = disabled;
    }
    changed = stableStringify(next) !== stableStringify(stored);
    return changed ? next : null;
  }
  function readFirst(io, paths) {
    return paths.reduce((prev, p) => prev.then((acc) => {
      if (acc !== null)
        return acc;
      return Promise.resolve(io.readJson(p)).then((v) => v === undefined || v === null ? null : v, () => null);
    }), Promise.resolve(null));
  }
  function syncRouting(io, opts) {
    if (!io || typeof io.readJson !== "function" || typeof io.writeJson !== "function") {
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
        const freshLatches = latchEntries(parts[4]).filter((e) => freeQuotaFresh(e, now));
        const preference = autoPreferenceOf(findPluginOptions(managed));
        const avoidFree = latchPredicate(freshLatches);
        const msConfig = normalizeModelselectConfig(parts[5]);
        let modelTable = null;
        if (modelCache && isObject(modelCache.config)) {
          modelTable = modelCache.config["task-types"] || modelCache.config.task_types || null;
        }
        let taskTypes = null;
        if (ttCache) {
          if (isObject(ttCache.taskTypes))
            taskTypes = ttCache.taskTypes;
          else if (isObject(ttCache["task-types"]))
            taskTypes = ttCache["task-types"];
          else if (isObject(ttCache)) {
            taskTypes = ttCache;
          }
        }
        if (!isObject(taskTypes) || !isObject(modelTable))
          return { written: false, settingsWritten: false };
        const built = buildDesired(taskTypes, modelTable, preference, avoidFree);
        if (built.unusable)
          return { written: false, settingsWritten: false };
        if (!Object.keys(built.desired).length)
          return { written: false, settingsWritten: false };
        const stored = isObject(routing) ? routing : {};
        const nextCats = mergeCategories(stored.categories, built.desired, built.ignored);
        const generic = built.desired.generic;
        let nextFallback = null;
        if (generic && generic.model) {
          const curFb = isObject(stored.fallback) ? stored.fallback : null;
          const wantFb = { model: generic.model };
          if (curFb && curFb.variant !== undefined)
            wantFb.variant = curFb.variant;
          if (stableStringify(wantFb) !== stableStringify(curFb))
            nextFallback = wantFb;
        }
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
            if (walkRef)
              settingsUpdates.walkthroughModelOverride = walkRef;
          }
          if (!Object.keys(settingsUpdates).length)
            settingsUpdates = null;
        }
        const routingDirty = nextCats !== null || nextFallback !== null;
        const writeRouting = routingDirty ? function() {
          const next = {};
          for (const sk in stored)
            next[sk] = stored[sk];
          if (next.version === undefined)
            next.version = 1;
          if (nextCats !== null)
            next.categories = nextCats;
          if (nextFallback !== null)
            next.fallback = nextFallback;
          return Promise.resolve(io.writeJson(ROUTING_PATH, next)).then(() => true, () => false);
        }() : Promise.resolve(false);
        const writeSettings = settingsUpdates ? function() {
          const nextSettings = mergeSettingsOverrides(isObject(parts[6]) ? parts[6] : null, settingsUpdates);
          const nextPrefs = mergePreferencesOverrides(parts[7] === undefined ? null : parts[7], settingsUpdates, now);
          const jobs = [];
          if (nextSettings !== null) {
            jobs.push(Promise.resolve(io.writeJson(SETTINGS_PATH, nextSettings)).then(() => true, () => false));
          }
          if (nextPrefs !== null) {
            jobs.push(Promise.resolve(io.writeJson(PREFERENCES_PATH, nextPrefs)).then(() => true, () => false));
          }
          if (!jobs.length)
            return Promise.resolve(false);
          return Promise.all(jobs).then((flags) => flags.some(Boolean));
        }() : Promise.resolve(false);
        return Promise.all([writeRouting, writeSettings]).then((flags) => ({
          written: flags[0],
          settingsWritten: flags[1]
        }));
      } catch (e) {
        return { written: false, settingsWritten: false };
      }
    }).then((r) => r, () => ({ written: false, settingsWritten: false }));
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
    latchEntries,
    latchKeyApplies,
    latchPredicate,
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
});

// service/src/main.js
var import_routing2 = __toESM(require_routing(), 1);
import http from "node:http";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// service/src/view.js
var import_routing = __toESM(require_routing(), 1);
var { freeQuotaFresh, latchEntries } = import_routing.default;
var STALE_MS = 10 * 60 * 1000;
var ROWS_MAX = 16;
var LABEL_MAX = 60;
var VALUE_MAX = 80;
var TEXT_MAX = 200;
var NOTE_MAX = 300;
var FIX_TEXT = "ModelSelect plugin not detected. Fix: add the modelselect " + "plugin to the OpenChamber managed config <dataDir>/opencode.managed.json " + "(default ~/.config/openchamber/opencode.managed.json) and reopen OpenChamber.";
function str(v) {
  return v == null ? "" : String(v);
}
function cut(s, max) {
  const t = str(s);
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}
function idOf(s) {
  const clean = str(s).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return "r-" + (clean.replace(/^[^a-z]+/, "") || "x").slice(0, 36);
}
function value(v) {
  const s = cut(v, VALUE_MAX);
  return s || "—";
}
function label(v) {
  const s = cut(v, LABEL_MAX);
  return s || "—";
}
function capitalize(v) {
  const s = str(v);
  if (!s)
    return "—";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function thinkLabel(status) {
  if (!status)
    return capitalize(null);
  if (!status.variant)
    return capitalize(status.think);
  const suffix = status.variant !== status.think ? ", task " + capitalize(status.think) : "";
  return capitalize(status.variant) + " (manual" + suffix + ")";
}
function isStale(status, now) {
  return Boolean(status && typeof status.updatedAt === "number" && now - status.updatedAt > STALE_MS);
}
function formatAge(now, at) {
  if (typeof at !== "number" || !Number.isFinite(at))
    return "—";
  const ms = Math.max(0, now - at);
  const min = Math.floor(ms / 60000);
  if (min < 1)
    return "just now";
  if (min < 60)
    return min + "m ago";
  const hours = Math.floor(min / 60);
  if (hours < 24)
    return hours + "h ago";
  return Math.floor(hours / 24) + "d ago";
}
function formatCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s % 3600 / 60);
  const sec = s % 60;
  if (h > 0)
    return h + "h " + m + "m";
  if (m > 0)
    return m + "m " + sec + "s";
  return sec + "s";
}
function goHint(goOk) {
  if (goOk === true)
    return "Go auth OK — quota available";
  if (goOk === false)
    return "Go auth exhausted — quota is out";
  return "Go quota unknown — no probe ran";
}
function usageMonthly(usage) {
  try {
    const go = usage && usage.go;
    if (!go || typeof go !== "object")
      return null;
    const usable = (m) => m && typeof m.percent === "number" && Number.isFinite(m.percent);
    let meter = usable(go.monthly) ? go.monthly : null;
    if (!meter) {
      ["rolling", "weekly", "monthly"].forEach((k) => {
        const w = go[k];
        if (usable(w) && (!meter || w.percent > meter.percent))
          meter = w;
      });
    }
    if (!meter)
      return null;
    const percent = Math.max(0, Math.min(100, meter.percent));
    return { percent, limited: Boolean(meter.limited), resetsAt: meter.resetsAt };
  } catch (e) {
    return null;
  }
}
function usageTone(percent, limited) {
  if (limited || percent >= 100)
    return "error";
  if (percent >= 70)
    return "warning";
  return "success";
}
function usageDetail(u, now) {
  const resets = typeof u.resetsAt === "number" && u.resetsAt > 0 ? " — resets in " + formatCountdown(u.resetsAt - now) : "";
  return cut("Go monthly quota " + Math.round(u.percent) + "%" + (u.limited ? " — limited" : "") + resets, TEXT_MAX);
}
function line(row) {
  return {
    kind: "line",
    id: row.id,
    label: label(row.label),
    ...row.dot ? { dot: row.dot } : {},
    ...row.content ? { content: row.content } : {},
    ...row.value != null ? { value: value(row.value) } : {},
    ...row.valueTone ? { valueTone: row.valueTone } : {},
    ...row.badge ? { badge: { label: label(row.badge.label), ...row.badge.tone ? { tone: row.badge.tone } : {} } } : {},
    ...row.tooltip ? { tooltip: cut(row.tooltip, TEXT_MAX) } : {},
    ...row.actions && row.actions.length ? { actions: row.actions } : {}
  };
}
function note(id, text, tone) {
  return { kind: "note", id, text: cut(text, NOTE_MAX), ...tone ? { tone } : {} };
}
function statusRows(snap, rows) {
  const status = snap.status;
  const now = snap.now;
  const stale = isStale(status, now);
  const known = Array.isArray(snap.knownTypes) ? snap.knownTypes : [];
  const unlisted = Boolean(known.length && status.taskType && known.indexOf(status.taskType) === -1);
  rows.push(line({
    id: "task",
    label: "Task",
    value: status.taskType || "—",
    ...unlisted ? { badge: { label: "unlisted task", tone: "warning" } } : {},
    ...unlisted ? { tooltip: "This task type is not in the plugin model config." } : {}
  }));
  rows.push(line({
    id: "tier",
    label: "Tier",
    value: status.tier || "—",
    dot: status.goOk === true ? "success" : status.goOk === false ? "error" : "muted",
    tooltip: goHint(status.goOk)
  }));
  rows.push(line({
    id: "model",
    label: "Model",
    value: status.model || "—",
    ...status.suggestOnly ? { badge: { label: "suggest only", tone: "info" } } : {},
    tooltip: (status.suggestOnly ? "Suggest-only trial mode — the pick is logged but never applied. " : "") + str(status.model)
  }));
  rows.push(line({
    id: "think",
    label: "Think",
    value: thinkLabel(status),
    tooltip: "Effective effort" + (status.variant ? " (manual override)" : " (task default)")
  }));
  rows.push(line({ id: "jev", label: "Jev", value: status.jev || "—" }));
  rows.push(line({ id: "source", label: "Source", value: status.source || "—" }));
  rows.push(line({
    id: "updated",
    label: "Updated",
    value: formatAge(now, status.updatedAt),
    ...stale ? { badge: { label: "last known", tone: "warning" } } : {},
    tooltip: "Session " + (snap.sessionID || "unknown") + " · " + (typeof status.updatedAt === "number" ? new Date(status.updatedAt).toISOString() : "no timestamp") + (stale ? " — the pick has not been rewritten for a while (stale by design outside routed turns)." : "")
  }));
}
function buildView(snap) {
  const now = typeof snap.now === "number" ? snap.now : Date.now();
  const rows = [];
  if (!snap.directory) {
    rows.push(note("no-project", "Open a project to see the model pick.", "muted"));
    return { rows };
  }
  if (!snap.found) {
    if (snap.globalEntry && snap.globalEntry.entry) {
      rows.push(note("no-pick", "No pick yet — the plugin routes on the first turn of a session.", "muted"));
    } else {
      rows.push(note("plugin-missing", FIX_TEXT, "error"));
    }
  } else if (snap.status) {
    statusRows(snap, rows);
  }
  const u = usageMonthly(snap.usage);
  if (u) {
    rows.push(line({
      id: "usage",
      label: "Go monthly",
      content: { kind: "bar", value: u.percent, tone: usageTone(u.percent, u.limited) },
      value: Math.round(u.percent) + "%",
      valueTone: u.limited ? "error" : undefined,
      tooltip: usageDetail(u, now)
    }));
  }
  const fresh = latchEntries(snap.freeQuota).filter((entry) => freeQuotaFresh(entry, now));
  fresh.forEach((entry, index) => {
    if (rows.length >= ROWS_MAX - 1)
      return;
    const rateLimited = entry.kind === "rate-limit";
    const head = (rateLimited ? "Rate limited" : "Free tier exhausted") + (entry.model ? " — " + entry.model : "");
    const detail = str(entry.detail).trim();
    const text = head + " — retry in " + formatCountdown(Number(entry.until) - now) + (detail ? " · " + detail : "");
    rows.push(note(idOf("free-" + (entry.model || "all") + "-" + index), text, "warning"));
  });
  rows.push(line({
    id: "router",
    label: "Auto-update router",
    content: {
      kind: "segmented",
      id: "routing-sync",
      label: snap.sync ? "On" : "Off",
      value: snap.sync ? "on" : "off",
      options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }]
    },
    tooltip: snap.sync ? "routing.json refreshes every turn" : "router update paused"
  }));
  return { rows: rows.slice(0, ROWS_MAX) };
}

// service/src/main.js
var { syncRouting, parseJsonLenient } = import_routing2.default;
var CACHE_REL = ".opencode/.modelselect-cache";
var SESSION_MAP_FILE = "openchamber-sessions.json";
var ROUTING_SYNC_FILE = "routing-sync.json";
var SESSION_MAP_TTL_MS = 30 * 24 * 60 * 60 * 1000;
var SESSION_MAP_TOUCH_MS = 60 * 1000;
var HOST_EVIDENCE_KEY = "openchamber";
var ROUTING_SYNC_THROTTLE_MS = 30 * 1000;
var GLOBAL_PROBE_MS = 30 * 1000;
var BODY_MAX = 16 * 1024;
var GLOBAL_CONFIG_PATHS = [
  "~/.config/openchamber/opencode.managed.json",
  "~/.config/opencode/opencode.json",
  "~/.config/opencode/opencode.jsonc"
];
var TOKEN = String(process.env.OPENCHAMBER_SERVICE_TOKEN || "");
var rawPort = process.env.OPENCHAMBER_SERVICE_PORT;
var PORT = Number(rawPort);
function fail(message) {
  process.stderr.write("[modelselect] " + message + `
`);
  process.exit(1);
}
if (!TOKEN)
  fail("OPENCHAMBER_SERVICE_TOKEN is missing");
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  fail("OPENCHAMBER_SERVICE_PORT is missing or invalid: " + String(rawPort));
}
function resolveLogicalPath(directory, logical) {
  const p = String(logical == null ? "" : logical);
  if (p === "~")
    return os.homedir();
  if (p.startsWith("~/"))
    return path.join(os.homedir(), p.slice(2));
  if (path.isAbsolute(p))
    return p;
  return path.join(String(directory || process.cwd()), p);
}
async function readJsonFile(file) {
  try {
    return parseJsonLenient(await fsp.readFile(file, "utf8"));
  } catch (e) {
    return null;
  }
}
async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + "." + process.pid + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(value));
  await fsp.rename(tmp, file);
}
function cacheDirOf(directory) {
  return path.join(directory, CACHE_REL);
}
var probeCache = { at: 0, value: { checked: false, entry: false } };
async function pluginEntry() {
  if (Date.now() - probeCache.at < GLOBAL_PROBE_MS)
    return probeCache.value;
  const results = await Promise.all(GLOBAL_CONFIG_PATHS.map(async (logical) => {
    try {
      const text = await fsp.readFile(resolveLogicalPath(null, logical), "utf8");
      return /modelselect/i.test(text);
    } catch (e) {
      return null;
    }
  }));
  const readable = results.filter((r) => r !== null);
  const value = readable.length ? { checked: true, entry: readable.some((r) => r === true) } : { checked: false, entry: false };
  probeCache = { at: Date.now(), value };
  return value;
}
async function listStatuses(cacheDir) {
  let names;
  try {
    names = await fsp.readdir(cacheDir);
  } catch (e) {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!/^status-.+\.json$/.test(name))
      continue;
    const file = path.join(cacheDir, name);
    try {
      const data = parseJsonLenient(await fsp.readFile(file, "utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data))
        continue;
      const stat = await fsp.stat(file);
      out.push({
        sessionID: String(data.sessionID || name.slice("status-".length, -".json".length)),
        data,
        at: typeof data.updatedAt === "number" && Number.isFinite(data.updatedAt) ? data.updatedAt : stat.mtimeMs
      });
    } catch (e) {}
  }
  return out;
}
function knownTaskTypes(cfg) {
  const table = cfg && (cfg.config || cfg) || {};
  const bucket = table["task-types"] || table.taskTypes || {};
  return Object.keys(bucket);
}
function newestStatus(statuses) {
  let newest = null;
  for (const entry of statuses) {
    if (!newest || entry.at > newest.at)
      newest = entry;
  }
  return newest;
}
var syncAt = new Map;
async function maybeSyncRouting(directory, syncEnabled) {
  if (!syncEnabled)
    return;
  const last = syncAt.get(directory) || 0;
  if (Date.now() - last < ROUTING_SYNC_THROTTLE_MS)
    return;
  syncAt.set(directory, Date.now());
  await syncRouting({
    readJson: (logical) => readJsonFile(resolveLogicalPath(directory, logical)),
    writeJson: (logical, value) => writeJsonAtomic(resolveLogicalPath(directory, logical), value)
  });
}
var mapAt = new Map;
var mapChain = new Map;
function touchSessionMap(cacheDir, sessionIDs) {
  const last = mapAt.get(cacheDir) || 0;
  if (Date.now() - last < SESSION_MAP_TOUCH_MS)
    return mapChain.get(cacheDir) || Promise.resolve();
  mapAt.set(cacheDir, Date.now());
  const run = (mapChain.get(cacheDir) || Promise.resolve()).then(async () => {
    const file = path.join(cacheDir, SESSION_MAP_FILE);
    const stored = await readJsonFile(file);
    const sessions = stored && typeof stored.sessions === "object" && stored.sessions ? stored.sessions : {};
    const now = Date.now();
    let changed = false;
    Object.keys(sessions).forEach((id) => {
      const seen = sessions[id];
      if (typeof seen !== "number" || !Number.isFinite(seen) || now - seen > SESSION_MAP_TTL_MS) {
        delete sessions[id];
        changed = true;
      }
    });
    const keys = sessionIDs.length ? sessionIDs : [HOST_EVIDENCE_KEY];
    keys.forEach((id) => {
      if (sessions[id] === now)
        return;
      sessions[id] = now;
      changed = true;
    });
    if (!changed)
      return;
    await writeJsonAtomic(file, { version: 1, sessions });
  }).catch(() => {});
  mapChain.set(cacheDir, run);
  return run;
}
async function readView(directory) {
  const now = Date.now();
  if (!directory)
    return buildView({ now, directory: null });
  const cacheDir = cacheDirOf(directory);
  const statuses = await listStatuses(cacheDir);
  const newest = newestStatus(statuses);
  const [syncFile, freeQuota, usage, config, entry] = await Promise.all([
    readJsonFile(path.join(cacheDir, ROUTING_SYNC_FILE)),
    readJsonFile(path.join(cacheDir, "free-quota.json")),
    readJsonFile(path.join(cacheDir, "usage-limits.json")),
    readJsonFile(path.join(cacheDir, "model-config-cache.json")),
    pluginEntry()
  ]);
  const syncEnabled = !(syncFile && syncFile.sync === false);
  const view = buildView({
    now,
    directory,
    found: Boolean(newest),
    status: newest ? newest.data : null,
    sessionID: newest ? newest.sessionID : "",
    knownTypes: knownTaskTypes(config),
    sync: syncEnabled,
    freeQuota,
    usage,
    globalEntry: entry
  });
  maybeSyncRouting(directory, syncEnabled).catch(() => {});
  touchSessionMap(cacheDir, statuses.map((s) => s.sessionID)).catch(() => {});
  return view;
}
function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store"
  });
  res.end(text);
}
function authorized(req) {
  const given = Buffer.from(String(req.headers.authorization || ""));
  const want = Buffer.from("Bearer " + TOKEN);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_MAX) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function projectDirectory(url) {
  const raw = url.searchParams.get("directory");
  return raw && path.isAbsolute(raw) ? raw : null;
}
async function handleAction(directory, body) {
  if (!directory)
    return { status: 400, body: { message: "No project is open." } };
  let event;
  try {
    event = JSON.parse(body || "{}");
  } catch (e) {
    return { status: 400, body: { message: "The control event is not JSON." } };
  }
  if (!event || typeof event !== "object" || typeof event.id !== "string") {
    return { status: 400, body: { message: "The control event has no id." } };
  }
  if (event.id === "routing-sync") {
    if (event.value !== "on" && event.value !== "off") {
      return { status: 400, body: { message: "Router sync wants 'on' or 'off'." } };
    }
    try {
      await writeJsonAtomic(path.join(cacheDirOf(directory), ROUTING_SYNC_FILE), { sync: event.value === "on" });
    } catch (e) {
      return { status: 500, body: { message: "Could not write the router-sync file." } };
    }
    if (event.value === "on") {
      syncAt.delete(directory);
      maybeSyncRouting(directory, true).catch(() => {});
    }
    return { status: 200, body: { ok: true } };
  }
  return {
    status: 400,
    body: { message: "Unknown control '" + event.id.slice(0, 40) + "'." }
  };
}
async function handle(req, res) {
  if (!authorized(req)) {
    send(res, 401, { message: "Unauthorized." });
    return;
  }
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/health") {
    send(res, 200, { ok: true });
    return;
  }
  if (url.pathname === "/status" && req.method === "GET") {
    send(res, 200, await readView(projectDirectory(url)));
    return;
  }
  if (url.pathname === "/status" && req.method === "POST") {
    const answer = await handleAction(projectDirectory(url), await readBody(req));
    send(res, answer.status, answer.body);
    return;
  }
  send(res, 404, { message: "Not found." });
}
var server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    try {
      send(res, 500, { message: String(err && err.message || err).slice(0, 300) });
    } catch (e) {
      res.destroy();
    }
  });
});
server.on("error", (err) => fail("cannot start: " + String(err && err.message || err)));
server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write("[modelselect] listening on 127.0.0.1:" + server.address().port + `
`);
});
function stop() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
