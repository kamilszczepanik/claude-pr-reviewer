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

const githubRequest = async ({ token, path, method = 'GET', body, accept = 'application/vnd.github+json' }) => {
  const response = await send({
    url: `${API_URL}/${path}`,
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
    throw Object.assign(new Error(`GitHub ${method} ${path}: ${response.status}`), { status: response.status });
  }
  return accept.endsWith('diff') ? response.text() : response.json();
};

export const createGithub = ({ token, repo, prNumber }) => {
  const pullPath = `repos/${repo}/pulls/${prNumber}`;
  const commentsPath = `repos/${repo}/issues/${prNumber}/comments`;
  return {
    pullRequest: () => githubRequest({ token, path: pullPath }),
    diff: ({ baseSha, headSha }) =>
      githubRequest({ token, path: `repos/${repo}/compare/${baseSha}...${headSha}`, accept: 'application/vnd.github.diff' }),
    postReview: ({ commitId, body, comments }) =>
      githubRequest({
        token,
        method: 'POST',
        path: `${pullPath}/reviews`,
        body: { commit_id: commitId, event: 'COMMENT', body, comments },
      }),
    listComments: () => githubRequest({ token, path: `${commentsPath}?per_page=100` }),
    postComment: (body) => githubRequest({ token, method: 'POST', path: commentsPath, body: { body } }),
    updateComment: ({ id, body }) =>
      githubRequest({ token, method: 'PATCH', path: `repos/${repo}/issues/comments/${id}`, body: { body } }),
  };
};
