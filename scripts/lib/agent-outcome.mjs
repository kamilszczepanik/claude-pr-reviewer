import { MAX_TURNS } from './config.mjs';
import { apiErrorDetail, apiSkipError, skipError } from './failure.mjs';
import { parseReview } from './review-result.mjs';

const sumTokens = (modelUsage = {}) =>
  Object.values(modelUsage).reduce(
    (total, usage) => ({
      input: total.input + usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens,
      output: total.output + usage.outputTokens,
    }),
    { input: 0, output: 0 },
  );

const sdkErrorText = (result) => {
  if (result.subtype !== 'success') return (result.errors ?? []).join(' ');
  return result.is_error === true ? (result.result ?? '') : '';
};

const interrupted = ({ subtype, detail }) =>
  new Error(`Przegląd przerwany: ${subtype}${detail ? `; odpowiedź API: ${detail}` : ''}`);

export const reviewOutcome = ({ result, maxBudgetUsd, guardDenials, secrets, route = 'api' }) => {
  if (result.subtype === 'error_max_turns') throw skipError(`wyczerpany limit ${MAX_TURNS} tur`);
  if (result.subtype === 'error_max_budget_usd') throw skipError(`przekroczony budżet ${maxBudgetUsd} USD`);
  const errorText = sdkErrorText(result);
  if (result.is_error) {
    const skip = apiSkipError({ status: result.api_error_status ?? null, message: errorText, secrets, route });
    if (skip) throw skip;
  }
  if (result.subtype !== 'success' || result.is_error) {
    throw interrupted({ subtype: result.subtype, detail: apiErrorDetail({ text: errorText, secrets }) });
  }
  return {
    review: parseReview(result.structured_output ?? result.result),
    turns: result.num_turns,
    tokens: sumTokens(result.modelUsage),
    costUsd: result.total_cost_usd ?? 0,
    denials: guardDenials + (result.permission_denials?.length ?? 0),
  };
};
