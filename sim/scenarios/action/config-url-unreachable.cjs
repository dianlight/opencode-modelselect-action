'use strict';

module.exports = {
  id: 'action/config-url-unreachable',
  component: 'action',
  title: 'unreachable remote config fails closed',
  world: {
    net: [{ match: '/model-config.json', fault: 'reset' }],
  },
  env: {
    'INPUT_TASK-TYPE': 'pr-review',
    'INPUT_TIER': 'free',
    'INPUT_CONFIG-URL': '{{net}}/model-config.json',
    'INPUT_CONFIG-PATH': '',
  },
  expect: { exit: 1 },
};
