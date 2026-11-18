'use strict';

/**
 * Run reporter: console table during the run, then results.json, junit.xml
 * and a standalone report.html under sim/report/<run-id>/.
 */

const fs = require('node:fs');
const path = require('node:path');

class Report {
  constructor() {
    this.rows = [];
    this.startedAt = new Date();
  }

  add(row) {
    this.rows.push(row);
    const mark = row.ok ? 'PASS' : 'FAIL';
    const ms = `${row.durationMs}ms`;
    if (row.ok) {
      process.stdout.write(`  ${mark}  ${row.id} (${ms})\n`);
    } else {
      process.stdout.write(`  ${mark}  ${row.id} (${ms})\n`);
      for (const f of row.failures) process.stdout.write(`       - ${f}\n`);
      if (row.error) process.stdout.write(`       ! ${row.error}\n`);
    }
  }

  finish(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const passed = this.rows.filter((r) => r.ok).length;
    const failed = this.rows.length - passed;
    const summary = {
      runId: this.startedAt.toISOString().replace(/[:.]/g, '-'),
      startedAt: this.startedAt.toISOString(),
      total: this.rows.length,
      passed,
      failed,
      rows: this.rows.map((r) => ({ id: r.id, component: r.component, ok: r.ok, durationMs: r.durationMs, failures: r.failures, error: r.error })),
    };
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(dir, 'junit.xml'), toJunit(summary));
    fs.writeFileSync(path.join(dir, 'report.html'), toHtml(summary));
    fs.writeFileSync(path.join(dir, 'summary.txt'), `${passed}/${summary.total} scenarios passed${failed ? `, ${failed} failed` : ''}\n`);
    process.stdout.write(`\n${passed}/${summary.total} scenarios passed`);
    if (failed) process.stdout.write(`, ${failed} failed`);
    process.stdout.write(`\nreport: ${path.join(dir, 'report.html')}\n`);
    return failed === 0;
  }
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toJunit(summary) {
  const cases = summary.rows.map((r) => {
    const failure = r.ok ? '' : `<failure message="${esc((r.failures || []).join('; ') || r.error || 'failed')}"/>`;
    return `    <testcase classname="${esc(r.component)}" name="${esc(r.id)}" time="${(r.durationMs / 1000).toFixed(3)}">${failure}</testcase>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="sim" tests="${summary.total}" failures="${summary.failed}" time="${(summary.rows.reduce((a, r) => a + r.durationMs, 0) / 1000).toFixed(3)}">
${cases}
</testsuite>
`;
}

function toHtml(summary) {
  const rows = summary.rows.map((r) => `
    <tr class="${r.ok ? 'pass' : 'fail'}">
      <td>${esc(r.id)}</td>
      <td>${esc(r.component)}</td>
      <td>${r.ok ? 'pass' : 'fail'}</td>
      <td>${r.durationMs}ms</td>
      <td><pre>${esc((r.failures || []).join('\n') || r.error || '')}</pre></td>
    </tr>`).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>sim report</title>
<style>
body{font-family:ui-monospace,monospace;margin:2rem;color:#111;background:#fafafa}
h1{font-size:1.2rem}.pass td:first-child,.pass{color:#0a7f2c}.fail td:first-child,.fail{color:#b42318}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4rem .6rem;text-align:left;vertical-align:top}
pre{white-space:pre-wrap;margin:0;font-size:.75rem}
</style></head><body>
<h1>sim: ${summary.passed}/${summary.total} scenarios passed</h1>
<p>${esc(summary.startedAt)}</p>
<table><thead><tr><th>scenario</th><th>component</th><th>result</th><th>duration</th><th>detail</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
}

module.exports = { Report };
