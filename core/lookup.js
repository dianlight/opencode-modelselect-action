'use strict';

/**
 * Config lookup helpers — shared pure decision core (no dependencies).
 *
 * Vendored into `github-action/src/shared/core/` and
 * `plugin/src/shared/core/` by `scripts/build-core.js`; edit `core/`,
 * never the vendored copies.
 *
 * Extracted verbatim from the plugin's model-config selector.
 */

/** Find a task-type entry: case-insensitive key match; missing table throws. */
function entryFor(config, taskType) {
  const table = config?.['task-types'] ?? config?.task_types;
  if (!table || typeof table !== 'object') throw new Error("Invalid model config: missing 'task-types'.");
  const key = Object.keys(table).find((k) => k.toLowerCase() === String(taskType).toLowerCase());
  if (!key) return { key: null, entry: null };
  return { key, entry: table[key] };
}

/** Coerce a config `think` value to a known effort level, else null. */
function normalizeThink(v) {
  const s = String(v ?? '').toLowerCase();
  return ['default', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(s) ? s : null;
}

module.exports = {
  entryFor,
  normalizeThink,
};
