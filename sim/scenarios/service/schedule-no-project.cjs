'use strict';

module.exports = {
  id: 'service/schedule-no-project',
  component: 'service',
  title: 'a scheduled wake with no open project succeeds without refreshing',
  fixture: { taskTypesCache: { generic: { label: 'Generic', jev_criteria: 'criteria generic' } } },
  steps: [
    { method: 'POST', path: '/schedule', body: { v: 1, requestId: 'req_sim', id: 'routing-refresh', at: 1730000000000 } },
  ],
  expect: {
    http: [{ status: 200, jsonContains: { ok: true, handled: true } }],
    files: { 'home/.config/openchamber/routing.json': { exists: false } },
  },
};
