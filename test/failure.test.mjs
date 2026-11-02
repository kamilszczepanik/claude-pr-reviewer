import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { apiSkipError } from '../scripts/lib/failure.mjs';

describe('apiSkipError', () => {
  const rejected = (status) => `API Anthropic odrzuciło żądanie (${status})`;
  const longMessage = 'bad\nrequest sk-ant-api03-abcdefghijkl ' + 'x'.repeat(400);
  const cases = [
    {
      failure: { status: 400, message: 'invalid_request_error: prompt is too long' },
      skip: { skipReason: rejected(400), failsCheck: true, skipDetail: 'invalid_request_error: prompt is too long' },
    },
    { failure: { status: 404 }, skip: { skipReason: rejected(404), failsCheck: true, skipDetail: '' } },
    { failure: { status: 413 }, skip: { skipReason: rejected(413), failsCheck: true, skipDetail: '' } },
    { failure: { status: 422 }, skip: { skipReason: rejected(422), failsCheck: true, skipDetail: '' } },
    {
      failure: { status: 400, message: 'Your credit balance is too low' },
      skip: {
        skipReason: 'wyczerpany kredyt API Anthropic',
        failsCheck: false,
        skipDetail: 'Your credit balance is too low',
      },
    },
    {
      failure: { status: 402 },
      skip: { skipReason: 'wyczerpany kredyt API Anthropic', failsCheck: false, skipDetail: '' },
    },
    {
      failure: { status: 429 },
      skip: { skipReason: 'limit zapytań albo wydatków workspace', failsCheck: false, skipDetail: '' },
    },
    { failure: { status: 401 }, skip: { skipReason: 'klucz API odrzucony (401)', failsCheck: false, skipDetail: '' } },
    {
      failure: { status: 529 },
      skip: { skipReason: 'API Anthropic niedostępne (529)', failsCheck: false, skipDetail: '' },
    },
    {
      failure: { message: 'fetch failed: ETIMEDOUT' },
      skip: { skipReason: 'błąd sieci', failsCheck: false, skipDetail: 'fetch failed: ETIMEDOUT' },
    },
    {
      failure: { message: 'API Error: Connection error.' },
      skip: { skipReason: 'błąd sieci', failsCheck: false, skipDetail: 'API Error: Connection error.' },
    },
    { failure: { message: 'Unexpected token in JSON' }, skip: null },
    { failure: { status: null, message: '' }, skip: null },
    {
      failure: { status: 400, message: longMessage },
      skip: {
        skipReason: rejected(400),
        failsCheck: true,
        skipDetail: `bad request [ukryte] ${'x'.repeat(400)}`.slice(0, 300),
      },
    },
  ];
  for (const { failure, skip } of cases) {
    it(`keeps the API text and turns only an unexplained rejection red: ${JSON.stringify(failure).slice(0, 80)}`, () => {
      const error = apiSkipError(failure);
      if (skip === null) {
        assert.equal(error, null);
        return;
      }
      const { skipReason, failsCheck, skipDetail } = error;
      assert.deepEqual({ skipReason, failsCheck, skipDetail }, skip);
      assert.equal(error.message, skip.skipReason);
      assert.ok(!/\s{2}|\n/.test(skipDetail) && !skipDetail.includes('sk-ant-') && skipDetail.length <= 300);
    });
  }
});
