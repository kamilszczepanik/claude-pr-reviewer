import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { apiSkipError, skipError } from '../scripts/lib/failure.mjs';
import {
  failureLine,
  publishReview,
  runReviewProcess,
  settleReview,
  SKIP_MARKER,
  withLanguage,
} from '../scripts/lib/publish.mjs';
import {
  buildReviewBody,
  buildShortBody,
  cleanReview,
  GITHUB_BODY_LIMIT,
  toInlineComment,
} from '../scripts/lib/review-body.mjs';

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
    { label: 'a skip', run: async () => Promise.reject(skipError('network error')), exitCode: 0, posted: 1, updated: 0 },
    {
      label: 'a repeated skip',
      run: async () => Promise.reject(skipError('network error')),
      github: { comments: [ownComment] },
      exitCode: 0,
      posted: 0,
      updated: 1,
    },
    {
      label: 'a skip whose comment fails',
      run: async () => Promise.reject(skipError('network error')),
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

  const skipComments = [
    { label: 'English', language: 'en', text: 'Claude review skipped: network error.\n\nThis run did not check the PR' },
    { label: 'Polish', language: 'pl', text: 'Przegląd Claude pominięty: network error.\n\nTen przebieg nie sprawdził PR-a' },
    { label: 'English when the error carries no language', text: 'Claude review skipped: network error.\n\nThis run' },
  ];
  for (const { label, language, text } of skipComments) {
    it(`posts the skip comment in ${label}`, async () => {
      const github = fakeGithub();
      const run = async () => Promise.reject(Object.assign(skipError('network error'), language ? { language } : {}));
      assert.equal(await settleReview({ run, github, log: () => {} }), 0);
      assert.ok(github.calls.posted[0].startsWith(`${SKIP_MARKER}\n${text}`));
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
    assert.ok(comment.includes('rejected the request (400)'));
    assert.ok(!comment.includes('prompt is too long'));
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes('API response: prompt is too long'));
    assert.ok(lines[0].length <= 300);
    const failedLines = [];
    const failedComment = fakeGithub({ commentFailure: 403 });
    assert.equal(await settleReview({ run, github: failedComment, log: (line) => failedLines.push(line) }), 1);
    assert.equal(failedLines.length, 2);
    assert.ok(!failedLines[1].includes('without an error') && failedLines[1].includes('code 1'));
  });

  it('logs an unrecognised error with the review secrets and token-shaped text redacted, in the review and at the top level', async () => {
    const secret = 'tajny-klucz-1234567890';
    const github = fakeGithub();
    const lines = [];
    const run = async () =>
      Promise.reject(new Error(`request failed with x-api-key: ${secret} and sk-ant-api03-abcdefghijklmnop`));
    assert.equal(await settleReview({ run, github, log: (line) => lines.push(line), secrets: [secret] }), 1);
    assert.equal(lines.length, 1);
    assert.ok(!lines[0].includes(secret));
    assert.ok(!lines[0].includes('sk-ant-api03-abcdefghijklmnop'));
    assert.ok(lines[0].includes('[redacted]'));
    assert.ok(lines[0].length <= 300);
    assert.equal(github.calls.posted.length, 0);
    const gatewayKey = 'vck_gateway-key-0987654321';
    const topLines = [];
    const main = async () =>
      Promise.reject(new Error(`config failed: ${gatewayKey} ${Buffer.from(gatewayKey).toString('base64')}`));
    const env = { AI_GATEWAY_API_KEY: gatewayKey, GH_TOKEN: 'token-1234567890' };
    assert.equal(await runReviewProcess({ main, env, log: (line) => topLines.push(line) }), 1);
    assert.equal(topLines.length, 1);
    assert.ok(!topLines[0].includes(gatewayKey));
    assert.ok(!topLines[0].includes(Buffer.from(gatewayKey).toString('base64')));
    assert.ok(topLines[0].includes('[redacted]'));
    assert.throws(() => failureLine({ error: new Error(secret) }), TypeError);
    const unprintable = {
      toString: () => {
        throw new Error(gatewayKey);
      },
    };
    for (const thrown of [null, undefined, `config failed: ${gatewayKey}`, Object.create(null), unprintable]) {
      const thrownLines = [];
      const throwing = async () => Promise.reject(thrown);
      assert.equal(await runReviewProcess({ main: throwing, env, log: (line) => thrownLines.push(line) }), 1);
      assert.equal(
        await settleReview({ run: throwing, github, log: (line) => thrownLines.push(line), secrets: [gatewayKey] }),
        1,
      );
      assert.equal(thrownLines.length, 2);
      assert.ok(thrownLines.every((line) => line.startsWith('Claude review failed: Error: ')));
      assert.ok(thrownLines.every((line) => !line.includes(gatewayKey)));
    }
  });
});

