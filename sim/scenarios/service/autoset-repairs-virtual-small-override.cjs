'use strict';

module.exports = {
  id: 'service/autoset-repairs-virtual-small-override',
  component: 'service',
  title: 'autoset replaces a manually selected virtual Small Model with a concrete pick',
  fixture: {
    extConfig: { autoSmallModel: true, smallModelTask: 'small-model' },
    catalog: {
      fetchedAt: 1,
      config: {
        'task-types': {
          'small-model': {
            free: 'modelselect/auto-free-first',
            free_ranked: [{ model: 'opencode/beam-free' }],
            go: 'opencode-go/small',
            go_ranked: [{ model: 'opencode-go/small' }],
          },
        },
      },
    },
    taskTypesCache: {
      'small-model': { label: 'Small Model', jev_criteria: 'Trivial mechanical work.' },
    },
    files: {
      'home/.config/openchamber/settings.json': {
        smallModelOverride: 'modelselect/auto-free-first',
      },
      'home/.config/openchamber/preferences.json': {
        version: 1,
        fields: {
          smallModelOverride: { value: 'modelselect/auto-free-first' },
        },
      },
    },
  },
  steps: [
    { method: 'GET', path: '/status', query: { directory: '{{project}}' } },
    {
      method: 'POST',
      path: '/schedule',
      body: { v: 1, requestId: 'req_sim', id: 'routing-refresh', at: 1730000000000 },
    },
  ],
  expect: {
    http: [
      { status: 200 },
      { status: 200, jsonContains: { ok: true, handled: true } },
    ],
    files: {
      'home/.config/openchamber/settings.json': {
        jsonContains: { smallModelOverride: 'opencode/beam-free' },
      },
      'home/.config/openchamber/preferences.json': {
        contains: '"value": "opencode/beam-free"',
        notContains: 'modelselect/auto-free-first',
      },
    },
  },
};
