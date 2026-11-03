import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { apiSkipError } from '../scripts/lib/failure.mjs';

const REPO_SECRET = 'tajny-klucz-repo-123';

describe('apiSkipError', () => {
  const rejected = (status) => `API Anthropic odrzuciło żądanie (${status})`;
  const longMessage = 'bad\nrequest sk-ant-api03-abcdefghijkl ' + 'x'.repeat(400);
  const cases = [
    {
      failure: { status: 400, message: 'invalid_request_error: prompt is too long' },
      skip: { skipReason: rejected(400), failsCheck: true, fallback: false, skipDetail: 'invalid_request_error: prompt is too long' },
    },
    { failure: { status: 404 }, skip: { skipReason: rejected(404), failsCheck: true, fallback: false, skipDetail: '' } },
    { failure: { status: 413 }, skip: { skipReason: rejected(413), failsCheck: true, fallback: false, skipDetail: '' } },
    { failure: { status: 422 }, skip: { skipReason: rejected(422), failsCheck: true, fallback: false, skipDetail: '' } },
    {
      failure: { status: 400, message: 'Your credit balance is too low' },
      skip: {
        skipReason: 'wyczerpany kredyt API Anthropic',
        failsCheck: false,
        fallback: true,
        skipDetail: 'Your credit balance is too low',
      },
    },
    {
      failure: { status: 402 },
      skip: { skipReason: 'wyczerpany kredyt API Anthropic', failsCheck: false, fallback: true, skipDetail: '' },
    },
    {
      failure: { status: 429 },
      skip: { skipReason: 'limit zapytań albo wydatków workspace', failsCheck: false, fallback: false, skipDetail: '' },
    },
    {
      failure: { status: 401 },
      skip: { skipReason: 'klucz API odrzucony (401)', failsCheck: false, fallback: false, skipDetail: '' },
    },
    {
      failure: { status: 529 },
      skip: { skipReason: 'API Anthropic niedostępne (529)', failsCheck: false, fallback: false, skipDetail: '' },
    },
    {
      failure: { message: 'fetch failed: ETIMEDOUT' },
      skip: { skipReason: 'błąd sieci', failsCheck: false, fallback: false, skipDetail: 'fetch failed: ETIMEDOUT' },
    },
    {
      failure: { message: 'API Error: Connection error.' },
      skip: { skipReason: 'błąd sieci', failsCheck: false, fallback: false, skipDetail: 'API Error: Connection error.' },
    },
    {
      failure: { status: 400, message: `bad key ${REPO_SECRET} here` },
      skip: { skipReason: rejected(400), failsCheck: true, fallback: false, skipDetail: 'bad key [ukryte] here' },
    },
    { failure: { message: 'Unexpected token in JSON' }, skip: null },
    { failure: { status: null, message: '' }, skip: null },
    {
      failure: { status: 400, message: longMessage },
      skip: {
        skipReason: rejected(400),
        failsCheck: true,
        fallback: false,
        skipDetail: `bad request [ukryte] ${'x'.repeat(400)}`.slice(0, 300),
      },
    },
    {
      failure: { status: 400, message: 'You have reached your specified API usage limits. You will regain access on 2026-12-01' },
      skip: {
        skipReason: 'wyczerpany limit użycia API Anthropic',
        failsCheck: false,
        fallback: true,
        skipDetail: 'You have reached your specified API usage limits. You will regain access on 2026-12-01',
      },
    },
    {
      failure: { status: 429, message: 'usage limit reached' },
      skip: {
        skipReason: 'wyczerpany limit użycia API Anthropic',
        failsCheck: false,
        fallback: true,
        skipDetail: 'usage limit reached',
      },
    },
    {
      failure: { route: 'gateway', status: 402, message: 'quota_for_entity_exceeded' },
      skip: {
        skipReason: 'wyczerpany budżet klucza bramki AI',
        failsCheck: false,
        fallback: false,
        skipDetail: 'quota_for_entity_exceeded',
      },
    },
    {
      failure: { route: 'gateway', status: 401 },
      skip: { skipReason: 'klucz bramki AI odrzucony (401)', failsCheck: false, fallback: false, skipDetail: '' },
    },
    {
      failure: { route: 'gateway', status: 400 },
      skip: { skipReason: 'bramka AI odrzuciła żądanie (400)', failsCheck: true, fallback: false, skipDetail: '' },
    },
    {
      failure: { route: 'gateway', status: 503 },
      skip: { skipReason: 'bramka AI niedostępna (503)', failsCheck: false, fallback: false, skipDetail: '' },
    },
  ];
  for (const { failure, skip } of cases) {
    it(`keeps the API text and turns only an unexplained rejection red: ${JSON.stringify(failure).slice(0, 80)}`, () => {
      const error = apiSkipError({ ...failure, secrets: [REPO_SECRET] });
      if (skip === null) {
        assert.equal(error, null);
        return;
      }
      const { skipReason, failsCheck, fallback, skipDetail } = error;
      assert.deepEqual({ skipReason, failsCheck, fallback, skipDetail }, skip);
      assert.equal(error.message, skip.skipReason);
      assert.ok(
        !/\s{2}|\n/.test(skipDetail) &&
          !skipDetail.includes('sk-ant-') &&
          !skipDetail.includes(REPO_SECRET) &&
          skipDetail.length <= 300,
      );
    });
  }
});