describe('withLanguage', () => {
  it('attaches the review language to a thrown error and keeps one already set', async () => {
    const plain = skipError('network error');
    await assert.rejects(
      withLanguage({ language: 'pl', run: async () => Promise.reject(plain) }),
      (error) => error === plain && error.language === 'pl',
    );
    const tagged = Object.assign(skipError('network error'), { language: 'en' });
    await assert.rejects(
      withLanguage({ language: 'pl', run: async () => Promise.reject(tagged) }),
      (error) => error === tagged && error.language === 'en',
    );
    assert.equal(await withLanguage({ language: 'pl', run: async () => 'done' }), 'done');
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
    assert.equal(review.summary, '@​kamil klucz [redacted]');
    assert.equal(review.comments[0].body, '(image removed)');
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
      route: 'api',
      model: 'claude-opus-5-5',
      turns: 40,
      tokens: { input: 1, output: 1 },
      omittedFiles: ['b'],
      droppedOverCap: 0,
      fallbackComments: review.comments,
    });
    assert.ok(body.length <= GITHUB_BODY_LIMIT);
    assert.match(body, /<sub>Claude review · route: API credit · model claude-opus-5-5/);
  });

  it('names the gateway route in the status line of the full and the short body', () => {
    const input = {
      summary: 'Podsumowanie.',
      route: 'gateway',
      model: 'anthropic/claude-sonnet-5.5',
      turns: 2,
      tokens: { input: 1, output: 1 },
      omittedFiles: [],
      droppedOverCap: 0,
    };
    for (const body of [buildReviewBody(input), buildShortBody(input)]) {
      assert.ok(body.split('\n').at(-1).includes('route: AI gateway · model anthropic/claude-sonnet-5.5'));
    }
  });

  const fixedTexts = {
    en: {
      heading: '**Severity: medium**\n\nb',
      truncation:
        '**Diff truncated:** Claude did not see the changes in 1 files and this review does not cover them: "a.ts".',
      shortTruncation:
        '**Diff truncated:** Claude did not see the changes in 1 files and this review does not cover them.',
      dropped: 'Comments dropped over the limit: 3.',
      footer: '<sub>Claude review · route: API credit · model m · turns 2 · input tokens 4, output 5</sub>',
    },
    pl: {
      heading: '**Powaga: średnia**\n\nb',
      truncation: '**Diff obcięty:** Claude nie widział zmian w 1 plikach i ten przegląd ich nie obejmuje: "a.ts".',
      shortTruncation: '**Diff obcięty:** Claude nie widział zmian w 1 plikach i ten przegląd ich nie obejmuje.',
      dropped: 'Pominięte uwagi ponad limit: 3.',
      footer: '<sub>Przegląd Claude · trasa: kredyt API · model m · tury 2 · tokeny wejścia 4, wyjścia 5</sub>',
    },
  };
  for (const [language, texts] of Object.entries(fixedTexts)) {
    it(`writes the severity heading, truncation note, dropped count and footer in ${language}`, () => {
      const input = {
        summary: 'S',
        route: 'api',
        model: 'm',
        turns: 2,
        tokens: { input: 4, output: 5 },
        omittedFiles: ['a.ts'],
        droppedOverCap: 3,
        language,
      };
      const inline = toInlineComment({ path: 'a', line: 1, severity: 'medium', body: 'b', language });
      assert.equal(inline.body, texts.heading);
      assert.equal(buildReviewBody(input), [texts.truncation, 'S', texts.dropped, texts.footer].join('\n\n'));
      assert.equal(buildShortBody(input), [texts.shortTruncation, 'S', texts.footer].join('\n\n'));
    });
  }

  it('escapes model paths in the fallback list like omitted files', () => {
    const fallbackBody = (comment) =>
      buildReviewBody({
        summary: 'Podsumowanie.',
        route: 'api',
        model: 'claude-opus-5-5',
        turns: 1,
        tokens: { input: 1, output: 1 },
        omittedFiles: [],
        droppedOverCap: 0,
        fallbackComments: [{ line: 3, severity: 'high', ...comment }],
      });
    const body = fallbackBody({ path: 'src/`a`<img src=x>@kamil.ts', body: 'b' });
    assert.ok(body.includes('"src/'));
    assert.ok(body.includes(':3 (high): b'));
    assert.ok(!body.includes('<img'));
    assert.ok(body.includes('@\u200Bkamil'));
    assert.ok(!body.includes('`src/'));
    assert.ok(!fallbackBody({ path: 'src/`a.ts', body: 'x `<img src=y>`' }).includes('<img'));
  });
});
