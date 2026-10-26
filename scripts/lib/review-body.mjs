import { capLength, cleanModelText } from './sanitize.mjs';

export const GITHUB_BODY_LIMIT = 65_536;
const MAX_SUMMARY_CHARS = 3_000;
const MAX_COMMENT_CHARS = 4_000;
const MAX_SHORT_SUMMARY_CHARS = 1_000;
const MAX_BODY_CHARS = 60_000;
const SEVERITY_LABELS = { critical: 'krytyczna', high: 'wysoka', medium: 'średnia', low: 'niska' };

export const cleanReview = ({ review, secrets }) => ({
  summary: cleanModelText({ text: review.summary, secrets, maxChars: MAX_SUMMARY_CHARS }),
  comments: review.comments.map((comment) => ({
    ...comment,
    body: cleanModelText({ text: comment.body, secrets, maxChars: MAX_COMMENT_CHARS }),
  })),
});

export const toInlineComment = ({ path, line, severity, body }) => ({
  path,
  line,
  side: 'RIGHT',
  body: `**Powaga: ${SEVERITY_LABELS[severity]}**\n\n${body}`,
});

const statusLine = ({ model, turns, tokens }) =>
  `<sub>Przegląd Claude · model ${model} · tury ${turns} · tokeny wejścia ${tokens.input}, wyjścia ${tokens.output}</sub>`;

export const buildReviewBody = ({
  summary,
  model,
  turns,
  tokens,
  omittedFiles,
  droppedOverCap,
  fallbackComments = [],
}) => {
  const notes = [
    omittedFiles.length > 0 ? `Diff obcięty, pominięte pliki: ${omittedFiles.join(', ')}.` : '',
    droppedOverCap > 0 ? `Pominięte uwagi ponad limit: ${droppedOverCap}.` : '',
  ].filter(Boolean);
  const fallback = fallbackComments.map(
    ({ path, line, severity, body }) => `- \`${path}:${line}\` (${SEVERITY_LABELS[severity]}): ${body}`,
  );
  const content = [summary, ...notes, fallback.join('\n')].filter(Boolean).join('\n\n');
  return `${capLength({ text: content, maxChars: MAX_BODY_CHARS })}\n\n${statusLine({ model, turns, tokens })}`;
};

export const buildShortBody = ({ summary, model, turns, tokens }) =>
  `${capLength({ text: summary, maxChars: MAX_SHORT_SUMMARY_CHARS })}\n\n${statusLine({ model, turns, tokens })}`;
