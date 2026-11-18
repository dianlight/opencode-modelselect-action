'use strict';

module.exports = {
  id: 'service/status-ok',
  component: 'service',
  title: 'GET /status answers the host schema from a healthy fixture',
  steps: [{ method: 'GET', path: '/status', query: { directory: '{{project}}' } }],
  expect: {
    http: [{ status: 200, jsonContains: { rows: [{ id: 'task', value: 'bugfix' }, { id: 'tier', value: 'free' }] } }],
  },
};
