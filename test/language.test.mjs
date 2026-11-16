import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectReviewLanguage } from '../scripts/lib/language.mjs';

const ASYSTENT = `## CLAUDE.md

# Asystent bezpieczeństwa — repozytorium produktu

To jest **repozytorium produktu**, nie dokumentów. Monorepo pnpm + turbo.
Poprzednia reguła zakazująca \`package.json\`, lintera i narzędzi JS **już nie obowiązuje**.

Dokumenty, notatki, plany i makiety żyją w \`~/workspace/projects/docs/\`, nie tutaj.
To samo dotyczy kroków ręcznych po przebiegu: trafiają do
\`~/workspace/projects/docs/asystent/kroki-reczne/RRRR-MM-DD-<slug>.md\`, nigdy do
\`docs/\` w tym repozytorium.

## Układ

- \`landing-page/\` — publiczna strona produktowa, pakiet \`landing-page\` (port 4100)
- \`apps/resident/web/\` — platforma mieszkańca, pakiet \`resident-app\` (4101)
- \`apps/resident/api/\` — API mieszkańca, NestJS, pakiet \`resident-api\` (4110); moduł pism
  \`apps/resident/api/src/letters/\` ma jako jedyny w sprawach \`providers\` i importuje \`SpendModule\`,
  bo \`CasesModule\` jest bez DI.
- \`apps/city-hall/web/\` — panel miasta, pakiet \`city-hall-app\` (4102)
- \`apps/city-hall/api/\` — API miasta, NestJS, pakiet \`city-hall-api\` (4111)`;

const PLATERO = `## CLAUDE.md

# Platero AI — AI Review Auto-Responder

The two rules that get broken most, so they open and close this file: **no
comments in code**, and **read \`docs/design/design-system.md\` before any UI work
in \`apps/web\`**.

## Product Context

AI-powered Google review auto-responder for restaurants. First module of a restaurant growth platform. Generates personalized, on-brand responses to every Google review. Owner approves with one click. Starter $9/mo per location (30 AI drafts a month), Pro $29/mo per location (unlimited drafts, voice learning, Topics, auto-reply). Tiers are mixable within one account.`;

const DG_CARS = `## CLAUDE.md

# dg-cars

Polish car-parts shop. Routes, UI copy and user-facing messages are Polish —
match the tone already in the file rather than translating from English.

## Language

Anything a developer reads is English: files, directories, components, variables,
types, props, constants, CSS classes, package scripts, branches, commits.

Anything a user reads is Polish: UI copy, \`alt\` text, metadata values.

The exception, because they are addresses: route directories under \`src/app\`
(\`koszyk\`, \`dostawa\`, \`sposob-platnosci\`). A constant's name is English, its value
is not.`;

describe('detectReviewLanguage', () => {
  const cases = [
    { label: 'the asystent rubric', text: ASYSTENT, language: 'pl' },
    { label: 'the platero-ai rubric', text: PLATERO, language: 'en' },
    { label: 'the dg-cars rubric quoting Polish copy', text: DG_CARS, language: 'en' },
    { label: 'an empty rubric', text: '', language: 'en' },
    { label: 'whitespace and markdown only', text: '## \n\n- `` \n---\n|  |  |\n', language: 'en' },
  ];
  for (const { label, text, language } of cases) {
    it(`reads ${label} as ${language}`, () => {
      assert.equal(detectReviewLanguage(text), language);
    });
  }
});
