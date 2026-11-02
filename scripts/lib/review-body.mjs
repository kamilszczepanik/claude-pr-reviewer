import { capLength, cleanModelText, sanitizeMarkdown } from './sanitize.mjs';

export const GITHUB_BODY_LIMIT = 65_536;
const MAX_SUMMARY_CHARS = 3_000;
const MAX_COMMENT_CHARS = 4_000;
const MAX_SHORT_SUMMARY_CHARS = 1_000;
const MAX_BODY_CHARS = 60_000;
const MAX_OMITTED_NOTE_CHARS = 5_000;
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

const truncationNote = (omittedFiles) =>
  `**Diff obcięty:** Claude nie widział zmian w ${omittedFiles.length} plikach i ten przegląd ich nie obejmuje`;

const omittedFilesNote = (omittedFiles) =>
  capLength({
    text: sanitizeMarkdown(
      `${truncationNote(omittedFiles)}: ${omittedFiles.map((path) => JSON.stringify(path)).join(', ')}.`,
    ),
    maxChars: MAX_OMITTED_NOTE_CHARS,
  });

export const buildReviewBody = ({
  summary,
  model,
  turns,
  tokens,
  omittedFiles,
  droppedOverCap,
  fallbackComments = [],
}) => {
  const truncation = omittedFiles.length > 0 ? omittedFilesNote(omittedFiles) : '';
  const dropped = droppedOverCap > 0 ? `Pominięte uwagi ponad limit: ${droppedOverCap}.` : '';
  const fallback = fallbackComments.map(
    ({ path, line, severity, body }) => `- \`${path}:${line}\` (${SEVERITY_LABELS[severity]}): ${body}`,
  );
  const content = [truncation, summary, dropped, fallback.join('\n')].filter(Boolean).join('\n\n');
  return `${capLength({ text: content, maxChars: MAX_BODY_CHARS })}\n\n${statusLine({ model, turns, tokens })}`;
};

export const buildShortBody = ({ summary, model, turns, tokens, omittedFiles }) => {
  const truncation = omittedFiles.length > 0 ? `${truncationNote(omittedFiles)}.\n\n` : '';
  return `${truncation}${capLength({ text: summary, maxChars: MAX_SHORT_SUMMARY_CHARS })}\n\n${statusLine({ model, turns, tokens })}`;
};
