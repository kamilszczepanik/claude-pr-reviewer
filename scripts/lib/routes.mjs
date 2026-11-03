import { skipError } from './failure.mjs';

export const ROUTE_LABELS = { api: 'kredyt API', gateway: 'bramka AI' };
export const GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/claude-code';

const MINUTE_MS = 60_000;
const ATTEMPT_TIMEOUT_MS = 15 * MINUTE_MS;
const REVIEW_DEADLINE_MS = 18 * MINUTE_MS;

export const firstRoute = ({ apiKey, gatewayKey }) => {
  if (apiKey) return 'api';
  if (gatewayKey) return 'gateway';
  throw skipError('brak sekretu ANTHROPIC_API_KEY ani AI_GATEWAY_API_KEY');
};

export const routeEnv = ({ route, baseEnv, gatewayKey }) => {
  if (route === 'gateway') {
    return { ...baseEnv, ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: GATEWAY_BASE_URL, ANTHROPIC_AUTH_TOKEN: gatewayKey };
  }
  return baseEnv;
};

const modelFor = ({ route, config }) => (route === 'gateway' ? config.gatewayModel : config.model);

const attemptOn = async ({ route, config, attempt, timeoutMs }) => {
  const model = modelFor({ route, config });
  return { ...(await attempt({ route, model, timeoutMs })), route, model };
};

const gatewayJoinReason = (reason) => `${ROUTE_LABELS.gateway}: ${reason.replace(`${ROUTE_LABELS.gateway} `, '')}`;

const joinedSkip = ({ reason, cause }) =>
  Object.assign(skipError(reason), { failsCheck: cause.failsCheck, skipDetail: cause.skipDetail });

export const runRoutedReview = async ({ route, config, attempt, log, now = Date.now }) => {
  const deadline = now() + REVIEW_DEADLINE_MS;
  try {
    return await attemptOn({ route, config, attempt, timeoutMs: ATTEMPT_TIMEOUT_MS });
  } catch (error) {
    if (route !== 'api' || !error.skipReason || error.fallback !== true) throw error;
    if (!config.gatewayKey) {
      throw joinedSkip({
        reason: `${error.skipReason}; bramka AI nieskonfigurowana (brak sekretu AI_GATEWAY_API_KEY)`,
        cause: error,
      });
    }
    log(`Trasa ${ROUTE_LABELS.api}: ${error.skipReason}; ponawiam przez bramkę AI`);
    try {
      const timeoutMs = Math.min(ATTEMPT_TIMEOUT_MS, Math.max(0, deadline - now()));
      return await attemptOn({ route: 'gateway', config, attempt, timeoutMs });
    } catch (gatewayError) {
      if (!gatewayError.skipReason) throw gatewayError;
      throw joinedSkip({
        reason: `${error.skipReason}; ${gatewayJoinReason(gatewayError.skipReason)}`,
        cause: gatewayError,
      });
    }
  }
};
