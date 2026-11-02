import { query } from '@anthropic-ai/claude-agent-sdk';

import { skipError, skipReasonFor } from './failure.mjs';
import { parseReview, REVIEW_JSON_SCHEMA } from './review-result.mjs';
import { createRepoGuard, GUARDED_TOOLS } from './tool-guard.mjs';

const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'];
const MAX_TURNS = 20;
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

const sumTokens = (modelUsage = {}) =>
  Object.values(modelUsage).reduce(
    (total, usage) => ({
      input: total.input + usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens,
      output: total.output + usage.outputTokens,
    }),
    { input: 0, output: 0 },
  );

const failureText = (result) => (result.subtype === 'success' ? result.result : (result.errors ?? []).join(' '));

const timeoutError = () => skipError(`przekroczony czas ${TIMEOUT_MINUTES} min`);

const collectResult = async ({ model, cwd, systemPrompt, prompt, maxBudgetUsd, onDeny }) => {
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
        env: agentEnv(),
      },
    })) {
      if (message.type === 'result') result = message;
    }
  } catch (error) {
    if (abortController.signal.aborted) throw timeoutError();
    if (result) return result;
    const reason = skipReasonFor({ status: error.status ?? null, message: String(error.message ?? '') });
    throw reason ? skipError(reason) : error;
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
  if (result.subtype === 'error_max_turns') throw skipError(`wyczerpany limit ${MAX_TURNS} tur`);
  if (result.subtype === 'error_max_budget_usd') throw skipError(`przekroczony budżet ${request.maxBudgetUsd} USD`);
  if (result.is_error) {
    const reason = skipReasonFor({ status: result.api_error_status ?? null, message: failureText(result) });
    if (reason) throw skipError(reason);
  }
  if (result.subtype !== 'success' || result.is_error) throw new Error(`Przegląd przerwany: ${result.subtype}`);
  return {
    review: parseReview(result.structured_output ?? result.result),
    turns: result.num_turns,
    tokens: sumTokens(result.modelUsage),
    costUsd: result.total_cost_usd ?? 0,
    denials: guardDenials + (result.permission_denials?.length ?? 0),
  };
};
