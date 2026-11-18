'use strict';

const VIRTUAL = { providerID: 'modelselect', id: 'auto-free-first' };

module.exports = {
  id: 'plugin/http-request-stamps-pick',
  component: 'plugin',
  title: 'a virtual session request is stamped with the resolved pick headers',
  seed: {
    files: {
      '.opencode/.modelselect-cache/model-config-cache.json': {
        fetchedAt: Date.now(),
        config: { 'task-types': { review: { go: 'g/a', free: 'f/b' } } },
      },
    },
  },
  options: { tier: 'free', taskType: 'review' },
  steps: [
    { hook: 'context', with: { sessionID: 's1', agent: 'review', model: VIRTUAL, messages: [] } },
    { hook: 'prompt', with: { sessionID: 's1', prompt: 'review this diff' } },
    {
      hook: 'http.request',
      with: { sessionID: 's1', model: VIRTUAL, requestBody: '' },
    },
  ],
  expect: {
    plugin: {
      headers: { 'x-modelselect-model': 'b', 'x-modelselect-provider': 'f' },
      noSwitch: true,
    },
  },
};
