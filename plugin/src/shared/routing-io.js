'use strict';

/**
 * IO adapter for the shared routing sync (`./routing.js`) backed by plain
 * fs — used by the plugin (v2 hooks sync `~/.config/openchamber/routing.json`
 * per turn, before the mode check).
 *
 * - `~/...` paths resolve against the user home (tests may override via
 *   the `home` option; `os.homedir()` follows `$HOME`).
 * - Project-relative paths (the modelselect caches) resolve against the
 *   project directory passed to `createRoutingIo`.
 * - Reads never reject (missing/unreadable/unparseable -> null); write
 *   failures reject so the core can report `written: false`.
 */

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseJsonLenient } = require('./routing');

function resolveLogicalPath(projectDir, home, logical) {
  const p = String(logical == null ? '' : logical);
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return path.join(String(projectDir || process.cwd()), p);
}

function createRoutingIo(projectDir, opts) {
  // Home resolved lazily per call: `os.homedir()` follows `$HOME`, so
  // tests can point it at a temp dir around a hook invocation.
  const homeOf = () => (opts && opts.home) || os.homedir();
  const resolve = (p) => resolveLogicalPath(projectDir, homeOf(), p);
  return {
    readJson(logicalPath) {
      return fs.readFile(resolve(logicalPath), 'utf8').then(
        (text) => {
          try {
            return parseJsonLenient(text);
          } catch (e) {
            return null;
          }
        },
        () => null
      );
    },
    writeJson(logicalPath, value) {
      return fs.writeFile(resolve(logicalPath), JSON.stringify(value, null, 2));
    },
  };
}

module.exports = { createRoutingIo, resolveLogicalPath };
