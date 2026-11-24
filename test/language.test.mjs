import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectReviewLanguage } from '../scripts/lib/language.mjs';

const POLISH_RUBRIC = `## CLAUDE.md

# Katalog biblioteki miejskiej: repozytorium aplikacji

To jest **repozytorium aplikacji**, nie dokumentacji. Monorepo pnpm z dwoma pakietami.
Stara reguła, która zabraniała \`package.json\` i lintera w korzeniu, **już nie obowiązuje**.

Notatki, plany i szkice ekranów trzymamy w \`docs/\`, a nie obok kodu.
Kroki ręczne po wdrożeniu zapisujemy w \`docs/kroki/RRRR-MM-DD-<opis>.md\`, nigdy w komentarzach.

## Układ

- \`apps/catalog/web/\`: katalog dla czytelników, pakiet \`catalog-web\` (port 3000)
- \`apps/catalog/api/\`: API katalogu, pakiet \`catalog-api\` (port 3001); moduł wypożyczeń
  \`apps/catalog/api/src/loans/\` jako jedyny korzysta z kolejki i importuje \`QueueModule\`,
  bo \`BooksModule\` działa bez niej.
- \`apps/staff/web/\`: panel bibliotekarza, pakiet \`staff-web\` (port 3002)
- \`packages/shared/\`: stałe wspólne dla obu aplikacji, pakiet \`@library/shared\``;

const ENGLISH_RUBRIC = `## CLAUDE.md

# Fieldnotes: offline note taking for field researchers

The two rules that get broken most, so they open and close this file: **no
comments in code**, and **read \`docs/ui-guidelines.md\` before any UI work
in \`apps/mobile\`**.

## Product Context

A mobile app that lets field researchers take notes, photos and voice memos without a network and syncs them later. Notes sync in the background when a connection returns. Conflicts are shown side by side and the researcher picks one version. Exports go to CSV and Markdown. Every screen must work with one hand.`;

const ENGLISH_RUBRIC_QUOTING_POLISH = `## CLAUDE.md

# bakery-orders

Online orders for a small Polish bakery. Routes, UI copy and user-facing messages are Polish;
match the tone already in the file rather than translating from English.

## Language

Anything a developer reads is English: files, directories, components, variables,
types, props, constants, CSS classes, package scripts, branches, commits.

Anything a user reads is Polish: UI copy, \`alt\` text, metadata values.

The exception, because they are addresses: route directories under \`src/app\`
(\`zamówienie\`, \`dostawa\`, \`płatność\`). A constant's name is English, its value
is not.`;

const POLISH_CODE = `Copy lives in one constant:

\`\`\`ts
export const KOSZYK = { pusty: 'Twój koszyk jest pusty', dodaj: 'Dodaj do koszyka', usuń: 'Usuń z koszyka' };
export const BŁĘDY = { sieć: 'Błąd połączenia, spróbuj ponownie później', płatność: 'Płatność odrzucona' };
\`\`\`

Labels such as \`Zamówienie złożone\`, \`Przejdź do płatności\` and \`Wróć do sklepu\` are tested verbatim.

~~~
Dziękujemy za zamówienie! Wyślemy potwierdzenie na Twój adres e-mail, gdy paczka opuści magazyn.
~~~`;

describe('detectReviewLanguage', () => {
  const cases = [
    { label: 'a Polish rubric', text: POLISH_RUBRIC, language: 'pl' },
    { label: 'an English rubric', text: ENGLISH_RUBRIC, language: 'en' },
    { label: 'an English rubric quoting Polish copy', text: ENGLISH_RUBRIC_QUOTING_POLISH, language: 'en' },
    { label: 'an empty rubric', text: '', language: 'en' },
    { label: 'whitespace and markdown only', text: '## \n\n- `` \n---\n|  |  |\n', language: 'en' },
    { label: 'English prose around Polish code', text: `${ENGLISH_RUBRIC}\n\n${POLISH_CODE}`, language: 'en' },
    { label: 'Polish prose around English code', text: `${POLISH_RUBRIC}\n\n\`\`\`sh\n${ENGLISH_RUBRIC}\n${ENGLISH_RUBRIC}\n\`\`\``, language: 'pl' },
    { label: 'a Polish rubric from the head branch', text: POLISH_RUBRIC, source: 'head', language: 'en' },
  ];
  for (const { label, text, source = 'base', language } of cases) {
    it(`reads ${label} as ${language}`, () => {
      assert.equal(detectReviewLanguage({ text, source }), language);
    });
  }
});
