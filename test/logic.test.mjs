import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { reviewOutcome } from '../scripts/lib/agent-outcome.mjs';
import { rightLinesByPath, splitDiffByFile, truncateDiff } from '../scripts/lib/diff.mjs';
import { apiSkipError, skipReasonFor } from '../scripts/lib/failure.mjs';
import { parseReview, selectComments } from '../scripts/lib/review-result.mjs';

const fileDiff = ({ path, hunk }) =>
  [`diff --git a/${path} b/${path}`, 'index 1111111..2222222 100644', `--- a/${path}`, `+++ b/${path}`, hunk, ''].join(
    '\n',
  );

const SAMPLE_DIFF = [
  fileDiff({
    path: 'src/app.ts',
    hunk: [
      '@@ -10,3 +10,4 @@ export const run = () => {',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 3;',
      '+const c = 4;',
      ' return a;',
      '\\ No newline at end of file',
    ].join('\n'),
  }),
  [
    'diff --git a/old.ts b/old.ts',
    'deleted file mode 100644',
    '--- a/old.ts',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-gone',
    '-gone too',
    '',
  ].join('\n'),
  fileDiff({
    path: 'docs/readme.md',
    hunk: ['@@ -1 +1 @@', '-old', '+new'].join('\n'),
  }),
].join('');

describe('rightLinesByPath', () => {
  it('maps context and added lines of the new version, skipping removed and deleted files', () => {
    const lines = rightLinesByPath(SAMPLE_DIFF);
    assert.deepEqual([...lines.get('src/app.ts')], [10, 11, 12, 13]);
    assert.deepEqual([...lines.get('docs/readme.md')], [1]);
    assert.equal(lines.has('old.ts'), false);
  });
});

const QUOTED_PATH = '"b/\\305\\274\\303\\263\\305\\202w.md"';

describe('diff parsing edge cases', () => {
  const cases = [
    {
      label: 'an added line that starts with ++',
      diff: fileDiff({ path: 'a.md', hunk: ['@@ -1,1 +1,3 @@', ' x', '+++ not a header', '+y'].join('\n') }),
      path: 'a.md',
      lines: [1, 2, 3],
    },
    {
      label: 'a quoted non-ASCII path',
      diff: [
        `diff --git ${QUOTED_PATH.replace('b/', 'a/')} ${QUOTED_PATH}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ ${QUOTED_PATH}`,
        '@@ -0,0 +1 @@',
        '+x',
        '',
      ].join('\n'),
      path: '\u017C\u00F3\u0142w.md',
      lines: [1],
    },
  ];
  for (const { label, diff, path, lines } of cases) {
    it(`maps ${label}`, () => {
      assert.deepEqual([...rightLinesByPath(diff).get(path)], lines);
      assert.deepEqual(
        splitDiffByFile(diff).map((file) => file.path),
        [path],
      );
    });
  }
});

describe('truncateDiff', () => {
  const cases = [
    {
      maxBytes: 1_000_000,
      keptPaths: ['src/app.ts', 'old.ts', 'docs/readme.md'],
      omittedFiles: [],
    },
    {
      maxBytes: 150,
      keptPaths: ['old.ts'],
      omittedFiles: ['src/app.ts', 'docs/readme.md'],
    },
    {
      maxBytes: 10,
      keptPaths: [],
      omittedFiles: ['src/app.ts', 'old.ts', 'docs/readme.md'],
    },
  ];
  for (const { maxBytes, keptPaths, omittedFiles } of cases) {
    it(`cuts at file boundaries under ${maxBytes} bytes`, () => {
      const result = truncateDiff({ diff: SAMPLE_DIFF, maxBytes });
      assert.deepEqual(result.omittedFiles, omittedFiles);
      assert.ok(Buffer.byteLength(result.diff) <= maxBytes);
      assert.deepEqual(
        [...result.diff.matchAll(/^diff --git a\/(\S+)/gm)].map((match) => match[1]),
        keptPaths,
      );
    });
  }
});

