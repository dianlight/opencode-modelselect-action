'use strict';

/**
 * Shared heuristics: repo signals + prompt + touched files + agent tag
 * vote for a task-type. Deterministic, sync where possible, no network.
 *
 * Weights (of 100): prompt 50, touched files 25, repo structure 15,
 * agent tag 10. Highest score wins; ties fall back to 'generic', except
 * the small-model fast-path which wins outright on explicit triggers.
 */

const TASK_TYPES = [
  'plan',
  'issue-triage',
  'review',
  'ui-design',
  'ui-testing',
  'api-testing',
  'docs',
  'debug',
  'refactor',
  'security',
  'code',
  'mechanical-engineer',
  'generic',
  'small-model',
];

// [regex, task-type, points (of the 50 prompt points, scaled later)]
const PROMPT_RULES = [
  [/commit\s*(message|msg)|conventional\s*commit|generate.*commit/i, 'small-model', 50],
  [/^(title|rename (session|conversation)|summar(y|ise)( this| conversation)?)$/i, 'small-model', 50],
  [/\bplan\b|architect|task breakdown|decompos/i, 'plan', 40],
  [/\btriage\b|label (this )?issue|categorize|route this/i, 'issue-triage', 40],
  [/\breview\b|\bdiff\b|pull request|\bpr\b.*(review|comment)/i, 'review', 40],
  [/component|layout|mockup|figma|tailwind|css\b|design system/i, 'ui-design', 40],
  [/playwright|cypress|\be2e\b|selenium/i, 'ui-testing', 40],
  [/openapi|postman|endpoint|integration test|rest api/i, 'api-testing', 35],
  [/readme|changelog|docstring|\bdocs?\b.*(write|update|generate)/i, 'docs', 35],
  [/stack ?trace|crash|repro(duce|duction)?|exception|segfault|\bbug\b.*(fix|triage)/i, 'debug', 40],
  [/refactor|cleanup|tech.?debt|rename.*(var|function|module)/i, 'refactor', 35],
  [/\bcve\b|vuln|exploit|xss|sqli|hardening|threat model/i, 'security', 40],
  [/implement|feature|function|class|endpoint.*(add|create)/i, 'code', 30],
  [/\bcad\b|openscad|thermo|finite element|tolerance|material.*(select|propert)/i, 'mechanical-engineer', 40],
];

const FILE_RULES = [
  [/\.scad$|\.stl$|\.step$|\.stp$|\.f3d$/i, 'mechanical-engineer', 25],
  [/\.tsx$|\.vue$|\.css$|\.scss$|tailwind/i, 'ui-design', 20],
  [/playwright|cypress|e2e|__tests__.*ui/i, 'ui-testing', 20],
  [/openapi.*\.ya?ml|postman.*\.json|api.*test/i, 'api-testing', 18],
  [/\.md$|changelog|docs?\//i, 'docs', 15],
  [/Dockerfile|docker-compose|ci\.ya?ml|\.github\//i, 'generic', 5],
  [/\.(ts|js|py|go|rs|java)$/i, 'code', 12],
];

const AGENT_BOOST = {
  reviewer: 'review',
  review: 'review',
  docs: 'docs',
  frontend: 'ui-design',
  qa: 'ui-testing',
  tester: 'ui-testing',
  security: 'security',
  planner: 'plan',
};

function zeroScores() {
  return Object.fromEntries(TASK_TYPES.map((t) => [t, 0]));
}

function scorePrompt(prompt) {
  const scores = zeroScores();
  const text = String(prompt ?? '');
  if (!text.trim()) return scores;
  for (const [re, task, pts] of PROMPT_RULES) {
    if (re.test(text)) scores[task] += pts;
  }
  return scores;
}

function scoreFiles(files) {
  const scores = zeroScores();
  for (const f of files ?? []) {
    const name = String(f ?? '');
    for (const [re, task, pts] of FILE_RULES) {
      if (re.test(name)) scores[task] += pts;
    }
  }
  return scores;
}

function detectRepoSignals({ stackFiles = [], hasUI = false, hasE2E = false, hasMech = false, fileCount = 0 } = {}) {
  return { stackFiles, hasUI, hasE2E, hasMech, fileCount };
}

function scoreRepo(signals) {
  const scores = zeroScores();
  if (!signals) return scores;
  if (signals.hasMech) scores['mechanical-engineer'] += 15;
  if (signals.hasE2E) scores['ui-testing'] += 10;
  if (signals.hasUI) scores['ui-design'] += 10;
  if ((signals.stackFiles ?? []).length > 0) scores.code += 5;
  if ((signals.fileCount ?? 0) === 0) scores.generic += 5;
  return scores;
}

function scoreAgent(agent) {
  const scores = zeroScores();
  const key = String(agent ?? '').toLowerCase().trim();
  if (!key) return scores;
  const task = AGENT_BOOST[key] ?? (TASK_TYPES.includes(key) ? key : null);
  if (task) scores[task] += 10;
  return scores;
}

/**
 * Combine votes with fixed weights. `fixedTaskType` (manual override)
 * wins outright. Returns { taskType, scores }.
 */
function inferTaskType({ prompt, files, repo, agent, fixedTaskType } = {}) {
  if (fixedTaskType && fixedTaskType !== 'auto') {
    const t = String(fixedTaskType).toLowerCase();
    if (!TASK_TYPES.includes(t)) throw new Error(`Unknown task-type '${fixedTaskType}'.`);
    return { taskType: t, scores: { [t]: 100 }, override: true };
  }
  const p = scorePrompt(prompt);
  // Small-model fast-path: explicit triggers win outright, never a tie-break.
  if (p['small-model'] >= 50) return { taskType: 'small-model', scores: p, fastPath: true };
  const f = scoreFiles(files);
  const r = scoreRepo(repo);
  const a = scoreAgent(agent);
  const total = zeroScores();
  for (const t of TASK_TYPES) total[t] = p[t] + f[t] + r[t] + a[t];
  let best = 'generic';
  let bestScore = -1;
  for (const t of TASK_TYPES) {
    if (t === 'generic') continue;
    if (total[t] > bestScore) {
      bestScore = total[t];
      best = t;
    }
  }
  if (bestScore <= 0) return { taskType: 'generic', scores: total };
  return { taskType: best, scores: total };
}

module.exports = {
  TASK_TYPES,
  inferTaskType,
  scorePrompt,
  scoreFiles,
  scoreRepo,
  scoreAgent,
  detectRepoSignals,
};
