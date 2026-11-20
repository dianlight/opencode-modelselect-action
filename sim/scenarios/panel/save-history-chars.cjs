'use strict';

module.exports = {
  id: 'panel/save-history-chars',
  component: 'panel',
  title: 'saving the historyChars field round-trips into the global config',
  ops: [
    { op: 'ready' },
    { op: 'setField', label: 'historyChars', value: '3000' },
    { op: 'clickButton', label: 'Save plugin settings' },
    { op: 'settle' },
  ],
  expect: { pluginConfigContains: '"historyChars": 3000' },
};
