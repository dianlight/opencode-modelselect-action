/* openchamber-modelselect — project and config store (ESM, Node).
 *
 * The service is the single owner of file I/O for this extension: the settings
 * panel reads and writes through it (`GET/POST /config`, `GET /chain`), so the
 * package asks for no `files` capability and no `filesystem` paths. Everything
 * here runs with the service's own user access, resolved from `?directory=`.
 *
 * Contracts (mirror plugin/src/shared/ — keep in sync):
 * - The user's global OpenCode config (`~/.config/opencode/opencode.json(c)`)
 *   is the one home for the plugin options: OpenCode loads it for every
 *   instance (OpenChamber's managed server and standalone TUI alike). An
 *   unparseable file is never rewritten: every write path refuses instead.
 * - Writes are surgical edits of the original JSONC text: comments, key order
 *   and every unrelated setting survive. Unknown plugin option keys are kept.
 * - `token` / `jevToken` are write-only: a blank draft keeps the stored value.
 * - Project cache (`<directory>/.opencode/.modelselect-cache/`) is written by
 *   the plugin: `status-<sessionID>.json`, `model-config-cache.json`,
 *   `model-config-v2-cache.json`, `free-quota.json`, `usage-limits.json`,
 *   `routing-sync.json`.
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import routingShared from '../../../core/routing.js';

const { parseJsonLenient } = routingShared;

export const CACHE_REL = '.opencode/.modelselect-cache';
export const SESSION_MAP_FILE = 'openchamber-sessions.json';
export const MODELSELECT_CONFIG_PATH = '~/.config/openchamber/modelselect.json';
/** Global OpenCode config candidates. `.jsonc` is preferred when both exist. */
export const GLOBAL_CONFIG_PATHS = [
  '~/.config/opencode/opencode.jsonc',
  '~/.config/opencode/opencode.json'
];
export const PLUGIN_CONFIG_PATH = GLOBAL_CONFIG_PATHS[0];
export const ROUTING_SYNC_FILE = 'routing-sync.json';
export const PLUGIN_PACKAGE = '@dianlight/opencode-modelselect-plugin';

// Plugin defaults (mirror plugin/src/shared — keep in sync).
export const DEFAULT_CONFIG_URL =
  'https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/model-config.json';
export const DEFAULT_TASK_TYPES_URL =
  'https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/task-types.json';
export const DEFAULT_JEV_ENDPOINT = 'https://opencode.ai/zen/v1/systemone';
export const FALLBACK_COST_MIN = 0;
export const FALLBACK_COST_MAX = 8;

/** `~/...` resolves against the user home; anything else against the project. */
export function resolveLogicalPath(directory, logical) {
  const p = String(logical == null ? '' : logical);
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  if (path.isAbsolute(p)) return p;
  return path.join(String(directory || process.cwd()), p);
}

