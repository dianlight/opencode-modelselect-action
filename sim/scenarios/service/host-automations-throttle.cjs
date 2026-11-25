'use strict';

const profile = require('../../fixtures/host-automations-profile.cjs');

module.exports = {
  id: 'service/host-automations-throttle',
  component: 'service',
  title: 'host automations: a routing-refresh wake refreshes and a second wake inside the throttle window stays quiet',
  fixture: {
    pluginConfig: profile,
    taskTypesCache: { generic: { label: 'Generic', jev_criteria: 'criteria generic' } },
  },
  steps: [
    { method: 'GET', path: '/status', query: { directory: '{{project}}' } },
    { method: 'POST', path: '/schedule', body: { v: 1, requestId: 'req_compat_1', id: 'routing-refresh', at: 1730000000000 } },
    { method: 'POST', path: '/schedule', body: { v: 1, requestId: 'req_compat_2', id: 'routing-refresh', at: 1730000000001 } },
  ],
  expect: {
    http: [
      { status: 200 },
      { status: 200, jsonContains: { ok: true, id: 'routing-refresh', handled: true } },
      { status: 200, jsonContains: { ok: true, id: 'routing-refresh', handled: true } },
    ],
    files: {
      'home/.config/openchamber/routing.json': {
        exists: true,
        // The second wake is inside the 30 s window; the file still describes
        // the first pass. The mtime-level no-extra-write proof lives in the
        // service test (status-service.test.cjs).
        jsonContains: { categories: { generic: { builtin: false, name: 'Generic' } } },
      },
    },
  },
};
