'use strict';

const profile = require('../../fixtures/host-automations-profile.cjs');

module.exports = {
  id: 'service/host-automations-no-project',
  component: 'service',
  title: 'host automations: a wake with no open project succeeds without refreshing',
  fixture: {
    pluginConfig: profile,
    taskTypesCache: { generic: { label: 'Generic', jev_criteria: 'criteria generic' } },
  },
  steps: [
    { method: 'POST', path: '/schedule', body: { v: 1, requestId: 'req_compat_noproject', id: 'routing-refresh', at: 1730000000000 } },
  ],
  expect: {
    http: [
      { status: 200, jsonContains: { ok: true, id: 'routing-refresh', handled: true } },
    ],
    files: {
      'home/.config/openchamber/routing.json': { exists: false },
    },
  },
};
