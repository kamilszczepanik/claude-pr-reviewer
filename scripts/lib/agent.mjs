import { query } from '@anthropic-ai/claude-agent-sdk';

import { reviewOutcome } from './agent-outcome.mjs';
import { MAX_TURNS } from './config.mjs';
import { apiSkipError, skipError } from './failure.mjs';
import { REVIEW_JSON_SCHEMA } from './review-result.mjs';
import { routeEnv } from './routes.mjs';
import { createRepoGuard, GUARDED_TOOLS } from './tool-guard.mjs';

const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'];
const TIMEOUT_MINUTES = 15;
const PASSED_ENV = [
  'ANTHROPIC_API_KEY',
  'PATH',
  'HOME',
  'USER',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
];

const agentEnv = () =>
  Object.fromEntries(
    PASSED_ENV.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]),
  );

const timeoutError = () => skipError(`przekroczony czas ${TIMEOUT_MINUTES} min`);

const collectResult = async ({ model, route, gatewayKey, cwd, systemPrompt, prompt, maxBudgetUsd, secrets, onDeny }) => {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), TIMEOUT_MINUTES * 60_000);
  let result = null;
  try {
    for await (const message of query({
      prompt,
      options: {
        model,
        effort: 'medium',
        cwd,
        tools: READ_ONLY_TOOLS,
        allowedTools: READ_ONLY_TOOLS,
        permissionMode: 'dontAsk',
        maxTurns: MAX_TURNS,
        maxBudgetUsd,
        abortController,
        settingSources: [],
        systemPrompt,
        outputFormat: { type: 'json_schema', schema: REVIEW_JSON_SCHEMA },
        hooks: { PreToolUse: [{ matcher: GUARDED_TOOLS, hooks: [createRepoGuard({ root: cwd, onDeny })] }] },
        env: routeEnv({ route, baseEnv: agentEnv(), gatewayKey }),
      },
    })) {
      if (message.type === 'result') result = message;
    }
  } catch (error) {
    if (abortController.signal.aborted) throw timeoutError();
    if (result) return result;
    throw (
      apiSkipError({ status: error.status ?? null, message: String(error.message ?? ''), secrets, route }) ?? error
    );
  } finally {
    clearTimeout(timer);
  }
  if (!result && abortController.signal.aborted) throw timeoutError();
  if (!result) throw new Error('Agent SDK nie zwrócił wyniku');
  return result;
};

export const runAgentReview = async (request) => {
  let guardDenials = 0;
  const result = await collectResult({ ...request, onDeny: () => (guardDenials += 1) });
  return reviewOutcome({
    result,
    maxBudgetUsd: request.maxBudgetUsd,
    guardDenials,
    secrets: request.secrets,
    route: request.route,
  });
};
