import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildReviewBody,
  buildShortBody,
  cleanReview,
  GITHUB_BODY_LIMIT,
  toInlineComment,
} from '../scripts/lib/review-body.mjs';

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
