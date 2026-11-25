'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFixture, startService, CACHE } = require('./helpers/service.cjs');

function startBody(fixture, id) {
  return {
    v: 1,
    requestId: 'start-' + id,
    wait: {
      id,
      type: 'quota-reset',
      args: { directory: fixture.project },
      session: { id: 'ses_test', directory: fixture.project },
    },
  };
}

function checkBody(fixture, id, state) {
  return {
    v: 1,
    requestId: 'check-' + id,
    waits: [{ id, type: 'quota-reset', args: { directory: fixture.project }, state }],
  };
}

function setLatch(fixture, entries) {
  fixture.write(path.join(fixture.cache, 'free-quota.json'), { version: 2, models: entries });
}

function freshLatch() {
  const at = Date.now();
  return {
    'opencode/deepseek-v4.1-flash-free': {
      at: at - 1000,
      until: at + 3 * 3600 * 1000,
      kind: 'exhaustion',
      detail: 'spent',
    },
  };
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const nested of listFiles(full)) out.push(path.join(entry.name, nested));
    } else {
      out.push(entry.name);
    }
  }
  return out.sort();
}

describe('stateless waits', () => {
  let fixture;
  let service;

  before(async () => {
    fixture = makeFixture();
    service = await startService(fixture);
  });

  after(() => { if (service) service.stop(); });

  it('starts with the live state and writes no wait state on a check', async () => {
    const beforeFiles = listFiles(fixture.root);
    const started = await service.post('/waits/start', {}, startBody(fixture, 'w1'));
    assert.equal(started.status, 200);
    assert.equal(started.body.ok, true);
    assert.equal(started.body.state.sync, true);
    assert.equal(started.body.state.latched.length, 1);
    assert.equal(started.body.state.latched[0].model, 'opencode/deepseek-v4.1-flash-free');

    const checked = await service.post('/waits/check', {}, checkBody(fixture, 'w1', started.body.state));
    assert.equal(checked.status, 200);
    assert.equal(checked.body.results.length, 1);
    assert.equal(checked.body.results[0].id, 'w1');
    assert.equal(checked.body.results[0].fired, false);
    assert.equal(checked.body.results[0].state.latched.length, 1);
    assert.deepEqual(listFiles(fixture.root), beforeFiles);
  });

  it('answers from the latch read at check time, not the start snapshot', async () => {
    const started = await service.post('/waits/start', {}, startBody(fixture, 'w2'));
    assert.equal(started.body.state.latched.length, 1);
    setLatch(fixture, {});

    const checked = await service.post('/waits/check', {}, checkBody(fixture, 'w2', started.body.state));
    assert.equal(checked.status, 200);
    assert.equal(checked.body.results[0].fired, true);
    assert.match(checked.body.results[0].summary, /Free quota reset/);
    assert.doesNotMatch(checked.body.results[0].summary, /retry in/);
  });

  it('answers correctly after a restart with only the body state', async () => {
    setLatch(fixture, freshLatch());
    const started = await service.post('/waits/start', {}, startBody(fixture, 'w3'));
    assert.equal(started.body.state.latched.length, 1);

    const stopped = new Promise((resolve) => service.child.once('exit', resolve));
    service.stop();
    await stopped;
    setLatch(fixture, {});
    service = await startService(fixture);

    const checked = await service.post('/waits/check', {}, checkBody(fixture, 'w3', started.body.state));
    assert.equal(checked.status, 200);
    assert.equal(checked.body.results[0].fired, true);
    assert.match(checked.body.results[0].summary, /Free quota reset/);
  });

  it('reuses the project recorded in the host state on later checks', async () => {
    await service.get('/status', { directory: fixture.project });
    const otherProject = path.join(fixture.root, 'another-project');
    const started = await service.post('/waits/start', {}, {
      v: 1,
      requestId: 'start-w4',
      wait: {
        id: 'w4',
        type: 'quota-reset',
        args: { directory: otherProject },
        session: { id: 'ses_test', directory: null },
      },
    });
    assert.equal(started.body.state.directory, otherProject);
    setLatch(fixture, freshLatch());

    const checked = await service.post('/waits/check', {}, {
      v: 1,
      requestId: 'check-w4',
      waits: [{ id: 'w4', type: 'quota-reset', args: {}, state: started.body.state }],
    });
    assert.equal(checked.body.results[0].fired, false);
    assert.equal(checked.body.results[0].state.directory, otherProject);
    assert.equal(checked.body.results[0].state.latched.length, 0);
  });

  it('does not fire when only the latch key order changes', async () => {
    const at = Date.now();
    const a = { at: at - 1000, until: at + 3600 * 1000, kind: 'exhaustion', detail: 'spent' };
    const b = { at: at - 1000, until: at + 7200 * 1000, kind: 'exhaustion', detail: 'spent' };
    setLatch(fixture, { 'opencode/model-a-free': a, 'opencode/model-b-free': b });
    const started = await service.post('/waits/start', {}, startBody(fixture, 'w5'));
    setLatch(fixture, { 'opencode/model-b-free': b, 'opencode/model-a-free': a });

    const checked = await service.post('/waits/check', {}, checkBody(fixture, 'w5', started.body.state));
    assert.equal(checked.body.results[0].fired, false);
  });

  it('reports the earliest retry across several latches', async () => {
    const at = Date.now();
    setLatch(fixture, {
      'opencode/late-free': { at: at - 1000, until: at + 3600 * 1000, kind: 'exhaustion', detail: 'spent' },
      'opencode/soon-free': { at: at - 1000, until: at + 60 * 1000, kind: 'rate-limit', detail: 'limited' },
    });
    const checked = await service.post('/waits/check', {}, checkBody(fixture, 'w6', {
      version: 1, latched: [], sync: true, directory: fixture.project,
    }));
    assert.equal(checked.body.results[0].fired, true);
    assert.match(checked.body.results[0].summary, /next retry in 60s/);
    assert.doesNotMatch(checked.body.results[0].summary, /3600s/);
  });

  it('refuses a wire version it does not know', async () => {
    const checked = await service.post('/waits/check', {}, { v: 2, requestId: 'r', waits: [] });
    assert.equal(checked.status, 400);
  });
});
