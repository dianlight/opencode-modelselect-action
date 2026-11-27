'use strict';

/**
 * The service answering the agent's requests (`POST /session-events`).
 *
 * OpenChamber posts a `permission-asked` or `question-asked` event to the
 * service; the service answers on the user's behalf through the host's
 * callback listener (`sessions.answerPermission`, `sessions.answerForm`,
 * `sessions.send`). This file drives the shipped bundle against a fake host
 * that records every call the service makes.
 *
 * Run `bun run build` first — this test exercises the shipped bundle.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { makeFixture, startService } = require('./helpers/service.cjs');

const EVENTS_PATH = '/session-events';

/** A stand-in for OpenChamber's callback listener: it records every call. */
function startFakeHost() {
  const calls = [];
  let handler = null;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch (e) {
        body = {};
      }
      calls.push(body);
      const reply = handler ? handler(body, calls.length) : { status: 200, body: { result: { answered: true } } };
      res.writeHead(reply.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        calls,
        url: 'http://127.0.0.1:' + server.address().port,
        setHandler(fn) {
          handler = fn;
        },
        stop() {
          server.closeAllConnections();
          server.close();
          server.unref();
        },
      });
    });
  });
}

function event(type, extra) {
  return Object.assign({
    v: 1,
    requestId: 'req_' + type,
    event: {
      id: 'evt_' + type,
      type: type,
      at: 1730000000000,
      session: { id: 'ses_test', parentId: null },
      project: { directory: null },
      linked: [],
    },
  }, extra || {});
}

describe('session answers', () => {
  let fixture;
  let service;
  let host;

  before(async () => {
    fixture = makeFixture({
      extConfig: {
        autoSmallModel: true,
        autoWalkthroughModel: true,
        smallModelTask: 'small-model',
        keep: 'me',
        sessionAnswers: true,
      },
    });
    host = await startFakeHost();
    service = await startService(fixture, { hostCallbackUrl: host.url });
    // The section poll marks the project as served.
    const res = await service.get('/status', { directory: fixture.project });
    assert.equal(res.status, 200);
  });

  after(() => {
    if (service) service.stop();
    if (host) host.stop();
  });

  beforeEach(() => {
    host.calls.length = 0;
    host.setHandler(null);
  });

  const postEvent = (body) => service.post(EVENTS_PATH, {}, body);

  /** The calls the service made into the session, not the ones it made on the card. */
  const sessionCalls = () => host.calls.filter((call) => String(call.method || '').startsWith('sessions.'));

  it('allows a permission request once, with a message', async () => {
    const res = await postEvent(event('permission-asked', {
      event: Object.assign(event('permission-asked').event, {
        project: { directory: fixture.project },
        permission: { requestId: 'perm_1' },
      }),
      content: {
        type: 'permission-asked',
        sessionTitle: null,
        action: 'bash',
        resources: ['ls'],
        message: null,
      },
    }));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(sessionCalls().length, 1);
    assert.equal(sessionCalls()[0].method, 'sessions.answerPermission');
    assert.equal(sessionCalls()[0].input.sessionId, 'ses_test');
    assert.equal(sessionCalls()[0].input.requestId, 'perm_1');
    assert.equal(sessionCalls()[0].input.decision, 'allow');
    assert.match(sessionCalls()[0].input.message, /allowed this once/);
    assert.deepEqual(
      Object.keys(sessionCalls()[0].input).sort(),
      ['decision', 'message', 'requestId', 'sessionId'],
      'an answer covers this request only: there is no standing rule to send'
    );
  });

  it('answers a form with the values the service holds', async () => {
    const res = await postEvent(event('question-asked', {
      event: Object.assign(event('question-asked').event, {
        project: { directory: fixture.project },
        question: { kind: 'form', id: 'frm_1' },
      }),
      content: {
        type: 'question-asked',
        sessionTitle: null,
        ask: {
          kind: 'form',
          id: 'frm_1',
          title: 'Pick a model',
          fields: [
            { key: 'model', type: 'string', title: 'Model', description: null, required: true },
            { key: 'task', type: 'string', title: 'Task', description: null, required: false },
            { key: 'note', type: 'string', title: 'Note', description: null, required: false },
          ],
        },
      },
    }));
    assert.equal(res.status, 200);
    assert.equal(sessionCalls().length, 1);
    assert.equal(sessionCalls()[0].method, 'sessions.answerForm');
    assert.equal(sessionCalls()[0].input.sessionId, 'ses_test');
    assert.equal(sessionCalls()[0].input.formId, 'frm_1');
    assert.deepEqual(sessionCalls()[0].input.values, {
      model: 'opencode/zen-free',
      task: 'bugfix',
    });
  });

  it('sends a page to the session instead of answering it', async () => {
    const res = await postEvent(event('question-asked', {
      event: Object.assign(event('question-asked').event, {
        project: { directory: fixture.project },
        question: { kind: 'page', id: 'page_1' },
      }),
      content: {
        type: 'question-asked',
        sessionTitle: null,
        ask: { kind: 'page', id: 'page_1', title: 'Pick a file' },
      },
    }));
    assert.equal(res.status, 200);
    assert.equal(sessionCalls().length, 1);
    assert.equal(sessionCalls()[0].method, 'sessions.send');
    assert.equal(sessionCalls()[0].input.sessionId, 'ses_test');
    assert.match(sessionCalls()[0].input.prompt, /page/);
  });

  it('ignores a request in a project the service does not serve', async () => {
    const res = await postEvent(event('permission-asked', {
      event: Object.assign(event('permission-asked').event, {
        project: { directory: '/somewhere/else' },
        permission: { requestId: 'perm_2' },
      }),
    }));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(sessionCalls().length, 0, 'no answer for a project this service does not serve');
  });

  it('logs a settled request and never retries it', async () => {
    host.setHandler(() => ({
      status: 404,
      body: { error: { message: 'The request settled already.', code: 'NOT_FOUND' } },
    }));
    const res = await postEvent(event('permission-asked', {
      event: Object.assign(event('permission-asked').event, {
        project: { directory: fixture.project },
        permission: { requestId: 'perm_3' },
      }),
    }));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(sessionCalls().length, 1, 'the settled request is answered once, never retried');
  });

  it('refuses a body that is not a session event', async () => {
    const res = await postEvent({ v: 99, requestId: 'req_x' });
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
  });
});

