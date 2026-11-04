import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CODE_PATHS = ['action.yml', 'scripts', 'package.json', 'package-lock.json'];
const FULL_SHA = /^[0-9a-f]{40}$/;

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const git = (args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const packageVersion = async () => JSON.parse(await read('package.json')).version;

const commitExists = (sha) => {
  try {
    git(['cat-file', '-e', `${sha}^{commit}`]);
  } catch {
    assert.fail(`commit ${sha} is not in this clone; CI needs fetch-depth: 0 to compare the code under a pin`);
  }
};

const codeMatchesTree = (sha) => {
  try {
    git(['diff', '--quiet', sha, '--', ...CODE_PATHS]);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
};

const actionPin = (workflowText) => {
  const match = workflowText.match(/uses: kamilszczepanik\/claude-pr-reviewer@(\S+)\s+# (\S+)/);
  assert.ok(match, 'review.yml calls the reviewer action with a pinned ref and a version label');
  return { ref: match[1], label: match[2] };
};

const usesRefs = (text) =>
  [...text.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)].map((match) => match[1].slice(match[1].lastIndexOf('@') + 1));

const pinnedFiles = async () => {
  const workflows = (await readdir(new URL('../.github/workflows', import.meta.url)))
    .filter((name) => name.endsWith('.yml'))
    .map((name) => `.github/workflows/${name}`);
  return [...workflows, 'action.yml'];
};

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
  it('pins the action to a commit whose code is this release, labelled with its version', async () => {
    const [workflow, version] = await Promise.all([read('.github/workflows/review.yml'), packageVersion()]);
    const { ref, label } = actionPin(workflow);
    assert.match(ref, FULL_SHA);
    assert.equal(label, `v${version}`);
    commitExists(ref);
    assert.ok(codeMatchesTree(ref), `the code under ${ref} differs from this tree in ${CODE_PATHS.join(', ')}`);
  });

  it('pins every action and reusable workflow by full commit SHA', async () => {
    for (const file of await pinnedFiles()) {
      for (const ref of usesRefs(await read(file))) {
        assert.match(ref, FULL_SHA, `${file} uses ${ref}, not a full commit SHA`);
      }
    }
  });

  it('points the self-review, the README caller example and the top pin-table row at one release commit', async () => {
    const [selfReview, readme, workflow, version] = await Promise.all([
      read('.github/workflows/claude-review.yml'),
      read('README.md'),
      read('.github/workflows/review.yml'),
      packageVersion(),
    ]);
    const selfReviewSha = selfReview.match(/review\.yml@(\S+)/)[1];
    const exampleSha = readme.match(/review\.yml@([0-9a-f]{40})/)[1];
    const [, tableVersion, tableSha] = readme.match(/^\| `v(\S+)` +\| `([0-9a-f]{40})` \|/m);
    assert.equal(exampleSha, selfReviewSha);
    assert.equal(tableSha, selfReviewSha);
    assert.equal(tableVersion, version);
    commitExists(selfReviewSha);
    assert.ok(codeMatchesTree(selfReviewSha), `the code under ${selfReviewSha} differs from this tree`);
    assert.deepEqual(actionPin(git(['show', `${selfReviewSha}:.github/workflows/review.yml`])), actionPin(workflow));
  });

  it('passes exactly the inputs the action declares', async () => {
    const [workflow, action] = await Promise.all([read('.github/workflows/review.yml'), read('action.yml')]);
    assert.deepEqual(actionStepInputs(workflow), actionInputs(action));
  });
});
