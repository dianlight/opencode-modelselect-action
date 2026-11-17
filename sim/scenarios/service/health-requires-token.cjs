'use strict';

module.exports = {
  id: 'service/health-requires-token',
  component: 'service',
  title: 'GET /health without the bearer token is refused',
  steps: [{ method: 'GET', path: '/health', auth: false }],
  expect: { http: [{ status: 401 }] },
};
