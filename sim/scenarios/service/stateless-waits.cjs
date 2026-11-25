'use strict';

const NOW = Date.now();

module.exports = {
  id: 'service/stateless-waits',
  component: 'service',
  title: 'Wait checks answer from the body state and a live latch read, storing nothing',
  fixture: {
    latch: {
      version: 2,
      models: {
        'opencode/deepseek-v4.1-flash-free': {
          at: NOW - 1000,
          until: NOW + 3 * 3600 * 1000,
          kind: 'exhaustion',
          detail: 'spent',
        },
      },
    },
  },
  steps: [
    // Stamp the project the waits fall back to when their args carry none.
    { method: 'GET', path: '/status', query: { directory: '{{project}}' } },
    {
      method: 'POST',
      path: '/waits/start',
      body: {
        v: 1,
        requestId: 'start-1',
        wait: {
          id: 'quota-reset',
          type: 'quota-reset',
          args: {},
          session: { id: 'ses_test', directory: null },
        },
      },
    },
    {
      method: 'POST',
      path: '/waits/check',
      body: {
        v: 1,
        requestId: 'check-1',
        waits: [{
          id: 'quota-reset',
          type: 'quota-reset',
          args: {},
          state: { version: 1, latched: [], sync: true },
        }],
      },
    },
  ],
  expect: {
    http: [
      { status: 200 },
      { status: 200, jsonContains: { ok: true, state: { latched: [{ model: 'opencode/deepseek-v4.1-flash-free' }] } } },
      { status: 200, jsonContains: { results: [{ id: 'quota-reset', fired: true }] } },
    ],
  },
};
