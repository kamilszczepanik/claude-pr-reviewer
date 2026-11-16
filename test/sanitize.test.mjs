import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { capLength, redactSecrets, sanitizeMarkdown } from '../scripts/lib/sanitize.mjs';

const ZWSP = '​';
const API_KEY = 'sk-ant-api03-secretsecretsecret';
const GITHUB_TOKEN = 'ghs_abcdefghijklmnopqrstuvwxyz0123';

describe('sanitizeMarkdown', () => {
  const cases = [
    { label: 'a user mention', text: '@kamil zobacz', expected: `@${ZWSP}kamil zobacz` },
    { label: 'a team mention', text: 'cc (@org/team).', expected: `cc (@${ZWSP}org/team).` },
    { label: 'an e-mail address', text: 'mail a@b.pl', expected: 'mail a@b.pl' },
    { label: 'a mention inside inline code', text: 'pakiet `@types/node`', expected: 'pakiet `@types/node`' },
    { label: 'an inline image', text: '![x](https://evil.test/a.png?d=(1)) ok', expected: '(image removed) ok' },
    {
      label: 'an inline image in Polish',
      text: '![x](https://evil.test/a.png) ok',
      language: 'pl',
      expected: '(obraz usunięty) ok',
    },
    {
      label: 'a reference image and its definition',
      text: '![x][1]\n\n[1]: https://evil.test/a.png',
      expected: '(image removed)\n\n',
    },
    {
      label: 'an html image',
      text: '<img src="https://evil.test/a.png">',
      expected: '&lt;img src="https://evil.test/a.png">',
    },
    { label: 'an html comment', text: '<!-- ukryte --> tekst', expected: '&lt;!-- ukryte --> tekst' },
    { label: 'a comparison', text: 'gdy a < b', expected: 'gdy a < b' },
    { label: 'a disguised link', text: '[kliknij](https://evil.test)', expected: 'kliknij (https://evil.test)' },
    {
      label: 'a fenced code block',
      text: '```html\n<div>@x ![a](b)</div>\n```',
      expected: '```html\n<div>@x ![a](b)</div>\n```',
    },
  ];
  for (const { label, text, language, expected } of cases) {
    it(`neutralises ${label}`, () => {
      assert.equal(sanitizeMarkdown({ text, language }), expected);
    });
  }
});

describe('capLength', () => {
  const cases = [
    { text: 'krótko', maxChars: 20, expected: 'krótko' },
    { text: 'a'.repeat(50), maxChars: 20, expected: `${'a'.repeat(7)}… (truncated)` },
    { text: 'a'.repeat(50), maxChars: 20, language: 'pl', expected: `${'a'.repeat(10)}… (ucięte)` },
  ];
  for (const { text, maxChars, language, expected } of cases) {
    it(`caps ${text.length} chars at ${maxChars} in ${language ?? 'en'}`, () => {
      const capped = capLength({ text, maxChars, language });
      assert.equal(capped, expected);
      assert.ok(capped.length <= maxChars);
    });
  }
});

describe('redactSecrets', () => {
  const secrets = [API_KEY, GITHUB_TOKEN, 'short'];
  const cases = [
    { label: 'the literal key', text: `klucz ${API_KEY}`, expected: 'klucz [redacted]' },
    { label: 'the base64 key', text: `b64 ${Buffer.from(API_KEY).toString('base64')}`, expected: 'b64 [redacted]' },
    { label: 'the base64url token', text: Buffer.from(GITHUB_TOKEN).toString('base64url'), expected: '[redacted]' },
    { label: 'an unknown Anthropic key', text: 'x sk-ant-api03-OTHERkey_123456 y', expected: 'x [redacted] y' },
    { label: 'an unknown GitHub token', text: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWX', expected: '[redacted]' },
    { label: 'a known key in Polish', text: `klucz ${API_KEY}`, language: 'pl', expected: 'klucz [ukryte]' },
    { label: 'a short secret', text: 'short', expected: 'short' },
  ];
  for (const { label, text, language, expected } of cases) {
    it(`hides ${label}`, () => {
      assert.equal(redactSecrets({ text, secrets, language }), expected);
    });
  }
});
