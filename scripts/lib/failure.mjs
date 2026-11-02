import { MAX_LOG_CHARS } from './config.mjs';
import { redactSecrets } from './sanitize.mjs';

const CREDIT_EXHAUSTED = /credit balance|insufficient.?credit|billing/i;
const USAGE_LIMIT = /usage limits?/i;
const GATEWAY_BUDGET = /quota_for_entity_exceeded|quota limit exceeded|budget exceeded/i;
const NETWORK_FAILURE =
  /connection error|fetch failed|network|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i;

const expected = (reason) => ({ reason, failsCheck: false, fallback: false });
const fallsBack = (reason) => ({ reason, failsCheck: false, fallback: true });
const rejected = (reason) => ({ reason, failsCheck: true, fallback: false });

const isClientError = (status) => status !== null && status >= 400 && status < 500;

const classifyApiFailure = ({ status, message }) => {
  if (status === 402 || (status !== null && status < 500 && CREDIT_EXHAUSTED.test(message))) {
    return fallsBack('wyczerpany kredyt API Anthropic');
  }
  if ((status === 400 || status === 429) && USAGE_LIMIT.test(message)) {
    return fallsBack('wyczerpany limit użycia API Anthropic');
  }
  if (status === 429) return expected('limit zapytań albo wydatków workspace');
  if (status === 401 || status === 403) return expected(`klucz API odrzucony (${status})`);
  if (isClientError(status)) return rejected(`API Anthropic odrzuciło żądanie (${status})`);
  if (status !== null && status >= 500) return expected(`API Anthropic niedostępne (${status})`);
  if (NETWORK_FAILURE.test(message)) return expected('błąd sieci');
  return null;
};

const classifyGatewayFailure = ({ status, message }) => {
  if (status === 402 || (status !== null && status < 500 && GATEWAY_BUDGET.test(message))) {
    return expected('wyczerpany budżet klucza bramki AI');
  }
  if (status === 429) return expected('limit zapytań bramki AI');
  if (status === 401 || status === 403) return expected(`klucz bramki AI odrzucony (${status})`);
  if (isClientError(status)) return rejected(`bramka AI odrzuciła żądanie (${status})`);
  if (status !== null && status >= 500) return expected(`bramka AI niedostępna (${status})`);
  if (NETWORK_FAILURE.test(message)) return expected('błąd sieci');
  return null;
};

const CLASSIFIERS = { api: classifyApiFailure, gateway: classifyGatewayFailure };

export const skipError = (reason) => Object.assign(new Error(reason), { skipReason: reason });

export const apiErrorDetail = ({ text, secrets }) =>
  redactSecrets({ text, secrets }).replace(/\s+/g, ' ').trim().slice(0, MAX_LOG_CHARS);

export const apiSkipError = ({ status = null, message = '', secrets, route = 'api' }) => {
  const failure = CLASSIFIERS[route]({ status, message });
  if (!failure) return null;
  return Object.assign(skipError(failure.reason), {
    skipDetail: apiErrorDetail({ text: message, secrets }),
    failsCheck: failure.failsCheck,
    fallback: failure.fallback,
  });
};
