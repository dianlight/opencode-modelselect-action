'use strict';

module.exports = {
  id: 'action/missing-task-type-fails-closed',
  component: 'action',
  title: 'unknown task type with no fallback fails closed',
  world: { files: { 'model-config.json': { copy: 'action-config-basic.json' } } },
  env: {
    'INPUT_TASK-TYPE': 'nope',
    'INPUT_TIER': 'free',
    'INPUT_CONFIG-PATH': '{{root}}/model-config.json',
    'INPUT_CONFIG-URL': '',
  },
  expect: { exit: 1, stderr: /No model resolved/ },
};
