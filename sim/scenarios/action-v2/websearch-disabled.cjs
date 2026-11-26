'use strict';

module.exports = {
  id: 'action-v2/websearch-disabled',
  component: 'action-v2',
  title: 'v2 action removes the web search tool from unattended runs',
  world: {
    files: {
      'data/model-config.json': {
        'task-types': {
          auto: { go: 'opencode-go/go-model', free: 'opencode/free-model' },
        },
      },
    },
  },
  env: {
    'INPUT_TIER': 'free',
    'INPUT_WEBSEARCH': 'false',
  },
  expect: {
    exit: 0,
    files: {
      'home/.config/opencode/opencode.json': { jsonContains: { websearch: false } },
      '.opencode/opencode.json': { jsonContains: { websearch: false } },
    },
  },
};
