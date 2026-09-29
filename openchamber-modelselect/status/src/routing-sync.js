/* openchamber-modelselect — routing sync adapter (ESM, bundled with the
 * status view).
 *
 * The sync logic itself lives in the shared plugin core
 * (`plugin/src/shared/routing.js` — CommonJS, dependency-free so it
 * inlines into the browser bundle); this file only adapts it to the
 * OpenChamber host file API:
 *
 * - `host.readFile(path)` -> `{ content }` promise for
 *   `~/.config/openchamber/routing.json` (stored-deviations shape), the
 *   plugin's model-config/task-types caches (project-relative), and the
 *   managed/global OpenCode config (for `autoPreference`).
 * - `host.writeFile(path, text)` writes back only when something changed.
 *
 * Failures are silent: sync is best-effort and must never break the
 * status view. See the shared module header for the category rules
 * (criteria verbatim as the Jev question, empty criteria ignored, stale
 * entries disabled, builtins keep `builtin: true`, unusable payloads
 * skip the write).
 */

import routingShared from '../../../plugin/src/shared/routing.js';

const routingCore = routingShared;
const {
  syncRouting: syncRoutingCore,
  buildDesired,
  mergeCategories,
  findPluginOptions,
  autoPreferenceOf,
  normalizeModelselectConfig,
  pickSideRef,
  mergeSettingsOverrides,
  mergePreferencesOverrides,
  splitModelRef,
  parseJsonLenient,
  ROUTING_PATH,
  MODELSELECT_CONFIG_PATH,
  SETTINGS_PATH,
  PREFERENCES_PATH,
} = routingShared;

// Host adapter: logical `~/...`/relative paths are passed through to the
// host, which resolves `~` itself (same as before the shared-module
// extraction).
function hostIo(host) {
  return {
    readJson(logicalPath) {
      let p;
      try {
        p = host.readFile(logicalPath);
      } catch (e) {
        return Promise.resolve(null);
      }
      return Promise.resolve(p).then(
        function (res) {
          try {
            return parseJsonLenient(res && res.content);
          } catch (e) {
            return null;
          }
        },
        function () {
          return null;
        }
      );
    },
    writeJson(logicalPath, value) {
      return Promise.resolve(host.writeFile(logicalPath, JSON.stringify(value, null, 2)));
    },
  };
}

// Best-effort sync: reads caches + routing.json, writes back only on diff.
// Resolves { written: boolean } and never rejects.
function syncRouting(host) {
  if (!host || typeof host.readFile !== 'function') return Promise.resolve({ written: false });
  return syncRoutingCore(hostIo(host));
}

export {
  syncRouting,
  routingCore as core,
  buildDesired,
  mergeCategories,
  findPluginOptions,
  autoPreferenceOf,
  normalizeModelselectConfig,
  pickSideRef,
  mergeSettingsOverrides,
  mergePreferencesOverrides,
  splitModelRef,
  parseJsonLenient,
  ROUTING_PATH,
  MODELSELECT_CONFIG_PATH,
  SETTINGS_PATH,
  PREFERENCES_PATH,
};
