'use strict';

module.exports = {
  id: 'service/read-never-writes-routing',
  component: 'service',
  title: 'a status read never rewrites the project routing config',
  steps: [{ method: 'GET', path: '/status', query: { directory: '{{project}}' } }],
  expect: {
    http: [{ status: 200 }],
    files: { '.opencode/.modelselect-cache/routing-sync.json': { exists: false } },
  },
};