describe('event-driven delivery state', () => {
  let fixture;
  let service;
  let host;

  const turnEvent = (type, extra) => event(type, Object.assign({
    event: Object.assign(event(type).event, {
      at: 1730000000123,
      project: { directory: fixture.project },
    }),
  }, extra || {}));

  const record = () => JSON.parse(fs.readFileSync(
    path.join(fixture.cache, 'delivery-ses_test.json'), 'utf8'));
  const sessionCalls = () => host.calls.filter((call) => String(call.method || '').startsWith('sessions.'));

  before(async () => {
    // No sessionAnswers switch: turn events are state reads, not answers.
    fixture = makeFixture();
    host = await startFakeHost();
    service = await startService(fixture, { hostCallbackUrl: host.url });
    const res = await service.get('/status', { directory: fixture.project });
    assert.equal(res.status, 200);
  });

  after(() => {
    if (service) service.stop();
    if (host) host.stop();
  });

  it('records a running turn without asking the host to do anything', async () => {
    const res = await service.post(EVENTS_PATH, {}, turnEvent('turn-started', {
      content: { type: 'turn-started', sessionTitle: 'Fix the parser' },
    }));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.deepEqual(record(), { activity: 'running', at: 1730000000123, reply: '', error: '' });
    assert.equal(sessionCalls().length, 0);
  });

  it('replaces the preview on a finished turn and surfaces it in /pick and /status', async () => {
    const done = await service.post(EVENTS_PATH, {}, turnEvent('turn-finished', {
      content: {
        type: 'turn-finished',
        sessionTitle: 'Fix the parser',
        reply: 'Done: the wait fired after the pull request merged.',
        replyTruncated: false,
      },
    }));
    assert.equal(done.status, 200);
    assert.deepEqual(record(), {
      activity: 'idle',
      at: 1730000000123,
      reply: 'Done: the wait fired after the pull request merged.',
      error: '',
    });

    const pick = await service.get('/pick', { directory: fixture.project, session: 'ses_test' });
    assert.equal(pick.status, 200);
    assert.match(pick.body.text, /idle — Done: the wait fired/);
    assert.match(pick.body.delivery, /idle — Done: the wait fired/);

    const status = await service.get('/status', { directory: fixture.project });
    const delivery = status.body.rows.find((row) => row.id === 'delivery');
    assert.equal(delivery.value, 'idle');
    assert.match(delivery.tooltip, /Done: the wait fired/);
    assert.equal(sessionCalls().length, 0);
  });

  it('records a failed turn as failed with no reply preview', async () => {
    const res = await service.post(EVENTS_PATH, {}, turnEvent('turn-failed', {
      content: {
        type: 'turn-failed',
        sessionTitle: 'Fix the parser',
        error: { type: 'ProviderError', message: 'provider refused the turn' },
      },
    }));
    assert.equal(res.status, 200);
    assert.deepEqual(record(), {
      activity: 'failed', at: 1730000000123, reply: '', error: 'provider refused the turn',
    });
    const status = await service.get('/status', { directory: fixture.project });
    const delivery = status.body.rows.find((row) => row.id === 'delivery');
    assert.equal(delivery.value, 'failed');
    assert.match(delivery.tooltip, /provider refused the turn/);
  });

  it('ignores a turn event from a project the service does not serve', async () => {
    const body = event('turn-started', {
      event: Object.assign(event('turn-started').event, {
        project: { directory: '/somewhere/else' },
        session: { id: 'ses_unserved', parentId: null },
      }),
      content: { type: 'turn-started', sessionTitle: null },
    });
    const res = await service.post(EVENTS_PATH, {}, body);
    assert.equal(res.status, 200);
    assert.equal(fs.existsSync(path.join(fixture.cache, 'delivery-ses_unserved.json')), false);
  });
});

