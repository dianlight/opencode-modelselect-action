'use strict';

module.exports = {
  id: 'panel/render-from-managed',
  component: 'panel',
  title: 'the settings panel renders from the global OpenCode config',
  ops: [{ op: 'ready' }],
  expect: { text: [/Save plugin settings/, /Editing: @dianlight\/opencode-modelselect-plugin/] },
};
