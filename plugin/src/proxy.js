'use strict';

/**
 * Localhost forwarding proxy for the single `modelselect` virtual provider.
 *
 * Why this exists: OpenCode pins the dispatch endpoint to the session's
 * provider (live-verified: `opencode` → `.../inference/openai/v1`,
 * `opencode-go` → `.../inference/go/openai/v1`). A standalone virtual
 * provider can therefore only reach both real endpoints by BEING the
 * endpoint: the plugin registers `modelselect` with a `baseURL` pointing
 * here, and this proxy forwards each request to the real base, preserving
 * the path the driver chose (the per-turn `api` sync keeps pointing the
 * virtual models at the pick's protocol, so chat/completions vs /responses
 * keeps working exactly as before).
 *
 * Routing metadata arrives on `x-modelselect-*` headers stamped by the
 * `http.request` hook (which already resolved the real pick through the
 * shared rules). The proxy itself is deliberately dumb: look up the
 * upstream base, rewrite `body.model` to the real id, forward, and relay
 * the response byte-for-byte so streaming (SSE) and error shapes pass
 * through untouched — the `http.response` fail-soft hook still sees the
 * real failure it classifies.
 *
 * Zero dependencies, Node >= 20. Binds 127.0.0.1 only, ephemeral port.
 * Never logs bodies or tokens.
 */

const http = require('node:http');

const HEADER_PROVIDER = 'x-modelselect-provider';
const HEADER_MODEL = 'x-modelselect-model';
const HEADER_ENDPOINT = 'x-modelselect-endpoint';

// Hop-by-hop / framing headers that must never be forwarded.
const SKIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  HEADER_PROVIDER,
  HEADER_MODEL,
  HEADER_ENDPOINT,
]);

const SKIP_RESPONSE_HEADERS = new Set(['content-length', 'transfer-encoding', 'connection', 'content-encoding']);

const MAX_BODY_BYTES = 50 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        try {
          req.destroy();
        } catch {
          // ignore
        }
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Our registered baseURL ends in /v1 and the driver appends the protocol
// path (e.g. /v1/chat/completions). Forward the path after that prefix so
// the upstream base (which also ends in /v1) receives the driver's choice.
function upstreamPath(incomingPathname) {
  if (incomingPathname === '/v1') return '/';
  if (incomingPathname.startsWith('/v1/')) return incomingPathname.slice(3);
  return incomingPathname;
}

function sendJson(res, status, obj) {
  const text = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

/**
 * Start the proxy. `getUpstream(providerID)` returns
 * `{ baseURL, headers } | null`; `getToken()` returns the bearer token
 * ('' when none — the request then goes out without one, same as today).
 * Resolves `{ port, close }`. The listening socket is unref'd so unit
 * tests don't hang on exit; the OpenCode host stays alive on its own.
 */
async function startProxy({ getUpstream, getToken, verbose } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const raw = await readBody(req);
      const providerID = String(req.headers[HEADER_PROVIDER] ?? '').trim();
      const model = String(req.headers[HEADER_MODEL] ?? '').trim();
      if (!providerID || !model) {
        sendJson(res, 400, {
          error: { message: 'modelselect proxy: missing routing headers (not a virtual request?)' },
        });
        return;
      }
      const up = getUpstream ? getUpstream(providerID) : null;
      if (!up || !up.baseURL) {
        sendJson(res, 502, { error: { message: `modelselect proxy: no upstream for provider '${providerID}'` } });
        return;
      }
      let out = raw.length ? raw.toString('utf8') : '';
      if (out) {
        try {
          const parsed = JSON.parse(out);
          if (parsed && typeof parsed === 'object' && parsed.model !== undefined) {
            parsed.model = model;
            out = JSON.stringify(parsed);
          }
        } catch {
          // Non-JSON body: forward untouched.
        }
      }
      const inUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const target = `${String(up.baseURL).replace(/\/+$/, '')}${upstreamPath(inUrl.pathname)}${inUrl.search}`;
      const headers = {};
      for (const [k, v] of Object.entries(up.headers || {})) {
        if (v !== undefined) headers[String(k).toLowerCase()] = v;
      }
      for (const [k, v] of Object.entries(req.headers || {})) {
        const lk = String(k).toLowerCase();
        if (SKIP_REQUEST_HEADERS.has(lk) || v === undefined) continue;
        headers[lk] = v;
      }
      if (!headers.authorization) {
        const token = getToken ? getToken() : '';
        if (token) headers.authorization = `Bearer ${token}`;
      }
      const method = String(req.method || 'POST').toUpperCase();
      const hasBody = out.length > 0 && method !== 'GET' && method !== 'HEAD';
      if (hasBody) {
        headers['content-type'] = headers['content-type'] || 'application/json';
        headers['content-length'] = String(Buffer.byteLength(out));
      } else {
        delete headers['content-length'];
        delete headers['content-type'];
      }
      if (verbose) {
        console.log(`[modelselect] proxy → ${providerID}/${model} (${method} ${upstreamPath(inUrl.pathname)})`);
      }
      const upstreamRes = await fetch(target, {
        method,
        headers,
        body: hasBody ? out : undefined,
      });
      const relay = {};
      upstreamRes.headers.forEach((v, k) => {
        if (SKIP_RESPONSE_HEADERS.has(String(k).toLowerCase())) return;
        relay[k] = v;
      });
      res.writeHead(upstreamRes.status, relay);
      if (upstreamRes.body) {
        for await (const chunk of upstreamRes.body) {
          if (!res.write(chunk)) await new Promise((r) => res.once('drain', r));
        }
      }
      res.end();
    } catch (err) {
      try {
        sendJson(res, 502, { error: { message: `modelselect proxy: ${err?.message ?? err}` } });
      } catch {
        try {
          res.end();
        } catch {
          // ignore
        }
      }
    }
  });
  const sockets = new Set();
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      try {
        server.unref();
      } catch {
        // ignore
      }
      resolve();
    });
  });
  const port = server.address().port;
  async function close() {
    for (const s of sockets) {
      try {
        s.destroy();
      } catch {
        // ignore
      }
    }
    await new Promise((resolve) => server.close(resolve));
  }
  return { port, close };
}

module.exports = {
  startProxy,
  HEADER_PROVIDER,
  HEADER_MODEL,
  HEADER_ENDPOINT,
  upstreamPath,
};
