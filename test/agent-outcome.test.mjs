import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { reviewOutcome } from '../scripts/lib/agent-outcome.mjs';

const REPO_SECRET = 'tajny-klucz-repo-123';

describe('reviewOutcome', () => {
  const outcomeOf = (input) => {
    try {
      return { returned: reviewOutcome({ ...input, secrets: [REPO_SECRET] }) };
    } catch ({ message, skipReason, failsCheck, skipDetail }) {
      return { thrown: { message, skipReason, failsCheck, skipDetail } };
    }
  };
  const skipped = (reason) => ({ message: reason, skipReason: reason, failsCheck: undefined, skipDetail: undefined });
  const cases = [
    {
      label: 'the turn limit',
      input: { result: { subtype: 'error_max_turns', is_error: true, errors: [] }, maxBudgetUsd: 2, guardDenials: 0 },
      outcome: { thrown: skipped('wyczerpany limit 20 tur') },
    },
    {
      label: 'the budget',
      input: {
        result: { subtype: 'error_max_budget_usd', is_error: true, errors: [] },
        maxBudgetUsd: 2,
        guardDenials: 0,
      },
      outcome: { thrown: skipped('przekroczony budżet 2 USD') },
    },
    {
      label: 'an unexplained API rejection',
      input: {
        result: {
          subtype: 'success',
          is_error: true,
          api_error_status: 400,
          result: 'API Error: 400 prompt is too long',
        },
        maxBudgetUsd: 2,
        guardDenials: 0,
      },
      outcome: {
        thrown: {
          message: 'API Anthropic odrzuciło żądanie (400)',
          skipReason: 'API Anthropic odrzuciło żądanie (400)',
          failsCheck: true,
          skipDetail: 'API Error: 400 prompt is too long',
        },
      },
    },
    {
      label: 'an execution error',
      input: {
        result: { subtype: 'error_during_execution', is_error: true, errors: [`boom ${REPO_SECRET}`, 'again'] },
        maxBudgetUsd: 2,
        guardDenials: 0,
      },
      outcome: {
        thrown: {
          message: 'Przegląd przerwany: error_during_execution; odpowiedź API: boom [ukryte] again',
          skipReason: undefined,
          failsCheck: undefined,
          skipDetail: undefined,
        },
      },
    },
    {
      label: 'an API error the classifier does not know',
      input: {
        result: { subtype: 'success', is_error: true, api_error_status: null, result: 'Invalid API key\n  · Fix it' },
        maxBudgetUsd: 2,
        guardDenials: 0,
      },
      outcome: {
        thrown: {
          message: 'Przegląd przerwany: success; odpowiedź API: Invalid API key · Fix it',
          skipReason: undefined,
          failsCheck: undefined,
          skipDetail: undefined,
        },
      },
    },
    {
      label: 'a finished review',
      input: {
        result: {
          subtype: 'success',
          is_error: false,
          structured_output: { summary: 'ok', comments: [] },
          num_turns: 3,
          modelUsage: {},
          total_cost_usd: 0.1,
          permission_denials: [],
        },
        maxBudgetUsd: 2,
        guardDenials: 1,
      },
      outcome: {
        returned: {
          review: { summary: 'ok', comments: [] },
          turns: 3,
          tokens: { input: 0, output: 0 },
          costUsd: 0.1,
          denials: 1,
        },
      },
    },
  ];
  for (const { label, input, outcome } of cases) {
    it(`maps the SDK result to a review or a skip: ${label}`, () => {
      assert.deepEqual(outcomeOf(input), outcome);
    });
  }
});
