'use strict';

const profile = require('../../fixtures/host-automations-profile.cjs');

module.exports = {
  id: 'service/host-automations-switch-toggle',
  component: 'service',
  title: 'host automations: turning router sync back on refreshes immediately and the later wake stays throttled',
  fixture: {
    pluginConfig: profile,
    taskTypesCache: { generic: { label: 'Generic', jev_criteria: 'criteria generic' } },
  },
  steps: [
    { method: 'POST', path: '/status', query: { directory: '{{project}}' }, body: { id: 'routing-sync', value: 'off' } },
    { method: 'POST', path: '/status', query: { directory: '{{project}}' }, body: { id: 'routing-sync', value: 'on' } },
    { method: 'POST', path: '/schedule', body: { v: 1, requestId: 'req_compat_toggle', id: 'quota-probe', at: 1730000000000 } },
  ],
  expect: {
    http: [
      { status: 200 },
      { status: 200 },
      { status: 200, jsonContains: { ok: true, id: 'quota-probe', handled: true } },
    ],
    files: {
      'home/.config/openchamber/routing.json': {
        exists: true,
        jsonContains: { categories: { generic: { builtin: false, name: 'Generic' } } },
      },
    },
  },
};
