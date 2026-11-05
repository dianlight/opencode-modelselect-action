#!/usr/bin/env node
/**
 * release-watch.js — daily check for opencode / openchamber / @openchamber/sdk
 * releases that carry SDK, API, or App addenda useful to this project.
 *
 * Compares against the last-seen state stored in
 * .opencode/.modelselect-cache/release-watch.json and prints a digest of
 * anything new. Exits 0 whether or not there is news.
 *
 * Intended to be run daily, e.g. as an OpenChamber scheduled task
 * (Settings > Scheduled Tasks → daily prompt that runs this script) or a
 * cron job.
 */

const { execSync } = require('child_process');
const fs = require('node:fs');
const path = require('node:path');

const STATE_DIR = path.join(process.cwd(), '.opencode', '.modelselect-cache');
const STATE_FILE = path.join(STATE_DIR, 'release-watch.json');

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return '';
  }
}

function ghReleases(repo, limit = 5) {
  const out = sh(`gh release list --repo ${repo} --limit ${limit} --json tagName,publishedAt,body,prerelease`);
  try {
    return JSON.parse(out || '[]');
  } catch {
    return [];
  }
}

function npmDistTags(pkg) {
  const out = sh(`npm view ${pkg} dist-tags --json`);
  try {
    return JSON.parse(out || '{}');
  } catch {
    return {};
  }
}

/** Lines that mention SDK / API / App / surface / guest / host / reload / quota. */
function relevantLines(body) {
  if (!body) return [];
  const keywords = [
    'sdk', 'api', 'app', 'status section', 'contributes', 'guest', 'host',
    'reload', 'quota', 'usage', 'manifest', 'service', 'panel', 'extension',
    'location/reload', 'session.stats', 'usage/limits'
  ];
  return body.split('\n')
    .filter(l => keywords.some(k => l.toLowerCase().includes(k)))
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { opencode: {}, openchamber: {}, sdk: {} };
  }
}

function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function main() {
  const state = loadState();
  const news = [];

  // --- opencode releases ---
  const ocReleases = ghReleases('anomalyco/opencode');
  for (const r of ocReleases) {
    const prev = state.opencode[r.tagName];
    if (prev) continue;
    state.opencode[r.tagName] = { publishedAt: r.publishedAt };
    const lines = relevantLines(r.body || '');
    if (lines.length > 0) {
      news.push({
        source: 'opencode',
        tag: r.tagName,
        publishedAt: r.publishedAt,
        prerelease: r.prerelease,
        lines
      });
    }
  }

  // --- openchamber releases ---
  const ocReleases2 = ghReleases('openchamber/openchamber');
  for (const r of ocReleases2) {
    const prev = state.openchamber[r.tagName];
    if (prev) continue;
    state.openchamber[r.tagName] = { publishedAt: r.publishedAt };
    const lines = relevantLines(r.body || '');
    if (lines.length > 0) {
      news.push({
        source: 'openchamber',
        tag: r.tagName,
        publishedAt: r.publishedAt,
        prerelease: r.prerelease,
        lines
      });
    }
  }

  // --- @openchamber/sdk dist-tags ---
  const tags = npmDistTags('@openchamber/sdk');
  const current = { latest: tags.latest, canary: tags.canary, preview: tags.preview };
  const prev = state.sdk;
  if (JSON.stringify(current) !== JSON.stringify(prev)) {
    const changed = [];
    for (const k of Object.keys(current)) {
      if (prev[k] !== current[k]) changed.push(`${k}: ${prev[k] ?? '(none)'} → ${current[k]}`);
    }
    news.push({
      source: 'sdk',
      tag: JSON.stringify(current),
      publishedAt: new Date().toISOString(),
      prerelease: false,
      lines: changed
    });
    state.sdk = current;
  }

  saveState(state);

  // --- print digest ---
  if (news.length === 0) {
    console.log('release-watch: no new SDK/API/App-related releases.');
    return;
  }

  console.log('release-watch: new releases with SDK/API/App addenda:\n');
  for (const n of news) {
    console.log(`[${n.source}] ${n.tag}` + (n.prerelease ? ' (prerelease)' : '') +
      ` — ${n.publishedAt}`);
    for (const line of n.lines.slice(0, 6)) {
      console.log(`   • ${line}`);
    }
    if (n.lines.length > 6) {
      console.log(`   • …and ${n.lines.length - 6} more`);
    }
    console.log('');
  }
}

main();
