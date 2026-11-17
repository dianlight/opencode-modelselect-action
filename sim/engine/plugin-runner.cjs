'use strict';

/**
 * Child process for the plugin adapter: boots the real plugin module against
 * a fake OpenCode v2 host, replays the scenario's hook steps, prints one
 * SIMRESULT JSON line. Isolated per scenario (fresh module state, sandboxed
 * HOME, no real auth).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { seedCache, isolateAuth } = require('../../plugin/test/helpers');
const v2 = require('../../plugin/src/v2');

const scenario = require(process.argv[2]);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-plugin-'));

for (const [rel, value] of Object.entries(scenario.seed?.files || {})) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

const restoreEnv = isolateAuth(dir);
for (const [k, v] of Object.entries(scenario.seed?.env || {})) process.env[k] = v;

const seen = { switches: [], synthetics: [], promptsOut: [], added: [] };
const providers = new Map();
for (const id of ['opencode', 'opencode-go']) {
  providers.set(id, {
    provider: { id, name: id, activation: 'enabled', package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `https://example.test/${id}/v1` }, headers: { 'x-opencode-org-id': 'org-1' } },
    models: new Map([['x', { id: 'x', modelID: 'x', providerID: id, name: 'X' }]]),
  });
}
for (const [pid, models] of Object.entries(scenario.features?.catalogModels || {})) {
  const rec = providers.get(pid);
  if (rec) for (const m of models) rec.models.set(m.id, m);
}

const editorFor = () => ({
  get: (id) => providers.get(id),
  add: ({ info, models }) => {
    providers.set(info.id, { provider: info, models: new Map(models.map((m) => [m.id, m])) });
    seen.added.push(info.id);
  },
  remove: (id) => { providers.delete(id); },
  models: {
    set: (providerID, models) => {
      const rec = providers.get(providerID);
      if (rec) rec.models = new Map(models.map((m) => [m.id, m]));
    },
  },
});

const fakeCtx = {
  options: { tier: 'free', taskType: 'review', ...(scenario.options || {}) },
  location: { directory: dir },
  session: {
    async hook(name, cb) { seen[name] = cb; },
    async switchModel(input) {
      if (scenario.features?.switchModelError) throw new Error('switch unavailable');
      seen.switches.push(input);
      seen.switched = input;
    },
    async synthetic(input) {
      if (scenario.features?.syntheticError) throw new Error('synthetic unavailable');
      seen.synthetics.push(input);
    },
    async prompt(input) { seen.promptsOut.push(input); },
  },
  provider: {
    async transform(cb) { cb(editorFor()); },
  },
};

(async () => {
  try {
    const cleanup = await v2.setup(fakeCtx);
    for (const step of scenario.steps || []) {
      if (step.hook === 'http.request') {
        const headerMap = {};
        const headers = {
          set: (k, v) => { headerMap[k] = v; },
          delete: (k) => { delete headerMap[k]; },
          get: (k) => headerMap[k],
          has: (k) => k in headerMap,
        };
        const request = { headers, clone: () => ({ text: async () => step.with.requestBody || '' }) };
        await seen['http.request']({ sessionID: step.with.sessionID, model: step.with.model, request });
        seen.headers = headerMap;
        continue;
      }
      const hook = seen[step.hook];
      if (!hook) throw new Error(`no hook registered for step ${step.hook}`);
      const ev = structuredClone(step.with);
      await hook(ev);
      if (step.hook === 'prompt') seen.promptText = typeof ev.prompt === 'string' ? ev.prompt : ev.prompt?.text;
      if (step.hook === 'context') seen.contextModel = ev.model;
    }
    const virtualRec = providers.get('modelselect');
    const out = {
      seen: {
        switched: seen.switched,
        switches: seen.switches,
        synthetics: seen.synthetics,
        promptsOut: seen.promptsOut,
        added: seen.added,
        catalog: [...providers.keys()],
        virtualModels: virtualRec ? [...virtualRec.models.keys()] : [],
        promptText: seen.promptText,
        contextModel: seen.contextModel,
        headers: seen.headers,
      },
      error: null,
    };
    await cleanup?.();
    process.stdout.write('SIMRESULT' + JSON.stringify(out));
  } catch (err) {
    process.stdout.write('SIMRESULT' + JSON.stringify({ seen, error: String(err && err.message) }));
  } finally {
    restoreEnv();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();
