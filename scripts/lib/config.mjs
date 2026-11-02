import { readFile } from 'node:fs/promises';

const DEFAULT_MODEL = 'claude-sonnet-5-5';
const DEFAULT_MAX_COMMENTS = 15;
const DEFAULT_MAX_DIFF_BYTES = 150_000;
const DEFAULT_MAX_BUDGET_USD = 2;

export const MAX_TURNS = 20;

const positiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const readEvent = async (eventPath) => (eventPath ? JSON.parse(await readFile(eventPath, 'utf8')) : {});

export const readConfig = async (env) => {
  const event = await readEvent(env.GITHUB_EVENT_PATH);
  const prNumber = event.pull_request?.number ?? positiveInt(env.PR_NUMBER, null);
  if (!prNumber) throw new Error('Brak numeru PR: ani zdarzenie pull_request, ani wejście pr-number');
  if (!env.GITHUB_REPOSITORY || !env.GH_TOKEN) throw new Error('Brak GITHUB_REPOSITORY albo GH_TOKEN');
  return {
    repo: env.GITHUB_REPOSITORY,
    prNumber,
    headSha: env.HEAD_SHA || event.pull_request?.head?.sha || null,
    model: env.REVIEW_MODEL || DEFAULT_MODEL,
    maxComments: positiveInt(env.MAX_COMMENTS, DEFAULT_MAX_COMMENTS),
    maxDiffBytes: positiveInt(env.MAX_DIFF_BYTES, DEFAULT_MAX_DIFF_BYTES),
    maxBudgetUsd: positiveNumber(env.MAX_BUDGET_USD, DEFAULT_MAX_BUDGET_USD),
    repoDir: env.REPO_DIR || process.cwd(),
    githubToken: env.GH_TOKEN,
    apiKey: env.ANTHROPIC_API_KEY || null,
  };
};
