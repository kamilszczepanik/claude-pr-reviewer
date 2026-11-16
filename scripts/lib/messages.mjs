export const MESSAGES = {
  en: {
    severities: { critical: 'critical', high: 'high', medium: 'medium', low: 'low' },
    severityHeading: (label) => `**Severity: ${label}**`,
    routes: { api: 'API credit', gateway: 'AI gateway' },
    footer: ({ route, model, turns, tokens }) =>
      `Claude review · route: ${route} · model ${model} · turns ${turns} · input tokens ${tokens.input}, output ${tokens.output}`,
    truncationNote: (count) =>
      `**Diff truncated:** Claude did not see the changes in ${count} files and this review does not cover them`,
    droppedOverCap: (count) => `Comments dropped over the limit: ${count}.`,
    skipComment: (reason) =>
      `Claude review skipped: ${reason}.\n\nThis run did not check the PR and left no comments, so do not treat it as a review with no issues. Run the review again or check the changes by hand.`,
    truncationMark: '… (truncated)',
    imagePlaceholder: '(image removed)',
    redacted: '[redacted]',
  },
  pl: {
    severities: { critical: 'krytyczna', high: 'wysoka', medium: 'średnia', low: 'niska' },
    severityHeading: (label) => `**Powaga: ${label}**`,
    routes: { api: 'kredyt API', gateway: 'bramka AI' },
    footer: ({ route, model, turns, tokens }) =>
      `Przegląd Claude · trasa: ${route} · model ${model} · tury ${turns} · tokeny wejścia ${tokens.input}, wyjścia ${tokens.output}`,
    truncationNote: (count) =>
      `**Diff obcięty:** Claude nie widział zmian w ${count} plikach i ten przegląd ich nie obejmuje`,
    droppedOverCap: (count) => `Pominięte uwagi ponad limit: ${count}.`,
    skipComment: (reason) =>
      `Przegląd Claude pominięty: ${reason}.\n\nTen przebieg nie sprawdził PR-a i nie zostawił żadnych uwag, więc nie traktuj go jako przeglądu bez uwag. Uruchom przegląd ponownie albo sprawdź zmiany ręcznie.`,
    truncationMark: '… (ucięte)',
    imagePlaceholder: '(obraz usunięty)',
    redacted: '[ukryte]',
  },
};
