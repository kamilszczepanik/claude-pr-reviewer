import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { createGithub } from '../scripts/lib/github.mjs';

const API = 'https://api.github.com';
const COMMENTS = `${API}/repos/o/r/issues/7/comments`;
const nextLink = (url) => `<${url}>; rel="next", <${COMMENTS}?per_page=100&page=99>; rel="last"`;
const page = ({ comments, next, status = 200 }) => ({ comments, status, link: next ? nextLink(next) : undefined });
const endless = Array.from({ length: 11 }, (_, index) =>
  page({ comments: [{ id: index }], next: `${COMMENTS}?per_page=100&page=${index + 2}` }),
);

describe('listComments', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const cases = [
    {
      label: 'follows rel="next" through three pages in order',
      pages: [
        page({ comments: [{ id: 1 }], next: `${COMMENTS}?per_page=100&page=2` }),
        page({ comments: [{ id: 2 }, { id: 3 }], next: `${COMMENTS}?per_page=100&page=3` }),
        page({ comments: [{ id: 4 }] }),
      ],
      requests: 3,
      result: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
    },
    {
      label: 'stops after one page without a Link header',
      pages: [page({ comments: [{ id: 1 }, { id: 2 }] })],
      requests: 1,
      result: [{ id: 1 }, { id: 2 }],
    },
    {
      label: 'never follows a next page on another host',
      pages: [page({ comments: [{ id: 1 }], next: 'https://evil.example/repos/o/r/issues/7/comments?page=2' })],
      requests: 1,
      result: [{ id: 1 }],
    },
    {
      label: 'reads at most ten pages',
      pages: endless,
      requests: 10,
      result: endless.slice(0, 10).flatMap(({ comments }) => comments),
    },
    {
      label: 'skips when a later page answers 502',
      pages: [
        page({ comments: [{ id: 1 }], next: `${COMMENTS}?per_page=100&page=2` }),
        page({ comments: {}, status: 502 }),
      ],
      requests: 2,
      error: { skipReason: 'API GitHuba niedostępne (502)' },
    },
  ];
  for (const { label, pages, requests, result, error } of cases) {
    it(label, async () => {
      const calls = [];
      globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        assert.ok(calls.length <= pages.length, `unexpected request ${calls.length} to ${url}`);
        const { comments, status, link } = pages[calls.length - 1];
        return new Response(JSON.stringify(comments), { status, headers: link ? { link } : {} });
      };
      const listing = createGithub({ token: 't', repo: 'o/r', prNumber: 7 }).listComments();
      if (error) await assert.rejects(listing, error);
      else assert.deepEqual(await listing, result);
      assert.equal(calls.length, requests);
      assert.equal(calls[0].url, `${COMMENTS}?per_page=100`);
      for (const { init } of calls) assert.equal(init.headers.authorization, 'Bearer t');
    });
  }
});
