'use strict';

module.exports = {
  id: 'action-v2/failure-propagates',
  component: 'action-v2',
  title: 'v2 action propagates a failing opencode run while still writing outputs',
  opencodeExit: 7,
  env: {
    'INPUT_TIER': 'go',
    'INPUT_MODEL': 'opencode/gpt-5.6-luna',
    'INPUT_ANNOUNCE': 'off',
  },
  expect: {
    exit: 7,
    outputs: { model: 'opencode/gpt-5.6-luna' },
    files: {
      'home/.config/opencode/opencode.json': {
        jsonContains: { plugins: [{ options: { announce: 'off' } }] },
      },
    },
  },
};
