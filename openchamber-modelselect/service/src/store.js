/* openchamber-modelselect — project and config store (ESM, Node).
 *
 * The service is the single owner of file I/O for this extension: the settings
 * panel reads and writes through it (`GET/POST /config`, `GET /chain`), so the
 * package asks for no `files` capability and no `filesystem` paths. Everything
 * here runs with the service's own user access, resolved from `?directory=`.
 *
 * Contracts (mirror plugin/src/shared/ — keep in sync):
 * - Managed OpenCode config (`~/.config/openchamber/opencode.managed.json`) is
 *   the only config OpenChamber's server loads. An unparseable file is never
 *   rewritten: every write path returns `{ ok: false }` instead.
 * - Writes are read-modify-write: unknown option keys and unknown top-level
 *   config keys are preserved; only managed keys are set or deleted.
 * - `token` / `jevToken` are write-only: a blank draft keeps the stored value.
 * - Project cache (`<directory>/.opencode/.modelselect-cache/`) is written by
 *   the plugin: `status-<sessionID>.json`, `model-config-cache.json`,
 *   `free-quota.json`, `usage-limits.json`, `routing-sync.json`.
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import routingShared from '../../../core/routing.js';

const { parseJsonLenient } = routingShared;

export const CACHE_REL = '.opencode/.modelselect-cache';
export const SESSION_MAP_FILE = 'openchamber-sessions.json';
export const MANAGED_CONFIG_PATH = '~/.config/openchamber/opencode.managed.json';
export const MODELSELECT_CONFIG_PATH = '~/.config/openchamber/modelselect.json';
export const GLOBAL_CONFIG_PATHS = [
  '~/.config/opencode/opencode.json',
  '~/.config/opencode/opencode.jsonc'
];
/** Paths the plugin tab names as "present but ignored" (read-only, never written). */
export const GLOBAL_NOTE_PATHS = GLOBAL_CONFIG_PATHS;
export const ROUTING_SYNC_FILE = 'routing-sync.json';
export const PLUGIN_PACKAGE = 'opencode-modelselect-plugin';

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

// --- managed OpenCode config -------------------------------------------------

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

/**
 * Read the managed config. `parseOk: false` means the file exists but does not
 * parse as a JSON object: the caller must not offer a form and must never write.
 */
export async function readManagedConfig() {
  const file = resolveLogicalPath(null, MANAGED_CONFIG_PATH);
  let raw;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (e) {
    // Missing file: an empty config is the honest reading (the panel offers Add).
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) {
      return { parseOk: true, exists: false, config: { plugins: [] }, entry: findPluginEntry({}) };
    }
    return {
      parseOk: false,
      exists: true,
      config: null,
      entry: findPluginEntry({}),
      parseError: String((e && e.message) || e)
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
      parseError: 'not valid JSON: ' + String((e && e.message) || e)
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      parseOk: false,
      exists: true,
      config: null,
      entry: findPluginEntry({}),
      parseError: 'the managed config is not a JSON object'
    };
  }
  return { parseOk: true, exists: true, config: parsed, entry: findPluginEntry(parsed) };
}

/** The plugin options currently stored in the managed config (empty when absent). */
export async function storedPluginOptions() {
  const managed = await readManagedConfig();
  return managed.entry.options || {};
}

/**
 * Build the next `options` object from the panel's values: start from the
 * existing options (unknown keys preserved) and set/delete only managed keys.
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
 * Read-modify-write the managed config with the panel's plugin values.
 * Throws `Error` with a user-facing message when nothing may be written.
 */
export async function savePluginOptions(directory, values) {
  const managed = await readManagedConfig();
  if (!managed.parseOk) {
    throw new Error('The managed config is not valid JSON — nothing was written. Fix the file first.');
  }
  const config = managed.config;
  if (!Array.isArray(config.plugins)) config.plugins = [];
  const entry = managed.entry;
  if (entry.form === 'missing') {
    throw new Error('No modelselect entry in the managed config.');
  }
  const nextOptions = buildPluginOptions(entry.options, values);
  if (entry.form === 'object') {
    config.plugins[entry.index].options = nextOptions;
  } else {
    // string / tuple form: convert in place, preserving position + package.
    config.plugins[entry.index] = { package: entry.package, options: nextOptions };
  }
  await writeJsonAtomic(resolveLogicalPath(null, MANAGED_CONFIG_PATH), config);
  return { entry: findPluginEntry(config), options: nextOptions };
}

/**
 * Append a bare `{ package, options: {} }` entry for the plugin. Idempotent:
 * an existing entry (string, tuple or object) is left alone.
 */
export async function addPluginEntry() {
  const managed = await readManagedConfig();
  if (!managed.parseOk) {
    throw new Error('The managed config is not valid JSON — nothing was written. Fix the file first.');
  }
  if (managed.entry.form !== 'missing') return { entry: managed.entry, added: false };
  const config = managed.config;
  if (!Array.isArray(config.plugins)) config.plugins = [];
  config.plugins.push({ package: PLUGIN_PACKAGE, options: {} });
  await writeJsonAtomic(resolveLogicalPath(null, MANAGED_CONFIG_PATH), config);
  return { entry: findPluginEntry(config), added: true };
}

/** Write one plugin option (`tier`) without touching anything else. */
export async function setPluginOption(name, value) {
  const managed = await readManagedConfig();
  if (!managed.parseOk) throw new Error('The managed config is not valid JSON.');
  const entry = managed.entry;
  if (entry.form === 'missing') throw new Error('No modelselect entry in the managed config.');
  const config = managed.config;
  const next = shallowCopy(entry.options);
  next[name] = value;
  if (entry.form === 'object') config.plugins[entry.index].options = next;
  else config.plugins[entry.index] = { package: entry.package, options: next };
  await writeJsonAtomic(resolveLogicalPath(null, MANAGED_CONFIG_PATH), config);
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
  await writeJsonAt(null, MODELSELECT_CONFIG_PATH, next);
  return next;
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
