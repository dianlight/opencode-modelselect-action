'use strict';

const NOW = Date.now();

module.exports = {
  id: 'service/chain-live-availability',
  component: 'service',
  title: 'GET /chain shows the real fallback when Go quota and free latch block every variant',
  fixture: {
    pluginConfig: '{\n' +
      '  "plugins": [\n' +
      '    {\n' +
      '      "package": "@dianlight/opencode-modelselect-plugin",\n' +
      '      "options": {\n' +
      '        "tier": "auto",\n' +
      '        "autoPreference": "free-first",\n' +
      '        "maxCost": 0.16,\n' +
      '        "fallbackModel": "Free Model Router"\n' +
      '      }\n' +
      '    }\n' +
      '  ]\n' +
      '}\n',
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
              { provider: 'opencode-go', model: 'demo-paid', free: false, cost: 0.125 },
            ],
          },
        },
      },
    },
    usage: {
      fetchedAt: NOW,
      source: 'limits',
      go: { monthly: { percent: 100, limited: true, resetsAt: NOW + 3600 * 1000 } },
    },
    latch: {
      version: 2,
      models: {
        'opencode/demo-free': {
          at: NOW - 1000,
          until: NOW + 10 * 3600 * 1000,
          kind: 'exhaustion',
          detail: 'spent',
        },
      },
    },
  },
  steps: [{ method: 'GET', path: '/chain', query: { directory: '{{project}}', task: 'generic' } }],
  expect: {
    http: [{
      status: 200,
      jsonContains: {
        pick: 'Free Model Router',
        pickSource: 'fallback',
        chain: [
          { model: 'opencode/demo-free', status: 'excluded' },
          { model: 'opencode-go/demo-paid', status: 'excluded' },
        ],
      },
    }],
  },
};
