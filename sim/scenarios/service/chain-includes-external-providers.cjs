'use strict';

module.exports = {
  id: 'service/chain-includes-external-providers',
  component: 'service',
  title: 'GET /chain lists external console providers (e.g. FreeModel, OpenRouter) when availableProviders is unset',
  fixture: {
    pluginConfig: '{\n  "plugins": [\n    {\n      "package": "@dianlight/opencode-modelselect-plugin",\n      "options": {\n        "tier": "auto"\n      }\n    }\n  ]\n}\n',
    configV2: {
      config: {
        'task-types-v2': { generic: { model: 'demo', models: ['demo'] } },
      },
    },
    registry: {
      registry: {
        schema_version: 2,
        models: {
          demo: {
            id: 'demo',
            variants: [
              { provider: 'opencode', model: 'demo-free', free: true, cost: 0 },
              { provider: 'openrouter', model: 'demo-paid', free: false, cost: 0.5 },
            ],
          },
        },
      },
    },
  },
  steps: [{ method: 'GET', path: '/chain', query: { directory: '{{project}}', task: 'generic' } }],
  expect: {
    http: [{
      status: 200,
      jsonContains: {
        chain: [
          { model: 'opencode/demo-free', status: 'pick' },
          { model: 'openrouter/demo-paid', status: 'standby' },
        ],
      },
    }],
  },
};
