import { MAX_TURNS } from './config.mjs';
import { apiSkipError, skipError } from './failure.mjs';
import { parseReview } from './review-result.mjs';

const sumTokens = (modelUsage = {}) =>
  Object.values(modelUsage).reduce(
    (total, usage) => ({
      input: total.input + usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens,
      output: total.output + usage.outputTokens,
    }),
    { input: 0, output: 0 },
  );

const failureText = (result) => (result.subtype === 'success' ? result.result : (result.errors ?? []).join(' '));

export const reviewOutcome = ({ result, maxBudgetUsd, guardDenials }) => {
  if (result.subtype === 'error_max_turns') throw skipError(`wyczerpany limit ${MAX_TURNS} tur`);
  if (result.subtype === 'error_max_budget_usd') throw skipError(`przekroczony budżet ${maxBudgetUsd} USD`);
  if (result.is_error) {
    const skip = apiSkipError({ status: result.api_error_status ?? null, message: failureText(result) });
    if (skip) throw skip;
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
