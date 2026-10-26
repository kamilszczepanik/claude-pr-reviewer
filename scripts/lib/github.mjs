const API_URL = process.env.GITHUB_API_URL ?? 'https://api.github.com';

const githubRequest = async ({ token, path, method = 'GET', body, accept = 'application/vnd.github+json' }) => {
  const response = await fetch(`${API_URL}/${path}`, {
    method,
    headers: {
      accept,
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw Object.assign(new Error(`GitHub ${method} ${path}: ${response.status}`), { status: response.status });
  }
  return accept.endsWith('diff') ? response.text() : response.json();
};

export const createGithub = ({ token, repo, prNumber }) => {
  const pullPath = `repos/${repo}/pulls/${prNumber}`;
  return {
    pullRequest: () => githubRequest({ token, path: pullPath }),
    diff: () => githubRequest({ token, path: pullPath, accept: 'application/vnd.github.diff' }),
    postReview: ({ commitId, body, comments }) =>
      githubRequest({
        token,
        method: 'POST',
        path: `${pullPath}/reviews`,
        body: { commit_id: commitId, event: 'COMMENT', body, comments },
      }),
    postComment: (body) =>
      githubRequest({ token, method: 'POST', path: `repos/${repo}/issues/${prNumber}/comments`, body: { body } }),
  };
};
