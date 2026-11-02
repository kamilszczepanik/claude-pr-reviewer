import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rightLinesByPath, splitDiffByFile, truncateDiff } from '../scripts/lib/diff.mjs';
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
