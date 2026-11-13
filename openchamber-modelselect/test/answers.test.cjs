'use strict';

/**
 * The values a form is answered with (`service/src/answers.js`).
 *
 * The service answers a form with what it already holds — the session's
 * project directory and the plugin's pick for that session — and nothing
 * else: every other field keeps its default, and a field the form does not
 * ask for is never filled.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let answers;

before(async () => {
  answers = await import(path.join(__dirname, '..', 'service', 'src', 'answers.js'));
});

const PICK = { model: 'opencode/zen-free', taskType: 'bugfix', tier: 'free' };
const DIRECTORY = '/Users/me/repo';

function field(overrides) {
  return Object.assign({
    key: 'field',
    type: 'string',
    title: 'Field',
    description: null,
    required: false,
  }, overrides);
}

describe('known values', () => {
  it('holds the project directory and the plugin pick', () => {
    assert.deepEqual(answers.knownValues(DIRECTORY, PICK), {
      directory: DIRECTORY,
      model: 'opencode/zen-free',
      task: 'bugfix',
      tier: 'free',
    });
  });

  it('holds the directory alone when the session has no pick', () => {
    assert.deepEqual(answers.knownValues(DIRECTORY, null), { directory: DIRECTORY });
  });

  it('skips empty values', () => {
    assert.deepEqual(answers.knownValues('', { model: '' }), {});
  });
});

describe('form values', () => {
  const known = () => answers.knownValues(DIRECTORY, PICK);

  it('fills a field the service holds a value for', () => {
    const values = answers.computeFormValues([
      field({ key: 'model' }),
      field({ key: 'task_type' }),
      field({ key: 'tier' }),
      field({ key: 'directory' }),
    ], known());
    assert.deepEqual(values, {
      model: 'opencode/zen-free',
      task_type: 'bugfix',
      tier: 'free',
      directory: DIRECTORY,
    });
  });

  it('leaves a field it cannot compute to its default', () => {
    const values = answers.computeFormValues([
      field({ key: 'note' }),
      field({ key: 'apiKey' }),
    ], known());
    assert.deepEqual(values, {});
  });

  it('never fills an external link', () => {
    const values = answers.computeFormValues([
      field({ key: 'model', type: 'external' }),
    ], known());
    assert.deepEqual(values, {});
  });

  it('fills a choice with one option', () => {
    const values = answers.computeFormValues([
      field({ key: 'side', options: [{ value: 'free', label: 'Free' }] }),
    ], known());
    assert.deepEqual(values, { side: 'free' });
  });

  it('refuses a value that is not one of the options', () => {
    const values = answers.computeFormValues([
      field({ key: 'model', options: [{ value: 'opencode/zen-free' }, { value: 'other' }] }),
    ], known());
    assert.deepEqual(values, { model: 'opencode/zen-free' });

    const refused = answers.computeFormValues([
      field({ key: 'model', options: [{ value: 'other' }] }),
    ], known());
    assert.deepEqual(refused, {});
  });

  it('takes a multiselect as the option values', () => {
    const values = answers.computeFormValues([
      field({
        key: 'model',
        type: 'multiselect',
        options: [{ value: 'opencode/zen-free' }, { value: 'other' }],
      }),
    ], known());
    assert.deepEqual(values, { model: ['opencode/zen-free'] });
  });

  it('leaves a number field alone: the service holds no numbers', () => {
    const values = answers.computeFormValues([
      field({ key: 'model', type: 'number' }),
    ], known());
    assert.deepEqual(values, {});
  });

  it('skips a field whose condition does not hold', () => {
    const values = answers.computeFormValues([
      field({ key: 'tier', when: [{ key: 'model', op: 'eq', value: 'other' }] }),
    ], known());
    assert.deepEqual(values, {});
  });

  it('skips a field whose condition names a value nobody computed', () => {
    const values = answers.computeFormValues([
      field({ key: 'note', when: [{ key: 'missing', op: 'neq', value: 'x' }] }),
    ], known());
    assert.deepEqual(values, {});
  });

  it('fills a field whose condition holds', () => {
    const values = answers.computeFormValues([
      field({ key: 'model' }),
      field({ key: 'tier', when: [{ key: 'model', op: 'eq', value: 'opencode/zen-free' }] }),
    ], known());
    assert.deepEqual(values, { model: 'opencode/zen-free', tier: 'free' });
  });

  it('copes with a form that has no fields', () => {
    assert.deepEqual(answers.computeFormValues([], known()), {});
    assert.deepEqual(answers.computeFormValues(null, known()), {});
  });
});

describe('the message the agent reads', () => {
  it('names the fields the service filled', () => {
    assert.match(answers.formMessage({ model: 'opencode/zen-free' }), /filled model/);
  });

  it('says so when nothing was computable', () => {
    assert.match(answers.formMessage({}), /defaults/);
  });
});
