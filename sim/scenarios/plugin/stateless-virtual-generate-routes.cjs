'use strict';

module.exports = {
  id: 'plugin/stateless-virtual-generate-routes',
  component: 'plugin',
  title: 'a headerless stateless virtual request resolves the small-model pick',
  seed: {
    files: {
      '.opencode/.modelselect-cache/model-config-cache.json': {
        fetchedAt: Date.now(),
        config: {
          'task-types': {
            'small-model': {
              go: 'opencode-go/small',
              free: 'opencode/small',
              think: 'minimal',
            },
          },
        },
      },
    },
  },
  options: { tier: 'free', taskType: 'review' },
  steps: [
    {
      hook: 'proxy.request',
      with: {
        path: '/v1/chat/completions',
        body: { model: 'auto-free-first', prompt: 'name this session' },
      },
    },
  ],
  expect: {
    plugin: {
      proxyStatus: 200,
      proxyFetchContains: 'https://example.test/opencode/v1/chat/completions',
      proxyWireModel: 'small',
      noSwitch: true,
    },
  },
};
