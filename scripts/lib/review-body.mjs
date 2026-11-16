import { MESSAGES } from './messages.mjs';
import { capLength, cleanModelText, sanitizeMarkdown } from './sanitize.mjs';

export const GITHUB_BODY_LIMIT = 65_536;
const MAX_SUMMARY_CHARS = 3_000;
const MAX_COMMENT_CHARS = 4_000;
const MAX_SHORT_SUMMARY_CHARS = 1_000;
const MAX_BODY_CHARS = 60_000;
const MAX_OMITTED_NOTE_CHARS = 5_000;

export const cleanReview = ({ review, secrets, language = 'en' }) => ({
  summary: cleanModelText({ text: review.summary, secrets, maxChars: MAX_SUMMARY_CHARS, language }),
  comments: review.comments.map((comment) => ({
    ...comment,
    body: cleanModelText({ text: comment.body, secrets, maxChars: MAX_COMMENT_CHARS, language }),
  })),
});

export const toInlineComment = ({ path, line, severity, body, language = 'en' }) => {
  const messages = MESSAGES[language];
  return {
    path,
    line,
    side: 'RIGHT',
    body: `${messages.severityHeading(messages.severities[severity])}\n\n${body}`,
  };
};

const statusLine = ({ route, model, turns, tokens, language }) => {
  const messages = MESSAGES[language];
  return `<sub>${messages.footer({ route: messages.routes[route], model, turns, tokens })}</sub>`;
};

const omittedFilesNote = ({ omittedFiles, language }) =>
  capLength({
    text: sanitizeMarkdown({
      text: `${MESSAGES[language].truncationNote(omittedFiles.length)}: ${omittedFiles.map((path) => JSON.stringify(path)).join(', ')}.`,
      language,
    }),
    maxChars: MAX_OMITTED_NOTE_CHARS,
    language,
  });

export const buildReviewBody = ({
  summary,
  route,
  model,
  turns,
  tokens,
  omittedFiles,
  droppedOverCap,
  fallbackComments = [],
  language = 'en',
}) => {
  const messages = MESSAGES[language];
  const truncation = omittedFiles.length > 0 ? omittedFilesNote({ omittedFiles, language }) : '';
  const dropped = droppedOverCap > 0 ? messages.droppedOverCap(droppedOverCap) : '';
  const fallback = fallbackComments.map(({ path, line, severity, body }) =>
    sanitizeMarkdown({
      text: `- ${JSON.stringify(path)}:${line} (${messages.severities[severity]}): ${body}`,
      language,
    }),
  );
  const content = [truncation, summary, dropped, fallback.join('\n')].filter(Boolean).join('\n\n');
  return `${capLength({ text: content, maxChars: MAX_BODY_CHARS, language })}\n\n${statusLine({ route, model, turns, tokens, language })}`;
};

export const buildShortBody = ({ summary, route, model, turns, tokens, omittedFiles, language = 'en' }) => {
  const truncation = omittedFiles.length > 0 ? `${MESSAGES[language].truncationNote(omittedFiles.length)}.\n\n` : '';
  return `${truncation}${capLength({ text: summary, maxChars: MAX_SHORT_SUMMARY_CHARS, language })}\n\n${statusLine({ route, model, turns, tokens, language })}`;
};
