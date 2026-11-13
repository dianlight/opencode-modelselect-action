/* openchamber-modelselect — local service for the host-rendered Work Status
 * section (`contributes.statusSection.source`, OpenChamber >= 2.6.1) and for
 * the settings panel.
 *
 * SOURCE FILE — do not edit service/main.js by hand. Rebuild with:
 *   bun install && bunx openchamber-guest-bundle --node service/src/main.js service/main.js
 * and commit the bundle.
 *
 * The host spawns this process (the `contributes.service` grant, `keepRunning`)
 * and binds a loopback port. Roles:
 * - `GET /status?directory=` — the section's answer (`view.js`); POST is a
 *   control event (`routing-sync`, `tier`, `config-reload`).
 * - `GET/POST /config` — the settings panel's whole read/write surface, so the
 *   package needs no `files` capability and no `filesystem` paths.
 * - `GET /chain?task=` — the models preview, computed here (`chain.js`).
 * - `GET /pick?session=` — the one-line pick behind the session action.
 * - `POST /quota` — the usage provider (`provides: ["quota"]`).
 * - `POST /session-events` — the agent's permission requests and forms, which
 *   the service answers on the user's behalf (`sessionControl.answers`).
 * - `GET /health` — the host's ready probe.
 * Every request carries `Authorization: Bearer $OPENCHAMBER_SERVICE_TOKEN`.
 *
 * The process keeps the plugin's caches fresh on a timer (routing sync + the
 * host-detection session map) instead of writing them from a GET, and reports
 * a missing plugin on the extension's card through `needsConfiguration`
 * (`createServiceHost`).
 *
 * Project cache (written by the plugin, see plugin/src/shared/):
 * - `status-<sessionID>.json`   newest pick per session
 * - `free-quota.json`           per-model free-tier latch
 * - `usage-limits.json`         Go quota snapshot
 * - `routing-sync.json`         {"sync":bool} — the switch this section owns
 * - `model-config-cache.json`   task types (feeding the routing sync)
 * - `openchamber-sessions.json` host-detection evidence (this service writes)
 */
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import routingShared from '../../../core/routing.js';
import { createServiceHost, readSessionEventRequest, SESSION_EVENTS_PATH } from '@openchamber/sdk';
import { buildView, pickSummary, TIER_OPTIONS } from './view.js';
import { computeModelsView } from './chain.js';
import { computeFormValues, formMessage, knownValues, PAGE_MESSAGE, PERMISSION_MESSAGE } from './answers.js';
import * as store from './store.js';

const { syncRouting } = routingShared;
const {
  CACHE_REL,
  SESSION_MAP_FILE,
  GLOBAL_NOTE_PATHS
} = store;

// Keep in sync with the plugin read window (plugin/src/shared/host.js).
const SESSION_MAP_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_MAP_TOUCH_MS = 60 * 1000;
// Session ids never reach the service (the source contract is
// project-scoped), so before the first routed turn the map carries this
// synthetic key: any fresh entry is what the plugin's setup probe reads.
const HOST_EVIDENCE_KEY = 'openchamber';

const ROUTING_SYNC_THROTTLE_MS = 30 * 1000;
const GLOBAL_PROBE_MS = 30 * 1000;
const MAINTAIN_EVERY_MS = 60 * 1000;
const BODY_MAX = 16 * 1024;
// A session event carries the form the agent shows, so it needs more room
// than a control event.
const EVENT_BODY_MAX = 256 * 1024;
const TIER_VALUES = TIER_OPTIONS.map((o) => o.value);

