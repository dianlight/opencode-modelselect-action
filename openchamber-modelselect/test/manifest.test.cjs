'use strict';

/**
 * Contract test for the extension manifest.
 *
 * The section is host-rendered, so a manifest the 2.6.1 host refuses means
 * no section at all: `contributes.statusSection` must carry a `source`
 * with no `entry`, and `contributes.service` must name the built bundle.
 * Parsing with the SDK's own `parseManifestJson` keeps this honest across
 * SDK bumps.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGE = path.join(__dirname, '..', 'package.json');

describe('extension manifest', () => {
  it('parses as an OpenChamber 2.6.1 guest with a source-backed status section', async () => {
    const { parseManifestJson } = await import('@openchamber/sdk/schemas');
    const pkg = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'));
    const result = parseManifestJson(JSON.stringify(pkg.openchamber));
    assert.ok(result.ok, JSON.stringify(result));

    const contributes = result.manifest.contributes;
    assert.equal(contributes.statusSection.source.path, '/status');
    assert.equal(contributes.statusSection.source.interval, 2000);
    assert.equal(contributes.statusSection.entry, undefined, 'the iframe entry is gone');
    assert.equal(contributes.statusSection.title, 'Model select');
    assert.equal(contributes.service.entry, 'service/main.js');
    assert.equal(contributes.service.runtime, 'host');
    assert.deepEqual(contributes.service.provides, ['quota'], 'quota provider role');
    assert.deepEqual(contributes.quota, { providers: [] });
    assert.equal(pkg.openchamber.engines.openchamber, '>=2.6.2', 'quota needs OpenChamber 2.6.2+ (canary)');
  });

  it('ships both entries it names', () => {
    const dir = path.join(__dirname, '..');
    assert.ok(fs.existsSync(path.join(dir, 'panel', 'index.html')), 'panel entry missing');
    assert.ok(fs.existsSync(path.join(dir, 'panel', 'main.js')), 'panel bundle missing');
    assert.ok(fs.existsSync(path.join(dir, 'service', 'main.js')), 'service bundle missing — run `bun run build`');
  });

  it('keeps the panel file grants the settings panel still uses', () => {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'));
    const contributes = pkg.openchamber.contributes;
    assert.deepEqual(contributes.capabilities, ['files']);
    assert.ok(contributes.filesystem.includes('~/.config/openchamber/modelselect.json'));
  });
});
