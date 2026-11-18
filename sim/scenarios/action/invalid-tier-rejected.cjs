'use strict';

module.exports = {
  id: 'action/invalid-tier-rejected',
  component: 'action',
  title: 'an unknown tier value is rejected before any network call',
  world: { files: { 'model-config.json': { copy: 'action-config-basic.json' } } },
  env: {
    'INPUT_TASK-TYPE': 'pr-review',
    'INPUT_TIER': 'ultra',
    'INPUT_CONFIG-PATH': '{{root}}/model-config.json',
    'INPUT_CONFIG-URL': '',
  },
  expect: { exit: 1, stderr: /tier/, net: [{ path: '/go/v1/usage', count: 0 }] },
};
