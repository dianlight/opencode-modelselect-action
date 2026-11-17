'use strict';

module.exports = {
  id: 'action/go-tier',
  component: 'action',
  title: 'tier=go resolves the paid model and echoes both tiers',
  world: { files: { 'model-config.json': { copy: 'action-config-basic.json' } } },
  env: {
    'INPUT_TASK-TYPE': 'pr-review',
    'INPUT_TIER': 'go',
    'INPUT_CONFIG-PATH': '{{root}}/model-config.json',
    'INPUT_CONFIG-URL': '',
  },
  expect: {
    exit: 0,
    outputs: {
      model: 'opencode-go/model-a',
      'model-go': 'opencode-go/model-a',
      'model-free': 'opencode/model-b-free',
      'config-source': 'local',
      'task-type': 'pr-review',
    },
  },
};
