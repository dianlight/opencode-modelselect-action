'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

describe('vendored shared core', () => {
  it('matches the canonical core/ sources byte-for-byte', () => {
    // Fails with the script's drift list when someone edits a vendored
    // copy (or forgets `mise run build-core` after a core/ change).
    const out = execFileSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'build-core.js'), '--check'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    assert.match(out, /in sync/);
  });
});
