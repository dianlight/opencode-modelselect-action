'use strict';

const exhausted = {
  usage: {
    rolling: { status: 'ok', percent: 100, resetsAt: new Date(Date.now() + 60000).toISOString() },
    weekly: { status: 'ok', percent: 20, resetsAt: new Date(Date.now() + 60000).toISOString() },
    monthly: { status: 'ok', percent: 30, resetsAt: new Date(Date.now() + 60000).toISOString() },
  },
};

module.exports = {
  id: 'action/auto-waits-for-quota',
  component: 'action',
  title: 'auto tier waits for go quota and succeeds on the second poll',
  world: {
    files: { 'model-config.json': { copy: 'action-config-basic.json' } },
    net: [
      { match: '/go/v1/usage', replies: [{ status: 200, body: exhausted }, { status: 200, body: require('../../fixtures/usage-go-available.json') }] },
      { match: '/zen/v1/chat/completions', replies: [{ status: 429, body: { error: { message: 'limited' } } }] },
    ],
  },
  env: {
    'INPUT_TASK-TYPE': 'pr-review',
    'INPUT_TIER': 'auto',
    'INPUT_OPENCODE-TOKEN': 'test-token',
    'INPUT_USAGE-URL': '{{net}}/go/v1/usage',
    'INPUT_PROBE-URL': '{{net}}/zen/v1/chat/completions',
    'INPUT_MAX-WAIT-SECONDS': '5',
    'INPUT_POLL-INTERVAL-SECONDS': '1',
    'INPUT_CONFIG-PATH': '{{root}}/model-config.json',
    'INPUT_CONFIG-URL': '',
  },
  expect: {
    exit: 0,
    outputs: { model: 'opencode-go/model-a', 'tier-selected': 'go' },
    net: [{ method: 'GET', path: '/go/v1/usage', min: 2 }],
  },
};
