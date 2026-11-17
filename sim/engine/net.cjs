'use strict';

/**
 * Mock HTTP server for spawned components (GitHub Action, python pipeline,
 * service callback). Routes are data: each has a `match` (substring or
 * `re:<pattern>`), an ordered `replies` list (the last reply repeats), and
 * optional faults. Every call is recorded so scenarios can assert on the
 * traffic the component actually produced.
 */

const http = require('node:http');

function matches(match, url) {
  if (typeof match === 'string') return url.includes(match);
  if (match instanceof RegExp) return match.test(url);
  return false;
}

function respond(res, reply) {
  const status = reply?.status ?? 200;
  const headers = { ...(reply?.headers || {}) };
  let body = reply?.body;
  if (body !== undefined && body !== null && typeof body !== 'string') {
    body = JSON.stringify(body);
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }
  res.writeHead(status, headers);
  res.end(body === undefined ? '' : String(body));
}

function startNet(routes = []) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let pathname = req.url;
      try { pathname = new URL(req.url, 'http://x').pathname + new URL(req.url, 'http://x').search; } catch { /* keep raw */ }
      calls.push({ method: req.method, url: req.url, path: pathname, body });
      const route = routes.find((r) => (!r.method || r.method === req.method) && matches(r.match, req.url));
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no route', url: req.url }));
        return;
      }
      route.count = (route.count || 0) + 1;
      const reply = route.replies[Math.min(route.count - 1, route.replies.length - 1)];
      if (route.fault === 'reset') { res.socket.destroy(); return; }
      if (route.fault === 'hang') { return; } // never answer; client must time out
      if (reply?.waitMs) setTimeout(() => respond(res, reply), reply.waitMs);
      else respond(res, reply);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        calls,
        routes,
        close() { server.close(); },
      });
    });
  });
}

/** Replace {{net}} placeholders in strings with the mock server origin. */
function substituteNet(value, origin) {
  if (typeof value === 'string') return value.split('{{net}}').join(origin);
  if (Array.isArray(value)) return value.map((v) => substituteNet(v, origin));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substituteNet(v, origin)]));
  }
  return value;
}

module.exports = { startNet, substituteNet };