// OpenCode local port candidates, same as plugin/src/shared/usage.js.
// The config reload endpoint lives on the bundled OpenCode server inside
// OpenChamber; the service calls POST /api/location/reload after the
// panel writes the managed config so plugin options apply without restart.
const RELOAD_PATH = '/api/location/reload';
const DEFAULT_PORT = 4096;
function reloadPorts(env = process.env) {
  const out = [];
  const push = (v) => {
    const n = Number(String(v ?? '').trim());
    if (Number.isInteger(n) && n > 0 && n <= 65535 && !out.includes(n)) out.push(n);
  };
  try {
    push(env.OPENCODE_PORT);
    push(env.OPENCODE_SERVER_PORT);
    push(env.PORT);
  } catch {
    /* env unreadable: default port only */
  }
  push(DEFAULT_PORT);
  return out;
}
async function postJson(url, body, { timeoutMs = 5000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

const TOKEN = String(process.env.OPENCHAMBER_SERVICE_TOKEN || '');
const rawPort = process.env.OPENCHAMBER_SERVICE_PORT;
const PORT = Number(rawPort);

function fail(message) {
  process.stderr.write('[modelselect] ' + message + '\n');
  process.exit(1);
}

if (!TOKEN) fail('OPENCHAMBER_SERVICE_TOKEN is missing');
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  fail('OPENCHAMBER_SERVICE_PORT is missing or invalid: ' + String(rawPort));
}

// --- extension card ---------------------------------------------------------

/** Service calls need the host's callback listener; tests run without it. */
let serviceHost = null;
try {
  if (process.env.OPENCHAMBER_HOST_CALLBACK_URL) {
    serviceHost = createServiceHost({ env: process.env });
  }
} catch (e) {
  serviceHost = null;
}

let lastCardState = null;

/**
 * Tell the extension's card why the section is empty, once per state change
 * (the host rate-limits these, and the card keeps the message until cleared).
 */
function reportCardState(state, message) {
  if (state === lastCardState) return;
  lastCardState = state;
  if (!serviceHost) return;
  void serviceHost.needsConfiguration(message || null).catch(() => {
    // Older hosts/tests: the card is a nicety, never a read dependency
    lastCardState = null;
  });
}

// --- plugin presence ------------------------------------------------------

let probeCache = { at: 0, value: { checked: false, entry: false } };

/** Does any readable global config mention the plugin? Cached 30 s. */
async function pluginEntry() {
  if (Date.now() - probeCache.at < GLOBAL_PROBE_MS) return probeCache.value;
  const results = await Promise.all(GLOBAL_NOTE_PATHS.map(async (logical) => {
    try {
      const text = await fsp.readFile(store.resolveLogicalPath(null, logical), 'utf8');
      return /modelselect/i.test(text);
    } catch (e) {
      return null; // unreadable (missing/denied) — not evidence
    }
  }));
  const readable = results.filter((r) => r !== null);
  const value = readable.length
    ? { checked: true, entry: readable.some((r) => r === true) }
    : { checked: false, entry: false };
  probeCache = { at: Date.now(), value: value };
  return value;
}

// --- side effects (best effort, never block the answer) -------------------

const syncAt = new Map();
const seenDirectories = new Set();

/** Per-turn routing refresh; throttled per project. */
async function maybeSyncRouting(directory, syncEnabled) {
  if (!syncEnabled) return;
  const last = syncAt.get(directory) || 0;
  if (Date.now() - last < ROUTING_SYNC_THROTTLE_MS) return;
  syncAt.set(directory, Date.now());
  await syncRouting({
    readJson: (logical) => store.readJsonAt(directory, logical),
    writeJson: (logical, value) => store.writeJsonAt(directory, logical, value)
  });
}

const mapAt = new Map();

/**
 * Keep `<cacheDir>/openchamber-sessions.json` fresh — the plugin reads it as
 * "this project is OpenChamber-hosted". One entry per routed session; when
 * no session has routed yet, the synthetic host key stands in so a fresh
 * project is detected before its first turn. Single writer, 30 d TTL.
 */
async function touchSessionMap(cacheDir, sessionIDs) {
  const last = mapAt.get(cacheDir) || 0;
  if (Date.now() - last < SESSION_MAP_TOUCH_MS) return;
  mapAt.set(cacheDir, Date.now());
  const file = path.join(cacheDir, SESSION_MAP_FILE);
  const stored = await store.readJsonFile(file);
  const sessions = stored && typeof stored.sessions === 'object' && stored.sessions ? stored.sessions : {};
  const now = Date.now();
  let changed = false;
  Object.keys(sessions).forEach((id) => {
    const seen = sessions[id];
    if (typeof seen !== 'number' || !Number.isFinite(seen) || now - seen > SESSION_MAP_TTL_MS) {
      delete sessions[id];
      changed = true;
    }
  });
  const keys = sessionIDs.length ? sessionIDs : [HOST_EVIDENCE_KEY];
  keys.forEach((id) => {
    if (sessions[id] === now) return;
    sessions[id] = now;
    changed = true;
  });
  if (!changed) return;
  await store.writeJsonAtomic(file, { version: 1, sessions: sessions });
}

/** One maintenance pass over every project this process has been asked about. */
async function maintain() {
  for (const directory of Array.from(seenDirectories)) {
    try {
      const syncOn = await store.readRoutingSync(directory);
      await maybeSyncRouting(directory, syncOn);
      const statuses = await store.listStatuses(store.cacheDirOf(directory));
      await touchSessionMap(store.cacheDirOf(directory), statuses.map((s) => s.sessionID));
    } catch (e) {
      // silent: maintenance must never break a read
    }
  }
}

// --- views ----------------------------------------------------------------

/** The stored plugin `tier` option, from an already-read managed config. */
function tierOf(managed) {
  if (!managed || !managed.parseOk || managed.entry.form === 'missing') return null;
  const tier = typeof managed.entry.options.tier === 'string' ? managed.entry.options.tier : 'auto';
  return TIER_VALUES.includes(tier) ? tier : 'auto';
}

async function readView(directory) {
  const now = Date.now();
  if (!directory) {
    reportCardState('no-project', null);
    return buildView({ now: now, directory: null });
  }
  seenDirectories.add(directory);

  const cacheDir = store.cacheDirOf(directory);
  const statuses = await store.listStatuses(cacheDir);
  const newest = store.newestStatus(statuses);
  const [syncOn, freeQuota, usage, config, entry, managed] = await Promise.all([
    store.readRoutingSync(directory),
    store.readLatch(directory),
    store.readUsage(directory),
    store.readJsonAt(directory, path.join(CACHE_REL, 'model-config-cache.json')),
    pluginEntry(),
    store.readManagedConfig()
  ]);

  // The card carries the fix; the section only says it is empty.
  if (!managed.parseOk) {
    reportCardState('managed-broken',
      'The OpenChamber managed OpenCode config is not valid JSON, so the settings panel cannot save. Fix ' +
      store.MANAGED_CONFIG_PATH + ' and reopen OpenChamber.');
  } else if (managed.entry.form === 'missing') {
    reportCardState('plugin-missing',
      'Add the modelselect plugin to ' + store.MANAGED_CONFIG_PATH +
      ' and reopen OpenChamber — it is the only config OpenChamber\'s server loads.');
  } else {
    reportCardState('ok', null);
  }

  return buildView({
    now: now,
    directory: directory,
    found: Boolean(newest),
    status: newest ? newest.data : null,
    sessionID: newest ? newest.sessionID : '',
    knownTypes: store.knownTaskTypes(config),
    sync: syncOn,
    freeQuota: freeQuota,
    usage: usage,
    globalEntry: entry,
    tierOption: tierOf(managed)
  });
}

/** The plugin options a frame may see: the write-only secrets never go out. */
function publicOptions(options) {
  const out = Object.assign({}, options || {});
  delete out.token;
  delete out.jevToken;
  return out;
}

/** Everything the settings panel needs for its three tabs, in one read. */
async function readConfig(directory, sessionID) {
  const [managed, globalPresent, catalog, extConfig, syncOn, sessionStatus] = await Promise.all([
    store.readManagedConfig(),
    Promise.all(GLOBAL_NOTE_PATHS.map(async (logical) => {
      try {
        await fsp.stat(store.resolveLogicalPath(null, logical));
        return logical;
      } catch (e) {
        return null;
      }
    })),
    store.readCatalog(directory),
    store.readExtensionConfig(),
    store.readRoutingSync(directory),
    store.readSessionStatus(directory, sessionID)
  ]);
  return {
    managed: {
      parseOk: managed.parseOk,
      exists: managed.exists,
      parseError: managed.parseError || '',
      entry: {
        form: managed.entry.form,
        package: managed.entry.package,
        options: publicOptions(managed.entry.options)
      }
    },
    managedPath: store.MANAGED_CONFIG_PATH,
    extensionPath: store.MODELSELECT_CONFIG_PATH,
    globalPaths: globalPresent.filter(Boolean),
    catalog: { types: catalog.types, bounds: catalog.bounds },
    extConfig: extConfig,
    syncOn: syncOn,
    sessionTask: sessionStatus && typeof sessionStatus.taskType === 'string'
      ? sessionStatus.taskType : ''
  };
}

async function readChain(directory, taskType) {
  const [catalog, options, latch, usage] = await Promise.all([
    store.readCatalog(directory),
    store.storedPluginOptions(),
    store.readLatch(directory),
    store.readUsage(directory)
  ]);
  return computeModelsView({
    taskType: taskType,
    catalogConfig: catalog.config,
    options: options,
    latchData: latch,
    usage: usage,
    now: Date.now()
  });
}

// --- answers (session control) ---------------------------------------------

/**
 * The projects this service serves: the section polled them or the panel named
 * them. A request in any other project is not ours to answer — the extension
 * only speaks for the project the user is working in.
 */
function servesDirectory(directory) {
  return typeof directory === 'string' && directory !== '' && seenDirectories.has(directory);
}

/**
 * One answer, never retried. A 404 means the request settled meanwhile, in
 * the app or on another device: log it and move on, because answering it
 * again would answer a request that no longer exists.
 */
async function answer(what, call) {
  if (!serviceHost) return;
  try {
    await call();
  } catch (e) {
    const status = e && typeof e.status === 'number' ? e.status : 0;
    if (status === 404) {
      process.stderr.write('[modelselect] the ' + what + ' settled already (404); not retrying\n');
    } else {
      process.stderr.write('[modelselect] the ' + what + ' could not be answered: ' +
        messageOf(e, 'unknown error') + '\n');
    }
  }
}

/** Allow the request once, with a message that says who allowed it. */
async function answerPermission(event) {
  const requestId = event.permission && event.permission.requestId;
  if (!requestId) return;
  await answer('permission request', () => serviceHost.sessions.answerPermission(
    event.session.id,
    requestId,
    { decision: 'allow', message: PERMISSION_MESSAGE }
  ));
}

/**
 * Answer a form with the values the service holds; send a page to the session
 * instead, because a page cannot be answered from a service.
 */
async function answerQuestion(event, content, directory) {
  const kind = event.question && event.question.kind;
  const sessionId = event.session.id;
  if (kind === 'page') {
    await answer('page', () => serviceHost.sessions.send(sessionId, PAGE_MESSAGE));
    return;
  }
  if (kind !== 'form') return;
  const ask = content && content.ask;
  const formId = (event.question && event.question.id) || (ask && ask.id);
  if (!formId) return;
  const fields = ask && Array.isArray(ask.fields) ? ask.fields : [];
  const pick = await store.readSessionStatus(directory, sessionId);
  const values = computeFormValues(fields, knownValues(directory, pick));
  await answer('form', () => serviceHost.sessions.answerForm(
    sessionId,
    formId,
    values,
    formMessage(values)
  ));
}

/** One session event: a request to answer, or nothing to do. */
async function handleSessionEvent(bodyText) {
  const request = readSessionEventRequest(bodyText);
  if (!request) {
    return { status: 400, body: { ok: false, error: 'Not a session event of this version.' } };
  }
  const event = request.event;
  const directory = event.project ? event.project.directory : null;
  if (!servesDirectory(directory)) {
    return { status: 200, body: { ok: true } };
  }
  if (event.type === 'permission-asked') {
    await answerPermission(event);
  } else if (event.type === 'question-asked') {
    await answerQuestion(event, request.content, directory);
  }
  return { status: 200, body: { ok: true } };
}

// --- HTTP -----------------------------------------------------------------

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

function authorized(req) {
  const given = Buffer.from(String(req.headers.authorization || ''));
  const want = Buffer.from('Bearer ' + TOKEN);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

function readBody(req, max = BODY_MAX) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function projectDirectory(url) {
  const raw = url.searchParams.get('directory');
  return raw && path.isAbsolute(raw) ? raw : null;
}

function messageOf(err, fallback) {
  return String((err && err.message) || fallback || err).slice(0, 300);
}

async function reloadOpenCode() {
  const tried = [];
  let last = null;
  for (const port of reloadPorts()) {
    tried.push(port);
    const result = await postJson('http://127.0.0.1:' + port + RELOAD_PATH, null);
    last = result;
    if (result.ok) return { ok: true, port: port, tried: tried };
  }
  return {
    ok: false,
    tried: tried,
    error: 'OpenCode config reload failed on ' + tried.join(', ') + ': ' +
      String((last && last.error) || (last && last.status))
  };
}

async function handleControl(directory, body) {
  if (!directory) return { status: 400, body: { message: 'No project is open.' } };
  let event;
  try {
    event = JSON.parse(body || '{}');
  } catch (e) {
    return { status: 400, body: { message: 'The control event is not JSON.' } };
  }
  if (!event || typeof event !== 'object' || typeof event.id !== 'string') {
    return { status: 400, body: { message: 'The control event has no id.' } };
  }
  if (event.id === 'routing-sync') {
    if (event.value !== 'on' && event.value !== 'off') {
      return { status: 400, body: { message: "Router sync wants 'on' or 'off'." } };
    }
    try {
      await store.writeRoutingSync(directory, event.value === 'on');
    } catch (e) {
      return { status: 500, body: { message: 'Could not write the router-sync file.' } };
    }
    if (event.value === 'on') {
      syncAt.delete(directory);
      void maybeSyncRouting(directory, true).catch(() => {});
    }
    return { status: 200, body: { ok: true } };
  }
  if (event.id === 'tier') {
    if (!TIER_VALUES.includes(event.value)) {
      return { status: 400, body: { message: "Tier wants 'auto', 'go' or 'free'." } };
    }
    try {
      await store.setPluginOption('tier', event.value);
    } catch (e) {
      return { status: 409, body: { message: messageOf(e, 'Could not write the plugin options.') } };
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
  if (event.id === 'config-reload') {
    const reload = await reloadOpenCode();
    if (reload.ok) return { status: 200, body: { ok: true, port: reload.port, tried: reload.tried } };
    return { status: 502, body: { message: reload.error } };
  }
  return {
    status: 400,
    body: { message: "Unknown control '" + event.id.slice(0, 40) + "'." }
  };
}

/** The settings panel's save: read-modify-write, then reload OpenCode once. */
async function handleConfigSave(directory, body) {
  let request;
  try {
    request = JSON.parse(body || '{}');
  } catch (e) {
    return { status: 400, body: { message: 'The save request is not JSON.' } };
  }
  if (!request || typeof request !== 'object') {
    return { status: 400, body: { message: 'The save request has no body.' } };
  }
  if (request.kind === 'plugin') {
    let saved;
    try {
      saved = await store.savePluginOptions(directory, request.values || {});
    } catch (e) {
      const status = /not valid JSON|No modelselect entry/.test(messageOf(e)) ? 409 : 500;
      return { status: status, body: { message: messageOf(e, 'Could not write the managed config.') } };
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
  if (request.kind === 'plugin-add') {
    try {
      const added = await store.addPluginEntry();
      // A new entry only takes effect when OpenCode reloads its config.
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
      return { status: status, body: { message: messageOf(e, 'Could not write the managed config.') } };
    }
  }
  if (request.kind === 'extension') {
    try {
      const next = await store.saveExtensionConfig(directory, request.values || {});
      return { status: 200, body: { ok: true, config: next } };
    } catch (e) {
      return { status: 500, body: { message: messageOf(e, 'Could not write the extension config.') } };
    }
  }
  return { status: 400, body: { message: "Save wants kind 'plugin' or 'extension'." } };
}

// Quota provider (contributes.quota, OpenChamber >= 2.6.2 canary).
// Reports the OpenCode Go / Console budget data already cached in
// usage-limits.json so OpenChamber's Usage page can surface it alongside
// built-in providers. No credentials are consumed (providers: []).
// The quota call carries no directory, so the project is the last one this
// extension was asked about (the section or the panel). The host spawns a
// service with its package folder as cwd, so cwd is never the project.
async function handleQuota(bodyText) {
  let request;
  try {
    request = JSON.parse(bodyText || '{}');
  } catch (e) {
    return { ok: false, error: { message: 'The quota request is not JSON.' } };
  }
  if (!request || typeof request !== 'object' || request.method !== 'usage.read') {
    return { ok: false, error: { message: 'Unexpected quota request.' } };
  }
  const directory = await store.lastProject();
  const usage = directory ? await store.readUsage(directory) : null;
  if (!usage || typeof usage !== 'object') {
    return {
      ok: true,
      data: {
        ok: true,
        configured: false,
        error: 'No usage snapshot yet — open a project so the plugin writes one.',
        usage: null
      }
    };
  }
  const windows = {};
  const go = usage.go && typeof usage.go === 'object' ? usage.go : null;
  if (go) {
    ['rolling', 'weekly', 'monthly'].forEach(function (k) {
      const w = go[k];
      if (w && typeof w.percent === 'number' && Number.isFinite(w.percent)) {
        windows[k] = {
          usedPercent: Math.max(0, Math.min(100, w.percent)),
          resetAt: typeof w.resetsAt === 'number' && w.resetsAt > 0 ? w.resetsAt : null
        };
      }
    });
  }
  const models = {};
  const budgets = Array.isArray(usage.budgets) ? usage.budgets : [];
  budgets.forEach(function (b) {
    if (!b || typeof b !== 'object' || !Array.isArray(b.models)) return;
    b.models.forEach(function (m) {
      if (!m || typeof m !== 'object') return;
      const key = (m.providerID ? m.providerID + '/' : '') + (m.modelID || m.name || '');
      if (!key) return;
      const mw = {};
      if (typeof m.percent === 'number' && Number.isFinite(m.percent)) {
        mw.monthly = {
          usedPercent: Math.max(0, Math.min(100, m.percent)),
          resetAt: typeof m.resetsAt === 'number' && m.resetsAt > 0 ? m.resetsAt : null
        };
      }
      models[key] = { windows: mw };
    });
  });
  let anyWindow = false;
  Object.values(windows).forEach(function (w) { if (w) anyWindow = true; });
  Object.values(models).forEach(function (mw) { Object.values(mw.windows || {}).forEach(function () { anyWindow = true; }); });
  return {
    ok: true,
    data: {
      ok: true,
      configured: anyWindow,
      error: anyWindow ? null : 'Usage snapshot has no readable windows yet.',
      planLabel: 'OpenCode Go / Console',
      usage: {
        windows: Object.keys(windows).length ? windows : null,
        models: Object.keys(models).length ? models : null
      }
    }
  };
}

async function handle(req, res) {
  if (!authorized(req)) {
    send(res, 401, { message: 'Unauthorized.' });
    return;
  }
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const directory = projectDirectory(url);

  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, { ok: true });
    return;
  }
  if (url.pathname === '/status' && req.method === 'GET') {
    if (directory) {
      seenDirectories.add(directory);
      void store.rememberProject(directory);
      // The map is this service's own evidence file (not the project's
      // config): stamping it here is what lets the plugin detect OpenChamber
      // on the first turn. Routing.json is only touched by the timer and the
      // switch, never by a read.
      void store.listStatuses(store.cacheDirOf(directory))
        .then((statuses) => touchSessionMap(
          store.cacheDirOf(directory),
          statuses.map((s) => s.sessionID)
        ))
        .catch(() => {});
    }
    send(res, 200, await readView(directory));
    return;
  }
  if (url.pathname === '/status' && req.method === 'POST') {
    const answer = await handleControl(directory, await readBody(req));
    send(res, answer.status, answer.body);
    return;
  }
  if (url.pathname === '/config' && req.method === 'GET') {
    if (!directory) {
      send(res, 400, { message: 'No project is open.' });
      return;
    }
    seenDirectories.add(directory);
    void store.rememberProject(directory);
    send(res, 200, await readConfig(directory, url.searchParams.get('session')));
    return;
  }
  if (url.pathname === '/config' && req.method === 'POST') {
    const answer = await handleConfigSave(directory, await readBody(req));
    send(res, answer.status, answer.body);
    return;
  }
  if (url.pathname === '/chain' && req.method === 'GET') {
    if (!directory) {
      send(res, 400, { message: 'No project is open.' });
      return;
    }
    const task = String(url.searchParams.get('task') || '').slice(0, 120);
    send(res, 200, await readChain(directory, task));
    return;
  }
  if (url.pathname === '/pick' && req.method === 'GET') {
    if (!directory) {
      send(res, 400, { message: 'No project is open.' });
      return;
    }
    const sessionID = String(url.searchParams.get('session') || '');
    let picked = null;
    if (sessionID) {
      picked = await store.readSessionStatus(directory, sessionID);
    } else {
      const newest = store.newestStatus(await store.listStatuses(store.cacheDirOf(directory)));
      picked = newest ? newest.data : null;
    }
    const summary = pickSummary(picked, Date.now());
    if (!summary) {
      send(res, 404, { message: 'No pick for this session yet — it routes on the first turn.' });
      return;
    }
    send(res, 200, summary);
    return;
  }
  if (url.pathname === '/quota' && req.method === 'POST') {
    send(res, 200, await handleQuota(await readBody(req)));
    return;
  }
  if (url.pathname === SESSION_EVENTS_PATH && req.method === 'POST') {
    const result = await handleSessionEvent(await readBody(req, EVENT_BODY_MAX));
    send(res, result.status, result.body);
    return;
  }
  send(res, 404, { message: 'Not found.' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    try {
      send(res, 500, { message: String((err && err.message) || err).slice(0, 300) });
    } catch (e) {
      res.destroy();
    }
  });
});

server.on('error', (err) => fail('cannot start: ' + String((err && err.message) || err)));

server.listen(PORT, '127.0.0.1', () => {
  // keepRunning: the host starts this process with OpenChamber. The project
  // list is empty until something asks about one, so a cold start costs
  // nothing until the first read.
  const timer = setInterval(() => { void maintain(); }, MAINTAIN_EVERY_MS);
  if (typeof timer.unref === 'function') timer.unref();
  process.stdout.write('[modelselect] listening on 127.0.0.1:' + server.address().port + '\n');
});

function stop() {
  server.close(() => process.exit(0));
  // The host sends SIGTERM on uninstall/quit; never hang the shutdown.
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGTERM', stop);
process.on('SIGINT', stop);
