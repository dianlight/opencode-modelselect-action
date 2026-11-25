'use strict';

module.exports = {
  id: 'service/schedule-switch-toggle',
  component: 'service',
  title: 'turning router sync back on refreshes immediately and a later wake stays throttled',
  fixture: { taskTypesCache: { generic: { label: 'Generic', jev_criteria: 'criteria generic' } } },
  steps: [
    { method: 'POST', path: '/status', query: { directory: '{{project}}' }, body: { id: 'routing-sync', value: 'off' } },
    { method: 'POST', path: '/status', query: { directory: '{{project}}' }, body: { id: 'routing-sync', value: 'on' } },
    { method: 'POST', path: '/schedule', body: { v: 1, requestId: 'req_sim', id: 'quota-probe', at: 1730000000000 } },
  ],
  expect: {
    http: [
      { status: 200 },
      { status: 200 },
      { status: 200, jsonContains: { ok: true, handled: true } },
    ],
    files: { 'home/.config/openchamber/routing.json': { exists: true } },
  },
};