describe('parseReview', () => {
  it('accepts a well-formed review', () => {
    const review = parseReview({
      summary: 'Jedna uwaga.',
      comments: [{ path: 'src/app.ts', line: 12, severity: 'high', body: 'Popraw.' }],
    });
    assert.equal(review.comments.length, 1);
  });

  const invalid = [
    { label: 'missing summary', value: { comments: [] } },
    {
      label: 'unknown severity',
      value: { summary: 'x', comments: [{ path: 'a', line: 1, severity: 'nit', body: 'b' }] },
    },
    {
      label: 'line below one',
      value: { summary: 'x', comments: [{ path: 'a', line: 0, severity: 'low', body: 'b' }] },
    },
    { label: 'not an object', value: 'plain text' },
  ];
  for (const { label, value } of invalid) {
    it(`throws on ${label}`, () => {
      assert.throws(() => parseReview(value));
    });
  }
});

describe('selectComments', () => {
  it('drops lines outside the diff and keeps the most severe up to the cap', () => {
    const validLines = rightLinesByPath(SAMPLE_DIFF);
    const comment = (path, line, severity) => ({ path, line, severity, body: severity });
    const { comments, droppedOutsideDiff, droppedOverCap } = selectComments({
      comments: [
        comment('src/app.ts', 11, 'low'),
        comment('src/app.ts', 99, 'critical'),
        comment('old.ts', 1, 'high'),
        comment('docs/readme.md', 1, 'medium'),
        comment('src/app.ts', 12, 'critical'),
      ],
      validLines,
      maxComments: 2,
    });
    assert.deepEqual(
      comments.map(({ path, line }) => `${path}:${line}`),
      ['src/app.ts:12', 'docs/readme.md:1'],
    );
    assert.equal(droppedOutsideDiff, 2);
    assert.equal(droppedOverCap, 1);
  });
});

describe('skipReasonFor', () => {
  const cases = [
    { failure: { status: 402 }, reason: 'wyczerpany kredyt API Anthropic' },
    { failure: { status: 400, message: 'Your credit balance is too low' }, reason: 'wyczerpany kredyt API Anthropic' },
    { failure: { status: 429 }, reason: 'limit zapytań albo wydatków workspace' },
    { failure: { status: 401 }, reason: 'klucz API odrzucony (401)' },
    { failure: { status: 404 }, reason: 'API Anthropic odrzuciło żądanie (404)' },
    { failure: { status: 529 }, reason: 'API Anthropic niedostępne (529)' },
    { failure: { message: 'API Error: Connection error.' }, reason: 'błąd sieci' },
    { failure: { message: 'fetch failed: ETIMEDOUT' }, reason: 'błąd sieci' },
    { failure: { message: 'Unexpected token in JSON' }, reason: null },
    { failure: { status: null, message: '' }, reason: null },
  ];
  for (const { failure, reason } of cases) {
    it(`maps ${JSON.stringify(failure)} to ${reason}`, () => {
      assert.equal(skipReasonFor(failure), reason);
    });
  }
});

