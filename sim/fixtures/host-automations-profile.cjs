'use strict';

/**
 * Pinned host-automations profile for the opencode-automations-compat parity
 * scenarios: OpenCode 2.4.0's `automations` switch is on, so the host owns the
 * schedule and the service answers POST /schedule wakes instead of running a
 * clock of its own. JSONC because it is the user's real opencode.jsonc, which
 * the service must read without rewriting.
 */
module.exports = `{
  // host automations are on (OpenCode 2.4.0)
  "automations": true,
  "theme": "dark",
  "plugins": [
    "some-other-plugin",
    {
      "package": "@dianlight/opencode-modelselect-plugin",
      "options": {
        "tier": "go",
        "verbose": false,
        "maxCost": 3,
        "historyChars": 1200,
        "agentTaskMap": { "build": "code" },
        "fallbackModel": "",
        "token": "SUPERSECRET",
        "futureOption": { "keep": true }
      }
    }
  ]
}
`;
