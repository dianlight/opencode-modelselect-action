'use strict';

module.exports = {
  id: 'action/auto-prefers-free',
  component: 'action',
  title: 'auto tier prefers free when the probe answers',
  world: {
    files: { 'model-config.json': { copy: 'action-config-basic.json' } },
    net: [
      { match: '/go/v1/usage', replies: [{ status: 200, body: require('../../fixtures/usage-go-available.json') }] },
      { match: '/zen/v1/chat/completions', replies: [{ status: 200, body: { choices: [{ message: { content: 'pong' } }] } }] },
    ],
  },
  env: {
    'INPUT_TASK-TYPE': 'pr-review',
    'INPUT_TIER': 'auto',
    'INPUT_OPENCODE-TOKEN': 'test-token',
    'INPUT_USAGE-URL': '{{net}}/go/v1/usage',
    'INPUT_PROBE-URL': '{{net}}/zen/v1/chat/completions',
    'INPUT_CONFIG-PATH': '{{root}}/model-config.json',
    'INPUT_CONFIG-URL': '',
  },
  expect: {
    exit: 0,
    outputs: { model: 'opencode/model-b-free', 'tier-selected': 'free' },
    net: [{ path: '/zen/v1/chat/completions', count: 1 }, { path: '/zen/v1/responses', min: 1 }, { method: 'GET', path: '/go/v1/usage', count: 0 }],
  },
};
