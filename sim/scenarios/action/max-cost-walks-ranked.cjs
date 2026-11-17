'use strict';

module.exports = {
  id: 'action/max-cost-walks-ranked',
  component: 'action',
  title: 'max-cost walks best-to-worst to the first model within budget',
  world: { files: { 'model-config.json': { copy: 'action-config-ranked.json' } } },
  env: {
    'INPUT_TASK-TYPE': 'pr-review',
    'INPUT_TIER': 'go',
    'INPUT_MAX-COST': '10',
    'INPUT_CONFIG-PATH': '{{root}}/model-config.json',
    'INPUT_CONFIG-URL': '',
  },
  expect: {
    exit: 0,
    outputs: { model: 'opencode-go/mid', 'model-cost': '1.5' },
  },
};
