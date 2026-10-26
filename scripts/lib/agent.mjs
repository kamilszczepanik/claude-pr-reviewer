import { query } from '@anthropic-ai/claude-agent-sdk';

import { skipError, skipReasonFor } from './failure.mjs';
import { parseReview, REVIEW_JSON_SCHEMA } from './review-result.mjs';

const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'];
const MAX_TURNS = 40;
const WITHHELD_ENV = new Set(['GH_TOKEN', 'GITHUB_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN']);

const agentEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([name, value]) => value !== undefined && !WITHHELD_ENV.has(name)),
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

const collectResult = async ({ model, cwd, systemPrompt, prompt }) => {
  let result = null;
  try {
    for await (const message of query({
      prompt,
      options: {
        model,
        effort: 'high',
        cwd,
        tools: READ_ONLY_TOOLS,
        permissionMode: 'dontAsk',
        maxTurns: MAX_TURNS,
        settingSources: [],
        systemPrompt,
        outputFormat: { type: 'json_schema', schema: REVIEW_JSON_SCHEMA },
        env: agentEnv(),
      },
    })) {
      if (message.type === 'result') result = message;
    }
  } catch (error) {
    if (result) return result;
    const reason = skipReasonFor({ status: error.status ?? null, message: String(error.message ?? '') });
    throw reason ? skipError(reason) : error;
  }
  if (!result) throw new Error('Agent SDK nie zwrócił wyniku');
  return result;
};

export const runAgentReview = async (request) => {
  const result = await collectResult(request);
  if (result.is_error) {
    const reason = skipReasonFor({ status: result.api_error_status ?? null, message: failureText(result) });
    if (reason) throw skipError(reason);
  }
  if (result.subtype === 'error_max_turns') throw skipError(`wyczerpany limit ${MAX_TURNS} tur`);
  if (result.subtype !== 'success' || result.is_error) throw new Error(`Przegląd przerwany: ${result.subtype}`);
  return {
    review: parseReview(result.structured_output ?? result.result),
    turns: result.num_turns,
    tokens: sumTokens(result.modelUsage),
  };
};
