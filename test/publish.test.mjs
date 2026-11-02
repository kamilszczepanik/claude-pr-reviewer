import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { apiSkipError, skipError } from '../scripts/lib/failure.mjs';
import { publishReview, settleReview, SKIP_MARKER } from '../scripts/lib/publish.mjs';
import { buildReviewBody, cleanReview, GITHUB_BODY_LIMIT } from '../scripts/lib/review-body.mjs';

const httpError = (status) => Object.assign(new Error(`GitHub ${status}`), { status });

const fakeGithub = ({ reviewFailures = [], comments = [], commentFailure = null } = {}) => {
  const calls = { reviews: [], posted: [], updated: [] };
  const failures = [...reviewFailures];
  return {
    calls,
    postReview: async (review) => {
      calls.reviews.push(review);
      const status = failures.shift();
      if (status) throw httpError(status);
    },
    listComments: async () => {
      if (commentFailure) throw httpError(commentFailure);
      return comments;
    },
    postComment: async (body) => calls.posted.push(body),
    updateComment: async (update) => calls.updated.push(update),
  };
};

describe('publishReview', () => {
  const attempts = [
    { commitId: 'abc', body: 'pełny', comments: [{ path: 'a', line: 1 }] },
    { commitId: 'abc', body: 'z listą', comments: [] },
    { body: 'krótki', comments: [] },
  ];
  const cases = [
    { failures: [], used: 0 },
    { failures: [422], used: 1 },
    { failures: [422, 422], used: 2 },
    { failures: [422, 422, 422], thrown: 422 },
    { failures: [500], thrown: 500 },
  ];
  for (const { failures, used, thrown } of cases) {
    it(`after failures ${JSON.stringify(failures)} ${thrown ? `throws ${thrown}` : `uses attempt ${used}`}`, async () => {
      const github = fakeGithub({ reviewFailures: failures });
      if (thrown) {
        await assert.rejects(publishReview({ github, attempts }), { status: thrown });
        return;
      }
      assert.equal(await publishReview({ github, attempts }), used);
      assert.equal(github.calls.reviews.at(-1).body, attempts[used].body);
    });
  }
});

describe('settleReview', () => {
  const ownComment = { id: 7, user: { type: 'Bot' }, body: `${SKIP_MARKER}\nstary` };
  const cases = [
    { label: 'a finished review', run: async () => {}, exitCode: 0, posted: 0, updated: 0 },
    { label: 'a skip', run: async () => Promise.reject(skipError('błąd sieci')), exitCode: 0, posted: 1, updated: 0 },
    {
      label: 'a repeated skip',
      run: async () => Promise.reject(skipError('błąd sieci')),
      github: { comments: [ownComment] },
      exitCode: 0,
      posted: 0,
      updated: 1,
    },
    {
      label: 'a skip whose comment fails',
      run: async () => Promise.reject(skipError('błąd sieci')),
      github: { commentFailure: 403 },
      exitCode: 0,
      posted: 0,
      updated: 0,
    },
    { label: 'a bug', run: async () => Promise.reject(new Error('boom')), exitCode: 1, posted: 0, updated: 0 },
    {
      label: 'a JSON error quoting the model',
      run: async () => Promise.reject(new SyntaxError('Unexpected token in "tajny tekst modelu"')),
      exitCode: 1,
      posted: 0,
      updated: 0,
    },
  ];
  for (const { label, run, github: options, exitCode, posted, updated } of cases) {
    it(`exits ${exitCode} after ${label}`, async () => {
      const github = fakeGithub(options);
      const lines = [];
      assert.equal(await settleReview({ run, github, log: (line) => lines.push(line) }), exitCode);
      assert.equal(github.calls.posted.length, posted);
      assert.equal(github.calls.updated.length, updated);
      assert.ok(
        [...github.calls.posted, ...github.calls.updated.map((update) => update.body)].every((body) =>
          body.startsWith(SKIP_MARKER),
        ),
      );
      assert.ok(lines.length <= 2);
      assert.ok(lines.every((line) => !line.includes('tajny tekst modelu')));
    });
  }

  it('exits 1 after an unexplained API rejection and keeps the API text out of the PR', async () => {
    const github = fakeGithub();
    const lines = [];
    const run = async () => Promise.reject(apiSkipError({ status: 400, message: 'prompt is too long', secrets: [] }));
    assert.equal(await settleReview({ run, github, log: (line) => lines.push(line) }), 1);
    assert.equal(github.calls.posted.length, 1);
    const [comment] = github.calls.posted;
    assert.ok(comment.startsWith(SKIP_MARKER));
    assert.ok(comment.includes('odrzuciło żądanie (400)'));
    assert.ok(!comment.includes('prompt is too long'));
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes('odpowiedź API: prompt is too long'));
    assert.ok(lines[0].length <= 300);
  });
});

describe('review body', () => {
  it('cleans mentions and secrets out of the model output', () => {
    const review = cleanReview({
      review: {
        summary: '@kamil klucz sk-ant-api03-abcdefghijkl',
        comments: [{ path: 'a', line: 1, severity: 'low', body: '![x](https://e.test/p.png)' }],
      },
      secrets: [],
    });
    assert.equal(review.summary, '@​kamil klucz [ukryte]');
    assert.equal(review.comments[0].body, '(obraz usunięty)');
  });

  it('stays under the GitHub body limit with the longest fallback list', () => {
    const long = 'x'.repeat(100_000);
    const review = cleanReview({
      review: {
        summary: long,
        comments: Array.from({ length: 30 }, (_, line) => ({
          path: 'a',
          line: line + 1,
          severity: 'high',
          body: long,
        })),
      },
      secrets: [],
    });
    const body = buildReviewBody({
      ...review,
      model: 'claude-opus-5-5',
      turns: 40,
      tokens: { input: 1, output: 1 },
      omittedFiles: ['b'],
      droppedOverCap: 0,
      fallbackComments: review.comments,
    });
    assert.ok(body.length <= GITHUB_BODY_LIMIT);
    assert.match(body, /<sub>Przegląd Claude · model claude-opus-5-5/);
  });

  it('escapes model paths in the fallback list like omitted files', () => {
    const fallbackBody = (comment) =>
      buildReviewBody({
        summary: 'Podsumowanie.',
        model: 'claude-opus-5-5',
        turns: 1,
        tokens: { input: 1, output: 1 },
        omittedFiles: [],
        droppedOverCap: 0,
        fallbackComments: [{ line: 3, severity: 'high', ...comment }],
      });
    const body = fallbackBody({ path: 'src/`a`<img src=x>@kamil.ts', body: 'b' });
    assert.ok(body.includes('"src/'));
    assert.ok(body.includes(':3 (wysoka): b'));
    assert.ok(!body.includes('<img'));
    assert.ok(body.includes('@\u200Bkamil'));
    assert.ok(!body.includes('`src/'));
    assert.ok(!fallbackBody({ path: 'src/`a.ts', body: 'x `<img src=y>`' }).includes('<img'));
  });
});
