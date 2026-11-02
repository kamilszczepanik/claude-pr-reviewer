import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { apiSkipError } from '../scripts/lib/failure.mjs';
import { firstRoute, routeEnv, runRoutedReview } from '../scripts/lib/routes.mjs';

describe('firstRoute', () => {
  const cases = [
    { keys: { apiKey: 'sk-ant', gatewayKey: null }, route: 'api' },
    { keys: { apiKey: 'sk-ant', gatewayKey: 'vck' }, route: 'api' },
    { keys: { apiKey: null, gatewayKey: 'vck' }, route: 'gateway' },
    { keys: { apiKey: null, gatewayKey: null }, skipReason: 'brak sekretu ANTHROPIC_API_KEY ani AI_GATEWAY_API_KEY' },
  ];
  for (const { keys, route, skipReason } of cases) {
    it(`starts on the API credit and goes straight to the gateway without an API key: ${JSON.stringify(keys)}`, () => {
      if (skipReason) {
        assert.throws(() => firstRoute(keys), { skipReason });
        return;
      }
      assert.equal(firstRoute(keys), route);
    });
  }
});

describe('routeEnv', () => {
  const cases = [
    {
      route: 'gateway',
      baseEnv: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-ant' },
      env: {
        PATH: '/usr/bin',
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_BASE_URL: 'https://ai-gateway.vercel.sh/claude-code',
        ANTHROPIC_AUTH_TOKEN: 'vck',
      },
    },
    {
      route: 'api',
      baseEnv: {
        PATH: '/usr/bin',
        ANTHROPIC_API_KEY: 'sk-ant',
        ANTHROPIC_BASE_URL: 'https://elsewhere.test',
        ANTHROPIC_AUTH_TOKEN: 'stray',
      },
      env: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-ant' },
    },
  ];
  for (const { route, baseEnv, env } of cases) {
    it(`gives the gateway variables to the gateway route only: ${route}`, () => {
      assert.deepEqual(routeEnv({ route, baseEnv, gatewayKey: 'vck' }), env);
    });
  }
});

describe('runRoutedReview', () => {
  const API_MODEL = 'claude-sonnet-5-5';
  const GATEWAY_MODEL = 'anthropic/claude-sonnet-5.5';
  const SWITCH_LOG = 'Trasa kredyt API: wyczerpany kredyt API Anthropic; ponawiam przez bramkę AI';
  const credit = apiSkipError({ status: 400, message: 'Your credit balance is too low', secrets: [] });
  const apiRejected = apiSkipError({ status: 401, secrets: [] });
  const budget = apiSkipError({ route: 'gateway', status: 402, message: 'quota_for_entity_exceeded', secrets: [] });
  const crash = new Error('boom');
  const done = { review: { summary: 'ok', comments: [] }, turns: 2, tokens: { input: 1, output: 1 }, costUsd: 0, denials: 0 };
  const cases = [
    {
      label: 'API success',
      route: 'api',
      outcomes: { api: done },
      calls: [{ route: 'api', model: API_MODEL }],
      returned: { ...done, route: 'api', model: API_MODEL },
      logs: [],
    },
    {
      label: 'API credit, gateway success',
      route: 'api',
      outcomes: { api: credit, gateway: done },
      calls: [
        { route: 'api', model: API_MODEL },
        { route: 'gateway', model: GATEWAY_MODEL },
      ],
      returned: { ...done, route: 'gateway', model: GATEWAY_MODEL },
      logs: [SWITCH_LOG],
    },
    {
      label: 'API credit without a gateway key',
      route: 'api',
      gatewayKey: null,
      outcomes: { api: credit },
      calls: [{ route: 'api', model: API_MODEL }],
      thrown: {
        skipReason: 'wyczerpany kredyt API Anthropic; bramka AI nieskonfigurowana (brak sekretu AI_GATEWAY_API_KEY)',
        failsCheck: false,
        skipDetail: 'Your credit balance is too low',
      },
      logs: [],
    },
    {
      label: 'API key rejected',
      route: 'api',
      outcomes: { api: apiRejected },
      calls: [{ route: 'api', model: API_MODEL }],
      same: apiRejected,
      logs: [],
    },
    {
      label: 'API credit, gateway budget',
      route: 'api',
      outcomes: { api: credit, gateway: budget },
      calls: [
        { route: 'api', model: API_MODEL },
        { route: 'gateway', model: GATEWAY_MODEL },
      ],
      thrown: {
        skipReason: 'wyczerpany kredyt API Anthropic; bramka AI: wyczerpany budżet klucza bramki AI',
        failsCheck: false,
        skipDetail: 'quota_for_entity_exceeded',
      },
      logs: [SWITCH_LOG],
    },
    {
      label: 'API credit, gateway crash',
      route: 'api',
      outcomes: { api: credit, gateway: crash },
      calls: [
        { route: 'api', model: API_MODEL },
        { route: 'gateway', model: GATEWAY_MODEL },
      ],
      same: crash,
      logs: [SWITCH_LOG],
    },
    {
      label: 'gateway first, gateway budget',
      route: 'gateway',
      outcomes: { gateway: budget },
      calls: [{ route: 'gateway', model: GATEWAY_MODEL }],
      same: budget,
      logs: [],
    },
  ];
  for (const { label, route, gatewayKey = 'vck', outcomes, calls, returned, thrown, same, logs } of cases) {
    it(`retries once through the gateway only after an exhausted API credit: ${label}`, async () => {
      const seen = [];
      const lines = [];
      const attempt = async (call) => {
        seen.push(call);
        const outcome = outcomes[call.route];
        if (outcome instanceof Error) throw outcome;
        return outcome;
      };
      const config = { model: API_MODEL, gatewayModel: GATEWAY_MODEL, gatewayKey };
      const run = runRoutedReview({ route, config, attempt, log: (line) => lines.push(line) });
      if (returned) assert.deepEqual(await run, returned);
      if (same) await assert.rejects(run, (error) => error === same);
      if (thrown) {
        await assert.rejects(run, ({ message, skipReason, failsCheck, skipDetail }) => {
          assert.deepEqual({ skipReason, failsCheck, skipDetail }, thrown);
          return message === thrown.skipReason;
        });
      }
      assert.deepEqual(seen, calls);
      assert.deepEqual(lines, logs);
    });
  }
});
