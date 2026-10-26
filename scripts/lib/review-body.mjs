const SEVERITY_LABELS = { critical: 'krytyczna', high: 'wysoka', medium: 'średnia', low: 'niska' };

export const redactSecrets = ({ text, secrets }) =>
  secrets.filter((secret) => secret && secret.length >= 8).reduce((redacted, secret) => redacted.split(secret).join('[ukryte]'), text);

export const toInlineComment = ({ path, line, severity, body }) => ({
  path,
  line,
  side: 'RIGHT',
  body: `**Powaga: ${SEVERITY_LABELS[severity]}**\n\n${body}`,
});

export const buildReviewBody = ({ summary, model, turns, tokens, omittedFiles, droppedOverCap, fallbackComments = [] }) => {
  const notes = [
    omittedFiles.length > 0 ? `Diff obcięty, pominięte pliki: ${omittedFiles.join(', ')}.` : '',
    droppedOverCap > 0 ? `Pominięte uwagi ponad limit: ${droppedOverCap}.` : '',
  ].filter(Boolean);
  const fallback = fallbackComments.map(
    ({ path, line, severity, body }) => `- \`${path}:${line}\` (${SEVERITY_LABELS[severity]}): ${body}`,
  );
  const status = `<sub>Przegląd Claude · model ${model} · tury ${turns} · tokeny wejścia ${tokens.input}, wyjścia ${tokens.output}</sub>`;
  return [summary, ...notes, fallback.join('\n'), status].filter(Boolean).join('\n\n');
};
