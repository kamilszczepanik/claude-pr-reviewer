import { skipError } from './failure.mjs';

const API_URL = process.env.GITHUB_API_URL ?? 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 30_000;
const GITHUB_UNAVAILABLE = 'API GitHuba niedostępne';

const send = async ({ url, init }) => {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw skipError(`${GITHUB_UNAVAILABLE} (${error.name})`);
  }
};

const MAX_COMMENT_PAGES = 10;
const JSON_ACCEPT = 'application/vnd.github+json';

const githubResponse = async ({ token, url, method = 'GET', body, accept = JSON_ACCEPT }) => {
  const response = await send({
    url,
    init: {
      method,
      headers: {
        accept,
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  });
  if (response.status >= 500) {
    throw Object.assign(skipError(`${GITHUB_UNAVAILABLE} (${response.status})`), { status: response.status });
  }
  if (!response.ok) {
    const path = url.slice(API_URL.length + 1);
    throw Object.assign(new Error(`GitHub ${method} ${path}: ${response.status}`), { status: response.status });
  }
  return response;
};

const githubRequest = async ({ token, path, method, body, accept = JSON_ACCEPT }) => {
  const response = await githubResponse({ token, url: `${API_URL}/${path}`, method, body, accept });
  return accept.endsWith('diff') ? response.text() : response.json();
};

const nextPageUrl = ({ linkHeader, log }) => {
  const next = (linkHeader ?? '')
    .split(',')
    .map((part) => part.match(/<([^>]+)>\s*;\s*rel="next"/))
    .find(Boolean);
  if (!next) return null;
  if (next[1].startsWith(`${API_URL}/`)) return next[1];
  log(`Komentarze PR: pomijam następną stronę spoza ${API_URL}`);
  return null;
};

const listAllPages = async ({ token, path, log }) => {
  const comments = [];
  let url = `${API_URL}/${path}`;
  for (let pageCount = 0; url && pageCount < MAX_COMMENT_PAGES; pageCount += 1) {
    const response = await githubResponse({ token, url });
    comments.push(...(await response.json()));
    url = nextPageUrl({ linkHeader: response.headers.get('link'), log });
  }
  if (url) log(`Komentarze PR: przeczytane tylko pierwsze ${MAX_COMMENT_PAGES} stron, dalszych nie czytam`);
  return comments;
};

export const createGithub = ({ token, repo, prNumber, log }) => {
  const pullPath = `repos/${repo}/pulls/${prNumber}`;
  const commentsPath = `repos/${repo}/issues/${prNumber}/comments`;
  return {
    pullRequest: () => githubRequest({ token, path: pullPath }),
    diff: ({ baseSha, headSha }) =>
      githubRequest({
        token,
        path: `repos/${repo}/compare/${baseSha}...${headSha}`,
        accept: 'application/vnd.github.diff',
      }),
    postReview: ({ commitId, body, comments }) =>
      githubRequest({
        token,
        method: 'POST',
        path: `${pullPath}/reviews`,
        body: { commit_id: commitId, event: 'COMMENT', body, comments },
      }),
    listComments: () => listAllPages({ token, path: `${commentsPath}?per_page=100`, log }),
    postComment: (body) => githubRequest({ token, method: 'POST', path: commentsPath, body: { body } }),
    updateComment: ({ id, body }) =>
      githubRequest({ token, method: 'PATCH', path: `repos/${repo}/issues/comments/${id}`, body: { body } }),
  };
};
