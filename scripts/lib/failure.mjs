import { MAX_LOG_CHARS } from './config.mjs';
import { redactSecrets } from './sanitize.mjs';

const CREDIT_EXHAUSTED = /credit balance|insufficient.?credit|billing/i;
const NETWORK_FAILURE =
  /connection error|fetch failed|network|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i;

const expected = (reason) => ({ reason, failsCheck: false });

const classifyApiFailure = ({ status = null, message = '' }) => {
  if (status === 402 || (status !== null && status < 500 && CREDIT_EXHAUSTED.test(message))) {
    return expected('wyczerpany kredyt API Anthropic');
  }
  if (status === 429) return expected('limit zapytań albo wydatków workspace');
  if (status === 401 || status === 403) return expected(`klucz API odrzucony (${status})`);
  if (status !== null && status >= 400 && status < 500) {
    return { reason: `API Anthropic odrzuciło żądanie (${status})`, failsCheck: true };
  }
  if (status !== null && status >= 500) return expected(`API Anthropic niedostępne (${status})`);
  if (NETWORK_FAILURE.test(message)) return expected('błąd sieci');
  return null;
};

export const skipError = (reason) => Object.assign(new Error(reason), { skipReason: reason });

const detailOf = (message) =>
  redactSecrets({ text: message, secrets: [] }).replace(/\s+/g, ' ').trim().slice(0, MAX_LOG_CHARS);

export const apiSkipError = ({ status = null, message = '' }) => {
  const failure = classifyApiFailure({ status, message });
  if (!failure) return null;
  return Object.assign(skipError(failure.reason), { skipDetail: detailOf(message), failsCheck: failure.failsCheck });
};
