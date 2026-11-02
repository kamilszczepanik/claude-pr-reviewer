import { skipError } from './failure.mjs';

export const ROUTE_LABELS = { api: 'kredyt API', gateway: 'bramka AI' };
export const GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/claude-code';

export const firstRoute = ({ apiKey, gatewayKey }) => {
  if (apiKey) return 'api';
  if (gatewayKey) return 'gateway';
  throw skipError('brak sekretu ANTHROPIC_API_KEY ani AI_GATEWAY_API_KEY');
};

export const routeEnv = ({ route, baseEnv, gatewayKey }) => {
  if (route === 'gateway') {
    return { ...baseEnv, ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: GATEWAY_BASE_URL, ANTHROPIC_AUTH_TOKEN: gatewayKey };
  }
  const { ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ...apiEnv } = baseEnv;
  return apiEnv;
};

const modelFor = ({ route, config }) => (route === 'gateway' ? config.gatewayModel : config.model);

const attemptOn = async ({ route, config, attempt }) => {
  const model = modelFor({ route, config });
  return { ...(await attempt({ route, model })), route, model };
};

const joinedSkip = ({ reason, cause }) =>
  Object.assign(skipError(reason), { failsCheck: cause.failsCheck, skipDetail: cause.skipDetail });

export const runRoutedReview = async ({ route, config, attempt, log }) => {
  try {
    return await attemptOn({ route, config, attempt });
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
      return await attemptOn({ route: 'gateway', config, attempt });
    } catch (gatewayError) {
      if (!gatewayError.skipReason) throw gatewayError;
      throw joinedSkip({ reason: `${error.skipReason}; bramka AI: ${gatewayError.skipReason}`, cause: gatewayError });
    }
  }
};
