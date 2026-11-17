'use strict';

module.exports = {
  id: 'action/auto-falls-back-to-go',
  component: 'action',
  title: 'auto tier falls back to go when free is rate-limited',
  world: {
    files: { 'model-config.json': { copy: 'action-config-basic.json' } },
    net: [
      { match: '/go/v1/usage', replies: [{ status: 200, body: require('../../fixtures/usage-go-available.json') }] },
      { match: '/zen/v1/chat/completions', replies: [{ status: 429, body: { error: { message: 'limited' } } }] },
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
    outputs: { model: 'opencode-go/model-a', 'tier-selected': 'go' },
  },
};
