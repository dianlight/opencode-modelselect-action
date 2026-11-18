'use strict';

module.exports = {
  id: 'action/fallback-model-used',
  component: 'action',
  title: 'fallback-model rescues an unknown task type with a warning',
  world: { files: { 'model-config.json': { copy: 'action-config-basic.json' } } },
  env: {
    'INPUT_TASK-TYPE': 'nope',
    'INPUT_TIER': 'free',
    'INPUT_FALLBACK-MODEL': 'opencode/model-b-free',
    'INPUT_CONFIG-PATH': '{{root}}/model-config.json',
    'INPUT_CONFIG-URL': '',
  },
  expect: {
    exit: 0,
    outputs: { model: 'opencode/model-b-free', 'config-source': 'local+fallback' },
  },
};
