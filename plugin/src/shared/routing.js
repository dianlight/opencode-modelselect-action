'use strict';

/**
 * Routing sync — vendored shared-core shim.
 *
 * Canonical source: `core/routing.js` (repo root), vendored here by
 * `scripts/build-core.js`. Every existing `require('./shared/routing')`
 * contract is preserved (the vendored module re-exports the model-ref +
 * free-quota helpers that moved into the core).
 *
 * Do not edit: run `mise run build-core` after changing `core/`.
 */
module.exports = require('./core/routing');
