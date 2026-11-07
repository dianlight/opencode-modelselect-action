'use strict';

/**
 * Contract test for the extension manifest.
 *
 * The manifest needs no `files` capability and no `filesystem` paths any more:
 * the local service owns every read and write, the Work Status section is
 * host-rendered, and the session action runs in the background entry. Parsing
 * with the SDK's own `parseManifestJson` keeps this honest across SDK bumps.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGE = path.join(__dirname, '..', 'package.json');
const ROOT = path.join(__dirname, '..');

describe('extension manifest', () => {
  it('parses as an OpenChamber 2.6 guest', async () => {
    const { parseManifestJson } = await import('@openchamber/sdk/schemas');
    const pkg = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'));
    const result = parseManifestJson(JSON.stringify(pkg.openchamber));
    assert.ok(result.ok, JSON.stringify(result));

    const openchamber = pkg.openchamber;
    // Identity beside `contributes` (the form that needs no panel).
    assert.equal(openchamber.id, 'model-select');
    assert.equal(openchamber.name, 'Model select');
    assert.equal(openchamber.icon, 'window');
    assert.equal(openchamber.contributes.panel.id, undefined, 'panel carries the entry only');

    const contributes = result.manifest.contributes;
    assert.equal(contributes.panel.entry, 'panel/index.html');
    assert.equal(contributes.background.entry, 'background/index.html');
    assert.equal(contributes.statusSection.source.path, '/status');
    assert.equal(contributes.statusSection.source.interval, 2000);
    assert.equal(contributes.statusSection.entry, undefined, 'the iframe entry is gone');
    assert.equal(contributes.statusSection.title, undefined, 'the section uses the extension name');
    assert.equal(contributes.statusSection.requiresProject, true);
    assert.equal(contributes.service.entry, 'service/main.js');
    assert.equal(contributes.service.runtime, 'host');
    assert.equal(contributes.service.keepRunning, true, 'the router sync and session map run on a timer');
    assert.deepEqual(contributes.service.provides, ['quota'], 'quota provider role');
    assert.deepEqual(contributes.quota, { providers: [] });
    assert.equal(contributes.capabilities, undefined, 'no file grants: the service owns I/O');
    assert.equal(contributes.filesystem, undefined, 'no filesystem paths any more');
    assert.equal(contributes.actions.length, 1);
    assert.deepEqual(contributes.actions[0], {
      id: 'model-pick',
      label: 'Model select pick',
      where: 'session',
      mode: 'background'
    });
    assert.equal(pkg.openchamber.engines.openchamber, '>=2.6.2');
  });

  it('ships every entry it names', () => {
    for (const file of [
      'panel/index.html',
      'panel/main.js',
      'service/main.js',
      'background/index.html',
      'background/main.js'
    ]) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), file + ' is missing — run `bun run build`');
    }
  });

  it('never asks for a file capability in the source', () => {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'));
    const contributes = pkg.openchamber.contributes;
    assert.equal(contributes.capabilities, undefined);
    assert.equal(contributes.filesystem, undefined);
  });
});
