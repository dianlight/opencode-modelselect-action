'use strict';

/**
 * Scenario discovery: every `sim/scenarios/<component>/*.cjs` module exports
 * one scenario object. Validation is deliberately strict — a malformed case
 * fails loudly instead of silently passing.
 */

const fs = require('node:fs');
const path = require('node:path');

const COMPONENTS = ['action', 'plugin', 'service', 'panel', 'pipeline', 'fuzz'];

function loadScenarios({ component, idFilter } = {}) {
  const base = path.join(__dirname, '..', 'scenarios');
  const wanted = component && component !== 'all' ? [component] : COMPONENTS.filter((c) => c !== 'fuzz');
  const scenarios = [];
  for (const comp of wanted) {
    const dir = path.join(base, comp);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.cjs')).sort()) {
      const scenario = require(path.join(dir, file));
      if (scenario.component !== comp) throw new Error(`${comp}/${file}: component field must be "${comp}"`);
      if (!scenario.id) scenario.id = `${comp}/${path.basename(file, '.cjs')}`;
      scenario.__file = path.join(dir, file);
      if (!scenario.title) throw new Error(`${scenario.id}: title is required`);
      if (idFilter && !scenario.id.includes(idFilter)) continue;
      scenarios.push(scenario);
    }
  }
  return scenarios;
}

module.exports = { loadScenarios, COMPONENTS };
