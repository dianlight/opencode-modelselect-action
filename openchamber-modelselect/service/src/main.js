/* openchamber-modelselect — local service for the host-rendered Work Status
 * section (`contributes.statusSection.source`, OpenChamber >= 2.6.1).
 *
 * SOURCE FILE — do not edit service/main.js by hand. Rebuild with:
 *   bun install && bunx openchamber-guest-bundle --node service/src/main.js service/main.js
 * and commit the bundle.
 *
 * The host spawns this process (the `contributes.service` grant), binds a
 * loopback port, and polls `GET /status` while the section is shown and
 * expanded. Row controls POST `{ id, value? }` to the same path. Every
 * request carries `Authorization: Bearer $OPENCHAMBER_SERVICE_TOKEN`.
 *
 * The service replaces the old status iframe: it reads and writes the
 * project cache directly (no host file API), runs the shared routing sync
 * (`core/routing.js`) through a plain-fs adapter, and keeps the plugin's
 * host-detection session map fresh. It runs with the user's own access and
 * needs no `capabilities`/`filesystem` declarations of its own.
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
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import routingShared from '../../../core/routing.js';
import { buildView } from './view.js';

const { syncRouting, parseJsonLenient } = routingShared;

const CACHE_REL = '.opencode/.modelselect-cache';
const SESSION_MAP_FILE = 'openchamber-sessions.json';
const ROUTING_SYNC_FILE = 'routing-sync.json';
// Keep in sync with the plugin read window (plugin/src/shared/host.js).
const SESSION_MAP_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_MAP_TOUCH_MS = 60 * 1000;
// Session ids never reach the service (the source contract is
// project-scoped), so before the first routed turn the map carries this
// synthetic key: any fresh entry is what the plugin's setup probe reads.
const HOST_EVIDENCE_KEY = 'openchamber';

const ROUTING_SYNC_THROTTLE_MS = 30 * 1000;
const GLOBAL_PROBE_MS = 30 * 1000;
const BODY_MAX = 16 * 1024;

const GLOBAL_CONFIG_PATHS = [
  '~/.config/openchamber/opencode.managed.json',
  '~/.config/opencode/opencode.json',
  '~/.config/opencode/opencode.jsonc'
];

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

// --- paths + JSON ---------------------------------------------------------

/** `~/...` resolves against the user home; anything else against the project. */
function resolveLogicalPath(directory, logical) {
  const p = String(logical == null ? '' : logical);
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  if (path.isAbsolute(p)) return p;
  return path.join(String(directory || process.cwd()), p);
}