describe('session answers off by default', () => {
  let fixture;
  let service;
  let host;

  before(async () => {
    fixture = makeFixture(); // no `sessionAnswers` key: the switch is off
    host = await startFakeHost();
    service = await startService(fixture, { hostCallbackUrl: host.url });
    const res = await service.get('/status', { directory: fixture.project });
    assert.equal(res.status, 200);
  });

  after(() => {
    if (service) service.stop();
    if (host) host.stop();
  });

  beforeEach(() => {
    host.calls.length = 0;
    host.setHandler(null);
  });

  const postEvent = (body) => service.post(EVENTS_PATH, {}, body);

  const sessionCalls = () => host.calls.filter((call) => String(call.method || '').startsWith('sessions.'));

  /** Every event kind: with the switch off the service must drop them all unanswered. */
  const events = () => ([
    event('permission-asked', {
      event: Object.assign(event('permission-asked').event, {
        project: { directory: fixture.project },
        permission: { requestId: 'perm_off' },
      }),
      content: { type: 'permission-asked', sessionTitle: null, action: 'bash', resources: ['ls'], message: null },
    }),
    event('question-asked', {
      event: Object.assign(event('question-asked').event, {
        project: { directory: fixture.project },
        question: { kind: 'form', id: 'frm_off' },
      }),
      content: {
        type: 'question-asked',
        sessionTitle: null,
        ask: {
          kind: 'form',
          id: 'frm_off',
          title: 'Pick a model',
          fields: [{ key: 'model', type: 'string', title: 'Model', description: null, required: true }],
        },
      },
    }),
  ]);

  it('drops every event unanswered when the switch is off', async () => {
    for (const body of events()) {
      const res = await postEvent(body);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { ok: true });
      assert.equal(sessionCalls().length, 0, 'no answer while the switch is off');
    }
  });
});
