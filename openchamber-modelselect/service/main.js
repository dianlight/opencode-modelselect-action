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
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

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
  var ACCESS_DISABLED_RE = /model\s+access\s+is\s+disabled|access\s+is\s+disabled/i;
  var MODEL_UNAVAILABLE_RE = /model\s+unavailable/i;
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
    if (ACCESS_DISABLED_RE.test(text))
      return true;
    if (MODEL_UNAVAILABLE_RE.test(text))
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
    ACCESS_DISABLED_RE,
    MODEL_UNAVAILABLE_RE,
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

// ../core/lookup.js
var require_lookup = __commonJS(function(exports, module) {
  function entryFor(config, taskType) {
    const table = config?.["task-types"] ?? config?.task_types;
    if (!table || typeof table !== "object")
      throw new Error("Invalid model config: missing 'task-types'.");
    const key = Object.keys(table).find((k) => k.toLowerCase() === String(taskType).toLowerCase());
    if (!key)
      return { key: null, entry: null };
    return { key, entry: table[key] };
  }
  function normalizeThink(v) {
    const s = String(v ?? "").toLowerCase();
    return ["default", "minimal", "low", "medium", "high", "xhigh"].includes(s) ? s : null;
  }
  function toWireEffort(think) {
    const t = String(think ?? "").toLowerCase();
    if (t === "xhigh")
      return "high";
    if (t === "minimal")
      return "low";
    if (t === "low" || t === "medium" || t === "high")
      return t;
    return null;
  }
  module.exports = {
    entryFor,
    normalizeThink,
    toWireEffort
  };
});

// ../core/budget.js
var require_budget = __commonJS(function(exports, module) {
  var { normModelName } = require_model_ref();
  function rankedCost(row) {
    if (!row || typeof row !== "object")
      return null;
    const c = row.blended_cost;
    return typeof c === "number" && Number.isFinite(c) && c >= 0 ? c : null;
  }
  function selectWithinBudget(entry, taskKey, tier, recommended, maxCost) {
    const ranked = entry ? entry[`${tier}_ranked`] : null;
    if (!Array.isArray(ranked)) {
      throw new Error(`Input 'max-cost' needs a '${tier}_ranked' best-to-worst ranking for ` + `task-type='${taskKey}' in the model config; regenerate ` + "data/model-config.json via maintenance.");
    }
    const ordered = ranked.filter((r) => r && typeof r.model === "string" && r.model).slice().sort((a, b) => {
      const sa = typeof a.score === "number" ? a.score : -Infinity;
      const sb = typeof b.score === "number" ? b.score : -Infinity;
      if (sb !== sa)
        return sb - sa;
      const ca = rankedCost(a);
      const cb = rankedCost(b);
      if (ca === null && cb === null)
        return 0;
      if (ca === null)
        return 1;
      if (cb === null)
        return -1;
      return ca - cb;
    });
    const wanted = normModelName(recommended);
    const rec = ordered.find((r) => normModelName(r.model) === wanted);
    const recCost = rec ? rankedCost(rec) : null;
    if (recCost !== null && recCost <= maxCost) {
      return { model: recommended, cost: String(recCost) };
    }
    for (const row of ordered) {
      const c = rankedCost(row);
      if (c !== null && c <= maxCost)
        return { model: row.model, cost: String(c) };
    }
    const known = ordered.map(rankedCost).filter((c) => c !== null);
    const cheapest = known.length ? Math.min(...known) : null;
    return {
      model: null,
      hint: cheapest === null ? "no ranked model has a known cost" : `cheapest ranked model costs $${cheapest}/1M`
    };
  }
  module.exports = {
    rankedCost,
    selectWithinBudget
  };
});

// service/src/store.js
var exports_store = {};
__export(exports_store, {
  CACHE_REL: () => CACHE_REL,
  DEFAULT_CONFIG_URL: () => DEFAULT_CONFIG_URL,
  DEFAULT_JEV_ENDPOINT: () => DEFAULT_JEV_ENDPOINT,
  DEFAULT_TASK_TYPES_URL: () => DEFAULT_TASK_TYPES_URL,
  FALLBACK_COST_MAX: () => FALLBACK_COST_MAX,
  FALLBACK_COST_MIN: () => FALLBACK_COST_MIN,
  GLOBAL_CONFIG_PATHS: () => GLOBAL_CONFIG_PATHS,
  GLOBAL_NOTE_PATHS: () => GLOBAL_NOTE_PATHS,
  MANAGED_CONFIG_PATH: () => MANAGED_CONFIG_PATH,
  MODELSELECT_CONFIG_PATH: () => MODELSELECT_CONFIG_PATH,
  PLUGIN_PACKAGE: () => PLUGIN_PACKAGE,
  ROUTING_SYNC_FILE: () => ROUTING_SYNC_FILE,
  SESSION_MAP_FILE: () => SESSION_MAP_FILE,
  addPluginEntry: () => addPluginEntry,
  buildPluginOptions: () => buildPluginOptions,
  cacheDirOf: () => cacheDirOf,
  findPluginEntry: () => findPluginEntry,
  knownTaskTypes: () => knownTaskTypes,
  lastProject: () => lastProject,
  listStatuses: () => listStatuses,
  newestStatus: () => newestStatus,
  readCatalog: () => readCatalog,
  readExtensionConfig: () => readExtensionConfig,
  readJsonAt: () => readJsonAt,
  readJsonFile: () => readJsonFile,
  readLatch: () => readLatch,
  readManagedConfig: () => readManagedConfig,
  readRoutingSync: () => readRoutingSync,
  readSessionStatus: () => readSessionStatus,
  readUsage: () => readUsage,
  rememberProject: () => rememberProject,
  resolveLogicalPath: () => resolveLogicalPath,
  sanitizeSessionID: () => sanitizeSessionID,
  saveExtensionConfig: () => saveExtensionConfig,
  savePluginOptions: () => savePluginOptions,
  setPluginOption: () => setPluginOption,
  storedPluginOptions: () => storedPluginOptions,
  writeJsonAt: () => writeJsonAt,
  writeJsonAtomic: () => writeJsonAtomic,
  writeRoutingSync: () => writeRoutingSync
});

