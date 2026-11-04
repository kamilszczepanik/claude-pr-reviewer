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

const MIN_PINNED_USES = 6;

const commitExists = (sha) => {
  try {
    git(['cat-file', '-e', `${sha}^{commit}`]);
  } catch (error) {
    if (!/Not a valid object name/.test(error.stderr ?? '')) throw error;
    assert.fail(`commit ${sha} is not in this clone; CI needs fetch-depth: 0 to compare the code under a pin`);
  }
};

const gitAnswers = (args) => {
  try {
    git(args);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
};

const codeMatchesTree = (sha) => gitAnswers(['diff', '--quiet', sha, '--', ...CODE_PATHS]);

const isAncestorOfHead = (sha) => gitAnswers(['merge-base', '--is-ancestor', sha, 'HEAD']);

const matchOrFail = ({ text, pattern, what }) => {
  const match = text.match(pattern);
  assert.ok(match, `${what} not found`);
  return match;
};

const actionPin = (workflowText) => {
  const [, ref, label] = matchOrFail({
    text: workflowText,
    pattern: /^[ \t]*uses: kamilszczepanik\/claude-pr-reviewer@(\S+)[ \t]+# (\S+)/m,
    what: 'review.yml calling the reviewer action with a pinned ref and a version label',
  });
  return { ref, label };
};

const usesRefs = (text) =>
  [...text.matchAll(/^[ \t]*(?:-[ \t]+)?uses:[ \t]*(\S+)/gm)].map((match) =>
    match[1].slice(match[1].lastIndexOf('@') + 1),
  );

const pinnedFiles = async () => {
  const workflows = (await readdir(new URL('../.github/workflows', import.meta.url)))
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => `.github/workflows/${name}`);
  return [...workflows, 'action.yml'];
};

const assertReleaseCommit = (sha) => {
  assert.match(sha, FULL_SHA);
  commitExists(sha);
  assert.ok(isAncestorOfHead(sha), `${sha} is not an ancestor of HEAD; pin a commit on the release branch`);
  assert.ok(codeMatchesTree(sha), `the code under ${sha} differs from this tree in ${CODE_PATHS.join(', ')}`);
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
    assert.equal(label, `v${version}`);
    assertReleaseCommit(ref);
  });

  it('pins every action and reusable workflow by full commit SHA', async () => {
    let found = 0;
    for (const file of await pinnedFiles()) {
      const text = await read(file);
      const refs = usesRefs(text);
      assert.equal(refs.length, (text.match(/uses:/g) ?? []).length, `${file} has a uses: line the scan cannot read`);
      for (const ref of refs) {
        assert.match(ref, FULL_SHA, `${file} uses ${ref}, not a full commit SHA`);
      }
      found += refs.length;
    }
    assert.ok(found >= MIN_PINNED_USES, `found ${found} uses: refs, expected at least ${MIN_PINNED_USES}`);
  });

  it('points the self-review, the README caller example and the top pin-table row at one release commit', async () => {
    const [selfReview, readme, workflow, version] = await Promise.all([
      read('.github/workflows/claude-review.yml'),
      read('README.md'),
      read('.github/workflows/review.yml'),
      packageVersion(),
    ]);
    const [, selfReviewSha] = matchOrFail({
      text: selfReview,
      pattern: /review\.yml@(\S+)/,
      what: 'claude-review.yml calling review.yml@<sha>',
    });
    const [, exampleSha] = matchOrFail({
      text: readme,
      pattern: /review\.yml@([0-9a-f]{40})/,
      what: 'README caller example review.yml@<sha>',
    });
    const [, tableVersion, tableSha] = matchOrFail({
      text: readme,
      pattern: /^\| `v(\S+)` +\| `([0-9a-f]{40})` \|/m,
      what: 'README top pin-table row | `vX.Y.Z` | `<sha>` |',
    });
    assert.equal(exampleSha, selfReviewSha);
    assert.equal(tableSha, selfReviewSha);
    assert.equal(tableVersion, version);
    assertReleaseCommit(selfReviewSha);
    assert.deepEqual(actionPin(git(['show', `${selfReviewSha}:.github/workflows/review.yml`])), actionPin(workflow));
  });

  it('passes exactly the inputs the action declares', async () => {
    const [workflow, action] = await Promise.all([read('.github/workflows/review.yml'), read('action.yml')]);
    assert.deepEqual(actionStepInputs(workflow), actionInputs(action));
  });
});
