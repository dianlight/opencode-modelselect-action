'use strict';

/**
 * End-to-end test for the local service that backs
 * `contributes.statusSection.source` (`service/main.js`).
 *
 * Spawns the committed bundle exactly as OpenChamber does (loopback port +
 * bearer token in the env), then drives the real wire: `/health`, a poll,
 * the host's `guestStatusViewSchema` validation of `GET /status`, a toggle
 * posted to `POST /status`, the 401 without the bearer, and the side
 * effects the plugin relies on (router-sync file + host-detection map).
 *
 * Run `bun run build` first — this test exercises the shipped bundle.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BUNDLE = path.join(__dirname, '..', 'service', 'main.js');
const CACHE = '.opencode/.modelselect-cache';
const TOKEN = 'test-service-token';

let guestStatusViewSchema;

before(async () => {
  ({ guestStatusViewSchema } = await import('@openchamber/sdk/schemas'));
});

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modelselect-service-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const cache = path.join(project, CACHE);
  fs.mkdirSync(cache, { recursive: true });
  fs.mkdirSync(home, { recursive: true });

  const now = Date.now();
  fs.writeFileSync(path.join(cache, 'status-ses_test.json'), JSON.stringify({
    sessionID: 'ses_test',
    taskType: 'bugfix',
    tier: 'free',
    model: 'opencode/zen-free',
    jev: 'pinned@0.8',
    goOk: true,
    think: 'high',
    variant: null,
    freeExhausted: false,
    source: 'auto',
    suggestOnly: false,
    updatedAt: now - 60 * 1000
  }));
  fs.writeFileSync(path.join(cache, 'model-config-cache.json'), JSON.stringify({
    fetchedAt: now,
    config: { 'task-types': { bugfix: { priority: {} }, review: { priority: {} } } }
  }));
  fs.writeFileSync(path.join(cache, 'usage-limits.json'), JSON.stringify({
    fetchedAt: now,
    source: 'limits',
    go: { monthly: { percent: 42, limited: false, resetsAt: now + 3600 * 1000 } }
  }));
  fs.writeFileSync(path.join(cache, 'free-quota.json'), JSON.stringify({
    version: 2,
    models: {
      'opencode/other-free': { at: now - 60000, until: now + 3600 * 1000, kind: 'exhaustion', detail: 'quota spent' }
    }
  }));
  return { root, home, project, cache };
}

function waitForPort(child) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('service did not announce a port in 5 s')), 5000);
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      const m = buffer.match(/listening on 127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.stderr.on('data', (chunk) => { buffer += String(chunk); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('service exited early (' + code + '): ' + buffer));
    });
  });
}

describe('status service', () => {
  let fixture;
  let child;
  let base;
  const authorized = () => ({ headers: { Authorization: 'Bearer ' + TOKEN } });

  before(async () => {
    assert.ok(fs.existsSync(BUNDLE), 'service/main.js is missing — run `bun run build` first');
    fixture = makeFixture();
    child = spawn(process.execPath, [BUNDLE], {
      env: Object.assign({}, process.env, {
        OPENCHAMBER_SERVICE_PORT: '0',
        OPENCHAMBER_SERVICE_TOKEN: TOKEN,
        HOME: fixture.home,
        USERPROFILE: fixture.home
      }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const port = await waitForPort(child);
    base = 'http://127.0.0.1:' + port;
  });

  after(() => {
    if (child && child.exitCode === null) child.kill('SIGTERM');
  });

  it('answers /health for the host ready probe', async () => {
    const res = await fetch(base + '/health', authorized());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  it('refuses requests without the bearer token', async () => {
    const res = await fetch(base + '/health');
    assert.equal(res.status, 401);
  });

  it('answers a view the host schema accepts', async () => {
    const res = await fetch(base + '/status?locale=en&directory=' + encodeURIComponent(fixture.project), authorized());
    assert.equal(res.status, 200);
    const body = await res.json();
    const parsed = guestStatusViewSchema.safeParse(body);
    assert.ok(parsed.success, JSON.stringify(parsed.error && parsed.error.issues));
    const rows = {};
    for (const row of body.rows) rows[row.id] = row;
    assert.equal(rows.task.value, 'bugfix');
    assert.equal(rows.task.badge, undefined, 'bugfix is a known task type');
    assert.equal(rows.tier.dot, 'success');
    assert.equal(rows.model.value, 'opencode/zen-free');
    assert.equal(rows.usage.content.kind, 'bar');
    assert.equal(rows.usage.value, '42%');
    assert.equal(rows.router.content.value, 'on');
    const latch = body.rows.find((row) => row.kind === 'note');
    assert.match(latch.text, /Free tier exhausted — opencode\/other-free — retry in 1h 0m/);
  });

  it('writes the host-detection session map the plugin reads', async () => {
    const file = path.join(fixture.cache, 'openchamber-sessions.json');
    assert.ok(fs.existsSync(file), 'session map was not written');
    const map = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(map.version, 1);
    assert.equal(typeof map.sessions.ses_test, 'number');
  });

  it('toggles the router sync and reports it on the next read', async () => {
    const post = await fetch(base + '/status?directory=' + encodeURIComponent(fixture.project), Object.assign({
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authorized().headers),
      body: JSON.stringify({ id: 'routing-sync', value: 'off' })
    }));
    assert.equal(post.status, 200);
    assert.deepEqual(await post.json(), { ok: true });

    const file = path.join(fixture.cache, 'routing-sync.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { sync: false });

    const res = await fetch(base + '/status?directory=' + encodeURIComponent(fixture.project), authorized());
    const body = await res.json();
    const router = body.rows.find((row) => row.id === 'router');
    assert.equal(router.content.value, 'off');

    const back = await fetch(base + '/status?directory=' + encodeURIComponent(fixture.project), Object.assign({
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authorized().headers),
      body: JSON.stringify({ id: 'routing-sync', value: 'on' })
    }));
    assert.equal(back.status, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { sync: true });
  });

  it('answers a bad control with a message the host can toast', async () => {
    const res = await fetch(base + '/status?directory=' + encodeURIComponent(fixture.project), Object.assign({
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authorized().headers),
      body: JSON.stringify({ id: 'nope' })
    }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /Unknown control/);
    assert.ok(body.message.length <= 300);
  });

  it('degrades to a project-free note without a directory', async () => {
    const res = await fetch(base + '/status?locale=en', authorized());
    const body = await res.json();
    assert.equal(body.rows.length, 1);
    assert.equal(body.rows[0].id, 'no-project');
  });
});
