'use strict';

/**
 * Generic expectations over an adapter result. Adapter-specific expectations
 * (plugin `seen` maps, service HTTP transcripts, panel DOM) live in the
 * adapter's own verify(); everything process-shaped lives here.
 */

const fs = require('node:fs');
const path = require('node:path');

/** `needle` is a subset of `hay` at every level (arrays: some element matches). */
function deepContains(hay, needle) {
  if (Array.isArray(needle)) return needle.every((n) => hay?.some?.((h) => deepContains(h, n)));
  if (needle && typeof needle === 'object') {
    if (!hay || typeof hay !== 'object') return false;
    return Object.entries(needle).every(([k, v]) => deepContains(hay[k], v));
  }
  return Object.is(hay, needle);
}

function checkFiles(fsRoot, files) {
  const failures = [];
  for (const [rel, spec] of Object.entries(files || {})) {
    const p = path.join(fsRoot, rel);
    if (spec.exists === false) {
      if (fs.existsSync(p)) failures.push(`file ${rel} should not exist`);
      continue;
    }
    if (!fs.existsSync(p)) { failures.push(`file ${rel} missing`); continue; }
    const raw = fs.readFileSync(p, 'utf8');
    if (spec.contains && !raw.includes(spec.contains)) failures.push(`file ${rel} missing ${JSON.stringify(spec.contains)}`);
    if (spec.notContains && raw.includes(spec.notContains)) failures.push(`file ${rel} contains ${JSON.stringify(spec.notContains)}`);
    if (spec.json !== undefined) {
      let parsed;
      try { parsed = JSON.parse(raw); } catch { failures.push(`file ${rel} is not JSON`); continue; }
      if (JSON.stringify(parsed) !== JSON.stringify(spec.json)) failures.push(`file ${rel} JSON mismatch`);
    }
    if (spec.jsonContains && !deepContains(safeJson(raw), spec.jsonContains)) {
      failures.push(`file ${rel} JSON does not contain ${JSON.stringify(spec.jsonContains)}`);
    }
  }
  return failures;
}

function safeJson(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function check(expectation, result) {
  const failures = [];
  const e = expectation || {};
  if (e.exit !== undefined && result.exit !== e.exit) failures.push(`exit ${result.exit} != ${e.exit}`);
  if (e.exitNot !== undefined && result.exit === e.exitNot) failures.push(`exit == ${e.exitNot}`);
  if (e.stderr && !new RegExp(e.stderr).test(result.stderr || '')) failures.push(`stderr !~ /${e.stderr}/`);
  if (e.stderrNot && new RegExp(e.stderrNot).test(result.stderr || '')) failures.push(`stderr ~ /${e.stderrNot}/`);
  if (e.stdout && !new RegExp(e.stdout).test(result.stdout || '')) failures.push(`stdout !~ /${e.stdout}/`);
  for (const [k, v] of Object.entries(e.outputs || {})) {
    if (result.outputs?.[k] !== v) failures.push(`output ${k}=${JSON.stringify(result.outputs?.[k])} != ${JSON.stringify(v)}`);
  }
  for (const n of e.net || []) {
    const hits = (result.calls || []).filter(
      (c) => (!n.method || c.method === n.method) && (!n.path || (typeof n.path === 'string' ? c.path.includes(n.path) : n.path.test(c.path))),
    );
    if (n.count !== undefined && hits.length !== n.count) failures.push(`net ${n.method || 'ANY'} ${n.path} count ${hits.length} != ${n.count}`);
    if (n.min !== undefined && hits.length < n.min) failures.push(`net ${n.path} count ${hits.length} < ${n.min}`);
    if (n.max !== undefined && hits.length > n.max) failures.push(`net ${n.path} count ${hits.length} > ${n.max}`);
  }
  if (e.files) failures.push(...checkFiles(result.fsRoot, e.files));
  return failures;
}

module.exports = { check, checkFiles, deepContains };
