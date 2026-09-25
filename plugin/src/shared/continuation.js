'use strict';

/**
 * Session continuation: short acks ("do it", "sì, procedi") and answers
 * to assistant questions carry no task signal in any language, so they
 * collapsed to `generic`. Instead, a zero-signal turn inherits the
 * previous turn's task; the ack regex is only a second opinion.
 */

const { TASK_TYPES, inferTaskType, isAck, signalStrength } = require('./detect');

const DEFAULT_HISTORY_CHARS = 2000;

function normalizeHistoryOptions(raw = {}) {
  const continuation =
    raw.continuation ?? raw['continuation'] ?? raw.continueOnLowSignal ?? true;
  let historyChars = raw.historyChars ?? raw['history-chars'] ?? raw.history_chars ?? DEFAULT_HISTORY_CHARS;
  historyChars = Number(historyChars);
  if (!Number.isFinite(historyChars) || historyChars < 0) {
    throw new Error(`Invalid historyChars '${raw.historyChars ?? raw['history-chars']}' (want >= 0).`);
  }
  return { continuation: continuation !== false && continuation !== 'false', historyChars };
}

function truncate(s, max) {
  const t = String(s ?? '');
  if (max <= 0 || t.length <= max) return t;
  return t.slice(0, max);
}

/**
 * Resolve the task-type with session history.
 * Returns { taskType, scores, continued, heuristic, ack, signal }.
 * - fixed taskType / agentMap pins and the small-model fast-path win outright.
 * - a turn with heuristic signal (>0) resolves normally and refreshes history.
 * - a zero-signal turn inherits history.task when available (ack or not).
 */
function resolveWithHistory(
  { prompt, files, repo, agent, fixedTaskType, agentTaskMap, defaultTaskType } = {},
  history,
) {
  const first = inferTaskType({ prompt, files, repo, agent, fixedTaskType, agentTaskMap, defaultTaskType });
  if (first.override || first.fastPath) {
    return { ...first, heuristic: first.taskType, continued: false, ack: false, signal: signalStrength({ prompt, files, agent }) };
  }
  const signal = signalStrength({ prompt, files, agent });
  const ack = isAck(prompt);
  const prev = history && TASK_TYPES.includes(history.task) ? history.task : null;
  if (signal <= 0 && prev) {
    return {
      taskType: prev,
      scores: first.scores,
      heuristic: first.taskType,
      continued: true,
      ack,
      signal,
    };
  }
  return { ...first, heuristic: first.taskType, continued: false, ack, signal };
}

/** True when the resolved turn should refresh the stored history. */
function shouldRemember(resolved) {
  return !resolved.continued && !resolved.override && !resolved.fastPath && resolved.signal > 0;
}

/**
 * Build the Jev/classifier input for a continued turn: previous
 * substantive user prompt (+ last assistant snippet when available) as
 * context, current ack/answer appended. Truncated to historyChars.
 */
function continuationState({ current, historyPrompt, assistantSnippet, historyChars = DEFAULT_HISTORY_CHARS }) {
  const ctx = [historyPrompt ? `Previous: ${historyPrompt}` : '', assistantSnippet ? `Assistant: ${assistantSnippet}` : '']
    .filter(Boolean)
    .join('\n');
  const cur = `Current: ${String(current ?? '')}`;
  const state = ctx ? `${truncate(ctx, historyChars)}\n---\n${cur}` : cur;
  return truncate(state, historyChars + 500);
}

/** Extract the last assistant text from v2 context messages (best-effort). */
function lastAssistantSnippet(messages, maxChars = 1000) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const role = String(m?.role ?? m?.author ?? '').toLowerCase();
    if (role && role !== 'assistant' && role !== 'model' && role !== 'ai') continue;
    const parts = m?.parts ?? m?.content ?? [];
    const texts = (Array.isArray(parts) ? parts : [parts])
      .filter((p) => (typeof p === 'string' ? true : p?.type === 'text'))
      .map((p) => (typeof p === 'string' ? p : p.text))
      .filter((t) => typeof t === 'string' && t.trim());
    if (texts.length) return truncate(texts.join('\n'), maxChars);
    if (!role && texts.length === 0) continue;
  }
  return '';
}

module.exports = {
  normalizeHistoryOptions,
  resolveWithHistory,
  shouldRemember,
  continuationState,
  lastAssistantSnippet,
  truncate,
  DEFAULT_HISTORY_CHARS,
};