export async function readJsonFile(file) {
  try {
    return parseJsonLenient(await fsp.readFile(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

/** Read one logical path (`~/…` or project-relative) as JSON; null when absent. */
export function readJsonAt(directory, logical) {
  return readJsonFile(resolveLogicalPath(directory, logical));
}

/** Write through a sibling temp file so a reader never sees half a document. */
export async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2) + '\n');
  await fsp.rename(tmp, file);
}

export function writeJsonAt(directory, logical, value) {
  return writeJsonAtomic(resolveLogicalPath(directory, logical), value);
}

export function cacheDirOf(directory) {
  return path.join(String(directory), CACHE_REL);
}

export function sanitizeSessionID(id) {
  const clean = String(id == null ? 'default' : id).replace(/[^A-Za-z0-9-_]/g, '_').slice(0, 128);
  return clean || 'default';
}

function str(v) {
  return v == null ? '' : String(v);
}

function shallowCopy(obj) {
  const out = {};
  if (obj && typeof obj === 'object') Object.keys(obj).forEach((k) => { out[k] = obj[k]; });
  return out;
}

// --- global OpenCode config (JSONC-safe) ------------------------------------

/**
 * Locate the modelselect entry inside a parsed OpenCode config. Supports the
 * v2 object form `{ package, options }` and the v1 string / tuple form.
 */
export function findPluginEntry(config) {
  const plugins = config && Array.isArray(config.plugins) ? config.plugins : [];
  for (let i = 0; i < plugins.length; i += 1) {
    const entry = plugins[i];
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

function decodeJsonString(literal) {
  try { return JSON.parse(literal); } catch (e) { return ''; }
}

/** String/brace/bracket tokens of a JSONC document, with comments skipped. */
function jsonTokens(raw) {
  const out = [];
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (c === '"') {
      const start = i;
      i += 1;
      while (i < raw.length) {
        if (raw[i] === '\\') { i += 2; continue; }
        if (raw[i] === '"') { i += 1; break; }
        i += 1;
      }
      out.push({ type: 'string', start: start, end: i, value: decodeJsonString(raw.slice(start, i)) });
      continue;
    }
    if (c === '/' && raw[i + 1] === '/') {
      while (i < raw.length && raw[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && raw[i + 1] === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '{' || c === '}' || c === '[' || c === ']') out.push({ type: c, start: i, end: i + 1 });
    i += 1;
  }
  return out;
}

function matchBracket(tokens, openIndex) {
  const open = tokens[openIndex].type;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i += 1) {
    if (tokens[i].type === open) depth += 1;
    else if (tokens[i].type === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function lineIndent(raw, pos) {
  const lineStart = raw.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
  const m = /^\s*/.exec(raw.slice(lineStart));
  return m ? m[0] : '';
}

function prettyAt(value, indent) {
  return JSON.stringify(value, null, 2).split('\n').map((line, i) => (i === 0 ? line : indent + line)).join('\n');
}

/** Locate the plugin entry's `options` object in the raw JSONC text. */
function findOptionsBlock(raw, packageName) {
  const tokens = jsonTokens(raw);
  const pkgIdx = tokens.findIndex((t) => t.type === 'string' && t.value === packageName);
  if (pkgIdx < 0) return null;
  let openIdx = -1;
  let depth = 0;
  for (let i = pkgIdx - 1; i >= 0; i -= 1) {
    if (tokens[i].type === '}') depth += 1;
    else if (tokens[i].type === '{') {
      if (depth === 0) { openIdx = i; break; }
      depth -= 1;
    }
  }
  if (openIdx < 0) return null;
  const entryClose = matchBracket(tokens, openIdx);
  if (entryClose < 0) return null;
  for (let i = pkgIdx + 1; i < entryClose; i += 1) {
    if (tokens[i].type !== 'string' || tokens[i].value !== 'options') continue;
    let braceIdx = -1;
    for (let j = i + 1; j < entryClose; j += 1) {
      if (tokens[j].type === '{') { braceIdx = j; break; }
      if (tokens[j].type !== ':' && tokens[j].type !== 'string') break;
    }
    if (braceIdx < 0) break;
    const endIdx = matchBracket(tokens, braceIdx);
    if (endIdx < 0 || endIdx > entryClose) break;
    return {
      start: tokens[braceIdx].start,
      end: tokens[endIdx].end,
      indent: lineIndent(raw, tokens[braceIdx].start),
      entryClose: entryClose,
      entryOpen: openIdx,
      tokens: tokens
    };
  }
  return { entryClose: entryClose, entryOpen: openIdx, tokens: tokens };
}

/** The raw text range of a string / tuple plugin entry inside the array. */
function plainEntryRange(raw, packageName, form) {
  const tokens = jsonTokens(raw);
  const pkgIdx = tokens.findIndex((t) => t.type === 'string' && t.value === packageName);
  if (pkgIdx < 0) return null;
  if (form === 'string') {
    return { start: tokens[pkgIdx].start, end: tokens[pkgIdx].end };
  }
  let openIdx = -1;
  for (let i = pkgIdx - 1; i >= 0; i -= 1) {
    if (tokens[i].type === '[') { openIdx = i; break; }
    if (tokens[i].type === '}' || tokens[i].type === ']') break;
  }
  if (openIdx < 0) return null;
  const closeIdx = matchBracket(tokens, openIdx);
  if (closeIdx < 0) return null;
  return { start: tokens[openIdx].start, end: tokens[closeIdx].end };
}

/**
 * Replace only the plugin entry (or just its options object) in the raw JSONC.
 * Comments, key order and every unrelated setting survive untouched.
 */
function replaceOptionsInJsonc(raw, packageName, form, nextOptions) {
  if (form === 'string' || form === 'tuple') {
    const range = plainEntryRange(raw, packageName, form);
    if (!range) throw new Error('No modelselect entry in the global OpenCode config.');
    const indent = lineIndent(raw, range.start);
    return raw.slice(0, range.start) +
      prettyAt({ package: packageName, options: nextOptions }, indent) +
      raw.slice(range.end);
  }
  const block = findOptionsBlock(raw, packageName);
  if (!block) throw new Error('No modelselect entry in the global OpenCode config.');
  if (typeof block.start === 'number') {
    return raw.slice(0, block.start) + prettyAt(nextOptions, block.indent) + raw.slice(block.end);
  }
  const tokens = block.tokens;
  const insertAt = tokens[block.entryClose].start;
  const indent = lineIndent(raw, insertAt);
  const emptyEntry = block.entryClose === block.entryOpen + 1;
  const addition = (emptyEntry ? '' : ',\n') + indent + '  "options": ' + prettyAt(nextOptions, indent + '  ');
  return raw.slice(0, insertAt) + addition + raw.slice(insertAt);
}

/** Append a bare plugin entry inside the `plugins` array of a JSONC document. */
function addEntryToJsonc(raw) {
  const tokens = jsonTokens(raw);
  const keyIdx = tokens.findIndex((t) => t.type === 'string' && t.value === 'plugins');
  if (keyIdx < 0) throw new Error('The global OpenCode config has no plugins array.');
  let arrayIdx = -1;
  for (let i = keyIdx + 1; i < tokens.length; i += 1) {
    if (tokens[i].type === '[') { arrayIdx = i; break; }
    if (tokens[i].type === '{' || tokens[i].type === 'string') break;
  }
  if (arrayIdx < 0) throw new Error('The global OpenCode config has no plugins array.');
  const closeIdx = matchBracket(tokens, arrayIdx);
  if (closeIdx < 0) throw new Error('The global OpenCode config plugins array is unbalanced.');
  const insertAt = tokens[closeIdx].start;
  const indent = lineIndent(raw, insertAt);
  const entry = prettyAt({ package: PLUGIN_PACKAGE, options: {} }, indent + '  ');
  const empty = closeIdx === arrayIdx + 1;
  const addition = (empty ? '\n' : ',\n') + indent + '  ' + entry + (empty ? '\n' + indent : '');
  return raw.slice(0, insertAt) + addition + raw.slice(insertAt);
}

async function writeTextAtomic(file, text) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  await fsp.writeFile(tmp, text);
  await fsp.rename(tmp, file);
}

/**
 * Read the global config that carries the plugin. Files with a modelselect
 * entry win; otherwise the first readable existing file is chosen (.jsonc
 * first). `parseOk: false` means the chosen file must never be written.
 */
export async function readPluginConfig() {
  const rejected = [];
  for (const logical of GLOBAL_CONFIG_PATHS) {
    const file = resolveLogicalPath(null, logical);
    let raw;
    try {
      raw = await fsp.readFile(file, 'utf8');
    } catch (e) {
      if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) continue;
      rejected.push({ logical: logical, file: file, raw: '', parseError: String((e && e.message) || e) });
      continue;
    }
    let parsed;
    try {
      parsed = parseJsonLenient(raw);
    } catch (e) {
      rejected.push({ logical: logical, file: file, raw: raw, parseError: 'not valid JSON: ' + String((e && e.message) || e) });
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      rejected.push({ logical: logical, file: file, raw: raw, parseError: 'the config is not a JSON object' });
      continue;
    }
    const entry = findPluginEntry(parsed);
    if (entry.form !== 'missing' || rejected.length === 0) {
      return { parseOk: true, exists: true, config: parsed, entry: entry, file: file, path: logical, raw: raw, parseError: '' };
    }
    rejected.push({ logical: logical, file: file, raw: raw, parseError: 'no modelselect entry' });
  }
  if (rejected.length) {
    const first = rejected[0];
    return {
      parseOk: false, exists: true, config: null, entry: findPluginEntry({}),
      file: first.file, path: first.logical, raw: first.raw, parseError: first.parseError
    };
  }
  return {
    parseOk: true, exists: false, config: { plugins: [] }, entry: findPluginEntry({}),
    file: resolveLogicalPath(null, PLUGIN_CONFIG_PATH), path: PLUGIN_CONFIG_PATH, raw: '', parseError: ''
  };
}

/** The plugin options currently stored in the global config (empty when absent). */
export async function storedPluginOptions() {
  const current = await readPluginConfig();
  return current.entry.options || {};
}

/**
 * Build the next `options` object from the panel's values: start from the
 * existing options (unknown keys preserved) and set/delete only plugin keys.
 */
export function buildPluginOptions(base, v) {
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
  if (v.maxCost == null) delete next.maxCost; // No limit
  else next.maxCost = v.maxCost;
  if (v.jevModel) next.jevModel = v.jevModel; else delete next.jevModel;
  if (v.fallbackModel) next.fallbackModel = v.fallbackModel; else delete next.fallbackModel;
  // Write-only secrets: blank draft = keep whatever is stored.
  if (v.tokenDraft) next.token = v.tokenDraft;
  if (v.jevTokenDraft) next.jevToken = v.jevTokenDraft;
  return next;
}

/**
 * Read-modify-write the global config with the panel's plugin values. Only the
 * plugin entry's options object is replaced; comments and all other settings
 * in the JSONC file survive untouched.
 */
export async function savePluginOptions(directory, values) {
  const current = await readPluginConfig();
  if (!current.parseOk) {
    throw new Error('The global OpenCode config is not valid JSON — nothing was written. Fix the file first.');
  }
  if (current.entry.form === 'missing') {
    throw new Error('No modelselect entry in the global OpenCode config.');
  }
  const nextOptions = buildPluginOptions(current.entry.options, values);
  const text = replaceOptionsInJsonc(current.raw, current.entry.package, current.entry.form, nextOptions);
  await writeTextAtomic(current.file, text);
  return { entry: findPluginEntry(parseJsonLenient(text)), options: nextOptions };
}

/**
 * Append a bare `{ package, options: {} }` entry to the global config's
 * `plugins` array. Idempotent: an existing entry is left alone.
 */
export async function addPluginEntry() {
  const current = await readPluginConfig();
  if (!current.parseOk) {
    throw new Error('The global OpenCode config is not valid JSON — nothing was written. Fix the file first.');
  }
  if (current.entry.form !== 'missing') return { entry: current.entry, added: false };
  const text = addEntryToJsonc(current.raw || '{\n  "plugins": []\n}\n');
  await writeTextAtomic(current.file, text);
  return { entry: findPluginEntry(parseJsonLenient(text)), added: true };
}

/** Write one plugin option (`tier`) without touching anything else. */
export async function setPluginOption(name, value) {
  const current = await readPluginConfig();
  if (!current.parseOk) throw new Error('The global OpenCode config is not valid JSON.');
  if (current.entry.form === 'missing') throw new Error('No modelselect entry in the global OpenCode config.');
  const next = shallowCopy(current.entry.options);
  next[name] = value;
  const text = replaceOptionsInJsonc(current.raw, current.entry.package, current.entry.form, next);
  await writeTextAtomic(current.file, text);
  return next;
}

// --- external extension config ----------------------------------------------

export async function readExtensionConfig() {
  const data = await readJsonAt(null, MODELSELECT_CONFIG_PATH);
  return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
}

export async function saveExtensionConfig(directory, values) {
  const current = await readJsonAt(null, MODELSELECT_CONFIG_PATH);
  const next = (current && typeof current === 'object' && !Array.isArray(current))
    ? shallowCopy(current)
    : {};
  next.autoSmallModel = Boolean(values.autoSmallModel);
  next.autoWalkthroughModel = Boolean(values.autoWalkthroughModel);
  next.smallModelTask = str(values.smallModelTask) || 'generic';
  next.walkthroughModelTask = str(values.walkthroughModelTask) || 'generic';
  next.sessionAnswers = values.sessionAnswers === true;
  await writeJsonAt(null, MODELSELECT_CONFIG_PATH, next);
  return next;
}

/**
 * May the service answer the agent's requests on the user's behalf?
 * Off unless the switch in the panel wrote `sessionAnswers: true` — the
 * manifest grant stays declared either way, so this is the only switch.
 */
export async function sessionAnswersEnabled() {
  const config = await readExtensionConfig();
  return config.sessionAnswers === true;
}

// --- project cache ----------------------------------------------------------

/** Every readable status file, with its age source (`updatedAt`, else mtime). */
export async function listStatuses(cacheDir) {
  let names;
  try {
    names = await fsp.readdir(cacheDir);
  } catch (e) {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!/^status-.+\.json$/.test(name)) continue;
    const file = path.join(cacheDir, name);
    try {
      const data = parseJsonLenient(await fsp.readFile(file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
      const stat = await fsp.stat(file);
      out.push({
        sessionID: String(data.sessionID || name.slice('status-'.length, -'.json'.length)),
        data: data,
        at: typeof data.updatedAt === 'number' && Number.isFinite(data.updatedAt)
          ? data.updatedAt
          : stat.mtimeMs
      });
    } catch (e) {
      // unreadable/racing file: not evidence
    }
  }
  return out;
}

export function newestStatus(statuses) {
  let newest = null;
  for (const entry of statuses) {
    if (!newest || entry.at > newest.at) newest = entry;
  }
  return newest;
}

/** The status file of one session, or null. */
export async function readSessionStatus(directory, sessionID) {
  if (!directory || !sessionID) return null;
  const file = path.join(cacheDirOf(directory), 'status-' + sanitizeSessionID(sessionID) + '.json');
  const data = await readJsonFile(file);
  return (data && typeof data === 'object' && !Array.isArray(data)) ? data : null;
}

export function knownTaskTypes(cfg) {
  const table = (cfg && (cfg.config || cfg)) || {};
  const bucket = table['task-types'] || table.taskTypes || {};
  return Object.keys(bucket);
}

/** The router-sync switch: anything but an explicit `{ sync: false }` means ON. */
export async function readRoutingSync(directory) {
  const data = await readJsonAt(directory, path.join(CACHE_REL, ROUTING_SYNC_FILE));
  return !(data && data.sync === false);
}

export async function writeRoutingSync(directory, on) {
  const file = path.join(cacheDirOf(directory), ROUTING_SYNC_FILE);
  const current = await readJsonFile(file);
  const next = (current && typeof current === 'object' && !Array.isArray(current))
    ? shallowCopy(current)
    : {};
  next.sync = Boolean(on);
  await writeJsonAtomic(file, next);
  return next;
}

/**
 * Task types plus the blended-cost bounds of the ranked catalog rows. The
 * names come only from the plugin's own cache — never hardcoded.
 */
export async function readCatalog(directory) {
  const data = await readJsonAt(directory, path.join(CACHE_REL, 'model-config-cache.json'));
  const cfg = (data && data.config) || data || {};
  const bucket = (cfg['task-types'] || cfg.taskTypes) || {};
  const types = Object.keys(bucket);
  const costs = [];
  types.forEach((t) => {
    const entry = bucket[t] || {};
    ['go_ranked', 'free_ranked'].forEach((side) => {
      const rows = Array.isArray(entry[side]) ? entry[side] : [];
      rows.forEach((row) => {
        const c = row && typeof row.blended_cost === 'number' ? row.blended_cost : null;
        if (c != null && Number.isFinite(c)) costs.push(c);
      });
    });
  });
  const bounds = { min: FALLBACK_COST_MIN, max: FALLBACK_COST_MAX };
  if (costs.length) {
    bounds.min = Math.min.apply(null, costs);
    bounds.max = Math.max.apply(null, costs);
    if (bounds.max <= bounds.min) bounds.max = bounds.min + 1;
  }
  return { types: types, bounds: bounds, config: (data && data.config) || null };
}

/**
 * Provider-model v2 task table (`model-config-v2-cache.json`), the v2 half
 * of the plugin's config cache. Null when the plugin has not cached it.
 */
export function readConfigV2(directory) {
  return readJsonAt(directory, path.join(CACHE_REL, 'model-config-v2-cache.json'))
    .then((data) => (data && data.config) || null);
}

/**
 * Provider-model v2 registry (`model-registry-v2-cache.json`), written by the
 * plugin beside the model config. Null when the plugin has not cached it.
 */
export function readRegistry(directory) {
  return readJsonAt(directory, path.join(CACHE_REL, 'model-registry-v2-cache.json'))
    .then((data) => (data && data.registry) || null);
}

export function readLatch(directory) {
  return readJsonAt(directory, path.join(CACHE_REL, 'free-quota.json'));
}

export function readUsage(directory) {
  return readJsonAt(directory, path.join(CACHE_REL, 'usage-limits.json'));
}

// --- last project (quota provider has no directory) --------------------------

// Scratch, not config: the quota call carries no project, so the last one this
// extension was asked about is remembered here. `MODELSELECT_STATE_FILE` lets
// tests keep parallel services from sharing it.
const LAST_PROJECT_FILE = process.env.MODELSELECT_STATE_FILE ||
  path.join(os.tmpdir(), 'openchamber-modelselect', 'last-project.json');

/** Remember the project the section/panel last named (the quota call carries none). */
export async function rememberProject(directory) {
  if (!directory) return;
  try {
    await writeJsonAtomic(LAST_PROJECT_FILE, { directory: String(directory), at: Date.now() });
  } catch (e) {
    // scratch data only: never break a read for it
  }
}

export async function lastProject() {
  const data = await readJsonFile(LAST_PROJECT_FILE);
  const dir = data && typeof data.directory === 'string' ? data.directory : null;
  return dir && path.isAbsolute(dir) ? dir : null;
}