// service/src/main.js
var import_routing3 = __toESM(require_routing(), 1);
import http from "node:http";
import fsp2 from "node:fs/promises";
import path2 from "node:path";
import crypto from "node:crypto";
// node_modules/@openchamber/sdk/dist/scrollbar-style.js
var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
var GUEST_SCROLLBAR_CSS = `
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
function installGuestScrollbarActivity(doc) {
  const root = doc.documentElement;
  if (root.hasAttribute("data-oc-scrollbar-activity"))
    return;
  root.setAttribute("data-oc-scrollbar-activity", "");
  const timers = new WeakMap;
  doc.addEventListener("scroll", (event) => {
    const target = event.target === doc ? root : event.target;
    if (!(target instanceof Element))
      return;
    if (!target.hasAttribute("data-oc-scrolling"))
      target.setAttribute("data-oc-scrolling", "");
    const pending = timers.get(target);
    if (pending !== undefined)
      clearTimeout(pending);
    timers.set(target, setTimeout(() => {
      timers.delete(target);
      target.removeAttribute("data-oc-scrolling");
    }, 1000));
  }, { capture: true, passive: true });
}
var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;
// node_modules/@openchamber/sdk/dist/manifest.js
var GUEST_PROVIDER_LOGO_BYTES_MAX = 1024 * 1024;
var TRACKER_URL_TOKENS = ["{id}", "{segment}", "{segments+}"];
var TRACKER_URL_TOKEN_SET = new Set(TRACKER_URL_TOKENS);
// node_modules/@openchamber/sdk/dist/session-events.js
var GUEST_SESSION_EVENT_TYPES = [
  "turn-finished",
  "turn-failed",
  "permission-asked",
  "question-asked",
  "turn-started",
  "session-created",
  "session-archived",
  "session-deleted"
];
var SESSION_EVENTS_PATH = "/session-events";
var SESSION_EVENTS_WIRE_VERSION = 1;
var SESSION_EVENTS_IDLE_MS = 10 * 60000;
var EVENT_TYPES = new Set(GUEST_SESSION_EVENT_TYPES);
var isGuestSessionEventType = (value) => EVENT_TYPES.has(value);
var readSessionEventRequest = (body) => {
  let wire;
  try {
    const parsed = JSON.parse(body);
    if (Object(parsed) !== parsed || parsed === null)
      return null;
    wire = parsed;
  } catch {
    return null;
  }
  const { v, requestId, event, content } = wire;
  if (v !== SESSION_EVENTS_WIRE_VERSION)
    return null;
  if (String(requestId) !== requestId || requestId.length === 0)
    return null;
  if (Object(event) !== event || event === undefined)
    return null;
  const { id, type, at, session, project, linked, permission, question } = event;
  if (String(id) !== id || id.length === 0)
    return null;
  if (String(type) !== type || !isGuestSessionEventType(type))
    return null;
  if (!Number.isFinite(at))
    return null;
  if (Object(session) !== session || session === undefined)
    return null;
  const sessionId = session.id;
  if (String(sessionId) !== sessionId || sessionId.length === 0)
    return null;
  const parentId = session.parentId;
  if (parentId !== null && (String(parentId) !== parentId || parentId.length === 0))
    return null;
  if (Object(project) !== project || project === undefined)
    return null;
  const directory = project.directory;
  if (directory !== null && (String(directory) !== directory || directory.length === 0))
    return null;
  if (!Array.isArray(linked))
    return null;
  const request = {
    v: SESSION_EVENTS_WIRE_VERSION,
    requestId,
    event: { id, type, at: Number(at), session: { id: sessionId, parentId }, project: { directory }, linked }
  };
  if (permission !== undefined) {
    if (Object(permission) !== permission)
      return null;
    const permissionRequestId = permission.requestId;
    if (String(permissionRequestId) !== permissionRequestId || permissionRequestId.length === 0)
      return null;
    request.event.permission = { requestId: permissionRequestId };
  }
  if (question !== undefined) {
    if (Object(question) !== question)
      return null;
    const { kind, id: questionId } = question;
    if (kind !== "form" && kind !== "page")
      return null;
    if (String(questionId) !== questionId || questionId.length === 0)
      return null;
    request.event.question = { kind, id: questionId };
  }
  if (content !== undefined) {
    if (Object(content) !== content || content.type !== type)
      return null;
    request.content = content;
  }
  return request;
};
// node_modules/@openchamber/sdk/dist/service-host.js
var SERVICE_HOST_PATH = "/service/call";
var OPENCHAMBER_HOST_CALLBACK_URL_ENV = "OPENCHAMBER_HOST_CALLBACK_URL";
var SERVICE_HOST_TIMEOUT_MS = 30000;
var SERVICE_SCHEDULE_IDLE_MS = 10 * 60000;
var MENTIONS_IDLE_MS = 10 * 60000;
class ServiceHostError extends Error {
  code;
  status;
  constructor(message, code, status) {
    super(message);
    this.name = "ServiceHostError";
    this.code = code;
    this.status = status;
  }
}
var createServiceHost = ({ env }) => {
  const call = async (method, input) => {
    const base = env[OPENCHAMBER_HOST_CALLBACK_URL_ENV];
    const token = env.OPENCHAMBER_SERVICE_TOKEN;
    if (!base || !token)
      throw new ServiceHostError("This service was not started by OpenChamber.", "HOST_UNAVAILABLE", 0);
    let response;
    try {
      response = await fetch(`${base.replace(/\/+$/, "")}${SERVICE_HOST_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ method, input }),
        signal: AbortSignal.timeout(SERVICE_HOST_TIMEOUT_MS)
      });
    } catch {
      throw new ServiceHostError("OpenChamber did not answer.", "HOST_UNAVAILABLE", 0);
    }
    const body = await response.json().catch(() => null);
    if (response.ok && body?.result !== undefined)
      return body.result;
    throw new ServiceHostError(body?.error?.message ?? `OpenChamber answered HTTP ${response.status}.`, body?.error?.code ?? "HOST_UNAVAILABLE", response.status);
  };
  return {
    sessions: {
      start: (input) => call("sessions.start", input),
      send: (sessionId, prompt) => call("sessions.send", { sessionId, prompt }),
      retry: (sessionId) => call("sessions.retry", { sessionId }),
      status: (sessionId) => call("sessions.status", { sessionId }),
      lastReply: (sessionId) => call("sessions.lastReply", { sessionId }),
      stop: (sessionId) => call("sessions.stop", { sessionId }),
      answerPermission: (sessionId, requestId, answer) => call("sessions.answerPermission", { sessionId, requestId, ...answer }),
      answerForm: (sessionId, formId, values, message) => call("sessions.answerForm", { sessionId, formId, values, ...message === undefined ? {} : { message } })
    },
    setInstructions: (directory, text) => call("instructions.set", { directory, text }),
    emit: (topic, data) => call("panels.emit", { topic, data }),
    readSettings: () => call("settings.read", {}).then(({ settings }) => settings),
    needsConfiguration: (message) => call("status.set", { needsConfiguration: message }),
    setMark: (target, mark) => call("marks.set", { target, mark })
  };
};
// node_modules/@openchamber/sdk/dist/file-editor.js
var patternExpressions = new Map;
// node_modules/@openchamber/sdk/dist/contract.js
var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
var GUEST_GENERATE_LATE_KEEP_MS = 60 * 60000;
var HOST_REQUEST_ERROR_CODES = [
  "HOST_UNAVAILABLE",
  "HOST_TIMEOUT",
  "HOST_REJECTED",
  "DISCONNECTED",
  "DISABLED",
  "BAD_PATH",
  "NO_INTEGRATION",
  "NO_SERVICE",
  "SERVICE_FAILED",
  "REQUEST_FAILED",
  "RESPONSE_TOO_LARGE",
  "NO_SESSION",
  "SESSION_BUSY",
  "NOT_GRANTED",
  "NO_DIRECTORY",
  "NOT_FOUND",
  "FILE_TOO_LARGE",
  "DENIED",
  "NO_MODEL",
  "MODEL_FAILED",
  "UNSUPPORTED"
];
var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);
var HOST_PUSH_TYPES = new Set([
  "workspace",
  "shells",
  "ready",
  "directory",
  "session",
  "connection",
  "settings",
  "session-lifecycle",
  "item",
  "resolve",
  "action",
  "service-event",
  "status-control-event",
  "popover-closed",
  "file-open",
  "file-snapshot",
  "file-saved",
  "generate-late"
]);
// node_modules/@openchamber/sdk/dist/service-providers.js
var BROWSER_CONTROL_ACTIONS = [
  "browser.open",
  "browser.snapshot",
  "browser.click",
  "browser.type",
  "browser.select",
  "browser.scroll",
  "browser.back",
  "browser.forward",
  "browser.inspect",
  "browser.capture",
  "browser.resize",
  "browser.close"
];
var BROWSER_PROVIDER_IDLE_MS = 10 * 60000;
var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);
var SOURCE_CONTROL_PROVIDER_IDLE_MS = 10 * 60000;
var NOTIFICATIONS_PROVIDER_IDLE_MS = 10 * 60000;
var TRACKER_PROVIDER_IDLE_MS = 10 * 60000;
var QUOTA_PROVIDER_IDLE_MS = 10 * 60000;
// node_modules/@openchamber/sdk/dist/service-surface.js
var SURFACE_CONTROLLERS = ["none", "agent", "user"];
var CONTROLLERS = new Set(SURFACE_CONTROLLERS);
// service/src/view.js
var import_routing = __toESM(require_routing(), 1);
var { freeQuotaFresh, latchEntries } = import_routing.default;
var STALE_MS = 10 * 60 * 1000;
var ROWS_MAX = 16;
var LABEL_MAX = 60;
var VALUE_MAX = 80;
var TEXT_MAX = 200;
var NOTE_MAX = 300;
var TIER_OPTIONS = [
  { value: "auto", label: "auto" },
  { value: "go", label: "go" },
  { value: "free", label: "free" }
];
var MISSING_NOTE = "ModelSelect plugin not in opencode.managed.json — " + "the extension card shows the fix; only this section stays empty.";
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
function budgetValue(m) {
  const spent = typeof m.spent === "number" && Number.isFinite(m.spent) ? "$" + (Math.round(m.spent * 100) / 100).toFixed(2) : "—";
  const limit = typeof m.limit === "number" && Number.isFinite(m.limit) && m.limit > 0 ? "$" + (Math.round(m.limit * 100) / 100).toFixed(2) : "no cap";
  return spent + " / " + limit;
}
function budgetTone(pct) {
  if (pct === null)
    return "muted";
  if (pct >= 100)
    return "error";
  if (pct >= 70)
    return "warning";
  return "success";
}
function budgetRow(b, m, now) {
  const name = m.name || m.modelID || m.providerID || "model";
  const rowLabel = (b.id ? b.id + " — " : "") + name;
  const pct = m.percent !== null ? Math.max(0, Math.min(100, Math.round(m.percent))) : null;
  const resets = typeof m.resetsAt === "number" && m.resetsAt > 0 ? " — resets in " + formatCountdown(m.resetsAt - now) : "";
  const tooltip = cut(rowLabel + ": " + budgetValue(m) + resets, TEXT_MAX);
  const row = {
    id: "budget-" + idOf(b.id || "budget") + "-" + idOf(name),
    label: label(rowLabel),
    value: value(budgetValue(m)),
    valueTone: budgetTone(pct),
    tooltip
  };
  if (pct !== null) {
    row.content = { kind: "bar", value: pct, tone: budgetTone(pct) };
  }
  return row;
}
function budgetRows(usage, rows, now) {
  try {
    const budgets = usage && usage.budgets;
    if (!Array.isArray(budgets))
      return;
    for (const b of budgets) {
      if (!b || typeof b !== "object" || !Array.isArray(b.models))
        continue;
      for (const m of b.models) {
        if (rows.length >= ROWS_MAX - 1)
          return;
        rows.push(line(budgetRow(b, m, now)));
      }
    }
  } catch (e) {}
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
    ...snap.tierOption ? {
      actions: [{
        kind: "select",
        id: "tier",
        label: "Tier",
        value: snap.tierOption,
        options: TIER_OPTIONS
      }]
    } : {},
    tooltip: cut(goHint(status.goOk) + " · last pick used " + (status.tier || "unknown") + (snap.tierOption ? " · the control sets the plugin tier option (" + snap.tierOption + "; auto = autoPreference)" : ""), TEXT_MAX)
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
function pickSummary(status, now) {
  if (!status)
    return null;
  const at = typeof now === "number" ? now : Date.now();
  const parts = [
    status.taskType || "task?",
    status.tier || "tier?",
    status.model || "no model",
    thinkLabel(status)
  ];
  if (status.suggestOnly)
    parts.push("suggest only");
  parts.push(formatAge(at, status.updatedAt));
  if (isStale(status, at))
    parts.push("last known");
  return {
    text: parts.join(" · "),
    taskType: str(status.taskType),
    tier: str(status.tier),
    model: str(status.model),
    think: thinkLabel(status),
    jev: str(status.jev),
    source: str(status.source),
    suggestOnly: Boolean(status.suggestOnly),
    updatedAt: typeof status.updatedAt === "number" ? status.updatedAt : null,
    stale: isStale(status, at)
  };
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
      rows.push(note("plugin-missing", MISSING_NOTE, "error"));
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
  budgetRows(snap.usage, rows, now);
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

// service/src/chain.js
var import_lookup = __toESM(require_lookup(), 1);
var import_model_ref = __toESM(require_model_ref(), 1);
var import_budget = __toESM(require_budget(), 1);
var import_free_quota = __toESM(require_free_quota(), 1);
var { entryFor } = import_lookup.default;
var { firstPaidModel } = import_model_ref.default;
var { selectWithinBudget } = import_budget.default;
var { latchEntries: latchEntries2, freeQuotaFresh: freeQuotaFresh2, latchKeyApplies } = import_free_quota.default;
function str2(v) {
  return v == null ? "" : String(v);
}
function optOf(raw, camel, kebab, dflt) {
  if (!raw || typeof raw !== "object")
    return dflt;
  if (raw[camel] !== undefined && raw[camel] !== null)
    return raw[camel];
  if (kebab && raw[kebab] !== undefined && raw[kebab] !== null)
    return raw[kebab];
  return dflt;
}
function numOrNull(v) {
  if (v === null || v === undefined || v === "")
    return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function rowCost(row) {
  if (!row || typeof row !== "object")
    return null;
  const c = row.blended_cost;
  return typeof c === "number" && Number.isFinite(c) && c >= 0 ? c : null;
}
function sortRanked(rows) {
  return (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r.model === "string" && r.model).slice().sort((a, b) => {
    const sa = typeof a.score === "number" ? a.score : -Infinity;
    const sb = typeof b.score === "number" ? b.score : -Infinity;
    if (sb !== sa)
      return sb - sa;
    const ca = rowCost(a);
    const cb = rowCost(b);
    if (ca === null && cb === null)
      return 0;
    if (ca === null)
      return 1;
    if (cb === null)
      return -1;
    return ca - cb;
  });
}
function splitName(model) {
  const s = str2(model);
  const i = s.indexOf("/");
  if (i < 0)
    return { provider: "—", id: s };
  return { provider: s.slice(0, i) || "—", id: s.slice(i + 1) };
}
function formatCountdown2(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s % 3600 / 60);
  if (h > 0)
    return h + "h " + m + "m";
  if (m > 0)
    return m + "m " + s % 60 + "s";
  return s + "s";
}
function usageBar(row, usage, at) {
  if (row.status === "excluded") {
    const reason = row.reason || "excluded";
    let tone = "muted";
    if (/quota latched/.test(reason))
      tone = "err";
    else if (/rate-limited/.test(reason))
      tone = "warn";
    else if (/over maxCost|no cost data/.test(reason))
      tone = "err";
    return { pct: 100, tone, label: reason };
  }
  const u = usageMonthly(usage);
  if (row.side === "go" && u && u.percent !== null) {
    const pct = Math.max(3, Math.min(100, Math.round(u.percent)));
    const tone = u.limited || u.percent >= 100 ? "err" : u.percent >= 70 ? "warn" : "ok";
    let label = "Go monthly " + Math.round(u.percent) + "%";
    if (u.limited) {
      label += " · limited";
      const left = typeof u.resetsAt === "number" && u.resetsAt > 0 ? formatCountdown2(u.resetsAt - (typeof at === "number" ? at : Date.now())) : "";
      if (left)
        label += " · resets " + left;
    } else if (row.status === "pick") {
      label = "PICK · " + label;
    }
    return { pct, tone, label };
  }
  if (row.status === "pick") {
    return { pct: 100, tone: "ok", label: row.side === "free" ? "PICK · free" : "PICK" };
  }
  return { pct: 45, tone: "muted", label: row.side === "free" ? "free · no quota cap" : "standby" };
}
function computeModelsView({ taskType, catalogConfig, options, latchData, usage, now }) {
  const at = typeof now === "number" ? now : Date.now();
  const table = catalogConfig && (catalogConfig["task-types"] || catalogConfig.task_types) || {};
  let key = null;
  let entry = null;
  try {
    const found = entryFor({ "task-types": table }, taskType);
    key = found.key;
    entry = found.entry;
  } catch (e) {
    return { found: false, taskType: str2(taskType) };
  }
  if (!key || !entry)
    return { found: false, taskType: str2(taskType) };
  const tier = str2(optOf(options, "tier", null, "auto")).toLowerCase();
  const preference = str2(optOf(options, "autoPreference", "auto-preference", "free-first")).toLowerCase();
  const order = preference === "go-first" ? ["go", "free"] : ["free", "go"];
  const maxCost = numOrNull(optOf(options, "maxCost", null, null));
  const fallback = str2(optOf(options, "fallbackModel", "fallback-model", "")).trim();
  const refOf = (side) => str2(side === "go" ? entry.go : entry.free).trim();
  let fresh = [];
  try {
    fresh = latchEntries2(latchData || {}).filter((e) => freeQuotaFresh2(e, at));
  } catch (e) {
    fresh = [];
  }
  const latchHitFor = (model) => {
    for (let i = 0;i < fresh.length; i += 1) {
      const e = fresh[i];
      if (!e.model || latchKeyApplies(e.key, model))
        return e;
    }
    return null;
  };
  const latched = (model) => Boolean(model && latchHitFor(model));
  let side;
  let sideNote;
  const pinned = tier === "go" || tier === "free";
  if (pinned) {
    side = tier;
    sideNote = "tier=" + tier;
    if (!refOf(side) && refOf(side === "go" ? "free" : "go")) {
      side = side === "go" ? "free" : "go";
      sideNote += " empty → " + side;
    }
  } else {
    side = refOf(order[0]) ? order[0] : order[1];
    sideNote = "auto → " + preference;
    const other = side === "go" ? "free" : "go";
    if (refOf(side) && latched(refOf(side)) && refOf(other)) {
      side = other;
      sideNote += " · latched → failover";
    }
  }
  const otherSide = side === "go" ? "free" : "go";
  let model = refOf(side);
  let pickNote = "";
  if (model && latched(model)) {
    const paid = firstPaidModel(entry);
    if (paid) {
      model = paid;
      side = "go";
      pickNote = "latched → paid failover";
    }
  }
  let pickName = model;
  let pickSource = model ? "chain" : null;
  if (!model && fallback) {
    return {
      found: true,
      key,
      side,
      sideNote,
      maxCost,
      fallback,
      pick: fallback,
      pickSource: "fallback",
      pickNote: "No chain model configured — fallback",
      chain: []
    };
  }
  if (maxCost !== null && model) {
    let budgeted = null;
    try {
      budgeted = selectWithinBudget(entry, key, side, model, maxCost);
    } catch (e) {
      budgeted = null;
    }
    if (budgeted && budgeted.model) {
      if (budgeted.model !== model)
        pickNote = "over budget → $" + budgeted.cost + "/1M pick";
      model = budgeted.model;
      pickName = model;
    } else {
      pickName = "";
      pickSource = fallback ? "fallback" : null;
      return {
        found: true,
        key,
        side,
        sideNote,
        maxCost,
        fallback,
        pick: fallback || null,
        pickSource,
        pickNote: fallback ? "Nothing fits maxCost — fallback" : "Nothing fits maxCost",
        chain: buildChain()
      };
    }
  }
  function buildChain() {
    const rows = [];
    [side, otherSide].forEach((s) => {
      sortRanked(entry[s + "_ranked"]).forEach((row) => {
        rows.push(describeRow(row, s));
      });
    });
    rows.forEach((r) => {
      r.bar = usageBar(r, usage, at);
    });
    return rows;
  }
  function describeRow(row, s) {
    const name = str2(row.model);
    const parts = splitName(name);
    const cost = rowCost(row);
    const score = typeof row.score === "number" ? row.score : null;
    const view = {
      model: name,
      provider: parts.provider,
      id: parts.id,
      score,
      cost,
      context: typeof row.context === "number" && row.context > 0 ? row.context : null,
      modalities: Array.isArray(row.modalities) ? row.modalities.filter(function(m) {
        return typeof m === "string" && m;
      }) : null,
      inputCost: typeof row.input_cost === "number" ? row.input_cost : null,
      outputCost: typeof row.output_cost === "number" ? row.output_cost : null,
      side: s,
      status: "ok",
      reason: "",
      latchText: ""
    };
    if (name === pickName && pickSource === "chain") {
      const hit = latchHitFor(name);
      if (hit) {
        view.status = "excluded";
        view.reason = "quota latched · retry in " + formatCountdown2(hit.until - at);
        view.latchText = view.reason;
        return view;
      }
      view.status = "pick";
      return view;
    }
    const hit = latchHitFor(name);
    if (hit) {
      view.status = "excluded";
      view.reason = (hit.kind === "rate-limit" ? "rate-limited" : "quota latched") + " · retry in " + formatCountdown2(hit.until - at);
      view.latchText = view.reason;
      return view;
    }
    if (maxCost !== null && (cost === null || cost > maxCost)) {
      view.status = "excluded";
      view.reason = cost === null ? "no cost data (cap set)" : "over maxCost $" + maxCost;
      return view;
    }
    if (s !== side) {
      view.status = "excluded";
      view.reason = "off-side · " + sideNote;
      return view;
    }
    return view;
  }
  return {
    found: true,
    key,
    side,
    sideNote,
    maxCost,
    fallback,
    pick: pickName || fallback || null,
    pickSource,
    pickNote: pickNote || (pickName ? "" : "No model configured"),
    chain: buildChain()
  };
}

// service/src/answers.js
var PERMISSION_MESSAGE = "Model select allowed this once. Ask the user to allow it always if it should repeat.";
var PAGE_MESSAGE = "Model select cannot answer a page — answer it in the app to continue this turn.";
function formMessage(values) {
  const keys = Object.keys(values || {});
  if (!keys.length) {
    return "Model select answered this form with its defaults; no field was computable.";
  }
  return "Model select filled " + keys.join(", ") + "; every other field keeps its default.";
}
function knownValues(directory, pick) {
  const known = {};
  if (typeof directory === "string" && directory)
    known.directory = directory;
  if (pick && typeof pick.model === "string" && pick.model)
    known.model = pick.model;
  if (pick && typeof pick.taskType === "string" && pick.taskType)
    known.task = pick.taskType;
  if (pick && typeof pick.tier === "string" && pick.tier)
    known.tier = pick.tier;
  return known;
}
var FIELD_KEYS = {
  directory: ["directory", "project", "projectdirectory", "path", "cwd", "workdir", "workspace"],
  model: ["model", "modelid"],
  task: ["task", "tasktype"],
  tier: ["tier"]
};
function computeFormValues(fields, known) {
  const values = {};
  if (!Array.isArray(fields))
    return values;
  for (const field of fields) {
    if (!field || typeof field.key !== "string" || !field.key)
      continue;
    if (!fieldIsAsked(field, values))
      continue;
    const value = fieldValue(field, known || {});
    if (value !== undefined)
      values[field.key] = value;
  }
  return values;
}
function fieldIsAsked(field, values) {
  if (!Array.isArray(field.when) || !field.when.length)
    return true;
  for (const condition of field.when) {
    if (!condition || typeof condition.key !== "string")
      return false;
    const current = values[condition.key];
    if (current === undefined)
      return false;
    if (condition.op === "eq" && current !== condition.value)
      return false;
    if (condition.op === "neq" && current === condition.value)
      return false;
    if (condition.op !== "eq" && condition.op !== "neq")
      return false;
  }
  return true;
}
function fieldValue(field, known) {
  const type = typeof field.type === "string" ? field.type : "string";
  if (type === "external")
    return;
  const kind = kindOfKey(field.key);
  if (kind) {
    const value = typedValue(type, known[kind]);
    if (value === undefined)
      return;
    return optionsAllow(field, value) ? value : undefined;
  }
  if (Array.isArray(field.options) && field.options.length === 1) {
    const only = field.options[0];
    if (!only || typeof only.value !== "string")
      return;
    const value = typedValue(type, only.value);
    if (value === undefined)
      return;
    return optionsAllow(field, value) ? value : undefined;
  }
  return;
}
function kindOfKey(key) {
  const normalized = normalizeKey(key);
  for (const kind of Object.keys(FIELD_KEYS)) {
    if (FIELD_KEYS[kind].indexOf(normalized) !== -1)
      return kind;
  }
  return null;
}
function normalizeKey(key) {
  return String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function typedValue(type, raw) {
  if (raw === undefined || raw === null || raw === "")
    return;
  if (type === "string")
    return typeof raw === "string" ? raw : undefined;
  if (type === "number" || type === "integer") {
    return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
  }
  if (type === "boolean")
    return typeof raw === "boolean" ? raw : undefined;
  if (type === "multiselect") {
    const list = Array.isArray(raw) ? raw : [raw];
    const values = list.filter((v) => typeof v === "string" && v !== "");
    return values.length ? values : undefined;
  }
  return;
}
function optionsAllow(field, value) {
  if (!Array.isArray(field.options) || !field.options.length)
    return true;
  const values = Array.isArray(value) ? value : [value];
  return values.every((v) => field.options.some((o) => o && o.value === v));
}

// service/src/store.js
var import_routing2 = __toESM(require_routing(), 1);
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
var { parseJsonLenient } = import_routing2.default;
var CACHE_REL = ".opencode/.modelselect-cache";
var SESSION_MAP_FILE = "openchamber-sessions.json";
var MANAGED_CONFIG_PATH = "~/.config/openchamber/opencode.managed.json";
var MODELSELECT_CONFIG_PATH = "~/.config/openchamber/modelselect.json";
var GLOBAL_CONFIG_PATHS = [
  "~/.config/opencode/opencode.json",
  "~/.config/opencode/opencode.jsonc"
];
var GLOBAL_NOTE_PATHS = GLOBAL_CONFIG_PATHS;
var ROUTING_SYNC_FILE = "routing-sync.json";
var PLUGIN_PACKAGE = "opencode-modelselect-plugin";
var DEFAULT_CONFIG_URL = "https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/model-config.json";
var DEFAULT_TASK_TYPES_URL = "https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/task-types.json";
var DEFAULT_JEV_ENDPOINT = "https://opencode.ai/zen/v1/systemone";
var FALLBACK_COST_MIN = 0;
var FALLBACK_COST_MAX = 8;
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
function readJsonAt(directory, logical) {
  return readJsonFile(resolveLogicalPath(directory, logical));
}
async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + "." + process.pid + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2) + `
`);
  await fsp.rename(tmp, file);
}
function writeJsonAt(directory, logical, value) {
  return writeJsonAtomic(resolveLogicalPath(directory, logical), value);
}
function cacheDirOf(directory) {
  return path.join(String(directory), CACHE_REL);
}
function sanitizeSessionID(id) {
  const clean = String(id == null ? "default" : id).replace(/[^A-Za-z0-9-_]/g, "_").slice(0, 128);
  return clean || "default";
}
function str3(v) {
  return v == null ? "" : String(v);
}
function shallowCopy(obj) {
  const out = {};
  if (obj && typeof obj === "object")
    Object.keys(obj).forEach((k) => {
      out[k] = obj[k];
    });
  return out;
}
function findPluginEntry(config) {
  const plugins = config && Array.isArray(config.plugins) ? config.plugins : [];
  for (let i = 0;i < plugins.length; i += 1) {
    const entry = plugins[i];
    if (typeof entry === "string" && /modelselect/i.test(entry)) {
      return { form: "string", index: i, package: entry, options: {} };
    }
    if (Array.isArray(entry) && typeof entry[0] === "string" && /modelselect/i.test(entry[0])) {
      return {
        form: "tuple",
        index: i,
        package: entry[0],
        options: entry[1] && typeof entry[1] === "object" ? entry[1] : {}
      };
    }
    if (entry && typeof entry === "object" && typeof entry.package === "string" && /modelselect/i.test(entry.package)) {
      return {
        form: "object",
        index: i,
        package: entry.package,
        options: entry.options && typeof entry.options === "object" ? entry.options : {}
      };
    }
  }
  return { form: "missing", index: -1, package: PLUGIN_PACKAGE, options: {} };
}
async function readManagedConfig() {
  const file = resolveLogicalPath(null, MANAGED_CONFIG_PATH);
  let raw;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch (e) {
    if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) {
      return { parseOk: true, exists: false, config: { plugins: [] }, entry: findPluginEntry({}) };
    }
    return {
      parseOk: false,
      exists: true,
      config: null,
      entry: findPluginEntry({}),
      parseError: String(e && e.message || e)
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      parseOk: false,
      exists: true,
      config: null,
      entry: findPluginEntry({}),
      parseError: "not valid JSON: " + String(e && e.message || e)
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      parseOk: false,
      exists: true,
      config: null,
      entry: findPluginEntry({}),
      parseError: "the managed config is not a JSON object"
    };
  }
  return { parseOk: true, exists: true, config: parsed, entry: findPluginEntry(parsed) };
}
async function storedPluginOptions() {
  const managed = await readManagedConfig();
  return managed.entry.options || {};
}
function buildPluginOptions(base, v) {
  const next = shallowCopy(base);
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
  if (v.maxCost == null)
    delete next.maxCost;
  else
    next.maxCost = v.maxCost;
  if (v.jevModel)
    next.jevModel = v.jevModel;
  else
    delete next.jevModel;
  if (v.fallbackModel)
    next.fallbackModel = v.fallbackModel;
  else
    delete next.fallbackModel;
  if (v.tokenDraft)
    next.token = v.tokenDraft;
  if (v.jevTokenDraft)
    next.jevToken = v.jevTokenDraft;
  return next;
}
async function savePluginOptions(directory, values) {
  const managed = await readManagedConfig();
  if (!managed.parseOk) {
    throw new Error("The managed config is not valid JSON — nothing was written. Fix the file first.");
  }
  const config = managed.config;
  if (!Array.isArray(config.plugins))
    config.plugins = [];
  const entry = managed.entry;
  if (entry.form === "missing") {
    throw new Error("No modelselect entry in the managed config.");
  }
  const nextOptions = buildPluginOptions(entry.options, values);
  if (entry.form === "object") {
    config.plugins[entry.index].options = nextOptions;
  } else {
    config.plugins[entry.index] = { package: entry.package, options: nextOptions };
  }
  await writeJsonAtomic(resolveLogicalPath(null, MANAGED_CONFIG_PATH), config);
  return { entry: findPluginEntry(config), options: nextOptions };
}
async function addPluginEntry() {
  const managed = await readManagedConfig();
  if (!managed.parseOk) {
    throw new Error("The managed config is not valid JSON — nothing was written. Fix the file first.");
  }
  if (managed.entry.form !== "missing")
    return { entry: managed.entry, added: false };
  const config = managed.config;
  if (!Array.isArray(config.plugins))
    config.plugins = [];
  config.plugins.push({ package: PLUGIN_PACKAGE, options: {} });
  await writeJsonAtomic(resolveLogicalPath(null, MANAGED_CONFIG_PATH), config);
  return { entry: findPluginEntry(config), added: true };
}
async function setPluginOption(name, value) {
  const managed = await readManagedConfig();
  if (!managed.parseOk)
    throw new Error("The managed config is not valid JSON.");
  const entry = managed.entry;
  if (entry.form === "missing")
    throw new Error("No modelselect entry in the managed config.");
  const config = managed.config;
  const next = shallowCopy(entry.options);
  next[name] = value;
  if (entry.form === "object")
    config.plugins[entry.index].options = next;
  else
    config.plugins[entry.index] = { package: entry.package, options: next };
  await writeJsonAtomic(resolveLogicalPath(null, MANAGED_CONFIG_PATH), config);
  return next;
}
async function readExtensionConfig() {
  const data = await readJsonAt(null, MODELSELECT_CONFIG_PATH);
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}
async function saveExtensionConfig(directory, values) {
  const current = await readJsonAt(null, MODELSELECT_CONFIG_PATH);
  const next = current && typeof current === "object" && !Array.isArray(current) ? shallowCopy(current) : {};
  next.autoSmallModel = Boolean(values.autoSmallModel);
  next.autoWalkthroughModel = Boolean(values.autoWalkthroughModel);
  next.smallModelTask = str3(values.smallModelTask) || "generic";
  next.walkthroughModelTask = str3(values.walkthroughModelTask) || "generic";
  await writeJsonAt(null, MODELSELECT_CONFIG_PATH, next);
  return next;
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
function newestStatus(statuses) {
  let newest = null;
  for (const entry of statuses) {
    if (!newest || entry.at > newest.at)
      newest = entry;
  }
  return newest;
}
async function readSessionStatus(directory, sessionID) {
  if (!directory || !sessionID)
    return null;
  const file = path.join(cacheDirOf(directory), "status-" + sanitizeSessionID(sessionID) + ".json");
  const data = await readJsonFile(file);
  return data && typeof data === "object" && !Array.isArray(data) ? data : null;
}
function knownTaskTypes(cfg) {
  const table = cfg && (cfg.config || cfg) || {};
  const bucket = table["task-types"] || table.taskTypes || {};
  return Object.keys(bucket);
}
async function readRoutingSync(directory) {
  const data = await readJsonAt(directory, path.join(CACHE_REL, ROUTING_SYNC_FILE));
  return !(data && data.sync === false);
}
async function writeRoutingSync(directory, on) {
  const file = path.join(cacheDirOf(directory), ROUTING_SYNC_FILE);
  const current = await readJsonFile(file);
  const next = current && typeof current === "object" && !Array.isArray(current) ? shallowCopy(current) : {};
  next.sync = Boolean(on);
  await writeJsonAtomic(file, next);
  return next;
}
async function readCatalog(directory) {
  const data = await readJsonAt(directory, path.join(CACHE_REL, "model-config-cache.json"));
  const cfg = data && data.config || data || {};
  const bucket = cfg["task-types"] || cfg.taskTypes || {};
  const types = Object.keys(bucket);
  const costs = [];
  types.forEach((t) => {
    const entry = bucket[t] || {};
    ["go_ranked", "free_ranked"].forEach((side) => {
      const rows = Array.isArray(entry[side]) ? entry[side] : [];
      rows.forEach((row) => {
        const c = row && typeof row.blended_cost === "number" ? row.blended_cost : null;
        if (c != null && Number.isFinite(c))
          costs.push(c);
      });
    });
  });
  const bounds = { min: FALLBACK_COST_MIN, max: FALLBACK_COST_MAX };
  if (costs.length) {
    bounds.min = Math.min.apply(null, costs);
    bounds.max = Math.max.apply(null, costs);
    if (bounds.max <= bounds.min)
      bounds.max = bounds.min + 1;
  }
  return { types, bounds, config: data && data.config || null };
}
function readLatch(directory) {
  return readJsonAt(directory, path.join(CACHE_REL, "free-quota.json"));
}
function readUsage(directory) {
  return readJsonAt(directory, path.join(CACHE_REL, "usage-limits.json"));
}
var LAST_PROJECT_FILE = process.env.MODELSELECT_STATE_FILE || path.join(os.tmpdir(), "openchamber-modelselect", "last-project.json");
async function rememberProject(directory) {
  if (!directory)
    return;
  try {
    await writeJsonAtomic(LAST_PROJECT_FILE, { directory: String(directory), at: Date.now() });
  } catch (e) {}
}
async function lastProject() {
  const data = await readJsonFile(LAST_PROJECT_FILE);
  const dir = data && typeof data.directory === "string" ? data.directory : null;
  return dir && path.isAbsolute(dir) ? dir : null;
}

// service/src/main.js
var { syncRouting } = import_routing3.default;
var {
  CACHE_REL: CACHE_REL2,
  SESSION_MAP_FILE: SESSION_MAP_FILE2,
  GLOBAL_NOTE_PATHS: GLOBAL_NOTE_PATHS2
} = exports_store;
var SESSION_MAP_TTL_MS = 30 * 24 * 60 * 60 * 1000;
var SESSION_MAP_TOUCH_MS = 60 * 1000;
var HOST_EVIDENCE_KEY = "openchamber";
var ROUTING_SYNC_THROTTLE_MS = 30 * 1000;
var GLOBAL_PROBE_MS = 30 * 1000;
var MAINTAIN_EVERY_MS = 60 * 1000;
var BODY_MAX = 16 * 1024;
var EVENT_BODY_MAX = 256 * 1024;
var TIER_VALUES = TIER_OPTIONS.map((o) => o.value);
var RELOAD_PATH = "/api/location/reload";
var DEFAULT_PORT = 4096;
function reloadPorts(env = process.env) {
  const out = [];
  const push = (v) => {
    const n = Number(String(v ?? "").trim());
    if (Number.isInteger(n) && n > 0 && n <= 65535 && !out.includes(n))
      out.push(n);
  };
  try {
    push(env.OPENCODE_PORT);
    push(env.OPENCODE_SERVER_PORT);
    push(env.PORT);
  } catch {}
  push(DEFAULT_PORT);
  return out;
}
async function postJson(url, body, { timeoutMs = 5000 } = {}) {
  const ctrl = new AbortController;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: String(e && e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}
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
var serviceHost = null;
try {
  if (process.env.OPENCHAMBER_HOST_CALLBACK_URL) {
    serviceHost = createServiceHost({ env: process.env });
  }
} catch (e) {
  serviceHost = null;
}
var lastCardState = null;
function reportCardState(state, message) {
  if (state === lastCardState)
    return;
  lastCardState = state;
  if (!serviceHost)
    return;
  serviceHost.needsConfiguration(message || null).catch(() => {
    lastCardState = null;
  });
}
var probeCache = { at: 0, value: { checked: false, entry: false } };
async function pluginEntry() {
  if (Date.now() - probeCache.at < GLOBAL_PROBE_MS)
    return probeCache.value;
  const results = await Promise.all(GLOBAL_NOTE_PATHS2.map(async (logical) => {
    try {
      const text = await fsp2.readFile(resolveLogicalPath(null, logical), "utf8");
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
var syncAt = new Map;
var seenDirectories = new Set;
async function maybeSyncRouting(directory, syncEnabled) {
  if (!syncEnabled)
    return;
  const last = syncAt.get(directory) || 0;
  if (Date.now() - last < ROUTING_SYNC_THROTTLE_MS)
    return;
  syncAt.set(directory, Date.now());
  await syncRouting({
    readJson: (logical) => readJsonAt(directory, logical),
    writeJson: (logical, value) => writeJsonAt(directory, logical, value)
  });
}
var mapAt = new Map;
async function touchSessionMap(cacheDir, sessionIDs) {
  const last = mapAt.get(cacheDir) || 0;
  if (Date.now() - last < SESSION_MAP_TOUCH_MS)
    return;
  mapAt.set(cacheDir, Date.now());
  const file = path2.join(cacheDir, SESSION_MAP_FILE2);
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
}
async function maintain() {
  for (const directory of Array.from(seenDirectories)) {
    try {
      const syncOn = await readRoutingSync(directory);
      await maybeSyncRouting(directory, syncOn);
      const statuses = await listStatuses(cacheDirOf(directory));
      await touchSessionMap(cacheDirOf(directory), statuses.map((s) => s.sessionID));
    } catch (e) {}
  }
}
function tierOf(managed) {
  if (!managed || !managed.parseOk || managed.entry.form === "missing")
    return null;
  const tier = typeof managed.entry.options.tier === "string" ? managed.entry.options.tier : "auto";
  return TIER_VALUES.includes(tier) ? tier : "auto";
}
async function readView(directory) {
  const now = Date.now();
  if (!directory) {
    reportCardState("no-project", null);
    return buildView({ now, directory: null });
  }
  seenDirectories.add(directory);
  const cacheDir = cacheDirOf(directory);
  const statuses = await listStatuses(cacheDir);
  const newest = newestStatus(statuses);
  const [syncOn, freeQuota, usage, config, entry, managed] = await Promise.all([
    readRoutingSync(directory),
    readLatch(directory),
    readUsage(directory),
    readJsonAt(directory, path2.join(CACHE_REL2, "model-config-cache.json")),
    pluginEntry(),
    readManagedConfig()
  ]);
  if (!managed.parseOk) {
    reportCardState("managed-broken", "The OpenChamber managed OpenCode config is not valid JSON, so the settings panel cannot save. Fix " + MANAGED_CONFIG_PATH + " and reopen OpenChamber.");
  } else if (managed.entry.form === "missing") {
    reportCardState("plugin-missing", "Add the modelselect plugin to " + MANAGED_CONFIG_PATH + " and reopen OpenChamber — it is the only config OpenChamber's server loads.");
  } else {
    reportCardState("ok", null);
  }
  return buildView({
    now,
    directory,
    found: Boolean(newest),
    status: newest ? newest.data : null,
    sessionID: newest ? newest.sessionID : "",
    knownTypes: knownTaskTypes(config),
    sync: syncOn,
    freeQuota,
    usage,
    globalEntry: entry,
    tierOption: tierOf(managed)
  });
}
function publicOptions(options) {
  const out = Object.assign({}, options || {});
  delete out.token;
  delete out.jevToken;
  return out;
}
async function readConfig(directory, sessionID) {
  const [managed, globalPresent, catalog, extConfig, syncOn, sessionStatus] = await Promise.all([
    readManagedConfig(),
    Promise.all(GLOBAL_NOTE_PATHS2.map(async (logical) => {
      try {
        await fsp2.stat(resolveLogicalPath(null, logical));
        return logical;
      } catch (e) {
        return null;
      }
    })),
    readCatalog(directory),
    readExtensionConfig(),
    readRoutingSync(directory),
    readSessionStatus(directory, sessionID)
  ]);
  return {
    managed: {
      parseOk: managed.parseOk,
      exists: managed.exists,
      parseError: managed.parseError || "",
      entry: {
        form: managed.entry.form,
        package: managed.entry.package,
        options: publicOptions(managed.entry.options)
      }
    },
    managedPath: MANAGED_CONFIG_PATH,
    extensionPath: MODELSELECT_CONFIG_PATH,
    globalPaths: globalPresent.filter(Boolean),
    catalog: { types: catalog.types, bounds: catalog.bounds },
    extConfig,
    syncOn,
    sessionTask: sessionStatus && typeof sessionStatus.taskType === "string" ? sessionStatus.taskType : ""
  };
}
async function readChain(directory, taskType) {
  const [catalog, options, latch, usage] = await Promise.all([
    readCatalog(directory),
    storedPluginOptions(),
    readLatch(directory),
    readUsage(directory)
  ]);
  return computeModelsView({
    taskType,
    catalogConfig: catalog.config,
    options,
    latchData: latch,
    usage,
    now: Date.now()
  });
}
function servesDirectory(directory) {
  return typeof directory === "string" && directory !== "" && seenDirectories.has(directory);
}
async function answer(what, call) {
  if (!serviceHost)
    return;
  try {
    await call();
  } catch (e) {
    const status = e && typeof e.status === "number" ? e.status : 0;
    if (status === 404) {
      process.stderr.write("[modelselect] the " + what + ` settled already (404); not retrying
`);
    } else {
      process.stderr.write("[modelselect] the " + what + " could not be answered: " + messageOf(e, "unknown error") + `
`);
    }
  }
}
async function answerPermission(event) {
  const requestId = event.permission && event.permission.requestId;
  if (!requestId)
    return;
  await answer("permission request", () => serviceHost.sessions.answerPermission(event.session.id, requestId, { decision: "allow", message: PERMISSION_MESSAGE }));
}
async function answerQuestion(event, content, directory) {
  const kind = event.question && event.question.kind;
  const sessionId = event.session.id;
  if (kind === "page") {
    await answer("page", () => serviceHost.sessions.send(sessionId, PAGE_MESSAGE));
    return;
  }
  if (kind !== "form")
    return;
  const ask = content && content.ask;
  const formId = event.question && event.question.id || ask && ask.id;
  if (!formId)
    return;
  const fields = ask && Array.isArray(ask.fields) ? ask.fields : [];
  const pick = await readSessionStatus(directory, sessionId);
  const values = computeFormValues(fields, knownValues(directory, pick));
  await answer("form", () => serviceHost.sessions.answerForm(sessionId, formId, values, formMessage(values)));
}
async function handleSessionEvent(bodyText) {
  const request = readSessionEventRequest(bodyText);
  if (!request) {
    return { status: 400, body: { ok: false, error: "Not a session event of this version." } };
  }
  const event = request.event;
  const directory = event.project ? event.project.directory : null;
  if (!servesDirectory(directory)) {
    return { status: 200, body: { ok: true } };
  }
  if (event.type === "permission-asked") {
    await answerPermission(event);
  } else if (event.type === "question-asked") {
    await answerQuestion(event, request.content, directory);
  }
  return { status: 200, body: { ok: true } };
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
function readBody(req, max = BODY_MAX) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > max) {
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
  return raw && path2.isAbsolute(raw) ? raw : null;
}
function messageOf(err, fallback) {
  return String(err && err.message || fallback || err).slice(0, 300);
}
async function reloadOpenCode() {
  const tried = [];
  let last = null;
  for (const port of reloadPorts()) {
    tried.push(port);
    const result = await postJson("http://127.0.0.1:" + port + RELOAD_PATH, null);
    last = result;
    if (result.ok)
      return { ok: true, port, tried };
  }
  return {
    ok: false,
    tried,
    error: "OpenCode config reload failed on " + tried.join(", ") + ": " + String(last && last.error || last && last.status)
  };
}
async function handleControl(directory, body) {
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
      await writeRoutingSync(directory, event.value === "on");
    } catch (e) {
      return { status: 500, body: { message: "Could not write the router-sync file." } };
    }
    if (event.value === "on") {
      syncAt.delete(directory);
      maybeSyncRouting(directory, true).catch(() => {});
    }
    return { status: 200, body: { ok: true } };
  }
  if (event.id === "tier") {
    if (!TIER_VALUES.includes(event.value)) {
      return { status: 400, body: { message: "Tier wants 'auto', 'go' or 'free'." } };
    }
    try {
      await setPluginOption("tier", event.value);
    } catch (e) {
      return { status: 409, body: { message: messageOf(e, "Could not write the plugin options.") } };
    }
    const reload = await reloadOpenCode();
    return {
      status: 200,
      body: {
        ok: true,
        reload: reload.ok ? { ok: true, port: reload.port } : { ok: false, error: reload.error }
      }
    };
  }
  if (event.id === "config-reload") {
    const reload = await reloadOpenCode();
    if (reload.ok)
      return { status: 200, body: { ok: true, port: reload.port, tried: reload.tried } };
    return { status: 502, body: { message: reload.error } };
  }
  return {
    status: 400,
    body: { message: "Unknown control '" + event.id.slice(0, 40) + "'." }
  };
}
async function handleConfigSave(directory, body) {
  let request;
  try {
    request = JSON.parse(body || "{}");
  } catch (e) {
    return { status: 400, body: { message: "The save request is not JSON." } };
  }
  if (!request || typeof request !== "object") {
    return { status: 400, body: { message: "The save request has no body." } };
  }
  if (request.kind === "plugin") {
    let saved;
    try {
      saved = await savePluginOptions(directory, request.values || {});
    } catch (e) {
      const status = /not valid JSON|No modelselect entry/.test(messageOf(e)) ? 409 : 500;
      return { status, body: { message: messageOf(e, "Could not write the managed config.") } };
    }
    const reload = await reloadOpenCode();
    return {
      status: 200,
      body: {
        ok: true,
        entry: {
          form: saved.entry.form,
          package: saved.entry.package,
          options: saved.entry.options
        },
        reload: reload.ok ? { ok: true, port: reload.port } : { ok: false, error: reload.error }
      }
    };
  }
  if (request.kind === "plugin-add") {
    try {
      const added = await addPluginEntry();
      const reload = added.added ? await reloadOpenCode() : { ok: true };
      return {
        status: 200,
        body: {
          ok: true,
          added: added.added,
          entry: {
            form: added.entry.form,
            package: added.entry.package,
            options: publicOptions(added.entry.options)
          },
          reload: reload.ok ? { ok: true, port: reload.port } : { ok: false, error: reload.error }
        }
      };
    } catch (e) {
      const status = /not valid JSON|No modelselect entry/.test(messageOf(e)) ? 409 : 500;
      return { status, body: { message: messageOf(e, "Could not write the managed config.") } };
    }
  }
  if (request.kind === "extension") {
    try {
      const next = await saveExtensionConfig(directory, request.values || {});
      return { status: 200, body: { ok: true, config: next } };
    } catch (e) {
      return { status: 500, body: { message: messageOf(e, "Could not write the extension config.") } };
    }
  }
  return { status: 400, body: { message: "Save wants kind 'plugin' or 'extension'." } };
}
async function handleQuota(bodyText) {
  let request;
  try {
    request = JSON.parse(bodyText || "{}");
  } catch (e) {
    return { ok: false, error: { message: "The quota request is not JSON." } };
  }
  if (!request || typeof request !== "object" || request.method !== "usage.read") {
    return { ok: false, error: { message: "Unexpected quota request." } };
  }
  const directory = await lastProject();
  const usage = directory ? await readUsage(directory) : null;
  if (!usage || typeof usage !== "object") {
    return {
      ok: true,
      data: {
        ok: true,
        configured: false,
        error: "No usage snapshot yet — open a project so the plugin writes one.",
        usage: null
      }
    };
  }
  const windows = {};
  const go = usage.go && typeof usage.go === "object" ? usage.go : null;
  if (go) {
    ["rolling", "weekly", "monthly"].forEach(function(k) {
      const w = go[k];
      if (w && typeof w.percent === "number" && Number.isFinite(w.percent)) {
        windows[k] = {
          usedPercent: Math.max(0, Math.min(100, w.percent)),
          resetAt: typeof w.resetsAt === "number" && w.resetsAt > 0 ? w.resetsAt : null
        };
      }
    });
  }
  const models = {};
  const budgets = Array.isArray(usage.budgets) ? usage.budgets : [];
  budgets.forEach(function(b) {
    if (!b || typeof b !== "object" || !Array.isArray(b.models))
      return;
    b.models.forEach(function(m) {
      if (!m || typeof m !== "object")
        return;
      const key = (m.providerID ? m.providerID + "/" : "") + (m.modelID || m.name || "");
      if (!key)
        return;
      const mw = {};
      if (typeof m.percent === "number" && Number.isFinite(m.percent)) {
        mw.monthly = {
          usedPercent: Math.max(0, Math.min(100, m.percent)),
          resetAt: typeof m.resetsAt === "number" && m.resetsAt > 0 ? m.resetsAt : null
        };
      }
      models[key] = { windows: mw };
    });
  });
  let anyWindow = false;
  Object.values(windows).forEach(function(w) {
    if (w)
      anyWindow = true;
  });
  Object.values(models).forEach(function(mw) {
    Object.values(mw.windows || {}).forEach(function() {
      anyWindow = true;
    });
  });
  return {
    ok: true,
    data: {
      ok: true,
      configured: anyWindow,
      error: anyWindow ? null : "Usage snapshot has no readable windows yet.",
      planLabel: "OpenCode Go / Console",
      usage: {
        windows: Object.keys(windows).length ? windows : null,
        models: Object.keys(models).length ? models : null
      }
    }
  };
}
async function handle(req, res) {
  if (!authorized(req)) {
    send(res, 401, { message: "Unauthorized." });
    return;
  }
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const directory = projectDirectory(url);
  if (req.method === "GET" && url.pathname === "/health") {
    send(res, 200, { ok: true });
    return;
  }
  if (url.pathname === "/status" && req.method === "GET") {
    if (directory) {
      seenDirectories.add(directory);
      rememberProject(directory);
      listStatuses(cacheDirOf(directory)).then((statuses) => touchSessionMap(cacheDirOf(directory), statuses.map((s) => s.sessionID))).catch(() => {});
    }
    send(res, 200, await readView(directory));
    return;
  }
  if (url.pathname === "/status" && req.method === "POST") {
    const answer = await handleControl(directory, await readBody(req));
    send(res, answer.status, answer.body);
    return;
  }
  if (url.pathname === "/config" && req.method === "GET") {
    if (!directory) {
      send(res, 400, { message: "No project is open." });
      return;
    }
    seenDirectories.add(directory);
    rememberProject(directory);
    send(res, 200, await readConfig(directory, url.searchParams.get("session")));
    return;
  }
  if (url.pathname === "/config" && req.method === "POST") {
    const answer = await handleConfigSave(directory, await readBody(req));
    send(res, answer.status, answer.body);
    return;
  }
  if (url.pathname === "/chain" && req.method === "GET") {
    if (!directory) {
      send(res, 400, { message: "No project is open." });
      return;
    }
    const task = String(url.searchParams.get("task") || "").slice(0, 120);
    send(res, 200, await readChain(directory, task));
    return;
  }
  if (url.pathname === "/pick" && req.method === "GET") {
    if (!directory) {
      send(res, 400, { message: "No project is open." });
      return;
    }
    const sessionID = String(url.searchParams.get("session") || "");
    let picked = null;
    if (sessionID) {
      picked = await readSessionStatus(directory, sessionID);
    } else {
      const newest = newestStatus(await listStatuses(cacheDirOf(directory)));
      picked = newest ? newest.data : null;
    }
    const summary = pickSummary(picked, Date.now());
    if (!summary) {
      send(res, 404, { message: "No pick for this session yet — it routes on the first turn." });
      return;
    }
    send(res, 200, summary);
    return;
  }
  if (url.pathname === "/quota" && req.method === "POST") {
    send(res, 200, await handleQuota(await readBody(req)));
    return;
  }
  if (url.pathname === SESSION_EVENTS_PATH && req.method === "POST") {
    const result = await handleSessionEvent(await readBody(req, EVENT_BODY_MAX));
    send(res, result.status, result.body);
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
  const timer = setInterval(() => {
    maintain();
  }, MAINTAIN_EVERY_MS);
  if (typeof timer.unref === "function")
    timer.unref();
  process.stdout.write("[modelselect] listening on 127.0.0.1:" + server.address().port + `
`);
});
function stop() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
