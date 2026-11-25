'use strict';

module.exports = {
  id: 'service/status-header-control-and-icons',
  component: 'service',
  title: 'status answers carry fixed-row icons and a header router control',
  steps: [
    { method: 'GET', path: '/status', query: { directory: '{{project}}' } },
    { method: 'POST', path: '/status', query: { directory: '{{project}}' }, body: { id: 'routing-sync', value: 'off' } },
    { method: 'GET', path: '/status', query: { directory: '{{project}}' } },
  ],
  expect: {
    http: [
      {
        status: 200,
        jsonContains: {
          rows: [{ id: 'task', icon: 'task-line' }, { id: 'model', icon: 'cpu-line' }],
          controls: [{ kind: 'select', id: 'routing-sync', value: 'on', options: [{ value: 'on' }, { value: 'off' }] }],
        },
      },
      { status: 200, jsonContains: { ok: true } },
      { status: 200, jsonContains: { controls: [{ id: 'routing-sync', value: 'off' }] } },
    ],
    files: {
      'project/.opencode/.modelselect-cache/routing-sync.json': { json: { sync: false } },
    },
  },
};
