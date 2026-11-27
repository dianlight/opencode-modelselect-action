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
      return /[-:]free$/i.test(str);
    if (/[-:]free$/i.test(ref.modelID))
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
  var MODEL_MISSING_RE = /modelnotfounderror|model\s+unavailable\s*:\s*[\w.-]+\/[\w.-]+|model\s+not\s+found|no\s+such\s+model|model\s+.*?does\s+not\s+exist/i;
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
  function classifyModelMissing(error, bodyText) {
    try {
      return MODEL_MISSING_RE.test(mismatchHaystack(error, bodyText));
    } catch {
      return false;
    }
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
    MODEL_MISSING_RE,
    PROTOCOL_MISMATCH_RE,
    mismatchHaystack,
    classifyModelMissing,
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
    "~/.config/opencode/opencode.jsonc",
    "~/.config/opencode/opencode.json"
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

// ../core/catalog.js
var require_catalog = __commonJS(function(exports, module) {
  var VARIANT_SUFFIXES = ["contributor", "unlimited", "free"];
  var EFFORT_SUFFIXES = [
    "max-effort",
    "high-effort",
    "medium-effort",
    "low-effort",
    "xhigh",
    "high",
    "medium",
    "low",
    "max"
  ];
  var NX_SUFFIX_RE = /-(\d+)x$/;
  var DATE_SUFFIX_RES = [/-(\d{4}-\d{2}-\d{2})$/, /-(\d{8})$/];
  function isObject(v) {
    return Boolean(v) && typeof v === "object" && !Array.isArray(v);
  }
  function bareModelName(value) {
    let name = String(value == null ? "" : value).trim().toLowerCase();
    if (name.includes("/") && !name.startsWith("http"))
      name = name.slice(name.lastIndexOf("/") + 1);
    return name.replace(/\./g, "-");
  }
  function canonicalModel(value) {
    let name = bareModelName(value);
    let changed = true;
    while (changed) {
      changed = false;
      for (const suffix of VARIANT_SUFFIXES.concat(EFFORT_SUFFIXES)) {
        for (const sep of ["-", ":"]) {
          const token = `${sep}${suffix}`;
          if (name.endsWith(token) && name.length > token.length) {
            name = name.slice(0, -token.length);
            changed = true;
            break;
          }
        }
        if (changed)
          continue;
      }
      if (changed)
        continue;
      const nx = NX_SUFFIX_RE.exec(name);
      if (nx && name.slice(0, nx.index)) {
        name = name.slice(0, nx.index);
        changed = true;
        continue;
      }
      for (const rx of DATE_SUFFIX_RES) {
        if (rx.test(name)) {
          name = name.replace(rx, "");
          changed = true;
          break;
        }
      }
    }
    return name;
  }
  function providerSlug(row) {
    if (!isObject(row))
      return "";
    const provider = String(row.provider == null ? "" : row.provider).trim().toLowerCase();
    if (provider)
      return provider;
    const canonical = String(row.canonical == null ? "" : row.canonical).trim().toLowerCase();
    if (canonical)
      return canonical;
    return String(row.providerID ?? "").trim().toLowerCase();
  }
  function rowKey(row) {
    if (!isObject(row))
      return "";
    const provider = String(row.provider ?? row.providerID ?? "").trim();
    const id = String(row.id ?? row.modelID ?? "").trim();
    return provider && id ? `${provider}/${id}` : "";
  }
  function knownCost(value) {
    const n = Number(value);
    return value !== null && value !== undefined && Number.isFinite(n) && n >= 0 ? n : null;
  }
  function classOf(row) {
    if (!isObject(row))
      return "external";
    if (row.free === true)
      return "free";
    const cost = knownCost(row.blended_cost);
    if (cost === 0)
      return "free";
    const provider = String(row.provider ?? row.providerID ?? "").trim().toLowerCase();
    if (provider === "opencode-go")
      return "go-plan";
    if (provider === "opencode")
      return "zen-paid";
    return "external";
  }
  function catalogRows(catalog) {
    if (Array.isArray(catalog))
      return catalog.filter(isObject);
    if (!isObject(catalog))
      return [];
    if (Array.isArray(catalog.models))
      return catalog.models.filter(isObject);
    return [];
  }
  function indexCatalog(catalog) {
    const index = new Map;
    for (const row of catalogRows(catalog)) {
      const id = String(row.id ?? row.modelID ?? "").trim();
      const provider = providerSlug(row);
      if (!id || !provider)
        continue;
      const canonical = canonicalModel(row.canonical || id);
      const normalized = {
        provider,
        id,
        canonical,
        name: row.name ?? id,
        input_cost: knownCost(row.input_cost),
        output_cost: knownCost(row.output_cost),
        blended_cost: knownCost(row.blended_cost),
        context: knownCost(row.context),
        media_in: Array.isArray(row.media_in) ? row.media_in.slice() : null,
        media_out: Array.isArray(row.media_out) ? row.media_out.slice() : null
      };
      normalized.class = classOf(normalized);
      normalized.free = normalized.class === "free";
      normalized.key = rowKey(normalized);
      if (!index.has(canonical))
        index.set(canonical, []);
      index.get(canonical).push(normalized);
    }
    return index;
  }
  function rowsForModel(index, model) {
    if (!index || !index.size)
      return [];
    const raw = String(model == null ? "" : model).trim();
    if (!raw)
      return [];
    const direct = index.get(raw.toLowerCase());
    if (direct)
      return direct;
    const canonical = canonicalModel(raw);
    if (!canonical)
      return [];
    if (index.has(canonical))
      return index.get(canonical);
    const out = [];
    for (const [key, rows] of index) {
      if (key === canonical || key.endsWith(`-${canonical}`) || canonical.endsWith(`-${key}`)) {
        out.push(...rows);
      }
    }
    return out;
  }
  module.exports = {
    bareModelName,
    canonicalModel,
    providerSlug,
    rowKey,
    classOf,
    catalogRows,
    indexCatalog,
    rowsForModel
  };
});

// ../core/chain.js
var require_chain = __commonJS(function(exports, module) {
  var { indexCatalog, rowsForModel, rowKey, classOf } = require_catalog();
  var TIER_CLASSES = {
    free: ["free"],
    paid: ["go-plan", "zen-paid", "external"]
  };
  function isAllowedProvider(row, providers) {
    if (!Array.isArray(providers) || providers.length === 0)
      return true;
    const slug = String(row.provider).toLowerCase();
    return providers.some((p) => {
      const wanted = String(p == null ? "" : p).trim().toLowerCase();
      return wanted && (wanted === slug || wanted === String(row.providerID ?? "").toLowerCase());
    });
  }
  function providerState(availability, row) {
    const providers = availability && availability.providers;
    if (!providers)
      return {};
    const key = String(row.provider).toLowerCase();
    const state = Object.prototype.hasOwnProperty.call(providers, key) ? providers[key] : Object.prototype.hasOwnProperty.call(providers, row.providerID) ? providers[row.providerID] : undefined;
    if (state === undefined || state === true)
      return {};
    if (state === false)
      return { unavailable: true };
    if (state && typeof state === "object")
      return state;
    return {};
  }
  function latched(availability, row) {
    const list = availability && availability.latched;
    if (!list)
      return false;
    const key = rowKey(row);
    if (!key)
      return false;
    if (typeof list.has === "function")
      return list.has(key);
    return Array.isArray(list) && list.includes(key);
  }
  function modelPresent(availability, row) {
    const list = availability && availability.models;
    if (!list)
      return true;
    const key = rowKey(row);
    if (!key)
      return true;
    if (typeof list.has === "function")
      return list.has(key);
    if (Array.isArray(list))
      return list.includes(key);
    return true;
  }
  function supportsMedia(row, media) {
    if (!Array.isArray(media) || media.length === 0)
      return true;
    if (!Array.isArray(row.media_in) || row.media_in.length === 0)
      return true;
    const have = new Set(row.media_in.map((m) => String(m).toLowerCase()));
    return media.every((m) => have.has(String(m).toLowerCase()));
  }
  function withinContext(row, contextNeed) {
    if (!(contextNeed > 0))
      return true;
    const context = Number(row.context);
    if (!Number.isFinite(context) || context <= 0)
      return true;
    return context >= contextNeed;
  }
  function withinBudget(row, maxCost) {
    if (maxCost === null || maxCost === undefined)
      return true;
    const cost = row.blended_cost;
    if (cost === null || cost === undefined)
      return true;
    return Number(cost) <= Number(maxCost);
  }
  function withinSpend(row, state) {
    if (!state || state.budget_remaining === undefined || state.budget_remaining === null)
      return true;
    const remaining = Number(state.budget_remaining);
    if (!Number.isFinite(remaining))
      return true;
    return remaining > 0;
  }
  function exclusionReason(row, { availability, providers, maxCost, media, contextNeed } = {}) {
    if (!isAllowedProvider(row, providers))
      return "provider not allowed";
    const state = providerState(availability, row);
    if (state.unavailable === true || state.available === false)
      return "provider unavailable";
    if (!withinSpend(row, state))
      return "no budget remaining";
    if (!modelPresent(availability, row))
      return "not in runtime inventory";
    if (latched(availability, row))
      return "free quota latched";
    if (!supportsMedia(row, media))
      return "media unsupported";
    if (!withinContext(row, contextNeed))
      return "context too small";
    if (!withinBudget(row, maxCost)) {
      return row.blended_cost === null || row.blended_cost === undefined ? "no cost data (maxCost set)" : `over maxCost $${maxCost}`;
    }
    return null;
  }
  function rankedModels(entry, tier) {
    if (!entry || typeof entry !== "object")
      return [];
    const out = [];
    const seen = new Set;
    const push = (model, score) => {
      const value = String(model == null ? "" : model).trim();
      if (!value)
        return;
      const key = value.toLowerCase();
      if (seen.has(key))
        return;
      seen.add(key);
      out.push({ model: value, score: typeof score === "number" ? score : null });
    };
    const ranked = Array.isArray(entry.ranked) ? entry.ranked : [];
    for (const row of ranked) {
      if (tier && tier !== "abs" && row && !rowMatchesTier(row, tier))
        continue;
      push(row && row.model, row && row.score);
    }
    if (out.length > 0)
      return out;
    const lists = tier === "free" ? ["free_ranked"] : tier === "go" ? ["go_ranked"] : ["go_ranked", "free_ranked"];
    for (const field of lists) {
      const list = Array.isArray(entry[field]) ? entry[field] : [];
      for (const row of list)
        push(row && row.model, row && row.score);
    }
    if (out.length === 0) {
      push(entry.go, null);
      push(entry.free, null);
    }
    return out;
  }
  function rowMatchesTier(row, tier) {
    if (!row || typeof row !== "object")
      return false;
    if (row.free === undefined && row.class === undefined)
      return true;
    const isFree = row.free === true || String(row.class).toLowerCase() === "free";
    return tier === "free" ? isFree : !isFree;
  }
  function sortRows(rows) {
    return rows.slice().sort((a, b) => {
      const ca = a.blended_cost;
      const cb = b.blended_cost;
      if (ca === null && cb === null)
        return 0;
      if (ca === null)
        return 1;
      if (cb === null)
        return -1;
      if (ca !== cb)
        return ca - cb;
      return String(a.provider).localeCompare(String(b.provider));
    });
  }
  function buildChain({
    entry,
    catalog,
    availability,
    mode = "auto",
    preference = "free-first",
    media,
    contextNeed = 0,
    maxCost = null,
    providers = null
  } = {}) {
    const index = indexCatalog(catalog);
    const tier = mode === "free" ? "free" : mode === "go" ? "go" : "abs";
    const seen = new Set;
    const candidates = [];
    for (const ranked of rankedModels(entry, tier)) {
      const rows = sortRows(rowsForModel(index, ranked.model));
      for (const row of rows) {
        if (!row.key || seen.has(row.key))
          continue;
        seen.add(row.key);
        if (exclusionReason(row, { availability, providers, maxCost, media, contextNeed }))
          continue;
        candidates.push({
          provider: row.provider,
          model: row.id,
          ref: row.key,
          canonical: row.canonical,
          class: classOf(row),
          cost: row.blended_cost,
          context: row.context,
          media_in: row.media_in,
          score: ranked.score
        });
      }
    }
    if (mode === "abs") {
      return candidates.slice().sort((a, b) => {
        const sa = a.score === null ? -Infinity : a.score;
        const sb = b.score === null ? -Infinity : b.score;
        if (sb !== sa)
          return sb - sa;
        return (a.cost === null ? Infinity : a.cost) - (b.cost === null ? Infinity : b.cost);
      });
    }
    const free = candidates.filter((c) => c.class === "free");
    const paid = candidates.filter((c) => c.class !== "free");
    const freeFirst = mode === "free" ? true : mode === "go" ? false : preference !== "go-first";
    return freeFirst ? free.concat(paid) : paid.concat(free);
  }
  function nextCandidate(chain, tried) {
    if (!Array.isArray(chain))
      return null;
    const done = new Set((Array.isArray(tried) ? tried : []).map((t) => String(t == null ? "" : t).trim()).filter(Boolean));
    for (const row of chain) {
      if (!row)
        continue;
      const ref = String(row.ref ?? `${row.provider}/${row.model}`);
      if (!done.has(ref))
        return row;
    }
    return null;
  }
  function partitionTiers(chain) {
    const free = [];
    const paid = [];
    for (const row of Array.isArray(chain) ? chain : []) {
      if (!row)
        continue;
      (row.class === "free" ? free : paid).push(row);
    }
    return { free, paid };
  }
  module.exports = {
    TIER_CLASSES,
    buildChain,
    nextCandidate,
    partitionTiers,
    rankedModels,
    isAllowedProvider,
    providerState,
    latched,
    modelPresent,
    supportsMedia,
    withinContext,
    withinBudget,
    withinSpend,
    exclusionReason,
    sortRows
  };
});

// ../core/registry.js
var require_registry = __commonJS(function(exports, module) {
  var { classOf, canonicalModel, providerSlug } = require_catalog();
  var { exclusionReason } = require_chain();
  var V2_SCHEMA_VERSION = 2;
  var ENGINE_PROVIDERS = new Set(["opencode", "opencode-go"]);
  function isObject(v) {
    return Boolean(v) && typeof v === "object" && !Array.isArray(v);
  }
  function str(v) {
    return v == null ? "" : String(v).trim();
  }
  function knownCost(value) {
    const n = Number(value);
    return value !== null && value !== undefined && Number.isFinite(n) && n >= 0 ? n : null;
  }
  function taskTableV2(config) {
    if (!isObject(config))
      return null;
    const table = config["task-types-v2"] ?? config.task_types_v2;
    return isObject(table) ? table : null;
  }
  function taskEntryV2(config, taskType) {
    const table = taskTableV2(config);
    if (!table)
      return null;
    const wanted = str(taskType).toLowerCase();
    const key = Object.keys(table).find((k) => String(k).toLowerCase() === wanted);
    if (!key)
      return null;
    const entry = table[key];
    if (!isObject(entry))
      return null;
    const modelsRaw = Array.isArray(entry.models) ? entry.models : null;
    const models = modelsRaw ? modelsRaw.map((m) => str(m && (typeof m === "string" ? m : m.model))).filter(Boolean) : [];
    const model = str(entry.model) || (models.length ? models[0] : "");
    if (!model && models.length === 0)
      return null;
    if (models.length === 0 && model)
      models.push(model);
    return { key, entry, model, models };
  }
  function registryModels(registry) {
    if (!isObject(registry))
      return {};
    if (Array.isArray(registry.models)) {
      const out = {};
      for (const model of registry.models) {
        if (!isObject(model))
          continue;
        const id = str(model.id ?? model.model);
        if (id)
          out[id] = model;
      }
      return out;
    }
    if (isObject(registry.models))
      return registry.models;
    return {};
  }
  function modelEntry(registry, modelId) {
    const models = registryModels(registry);
    const raw = str(modelId);
    if (!raw)
      return null;
    if (isObject(models[raw]))
      return models[raw];
    const lower = raw.toLowerCase();
    for (const [key, value] of Object.entries(models)) {
      if (String(key).toLowerCase() === lower && isObject(value))
        return value;
    }
    const canonical = canonicalModel(raw);
    if (!canonical)
      return null;
    for (const [key, value] of Object.entries(models)) {
      if (!isObject(value))
        continue;
      const id = str(value.id ?? key);
      if (canonicalModel(id) === canonical)
        return value;
    }
    return null;
  }
  function variantRows(entry) {
    if (!isObject(entry))
      return [];
    const baseScore = typeof entry.score === "number" && Number.isFinite(entry.score) ? entry.score : null;
    const out = [];
    const seen = new Set;
    for (const variant of Array.isArray(entry.variants) ? entry.variants : []) {
      if (!isObject(variant))
        continue;
      const provider = providerSlug(variant);
      const model = str(variant.model ?? variant.id);
      if (!provider || !model)
        continue;
      const key = `${provider}/${model}`;
      if (seen.has(key))
        continue;
      seen.add(key);
      const cost = knownCost(variant.cost ?? variant.blended_cost);
      const score = typeof variant.score === "number" && Number.isFinite(variant.score) ? variant.score : baseScore;
      const normalized = {
        provider,
        model,
        id: model,
        canonical: canonicalModel(variant.canonical ?? entry.id ?? model),
        name: variant.name ?? entry.name ?? model,
        free: variant.free === true || cost === 0,
        cost,
        blended_cost: cost,
        input_cost: knownCost(variant.input_cost),
        output_cost: knownCost(variant.output_cost),
        context: knownCost(variant.context),
        output: knownCost(variant.output),
        monthly_usage: isObject(variant.monthly_usage) ? { ...variant.monthly_usage } : null,
        media_in: Array.isArray(variant.media_in) ? variant.media_in.slice() : null,
        score,
        key,
        ref: key
      };
      normalized.class = classOf(normalized);
      normalized.free = normalized.class === "free";
      out.push(normalized);
    }
    return out;
  }
  function engineRank(row) {
    return ENGINE_PROVIDERS.has(providerSlug(row)) ? 0 : 1;
  }
  function compareVariants(a, b) {
    const sa = a.score === null ? -Infinity : a.score;
    const sb = b.score === null ? -Infinity : b.score;
    if (sb !== sa)
      return sb - sa;
    const ca = a.cost === null ? Infinity : a.cost;
    const cb = b.cost === null ? Infinity : b.cost;
    if (ca !== cb)
      return ca - cb;
    const ea = engineRank(a);
    const eb = engineRank(b);
    if (ea !== eb)
      return ea - eb;
    const pa = String(a.provider).localeCompare(String(b.provider));
    if (pa !== 0)
      return pa;
    return String(a.model).localeCompare(String(b.model));
  }
  function rankVariants(rows, { preference = "free-first", tier = null } = {}) {
    const list = (Array.isArray(rows) ? rows : []).filter(isObject);
    const freeFirst = tier === "free" ? true : tier === "go" ? false : preference !== "go-first";
    const free = list.filter((r) => r.free === true || r.class === "free").sort(compareVariants);
    const paid = list.filter((r) => !(r.free === true || r.class === "free")).sort(compareVariants);
    return freeFirst ? free.concat(paid) : paid.concat(free);
  }
  function poolVariants(taskEntry, registry) {
    if (!isObject(taskEntry))
      return [];
    const models = Array.isArray(taskEntry.models) && taskEntry.models.length ? taskEntry.models.map((m) => str(m && (typeof m === "string" ? m : m.model))).filter(Boolean) : [str(taskEntry.model ?? taskEntry.id)].filter(Boolean);
    const seenKeys = new Set;
    const pooled = [];
    for (const model of models) {
      const entry = modelEntry(registry, model);
      if (!entry)
        continue;
      for (const row of variantRows(entry)) {
        if (seenKeys.has(row.key))
          continue;
        seenKeys.add(row.key);
        pooled.push(row);
      }
    }
    return pooled;
  }
  function candidateFrom(row) {
    return {
      provider: row.provider,
      model: row.model,
      ref: row.ref,
      canonical: row.canonical,
      class: row.class,
      cost: row.cost,
      context: row.context,
      media_in: row.media_in,
      score: row.score
    };
  }
  function buildV2Chain({
    taskEntry,
    registry,
    availability,
    preference = "free-first",
    tier = null,
    media,
    contextNeed = 0,
    maxCost = null,
    providers = null
  } = {}) {
    const pooled = poolVariants(taskEntry, registry);
    if (pooled.length === 0)
      return [];
    const candidates = [];
    for (const row of pooled) {
      if (exclusionReason(row, { availability, providers, maxCost, media, contextNeed }))
        continue;
      candidates.push(candidateFrom(row));
    }
    return rankVariants(candidates, { preference, tier });
  }
  function excludedVariants({
    taskEntry,
    registry,
    availability,
    preference = "free-first",
    tier = null,
    media,
    contextNeed = 0,
    maxCost = null,
    providers = null
  } = {}) {
    const pooled = poolVariants(taskEntry, registry);
    if (pooled.length === 0)
      return [];
    const ranked = rankVariants(pooled.map(candidateFrom), { preference, tier });
    const byRef = new Map(pooled.map((row) => [row.ref, row]));
    const out = [];
    for (const candidate of ranked) {
      const row = byRef.get(candidate.ref);
      const reason = row && exclusionReason(row, { availability, providers, maxCost, media, contextNeed });
      if (reason)
        out.push({ ref: candidate.ref, reason });
    }
    return out;
  }
  module.exports = {
    V2_SCHEMA_VERSION,
    taskTableV2,
    taskEntryV2,
    registryModels,
    modelEntry,
    variantRows,
    compareVariants,
    rankVariants,
    buildV2Chain,
    excludedVariants
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
  MODELSELECT_CONFIG_PATH: () => MODELSELECT_CONFIG_PATH,
  PLUGIN_CONFIG_PATH: () => PLUGIN_CONFIG_PATH,
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
  readConfigV2: () => readConfigV2,
  readExtensionConfig: () => readExtensionConfig,
  readJsonAt: () => readJsonAt,
  readJsonFile: () => readJsonFile,
  readLatch: () => readLatch,
  readPluginConfig: () => readPluginConfig,
  readRegistry: () => readRegistry,
  readRoutingSync: () => readRoutingSync,
  readRuntimeInventory: () => readRuntimeInventory,
  readSessionDelivery: () => readSessionDelivery,
  readSessionStatus: () => readSessionStatus,
  readUsage: () => readUsage,
  rememberProject: () => rememberProject,
  resolveLogicalPath: () => resolveLogicalPath,
  sanitizeSessionID: () => sanitizeSessionID,
  saveExtensionConfig: () => saveExtensionConfig,
  savePluginOptions: () => savePluginOptions,
  sessionAnswersEnabled: () => sessionAnswersEnabled,
  sessionDeliveryFile: () => sessionDeliveryFile,
  setPluginOption: () => setPluginOption,
  storedPluginOptions: () => storedPluginOptions,
  writeJsonAt: () => writeJsonAt,
  writeJsonAtomic: () => writeJsonAtomic,
  writeRoutingSync: () => writeRoutingSync,
  writeSessionDelivery: () => writeSessionDelivery
});

// service/src/main.js
import http from "node:http";
var import_routing3 = __toESM(require_routing(), 1);
var import_free_quota2 = __toESM(require_free_quota(), 1);
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
var SERVICE_SCHEDULE_PATH = "/schedule";
var SERVICE_SCHEDULE_WIRE_VERSION = 1;
var SERVICE_SCHEDULE_IDLE_MS = 10 * 60000;
var readServiceScheduleRequest = (body) => {
  let wire;
  try {
    wire = JSON.parse(body);
  } catch {
    return null;
  }
  if (Object(wire) !== wire || wire === null)
    return null;
  const { v, requestId, id, at } = wire;
  if (v !== SERVICE_SCHEDULE_WIRE_VERSION)
    return null;
  if (String(requestId) !== requestId || requestId.length === 0)
    return null;
  if (String(id) !== id || id.length === 0)
    return null;
  if (!Number.isFinite(at))
    return null;
  return { v: SERVICE_SCHEDULE_WIRE_VERSION, requestId, id, at: Number(at) };
};
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
// node_modules/@openchamber/sdk/dist/waits.js
var WAITS_START_PATH = "/waits/start";
var WAITS_CHECK_PATH = "/waits/check";
var WAITS_WIRE_VERSION = 1;
var WAIT_SUMMARY_MAX = 2000;
var parseBody = (body) => {
  try {
    const parsed = JSON.parse(body);
    return Object(parsed) === parsed && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
var argsOf = (wire) => {
  if (Object(wire) !== wire || wire === undefined || Array.isArray(wire))
    return null;
  const args = {};
  for (const [name, entry] of Object.entries(wire)) {
    if (String(entry) !== entry && !Number.isFinite(entry) && entry !== true && entry !== false)
      return null;
    args[name] = entry;
  }
  return args;
};
var readWaitStartRequest = (body) => {
  const wire = parseBody(body);
  if (!wire || wire.v !== WAITS_WIRE_VERSION)
    return null;
  const { requestId, wait } = wire;
  if (String(requestId) !== requestId || requestId.length === 0)
    return null;
  if (Object(wait) !== wait || wait === undefined)
    return null;
  const { id, type, session } = wait;
  if (String(id) !== id || id.length === 0 || String(type) !== type || type.length === 0)
    return null;
  const args = argsOf(wait.args);
  if (!args)
    return null;
  if (Object(session) !== session || session === undefined)
    return null;
  const sessionId = session.id;
  if (String(sessionId) !== sessionId || sessionId.length === 0)
    return null;
  const directory = session.directory;
  if (directory !== null && (String(directory) !== directory || directory.length === 0))
    return null;
  return { v: WAITS_WIRE_VERSION, requestId, wait: { id, type, args, session: { id: sessionId, directory } } };
};
var readWaitCheckRequest = (body) => {
  const wire = parseBody(body);
  if (!wire || wire.v !== WAITS_WIRE_VERSION)
    return null;
  const { requestId } = wire;
  if (String(requestId) !== requestId || requestId.length === 0 || !Array.isArray(wire.waits))
    return null;
  const waits = [];
  for (const entry of wire.waits) {
    if (Object(entry) !== entry || entry.state === undefined)
      return null;
    const { id, type, state } = entry;
    if (String(id) !== id || id.length === 0 || String(type) !== type || type.length === 0)
      return null;
    const args = argsOf(entry.args);
    if (!args)
      return null;
    waits.push({ id, type, args, state });
  }
  return { v: WAITS_WIRE_VERSION, requestId, waits };
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
  "generate-late",
  "microphone-audio",
  "microphone-ended"
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
var DELIVERY_MAX = 160;
var ICON = {
  task: "task-line",
  tier: "stack-line",
  model: "cpu-line",
  think: "brain-line",
  jev: "lightbulb-line",
  source: "git-branch-line",
  updated: "time-line",
  usage: "pie-chart-2-line",
  delivery: "pulse-line"
};
var ROUTING_OPTIONS = [{ value: "on", label: "On" }, { value: "off", label: "Off" }];
var TIER_OPTIONS = [
  { value: "auto", label: "auto" },
  { value: "go", label: "go" },
  { value: "free", label: "free" }
];
var MISSING_NOTE = "ModelSelect plugin not in the global opencode.json(c) — " + "the extension card shows the fix; only this section stays empty.";
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
var ALLOWANCE_PLANS = { go: "Go", "go-plus": "Plus", "go-teams": "Teams" };
function compactTokens(v) {
  if (typeof v !== "number" || !Number.isFinite(v))
    return "—";
  if (v >= 1e6)
    return Math.round(v / 1e4) / 100 + "M";
  if (v >= 1000)
    return Math.round(v / 1000) + "k";
  return String(v);
}
function capsToolTip(caps) {
  if (!caps || typeof caps !== "object")
    return "";
  const parts = [];
  if (typeof caps.output === "number" && caps.output > 0) {
    parts.push("output cap " + compactTokens(caps.output) + " tokens/request");
  }
  const mu = caps.monthlyUsage;
  if (mu && typeof mu === "object") {
    Object.keys(ALLOWANCE_PLANS).forEach((key) => {
      if (typeof mu[key] === "number" && mu[key] > 0) {
        parts.push(ALLOWANCE_PLANS[key] + " allowance $" + mu[key] + "/mo");
      }
    });
  }
  if (!parts.length)
    return "";
  return " · " + parts.join("; ") + " — Go allowance is shared dollars, not a token budget";
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
        if (rows.length >= ROWS_MAX)
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
    ...row.icon ? { icon: row.icon } : {},
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
    icon: ICON.task,
    value: status.taskType || "—",
    ...unlisted ? { badge: { label: "unlisted task", tone: "warning" } } : {},
    ...unlisted ? { tooltip: "This task type is not in the plugin model config." } : {}
  }));
  rows.push(line({
    id: "tier",
    label: "Tier",
    icon: ICON.tier,
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
    icon: ICON.model,
    value: status.model || "—",
    ...status.suggestOnly ? { badge: { label: "suggest only", tone: "info" } } : {},
    tooltip: (status.suggestOnly ? "Suggest-only trial mode — the pick is logged but never applied. " : "") + str(status.model) + capsToolTip(snap.pickedCaps)
  }));
  rows.push(line({
    id: "think",
    label: "Think",
    icon: ICON.think,
    value: thinkLabel(status),
    tooltip: "Effective effort" + (status.variant ? " (manual override)" : " (task default)")
  }));
  rows.push(line({ id: "jev", label: "Jev", icon: ICON.jev, value: status.jev || "—" }));
  rows.push(line({ id: "source", label: "Source", icon: ICON.source, value: status.source || "—" }));
  rows.push(line({
    id: "updated",
    label: "Updated",
    icon: ICON.updated,
    value: formatAge(now, status.updatedAt),
    ...stale ? { badge: { label: "last known", tone: "warning" } } : {},
    tooltip: "Session " + (snap.sessionID || "unknown") + " · " + (typeof status.updatedAt === "number" ? new Date(status.updatedAt).toISOString() : "no timestamp") + (stale ? " — the pick has not been rewritten for a while (stale by design outside routed turns)." : "")
  }));
}
function deliveryLine(delivery) {
  if (!delivery || typeof delivery !== "object")
    return "";
  const activity = str(delivery.activity);
  if (["running", "idle", "failed"].indexOf(activity) === -1)
    return "";
  const detail = activity === "failed" ? str(delivery.error) : str(delivery.reply);
  return cut(activity + (detail ? " — " + detail : ""), DELIVERY_MAX);
}
function deliveryRow(snap, rows) {
  const lineText = deliveryLine(snap.delivery);
  if (!lineText || rows.length >= ROWS_MAX)
    return;
  const activity = str(snap.delivery.activity);
  const at = typeof snap.delivery.at === "number" && Number.isFinite(snap.delivery.at) ? snap.delivery.at : null;
  rows.push(line({
    id: "delivery",
    label: "Delivery",
    icon: ICON.delivery,
    value: activity,
    dot: activity === "failed" ? "error" : activity === "idle" ? "success" : "info",
    tooltip: "Host session event" + (at ? " at " + new Date(at).toISOString() : "") + " · " + lineText
  }));
}
function pickSummary(status, now, delivery) {
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
  const deliveryText = deliveryLine(delivery);
  if (deliveryText)
    parts.push(deliveryText);
  return {
    text: parts.join(" · "),
    delivery: deliveryText,
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
    deliveryRow(snap, rows);
  }
  const u = usageMonthly(snap.usage);
  if (u) {
    rows.push(line({
      id: "usage",
      label: "Go monthly",
      icon: ICON.usage,
      content: { kind: "bar", value: u.percent, tone: usageTone(u.percent, u.limited) },
      value: Math.round(u.percent) + "%",
      valueTone: u.limited ? "error" : undefined,
      tooltip: usageDetail(u, now)
    }));
  }
  budgetRows(snap.usage, rows, now);
  const fresh = latchEntries(snap.freeQuota).filter((entry) => freeQuotaFresh(entry, now));
  fresh.forEach((entry, index) => {
    if (rows.length >= ROWS_MAX)
      return;
    const rateLimited = entry.kind === "rate-limit";
    const head = (rateLimited ? "Rate limited" : "Free tier exhausted") + (entry.model ? " — " + entry.model : "");
    const detail = str(entry.detail).trim();
    const text = head + " — retry in " + formatCountdown(Number(entry.until) - now) + (detail ? " · " + detail : "");
    rows.push(note(idOf("free-" + (entry.model || "all") + "-" + index), text, "warning"));
  });
  return {
    rows: rows.slice(0, ROWS_MAX),
    controls: [{
      kind: "select",
      id: "routing-sync",
      label: "Auto-update router",
      value: snap.sync ? "on" : "off",
      options: ROUTING_OPTIONS
    }]
  };
}

// service/src/chain.js
var import_lookup = __toESM(require_lookup(), 1);
var import_model_ref = __toESM(require_model_ref(), 1);
var import_budget = __toESM(require_budget(), 1);
var import_free_quota = __toESM(require_free_quota(), 1);
var import_registry = __toESM(require_registry(), 1);
var { entryFor } = import_lookup.default;
var { firstPaidModel } = import_model_ref.default;
var { selectWithinBudget } = import_budget.default;
var { latchEntries: latchEntries2, freeQuotaFresh: freeQuotaFresh2, latchKeyApplies } = import_free_quota.default;
var { taskEntryV2, modelEntry, variantRows, buildV2Chain } = import_registry.default;
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
function previewGoVeto(usage, token) {
  try {
    const go = usage && usage.go && typeof usage.go === "object" ? usage.go : null;
    let hard = false;
    let percent = null;
    let resetsAt = null;
    if (go) {
      ["rolling", "weekly", "monthly"].forEach((k) => {
        const w = go[k];
        if (!w || typeof w !== "object")
          return;
        const p = Number(w.percent);
        if (Number.isFinite(p) && (percent === null || p > percent))
          percent = p;
        if (w.limited === true || Number.isFinite(p) && p >= 100)
          hard = true;
        if (w.limited === true && typeof w.resetsAt === "number" && w.resetsAt > 0)
          resetsAt = w.resetsAt;
      });
    }
    let budget = false;
    const budgets = usage && Array.isArray(usage.budgets) ? usage.budgets : [];
    for (const b of budgets) {
      if (!b || typeof b !== "object")
        continue;
      const p = Number(b.percent);
      if (b.limited === true || Number.isFinite(p) && p >= 100)
        budget = true;
    }
    return { veto: hard || budget, hard, budget, percent, resetsAt, token: Boolean(token) };
  } catch (e) {
    return { veto: false, hard: false, budget: false, percent: null, resetsAt: null, token: Boolean(token) };
  }
}
function inventoryKeys(snapshot, now) {
  try {
    if (!snapshot || typeof snapshot.fetchedAt !== "number" || Number(now) - snapshot.fetchedAt > 60 * 1000 || !Array.isArray(snapshot.models))
      return null;
    const keys = new Set;
    for (const m of snapshot.models) {
      if (!m || m.enabled === false)
        continue;
      const provider = str2(m.providerID).trim().toLowerCase();
      const id = str2(m.id).trim();
      if (provider && id)
        keys.add(provider + "/" + id);
    }
    return keys.size ? keys : null;
  } catch (e) {
    return null;
  }
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
    if (/quota latched|rate-limited|over maxCost|no cost data|quota spent|not in runtime inventory/.test(reason))
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
function computeModelsView({ taskType, catalogConfig, configV2, options, latchData, usage, registry, runtimeInventory, now }) {
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
  const providersRaw = optOf(options, "availableProviders", "available-providers", "");
  const allowedProviders = (Array.isArray(providersRaw) ? providersRaw : str2(providersRaw).split(",")).map((p) => str2(p).trim().toLowerCase()).filter(Boolean);
  const providerAllowed = (provider) => allowedProviders.length === 0 || allowedProviders.indexOf(str2(provider).toLowerCase()) !== -1;
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
  const goVeto = previewGoVeto(usage, options && options.token);
  const availability = {
    providers: goVeto.veto ? { "opencode-go": { budget_remaining: 0 } } : {},
    models: inventoryKeys(runtimeInventory, at)
  };
  const chainProviders = allowedProviders.length ? allowedProviders : null;
  const goBlocked = (provider) => goVeto.veto && str2(provider).toLowerCase() === "opencode-go";
  const goReason = "go quota spent" + (goVeto.resetsAt ? " · resets " + formatCountdown2(goVeto.resetsAt - at) : "");
  const v2Task = registry ? taskEntryV2(configV2 || {}, taskType) : null;
  if (v2Task) {
    const v2 = previewV2(v2Task);
    if (v2)
      return v2;
  }
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
  function previewV2(v2TaskEntry) {
    let ordered = [];
    try {
      ordered = buildV2Chain({
        taskEntry: v2TaskEntry.entry,
        registry,
        availability,
        preference,
        tier: tier === "go" || tier === "free" ? tier : null,
        maxCost,
        providers: chainProviders
      });
    } catch (e) {
      return null;
    }
    let all = [];
    try {
      const modelIds = Array.isArray(v2TaskEntry.entry && v2TaskEntry.entry.models) && v2TaskEntry.entry.models.length ? v2TaskEntry.entry.models : [v2TaskEntry.model];
      const seen = new Set;
      for (const mid of modelIds) {
        const e = modelEntry(registry, typeof mid === "string" ? mid : mid && mid.model);
        if (!e)
          continue;
        for (const row of variantRows(e)) {
          if (seen.has(row.key))
            continue;
          seen.add(row.key);
          all.push(row);
        }
      }
    } catch (e) {
      all = [];
    }
    if (!all.length)
      return null;
    const hitFor = (variant) => latchHitFor(variant.ref) || latchHitFor(variant.model);
    const usable = ordered.filter((c) => !hitFor(c));
    const pickRow = usable[0] || null;
    const pickName = pickRow ? pickRow.ref : "";
    const side = pickRow ? pickRow.class === "free" ? "free" : "go" : preference === "go-first" ? "go" : "free";
    const rank = new Map;
    ordered.forEach((c, i) => rank.set(c.ref, i));
    const rows = all.slice().sort((a, b) => (rank.has(a.ref) ? rank.get(a.ref) : 1000) - (rank.has(b.ref) ? rank.get(b.ref) : 1000)).map((variant) => {
      const rowSide = variant.class === "free" ? "free" : "go";
      const view = {
        model: variant.ref,
        provider: variant.provider,
        id: variant.model,
        score: typeof variant.score === "number" ? variant.score : null,
        cost: typeof variant.cost === "number" ? variant.cost : null,
        context: typeof variant.context === "number" && variant.context > 0 ? variant.context : null,
        output: typeof variant.output === "number" && variant.output > 0 ? variant.output : null,
        monthlyUsage: variant.monthly_usage && typeof variant.monthly_usage === "object" ? variant.monthly_usage : null,
        modalities: Array.isArray(variant.media_in) ? variant.media_in.filter(function(m) {
          return typeof m === "string" && m;
        }) : null,
        inputCost: typeof variant.input_cost === "number" ? variant.input_cost : null,
        outputCost: typeof variant.output_cost === "number" ? variant.output_cost : null,
        side: rowSide,
        status: "ok",
        reason: "",
        latchText: ""
      };
      if (variant.ref === pickName) {
        view.status = "pick";
        return view;
      }
      const hit = hitFor(variant);
      if (hit) {
        view.status = "excluded";
        view.reason = (hit.kind === "rate-limit" ? "rate-limited" : "quota latched") + " · retry in " + formatCountdown2(hit.until - at);
        view.latchText = view.reason;
        return view;
      }
      if (!providerAllowed(variant.provider)) {
        view.status = "excluded";
        view.reason = "provider not allowed";
        return view;
      }
      if (goBlocked(variant.provider)) {
        view.status = "excluded";
        view.reason = goReason;
        return view;
      }
      if (maxCost !== null && (view.cost === null || view.cost > maxCost)) {
        view.status = "excluded";
        view.reason = view.cost === null ? "no cost data (cap set)" : "over maxCost $" + maxCost;
        return view;
      }
      if (availability.models && !availability.models.has(variant.ref)) {
        view.status = "excluded";
        view.reason = "not in runtime inventory";
        return view;
      }
      if (rank.has(variant.ref)) {
        view.status = "standby";
        view.reason = "failover #" + (rank.get(variant.ref) + 1);
        return view;
      }
      view.status = "excluded";
      view.reason = "unavailable in this runtime";
      return view;
    });
    rows.forEach((r) => {
      r.bar = usageBar(r, usage, at);
    });
    const fallbackPick = !pickName && fallback ? fallback : null;
    let blocked = "";
    if (!pickName) {
      const why = [];
      if (goVeto.veto)
        why.push("Go quota spent");
      if (fresh.length)
        why.push("free tier latched");
      if (maxCost !== null)
        why.push("maxCost $" + maxCost);
      if (availability.models)
        why.push("runtime inventory");
      blocked = why.length ? why.join(" + ") : "no usable variant";
    }
    return {
      found: true,
      key,
      side,
      sideNote: "v2 · model=" + str2(v2TaskEntry.model) + " · " + preference,
      maxCost,
      fallback,
      pick: pickName || fallbackPick,
      pickSource: pickName ? "chain" : fallbackPick ? "fallback" : null,
      pickNote: pickName ? "" : fallbackPick ? "All variants blocked (" + blocked + ") — fallback" : "All variants blocked (" + blocked + ")",
      chain: rows,
      registry: true
    };
  }
  const chainKeys = [];
  [side, otherSide].forEach((s) => {
    sortRanked(entry[s + "_ranked"]).forEach((row) => {
      const key = str2(row.model);
      if (!key || chainKeys.indexOf(key) !== -1)
        return;
      if (latchHitFor(key))
        return;
      if (!providerAllowed(splitName(key).provider))
        return;
      if (goBlocked(splitName(key).provider))
        return;
      if (maxCost !== null && (rowCost(row) === null || rowCost(row) > maxCost))
        return;
      if (availability.models && !availability.models.has(key))
        return;
      chainKeys.push(key);
    });
  });
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
      output: typeof row.output === "number" && row.output > 0 ? row.output : null,
      monthlyUsage: row.monthly_usage && typeof row.monthly_usage === "object" ? row.monthly_usage : null,
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
    if (!providerAllowed(parts.provider)) {
      view.status = "excluded";
      view.reason = "provider not allowed";
      return view;
    }
    if (goBlocked(parts.provider)) {
      view.status = "excluded";
      view.reason = goReason;
      return view;
    }
    if (availability.models && !availability.models.has(name)) {
      view.status = "excluded";
      view.reason = "not in runtime inventory";
      return view;
    }
    const rank = chainKeys.indexOf(name);
    if (rank !== -1) {
      view.status = "standby";
      view.reason = "failover #" + (rank + 1);
      return view;
    }
    view.status = "excluded";
    view.reason = s !== side ? "off-side · " + sideNote : "unavailable in this runtime";
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
var MODELSELECT_CONFIG_PATH = "~/.config/openchamber/modelselect.json";
var GLOBAL_CONFIG_PATHS = [
  "~/.config/opencode/opencode.jsonc",
  "~/.config/opencode/opencode.json"
];
var PLUGIN_CONFIG_PATH = GLOBAL_CONFIG_PATHS[0];
var ROUTING_SYNC_FILE = "routing-sync.json";
var PLUGIN_PACKAGE = "@dianlight/opencode-modelselect-plugin";
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
function decodeJsonString(literal) {
  try {
    return JSON.parse(literal);
  } catch (e) {
    return "";
  }
}
function jsonTokens(raw) {
  const out = [];
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (c === '"') {
      const start = i;
      i += 1;
      while (i < raw.length) {
        if (raw[i] === "\\") {
          i += 2;
          continue;
        }
        if (raw[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      out.push({ type: "string", start, end: i, value: decodeJsonString(raw.slice(start, i)) });
      continue;
    }
    if (c === "/" && raw[i + 1] === "/") {
      while (i < raw.length && raw[i] !== `
`)
        i += 1;
      continue;
    }
    if (c === "/" && raw[i + 1] === "*") {
      i += 2;
      while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/"))
        i += 1;
      i += 2;
      continue;
    }
    if (c === "{" || c === "}" || c === "[" || c === "]")
      out.push({ type: c, start: i, end: i + 1 });
    i += 1;
  }
  return out;
}
function matchBracket(tokens, openIndex) {
  const open = tokens[openIndex].type;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = openIndex;i < tokens.length; i += 1) {
    if (tokens[i].type === open)
      depth += 1;
    else if (tokens[i].type === close) {
      depth -= 1;
      if (depth === 0)
        return i;
    }
  }
  return -1;
}
function lineIndent(raw, pos) {
  const lineStart = raw.lastIndexOf(`
`, Math.max(0, pos - 1)) + 1;
  const m = /^\s*/.exec(raw.slice(lineStart));
  return m ? m[0] : "";
}
function prettyAt(value, indent) {
  return JSON.stringify(value, null, 2).split(`
`).map((line, i) => i === 0 ? line : indent + line).join(`
`);
}
function findOptionsBlock(raw, packageName) {
  const tokens = jsonTokens(raw);
  const pkgIdx = tokens.findIndex((t) => t.type === "string" && t.value === packageName);
  if (pkgIdx < 0)
    return null;
  let openIdx = -1;
  let depth = 0;
  for (let i = pkgIdx - 1;i >= 0; i -= 1) {
    if (tokens[i].type === "}")
      depth += 1;
    else if (tokens[i].type === "{") {
      if (depth === 0) {
        openIdx = i;
        break;
      }
      depth -= 1;
    }
  }
  if (openIdx < 0)
    return null;
  const entryClose = matchBracket(tokens, openIdx);
  if (entryClose < 0)
    return null;
  for (let i = pkgIdx + 1;i < entryClose; i += 1) {
    if (tokens[i].type !== "string" || tokens[i].value !== "options")
      continue;
    let braceIdx = -1;
    for (let j = i + 1;j < entryClose; j += 1) {
      if (tokens[j].type === "{") {
        braceIdx = j;
        break;
      }
      if (tokens[j].type !== ":" && tokens[j].type !== "string")
        break;
    }
    if (braceIdx < 0)
      break;
    const endIdx = matchBracket(tokens, braceIdx);
    if (endIdx < 0 || endIdx > entryClose)
      break;
    return {
      start: tokens[braceIdx].start,
      end: tokens[endIdx].end,
      indent: lineIndent(raw, tokens[braceIdx].start),
      entryClose,
      entryOpen: openIdx,
      tokens
    };
  }
  return { entryClose, entryOpen: openIdx, tokens };
}
function plainEntryRange(raw, packageName, form) {
  const tokens = jsonTokens(raw);
  const pkgIdx = tokens.findIndex((t) => t.type === "string" && t.value === packageName);
  if (pkgIdx < 0)
    return null;
  if (form === "string") {
    return { start: tokens[pkgIdx].start, end: tokens[pkgIdx].end };
  }
  let openIdx = -1;
  for (let i = pkgIdx - 1;i >= 0; i -= 1) {
    if (tokens[i].type === "[") {
      openIdx = i;
      break;
    }
    if (tokens[i].type === "}" || tokens[i].type === "]")
      break;
  }
  if (openIdx < 0)
    return null;
  const closeIdx = matchBracket(tokens, openIdx);
  if (closeIdx < 0)
    return null;
  return { start: tokens[openIdx].start, end: tokens[closeIdx].end };
}
function replaceOptionsInJsonc(raw, packageName, form, nextOptions) {
  if (form === "string" || form === "tuple") {
    const range = plainEntryRange(raw, packageName, form);
    if (!range)
      throw new Error("No modelselect entry in the global OpenCode config.");
    const indent = lineIndent(raw, range.start);
    return raw.slice(0, range.start) + prettyAt({ package: packageName, options: nextOptions }, indent) + raw.slice(range.end);
  }
  const block = findOptionsBlock(raw, packageName);
  if (!block)
    throw new Error("No modelselect entry in the global OpenCode config.");
  if (typeof block.start === "number") {
    return raw.slice(0, block.start) + prettyAt(nextOptions, block.indent) + raw.slice(block.end);
  }
  const tokens = block.tokens;
  const insertAt = tokens[block.entryClose].start;
  const indent = lineIndent(raw, insertAt);
  const emptyEntry = block.entryClose === block.entryOpen + 1;
  const addition = (emptyEntry ? "" : `,
`) + indent + '  "options": ' + prettyAt(nextOptions, indent + "  ");
  return raw.slice(0, insertAt) + addition + raw.slice(insertAt);
}
function addEntryToJsonc(raw) {
  const tokens = jsonTokens(raw);
  const keyIdx = tokens.findIndex((t) => t.type === "string" && t.value === "plugins");
  if (keyIdx < 0)
    throw new Error("The global OpenCode config has no plugins array.");
  let arrayIdx = -1;
  for (let i = keyIdx + 1;i < tokens.length; i += 1) {
    if (tokens[i].type === "[") {
      arrayIdx = i;
      break;
    }
    if (tokens[i].type === "{" || tokens[i].type === "string")
      break;
  }
  if (arrayIdx < 0)
    throw new Error("The global OpenCode config has no plugins array.");
  const closeIdx = matchBracket(tokens, arrayIdx);
  if (closeIdx < 0)
    throw new Error("The global OpenCode config plugins array is unbalanced.");
  const insertAt = tokens[closeIdx].start;
  const indent = lineIndent(raw, insertAt);
  const entry = prettyAt({ package: PLUGIN_PACKAGE, options: {} }, indent + "  ");
  const empty = closeIdx === arrayIdx + 1;
  const addition = (empty ? `
` : `,
`) + indent + "  " + entry + (empty ? `
` + indent : "");
  return raw.slice(0, insertAt) + addition + raw.slice(insertAt);
}
async function writeTextAtomic(file, text) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + "." + process.pid + ".tmp";
  await fsp.writeFile(tmp, text);
  await fsp.rename(tmp, file);
}
async function readPluginConfig() {
  const rejected = [];
  for (const logical of GLOBAL_CONFIG_PATHS) {
    const file = resolveLogicalPath(null, logical);
    let raw;
    try {
      raw = await fsp.readFile(file, "utf8");
    } catch (e) {
      if (e && (e.code === "ENOENT" || e.code === "ENOTDIR"))
        continue;
      rejected.push({ logical, file, raw: "", parseError: String(e && e.message || e) });
      continue;
    }
    let parsed;
    try {
      parsed = parseJsonLenient(raw);
    } catch (e) {
      rejected.push({ logical, file, raw, parseError: "not valid JSON: " + String(e && e.message || e) });
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      rejected.push({ logical, file, raw, parseError: "the config is not a JSON object" });
      continue;
    }
    const entry = findPluginEntry(parsed);
    if (entry.form !== "missing" || rejected.length === 0) {
      return { parseOk: true, exists: true, config: parsed, entry, file, path: logical, raw, parseError: "" };
    }
    rejected.push({ logical, file, raw, parseError: "no modelselect entry" });
  }
  if (rejected.length) {
    const first = rejected[0];
    return {
      parseOk: false,
      exists: true,
      config: null,
      entry: findPluginEntry({}),
      file: first.file,
      path: first.logical,
      raw: first.raw,
      parseError: first.parseError
    };
  }
  return {
    parseOk: true,
    exists: false,
    config: { plugins: [] },
    entry: findPluginEntry({}),
    file: resolveLogicalPath(null, PLUGIN_CONFIG_PATH),
    path: PLUGIN_CONFIG_PATH,
    raw: "",
    parseError: ""
  };
}
async function storedPluginOptions() {
  const current = await readPluginConfig();
  return current.entry.options || {};
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
  const current = await readPluginConfig();
  if (!current.parseOk) {
    throw new Error("The global OpenCode config is not valid JSON — nothing was written. Fix the file first.");
  }
  if (current.entry.form === "missing") {
    throw new Error("No modelselect entry in the global OpenCode config.");
  }
  const nextOptions = buildPluginOptions(current.entry.options, values);
  const text = replaceOptionsInJsonc(current.raw, current.entry.package, current.entry.form, nextOptions);
  await writeTextAtomic(current.file, text);
  return { entry: findPluginEntry(parseJsonLenient(text)), options: nextOptions };
}
async function addPluginEntry() {
  const current = await readPluginConfig();
  if (!current.parseOk) {
    throw new Error("The global OpenCode config is not valid JSON — nothing was written. Fix the file first.");
  }
  if (current.entry.form !== "missing")
    return { entry: current.entry, added: false };
  const text = addEntryToJsonc(current.raw || `{
  "plugins": []
}
`);
  await writeTextAtomic(current.file, text);
  return { entry: findPluginEntry(parseJsonLenient(text)), added: true };
}
async function setPluginOption(name, value) {
  const current = await readPluginConfig();
  if (!current.parseOk)
    throw new Error("The global OpenCode config is not valid JSON.");
  if (current.entry.form === "missing")
    throw new Error("No modelselect entry in the global OpenCode config.");
  const next = shallowCopy(current.entry.options);
  next[name] = value;
  const text = replaceOptionsInJsonc(current.raw, current.entry.package, current.entry.form, next);
  await writeTextAtomic(current.file, text);
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
  next.sessionAnswers = values.sessionAnswers === true;
  await writeJsonAt(null, MODELSELECT_CONFIG_PATH, next);
  return next;
}
async function sessionAnswersEnabled() {
  const config = await readExtensionConfig();
  return config.sessionAnswers === true;
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
function sessionDeliveryFile(directory, sessionID) {
  return path.join(cacheDirOf(directory), "delivery-" + sanitizeSessionID(sessionID) + ".json");
}
async function readSessionDelivery(directory, sessionID) {
  if (!directory || !sessionID)
    return null;
  const data = await readJsonFile(sessionDeliveryFile(directory, sessionID));
  return data && typeof data === "object" && !Array.isArray(data) ? data : null;
}
async function writeSessionDelivery(directory, sessionID, state) {
  if (!directory || !sessionID)
    return;
  await writeJsonAtomic(sessionDeliveryFile(directory, sessionID), state);
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
function readConfigV2(directory) {
  return readJsonAt(directory, path.join(CACHE_REL, "model-config-v2-cache.json")).then((data) => data && data.config || null);
}
function readRegistry(directory) {
  return readJsonAt(directory, path.join(CACHE_REL, "model-registry-v2-cache.json")).then((data) => data && data.registry || null);
}
function readLatch(directory) {
  return readJsonAt(directory, path.join(CACHE_REL, "free-quota.json"));
}
function readUsage(directory) {
  return readJsonAt(directory, path.join(CACHE_REL, "usage-limits.json"));
}
function readRuntimeInventory(directory) {
  return readJsonAt(directory, path.join(CACHE_REL, "runtime-inventory.json"));
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
var { latchEntries: latchEntries3, freeQuotaFresh: freeQuotaFresh3 } = import_free_quota2.default;
var {
  CACHE_REL: CACHE_REL2,
  SESSION_MAP_FILE: SESSION_MAP_FILE2
} = exports_store;
var SESSION_MAP_TTL_MS = 30 * 24 * 60 * 60 * 1000;
var SESSION_MAP_TOUCH_MS = 60 * 1000;
var HOST_EVIDENCE_KEY = "openchamber";
var ROUTING_SYNC_THROTTLE_MS = 30 * 1000;
var SCHEDULE_ROUTING_REFRESH = "routing-refresh";
var SCHEDULE_QUOTA_PROBE = "quota-probe";
var SCHEDULE_IDS = new Set([SCHEDULE_ROUTING_REFRESH, SCHEDULE_QUOTA_PROBE]);
var BODY_MAX = 16 * 1024;
var EVENT_BODY_MAX = 256 * 1024;
var TIER_VALUES = TIER_OPTIONS.map((o) => o.value);
var TURN_EVENT_TYPES = new Set(["turn-started", "turn-finished", "turn-failed"]);
var DELIVERY_PREVIEW_MAX = 160;
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
function tierOf(current) {
  if (!current || !current.parseOk || current.entry.form === "missing")
    return null;
  const tier = typeof current.entry.options.tier === "string" ? current.entry.options.tier : "auto";
  return TIER_VALUES.includes(tier) ? tier : "auto";
}
function pickedCaps(config, model) {
  if (!config || !model)
    return null;
  const types = config["task-types"] || config.taskTypes || {};
  const bare = String(model).split("/").pop();
  for (const entry of Object.values(types)) {
    if (!entry || typeof entry !== "object")
      continue;
    for (const key of ["go_ranked", "free_ranked"]) {
      const rows = Array.isArray(entry[key]) ? entry[key] : [];
      const row = rows.find((r) => r && typeof r.model === "string" && (r.model === model || r.model === bare));
      if (!row)
        continue;
      const caps = {
        output: typeof row.output === "number" && row.output > 0 ? row.output : null,
        monthlyUsage: row.monthly_usage && typeof row.monthly_usage === "object" ? row.monthly_usage : null
      };
      return caps.output || caps.monthlyUsage ? caps : null;
    }
  }
  return null;
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
  const [syncOn, freeQuota, usage, config, pluginConfig, delivery] = await Promise.all([
    readRoutingSync(directory),
    readLatch(directory),
    readUsage(directory),
    readJsonAt(directory, path2.join(CACHE_REL2, "model-config-cache.json")),
    readPluginConfig(),
    readSessionDelivery(directory, newest ? newest.sessionID : "")
  ]);
  if (!pluginConfig.parseOk) {
    reportCardState("config-broken", "The global OpenCode config is not valid JSON, so the settings panel cannot save. Fix " + pluginConfig.path + " and reload OpenCode.");
  } else if (pluginConfig.entry.form === "missing") {
    reportCardState("plugin-missing", "Add the modelselect plugin to " + pluginConfig.path + " — it is loaded by both OpenChamber and standalone OpenCode.");
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
    pickedCaps: pickedCaps(config, newest && newest.data && newest.data.model),
    sync: syncOn,
    freeQuota,
    usage,
    globalEntry: { checked: true, entry: pluginConfig.entry.form !== "missing" },
    tierOption: tierOf(pluginConfig),
    delivery
  });
}
function publicOptions(options) {
  const out = Object.assign({}, options || {});
  delete out.token;
  delete out.jevToken;
  return out;
}
async function readConfig(directory, sessionID) {
  const [pluginConfig, catalog, extConfig, syncOn, sessionStatus] = await Promise.all([
    readPluginConfig(),
    readCatalog(directory),
    readExtensionConfig(),
    readRoutingSync(directory),
    readSessionStatus(directory, sessionID)
  ]);
  return {
    pluginConfig: {
      parseOk: pluginConfig.parseOk,
      exists: pluginConfig.exists,
      parseError: pluginConfig.parseError || "",
      entry: {
        form: pluginConfig.entry.form,
        package: pluginConfig.entry.package,
        options: publicOptions(pluginConfig.entry.options)
      }
    },
    pluginConfigPath: pluginConfig.path,
    extensionPath: MODELSELECT_CONFIG_PATH,
    catalog: { types: catalog.types, bounds: catalog.bounds },
    extConfig,
    syncOn,
    sessionTask: sessionStatus && typeof sessionStatus.taskType === "string" ? sessionStatus.taskType : ""
  };
}
async function readChain(directory, taskType) {
  const [catalog, configV2, registry, options, latch, usage, inventory] = await Promise.all([
    readCatalog(directory),
    readConfigV2(directory),
    readRegistry(directory),
    storedPluginOptions(),
    readLatch(directory),
    readUsage(directory),
    readRuntimeInventory(directory)
  ]);
  return computeModelsView({
    taskType,
    catalogConfig: catalog.config,
    configV2,
    options,
    latchData: latch,
    usage,
    registry,
    runtimeInventory: inventory,
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
function deliveryFromEvent(event, content) {
  const at = typeof event.at === "number" && Number.isFinite(event.at) ? event.at : Date.now();
  const text = (v) => String(v == null ? "" : v).trim().slice(0, DELIVERY_PREVIEW_MAX);
  if (event.type === "turn-started") {
    return { activity: "running", at, reply: "", error: "" };
  }
  if (event.type === "turn-finished") {
    const reply = content && content.type === "turn-finished" ? text(content.reply) : "";
    return { activity: "idle", at, reply, error: "" };
  }
  const error = content && content.type === "turn-failed" && content.error ? text(content.error.message) : "";
  return { activity: "failed", at, reply: "", error };
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
  if (TURN_EVENT_TYPES.has(event.type) && event.session && event.session.id) {
    try {
      await writeSessionDelivery(directory, event.session.id, deliveryFromEvent(event, request.content));
    } catch (e) {
      process.stderr.write("[modelselect] could not record delivery state: " + messageOf(e, "unknown error") + `
`);
    }
  }
  if (!await sessionAnswersEnabled()) {
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
      return { status, body: { message: messageOf(e, "Could not write the global OpenCode config.") } };
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
      return { status, body: { message: messageOf(e, "Could not write the global OpenCode config.") } };
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
  const data = {
    ok: true,
    configured: anyWindow,
    planLabel: "OpenCode Go / Console",
    usage: { windows, models }
  };
  if (!anyWindow)
    data.error = "Usage snapshot has no readable windows yet.";
  return { ok: true, data };
}
async function handleSchedule(bodyText) {
  const run = readServiceScheduleRequest(bodyText);
  if (!run)
    return { status: 400, body: { message: "Invalid schedule run." } };
  if (!SCHEDULE_IDS.has(run.id)) {
    return { status: 200, body: { ok: true, id: run.id, handled: false } };
  }
  const last = await lastProject();
  if (last)
    seenDirectories.add(last);
  await maintain();
  return { status: 200, body: { ok: true, id: run.id, handled: true } };
}
async function readWaitLiveState(wait) {
  const args = wait && wait.args && typeof wait.args === "object" ? wait.args : {};
  const state = wait && wait.state && typeof wait.state === "object" ? wait.state : {};
  const argDir = [args.directory, args.projectDirectory, args.project].map((v) => typeof v === "string" && path2.isAbsolute(v) ? v : null).find(Boolean);
  const stateDir = typeof state.directory === "string" && path2.isAbsolute(state.directory) ? state.directory : null;
  const directory = argDir || stateDir || await lastProject();
  const [latchData, syncOn] = await Promise.all([
    directory ? readLatch(directory) : Promise.resolve(null),
    directory ? readRoutingSync(directory) : Promise.resolve(false)
  ]);
  const now = Date.now();
  const latched = latchEntries3(latchData).filter((entry) => freeQuotaFresh3(entry, now)).map((entry) => ({
    model: entry.model || "*",
    kind: entry.kind === "rate-limit" ? "rate-limit" : "exhaustion",
    until: Number(entry.until),
    retryInMs: Math.max(0, Number(entry.until) - now)
  }));
  return { version: 1, at: now, directory, sync: Boolean(syncOn), latched };
}
function waitChange(seen, live) {
  if (!seen || typeof seen !== "object" || Array.isArray(seen))
    return null;
  const before = Array.isArray(seen.latched) ? seen.latched : [];
  const after = live.latched;
  const previous = new Map(before.map((entry) => [entry && entry.model, entry]));
  const quota = before.length !== after.length || previous.size !== after.length || after.some((entry) => {
    const old = previous.get(entry.model);
    return !old || old.until !== entry.until || old.kind !== entry.kind;
  });
  const sync = Boolean(seen.sync) !== live.sync;
  return quota || sync ? { quota, sync } : null;
}
function waitSummary(live, change) {
  const parts = [];
  if (change.quota) {
    parts.push(live.latched.length ? "Free quota changed — " + live.latched.length + " latch(es), next retry in " + Math.ceil(Math.min.apply(null, live.latched.map((entry) => entry.retryInMs)) / 1000) + "s" : "Free quota reset — no active latches");
  }
  if (change.sync)
    parts.push("Routing sync is " + (live.sync ? "on" : "off"));
  return (parts.join("; ") || "Wait state is current.").slice(0, WAIT_SUMMARY_MAX);
}
async function handleWaitStart(bodyText) {
  const request = readWaitStartRequest(bodyText);
  if (!request)
    return { status: 400, body: { message: "Unsupported wait start request." } };
  return { status: 200, body: { ok: true, state: await readWaitLiveState(request.wait) } };
}
async function handleWaitCheck(bodyText) {
  const request = readWaitCheckRequest(bodyText);
  if (!request)
    return { status: 400, body: { message: "Unsupported wait check request." } };
  const results = [];
  for (const wait of request.waits) {
    const live = await readWaitLiveState(wait);
    const change = waitChange(wait.state, live);
    if (!change) {
      results.push({ id: wait.id, fired: false, state: live });
    } else {
      results.push({ id: wait.id, fired: true, summary: waitSummary(live, change) });
    }
  }
  return { status: 200, body: { results } };
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
  if (req.method === "POST" && url.pathname === SERVICE_SCHEDULE_PATH) {
    const answer = await handleSchedule(await readBody(req));
    send(res, answer.status, answer.body);
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
    const delivery = picked ? await readSessionDelivery(directory, sessionID) : null;
    const summary = pickSummary(picked, Date.now(), delivery);
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
  if (req.method === "POST" && url.pathname === WAITS_START_PATH) {
    const answer = await handleWaitStart(await readBody(req));
    send(res, answer.status, answer.body);
    return;
  }
  if (req.method === "POST" && url.pathname === WAITS_CHECK_PATH) {
    const answer = await handleWaitCheck(await readBody(req));
    send(res, answer.status, answer.body);
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
  process.stdout.write("[modelselect] listening on 127.0.0.1:" + server.address().port + `
`);
});
function stop() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
