'use strict';

module.exports = {
  id: 'service/schedule-refresh',
  component: 'service',
  title: 'a host schedule wake refreshes routing for the remembered project',
  fixture: { taskTypesCache: { generic: { label: 'Generic', jev_criteria: 'criteria generic' } } },
  steps: [
    { method: 'GET', path: '/status', query: { directory: '{{project}}' } },
    { method: 'POST', path: '/schedule', body: { v: 1, requestId: 'req_sim', id: 'routing-refresh', at: 1730000000000 } },
  ],
  expect: {
    http: [
      { status: 200 },
      { status: 200, jsonContains: { ok: true, handled: true } },
    ],
    files: { 'home/.config/openchamber/routing.json': { exists: true } },
  },
};