describe('apiSkipError', () => {
  const rejected = (status) => `API Anthropic odrzuciło żądanie (${status})`;
  const longMessage = 'bad\nrequest sk-ant-api03-abcdefghijkl ' + 'x'.repeat(400);
  const cases = [
    {
      failure: { status: 400, message: 'invalid_request_error: prompt is too long' },
      skip: { skipReason: rejected(400), failsCheck: true, skipDetail: 'invalid_request_error: prompt is too long' },
    },
    { failure: { status: 404 }, skip: { skipReason: rejected(404), failsCheck: true, skipDetail: '' } },
    { failure: { status: 413 }, skip: { skipReason: rejected(413), failsCheck: true, skipDetail: '' } },
    { failure: { status: 422 }, skip: { skipReason: rejected(422), failsCheck: true, skipDetail: '' } },
    {
      failure: { status: 400, message: 'Your credit balance is too low' },
      skip: {
        skipReason: 'wyczerpany kredyt API Anthropic',
        failsCheck: false,
        skipDetail: 'Your credit balance is too low',
      },
    },
    {
      failure: { status: 402 },
      skip: { skipReason: 'wyczerpany kredyt API Anthropic', failsCheck: false, skipDetail: '' },
    },
    {
      failure: { status: 429 },
      skip: { skipReason: 'limit zapytań albo wydatków workspace', failsCheck: false, skipDetail: '' },
    },
    { failure: { status: 401 }, skip: { skipReason: 'klucz API odrzucony (401)', failsCheck: false, skipDetail: '' } },
    {
      failure: { status: 529 },
      skip: { skipReason: 'API Anthropic niedostępne (529)', failsCheck: false, skipDetail: '' },
    },
    {
      failure: { message: 'fetch failed: ETIMEDOUT' },
      skip: { skipReason: 'błąd sieci', failsCheck: false, skipDetail: 'fetch failed: ETIMEDOUT' },
    },
    { failure: { message: 'Unexpected token in JSON' }, skip: null },
    {
      failure: { status: 400, message: longMessage },
      skip: {
        skipReason: rejected(400),
        failsCheck: true,
        skipDetail: `bad request [ukryte] ${'x'.repeat(400)}`.slice(0, 300),
      },
    },
  ];
  for (const { failure, skip } of cases) {
    it(`keeps the API text and turns only an unexplained rejection red: ${JSON.stringify(failure).slice(0, 80)}`, () => {
      const error = apiSkipError(failure);
      if (skip === null) {
        assert.equal(error, null);
        return;
      }
      const { skipReason, failsCheck, skipDetail } = error;
      assert.deepEqual({ skipReason, failsCheck, skipDetail }, skip);
      assert.equal(error.message, skip.skipReason);
      assert.ok(!/\s{2}|\n/.test(skipDetail) && !skipDetail.includes('sk-ant-') && skipDetail.length <= 300);
    });
  }
});

describe('reviewOutcome', () => {
  const outcomeOf = (input) => {
    try {
      return { returned: reviewOutcome(input) };
    } catch ({ message, skipReason, failsCheck, skipDetail }) {
      return { thrown: { message, skipReason, failsCheck, skipDetail } };
    }
  };
  const skipped = (reason) => ({ message: reason, skipReason: reason, failsCheck: undefined, skipDetail: undefined });
  const cases = [
    {
      label: 'the turn limit',
      input: { result: { subtype: 'error_max_turns', is_error: true, errors: [] }, maxBudgetUsd: 2, guardDenials: 0 },
      outcome: { thrown: skipped('wyczerpany limit 20 tur') },
    },
    {
      label: 'the budget',
      input: {
        result: { subtype: 'error_max_budget_usd', is_error: true, errors: [] },
        maxBudgetUsd: 2,
        guardDenials: 0,
      },
      outcome: { thrown: skipped('przekroczony budżet 2 USD') },
    },
    {
      label: 'an unexplained API rejection',
      input: {
        result: {
          subtype: 'success',
          is_error: true,
          api_error_status: 400,
          result: 'API Error: 400 prompt is too long',
        },
        maxBudgetUsd: 2,
        guardDenials: 0,
      },
      outcome: {
        thrown: {
          message: 'API Anthropic odrzuciło żądanie (400)',
          skipReason: 'API Anthropic odrzuciło żądanie (400)',
          failsCheck: true,
          skipDetail: 'API Error: 400 prompt is too long',
        },
      },
    },
    {
      label: 'an execution error',
      input: {
        result: { subtype: 'error_during_execution', is_error: true, errors: ['boom'] },
        maxBudgetUsd: 2,
        guardDenials: 0,
      },
      outcome: {
        thrown: {
          message: 'Przegląd przerwany: error_during_execution',
          skipReason: undefined,
          failsCheck: undefined,
          skipDetail: undefined,
        },
      },
    },
    {
      label: 'a finished review',
      input: {
        result: {
          subtype: 'success',
          is_error: false,
          structured_output: { summary: 'ok', comments: [] },
          num_turns: 3,
          modelUsage: {},
          total_cost_usd: 0.1,
          permission_denials: [],
        },
        maxBudgetUsd: 2,
        guardDenials: 1,
      },
      outcome: {
        returned: {
          review: { summary: 'ok', comments: [] },
          turns: 3,
          tokens: { input: 0, output: 0 },
          costUsd: 0.1,
          denials: 1,
        },
      },
    },
  ];
  for (const { label, input, outcome } of cases) {
    it(`maps the SDK result to a review or a skip: ${label}`, () => {
      assert.deepEqual(outcomeOf(input), outcome);
    });
  }
});
