import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const actionStepInputs = (workflow) => {
  const step = workflow.slice(workflow.indexOf('uses: kamilszczepanik/claude-pr-reviewer@'));
  const withBlock = step.slice(step.indexOf('with:'));
  return [...withBlock.matchAll(/^ {10}([a-z-]+):/gm)].map((match) => match[1]).sort();
};

const actionInputs = (action) => {
  const block = action.slice(action.indexOf('inputs:'), action.indexOf('runs:'));
  return [...block.matchAll(/^ {2}([a-z-]+):/gm)].map((match) => match[1]).sort();
};

describe('release contract', () => {
  it('calls the action at the tag of its own version, so a pinned workflow runs its own scripts', async () => {
    const [workflow, manifest] = await Promise.all([read('.github/workflows/review.yml'), read('package.json')]);
    const ref = workflow.match(/uses: kamilszczepanik\/claude-pr-reviewer@(\S+)/)[1];
    assert.equal(ref, `v${JSON.parse(manifest).version}`);
  });

  it('passes exactly the inputs the action declares', async () => {
    const [workflow, action] = await Promise.all([read('.github/workflows/review.yml'), read('action.yml')]);
    assert.deepEqual(actionStepInputs(workflow), actionInputs(action));
  });
});
