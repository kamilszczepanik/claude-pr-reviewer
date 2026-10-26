const CREDIT_EXHAUSTED = /credit balance|insufficient.?credit|billing/i;
const NETWORK_FAILURE =
  /connection error|fetch failed|network|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i;

export const skipReasonFor = ({ status = null, message = "" }) => {
  if (
    status === 402 ||
    (status !== null && status < 500 && CREDIT_EXHAUSTED.test(message))
  ) {
    return "wyczerpany kredyt API Anthropic";
  }
  if (status === 429) return "limit zapytań albo wydatków workspace";
  if (status === 401 || status === 403)
    return `klucz API odrzucony (${status})`;
  if (status !== null && status >= 400 && status < 500)
    return `API Anthropic odrzuciło żądanie (${status})`;
  if (status !== null && status >= 500)
    return `API Anthropic niedostępne (${status})`;
  if (NETWORK_FAILURE.test(message)) return "błąd sieci";
  return null;
};

export const skipError = (reason) =>
  Object.assign(new Error(reason), { skipReason: reason });
