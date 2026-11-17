'use strict';

module.exports = {
  id: 'service/tier-control-writes-managed',
  component: 'service',
  title: 'the Tier control writes the plugin option and preserves unknown keys',
  steps: [
    { method: 'POST', path: '/status', query: { directory: '{{project}}' }, body: { id: 'tier', value: 'free' } },
  ],
  expect: {
    http: [{ status: 200, jsonContains: { ok: true } }],
    managedContains: '"tier": "free"',
  },
};
