'use strict';

module.exports = {
  id: 'action/free-tier-case-insensitive',
  component: 'action',
  title: 'tier=free matches the task type case-insensitively',
  world: { files: { 'model-config.json': { copy: 'action-config-basic.json' } } },
  env: {
    'INPUT_TASK-TYPE': 'PR-REVIEW',
    'INPUT_TIER': 'free',
    'INPUT_CONFIG-PATH': '{{root}}/model-config.json',
    'INPUT_CONFIG-URL': '',
  },
  expect: {
    exit: 0,
    outputs: { model: 'opencode/model-b-free', 'tier-selected': 'free', 'task-type': 'pr-review' },
  },
};
