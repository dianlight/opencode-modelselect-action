'use strict';

/**
 * Proxy tests: a stub upstream asserts what the proxy forwards, the test
 * asserts what the proxy relays. Real HTTP through the real proxy code —
 * no mocks of the forwarding path itself.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { startProxy, HEADER_PROVIDER, HEADER_MODEL } = require('../src/proxy');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Stub upstream: records the last request, replays scripted SSE chunks.
function startStub(handler) {
  const seen = { requests: [] };
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    seen.requests.push({ method: req.method, url: req.url, headers: { ...req.headers }, body });
    await handler(req, res, body, seen);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      server.unref?.();
      resolve({ seen, port: server.address().port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

async function startProxyTo(stub, extra = {}) {
  return startProxy({
    getUpstream: (providerID) =>
      providerID === 'opencode'
        ? { baseURL: `http://127.0.0.1:${stub.port}/v1`, headers: { 'x-opencode-org-id': 'org-1' } }
        : null,
    getToken: () => 'tok-1',
    verbose: false,
    ...extra,
  });
}

describe('modelselect proxy', () => {
  it('rewrites the model, preserves the path, attaches auth, relays SSE', async () => {
    const stub = await startStub(async (req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"a":1}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
    const proxy = await startProxyTo(stub);
    try {
      const r = await fetch(`http://127.0.0.1:${proxy.port}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [HEADER_PROVIDER]: 'opencode',
          [HEADER_MODEL]: 'real-model',
        },
        body: JSON.stringify({ model: 'auto-free-first', messages: [] }),
      });
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /text\/event-stream/);
      assert.equal(await r.text(), 'data: {"a":1}\n\ndata: [DONE]\n\n');
      assert.equal(stub.seen.requests.length, 1);
      const fwd = stub.seen.requests[0];
      assert.equal(fwd.url, '/v1/chat/completions', 'driver path preserved');
      assert.equal(JSON.parse(fwd.body).model, 'real-model', 'wire carries the real pick');
      assert.equal(fwd.headers.authorization, 'Bearer tok-1', 'token chain attached');
      assert.equal(fwd.headers['x-opencode-org-id'], 'org-1', 'captured provider headers forwarded');
      assert.equal(fwd.headers['x-modelselect-provider'], undefined, 'routing headers stripped');
      assert.equal(fwd.headers['x-modelselect-model'], undefined, 'routing headers stripped');
    } finally {
      await proxy.close();
      await stub.close();
    }
  });

  it('rejects requests without routing headers (never forwards blind)', async () => {
    const stub = await startStub(async (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    const proxy = await startProxyTo(stub);
    try {
      const r = await fetch(`http://127.0.0.1:${proxy.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'auto-free-first', messages: [] }),
      });
      assert.equal(r.status, 400);
      assert.equal(stub.seen.requests.length, 0, 'nothing forwarded');
    } finally {
      await proxy.close();
      await stub.close();
    }
  });

  it('returns 502 for an unknown provider', async () => {
    const stub = await startStub(async (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    const proxy = await startProxyTo(stub);
    try {
      const r = await fetch(`http://127.0.0.1:${proxy.port}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [HEADER_PROVIDER]: 'nope',
          [HEADER_MODEL]: 'x',
        },
        body: JSON.stringify({ model: 'auto-free-first', messages: [] }),
      });
      assert.equal(r.status, 502);
      assert.equal(stub.seen.requests.length, 0);
    } finally {
      await proxy.close();
      await stub.close();
    }
  });

  it('relays upstream error statuses untouched (fail-soft still classifies)', async () => {
    const stub = await startStub(async (req, res) => {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Rate limit exceeded. Please try again later.' } }));
    });
    const proxy = await startProxyTo(stub);
    try {
      const r = await fetch(`http://127.0.0.1:${proxy.port}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [HEADER_PROVIDER]: 'opencode',
          [HEADER_MODEL]: 'some-free',
        },
        body: JSON.stringify({ model: 'auto-free-first', messages: [] }),
      });
      assert.equal(r.status, 429);
      assert.match(await r.text(), /Rate limit exceeded/);
    } finally {
      await proxy.close();
      await stub.close();
    }
  });

  it('forwards non-JSON bodies untouched', async () => {
    const stub = await startStub(async (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    const proxy = await startProxyTo(stub);
    try {
      const r = await fetch(`http://127.0.0.1:${proxy.port}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          [HEADER_PROVIDER]: 'opencode',
          [HEADER_MODEL]: 'x',
        },
        body: 'not json{',
      });
      assert.equal(r.status, 200);
      assert.equal(stub.seen.requests[0].body, 'not json{');
    } finally {
      await proxy.close();
      await stub.close();
    }
  });
});