async function readJsonFile(file) {
  try {
    return parseJsonLenient(await fsp.readFile(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

/** Write through a sibling temp file so a reader never sees half a document. */
async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(value));
  await fsp.rename(tmp, file);
}

function cacheDirOf(directory) {
  return path.join(directory, CACHE_REL);
}

// --- plugin presence ------------------------------------------------------

let probeCache = { at: 0, value: { checked: false, entry: false } };

/** Does any readable global config mention the plugin? Cached 30 s. */
async function pluginEntry() {
  if (Date.now() - probeCache.at < GLOBAL_PROBE_MS) return probeCache.value;
  const results = await Promise.all(GLOBAL_CONFIG_PATHS.map(async (logical) => {
    try {
      const text = await fsp.readFile(resolveLogicalPath(null, logical), 'utf8');
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

// --- project snapshot -----------------------------------------------------

/** Every readable status file, with its age source (`updatedAt`, else mtime). */
async function listStatuses(cacheDir) {
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

function knownTaskTypes(cfg) {
  const table = (cfg && (cfg.config || cfg)) || {};
  const bucket = table['task-types'] || table.taskTypes || {};
  return Object.keys(bucket);
}

function newestStatus(statuses) {
  let newest = null;
  for (const entry of statuses) {
    if (!newest || entry.at > newest.at) newest = entry;
  }
  return newest;
}

// --- side effects (best effort, never block the answer) -------------------

const syncAt = new Map();

/** Per-turn routing refresh while the section is visible; throttled. */
async function maybeSyncRouting(directory, syncEnabled) {
  if (!syncEnabled) return;
  const last = syncAt.get(directory) || 0;
  if (Date.now() - last < ROUTING_SYNC_THROTTLE_MS) return;
  syncAt.set(directory, Date.now());
  await syncRouting({
    readJson: (logical) => readJsonFile(resolveLogicalPath(directory, logical)),
    writeJson: (logical, value) => writeJsonAtomic(resolveLogicalPath(directory, logical), value)
  });
}

const mapAt = new Map();
const mapChain = new Map();

/**
 * Keep `<cacheDir>/openchamber-sessions.json` fresh — the plugin reads it as
 * "this project is OpenChamber-hosted". One entry per routed session; when
 * no session has routed yet, the synthetic host key stands in so a fresh
 * project is detected before its first turn. Single writer, 30 d TTL.
 */
function touchSessionMap(cacheDir, sessionIDs) {
  const last = mapAt.get(cacheDir) || 0;
  if (Date.now() - last < SESSION_MAP_TOUCH_MS) return mapChain.get(cacheDir) || Promise.resolve();
  mapAt.set(cacheDir, Date.now());
  const run = (mapChain.get(cacheDir) || Promise.resolve()).then(async () => {
    const file = path.join(cacheDir, SESSION_MAP_FILE);
    const stored = await readJsonFile(file);
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
    await writeJsonAtomic(file, { version: 1, sessions: sessions });
  }).catch(() => {});
  mapChain.set(cacheDir, run);
  return run;
}

// --- views ----------------------------------------------------------------

async function readView(directory) {
  const now = Date.now();
  if (!directory) return buildView({ now: now, directory: null });

  const cacheDir = cacheDirOf(directory);
  const statuses = await listStatuses(cacheDir);
  const newest = newestStatus(statuses);
  const [syncFile, freeQuota, usage, config, entry] = await Promise.all([
    readJsonFile(path.join(cacheDir, ROUTING_SYNC_FILE)),
    readJsonFile(path.join(cacheDir, 'free-quota.json')),
    readJsonFile(path.join(cacheDir, 'usage-limits.json')),
    readJsonFile(path.join(cacheDir, 'model-config-cache.json')),
    pluginEntry()
  ]);
  const syncEnabled = !(syncFile && syncFile.sync === false);

  const view = buildView({
    now: now,
    directory: directory,
    found: Boolean(newest),
    status: newest ? newest.data : null,
    sessionID: newest ? newest.sessionID : '',
    knownTypes: knownTaskTypes(config),
    sync: syncEnabled,
    freeQuota: freeQuota,
    usage: usage,
    globalEntry: entry
  });

  void maybeSyncRouting(directory, syncEnabled).catch(() => {});
  void touchSessionMap(cacheDir, statuses.map((s) => s.sessionID)).catch(() => {});
  return view;
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_MAX) {
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

async function handleAction(directory, body) {
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
      await writeJsonAtomic(path.join(cacheDirOf(directory), ROUTING_SYNC_FILE), { sync: event.value === 'on' });
    } catch (e) {
      return { status: 500, body: { message: 'Could not write the router-sync file.' } };
    }
    if (event.value === 'on') {
      syncAt.delete(directory);
      void maybeSyncRouting(directory, true).catch(() => {});
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
    send(res, 401, { message: 'Unauthorized.' });
    return;
  }
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, { ok: true });
    return;
  }
  if (url.pathname === '/status' && req.method === 'GET') {
    send(res, 200, await readView(projectDirectory(url)));
    return;
  }
  if (url.pathname === '/status' && req.method === 'POST') {
    const answer = await handleAction(projectDirectory(url), await readBody(req));
    send(res, answer.status, answer.body);
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
  process.stdout.write('[modelselect] listening on 127.0.0.1:' + server.address().port + '\n');
});

function stop() {
  server.close(() => process.exit(0));
  // The host sends SIGTERM on uninstall/quit; never hang the shutdown.
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGTERM', stop);
process.on('SIGINT', stop);
