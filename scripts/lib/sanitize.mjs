import { MESSAGES } from './messages.mjs';

const MIN_SECRET_LENGTH = 8;
const ZERO_WIDTH_SPACE = '​';

const TOKEN_PATTERNS = [/sk-ant-[A-Za-z0-9_-]{10,}/g, /gh[pousr]_[A-Za-z0-9]{20,}/g, /github_pat_[A-Za-z0-9_]{20,}/g];
const CODE_SEGMENT = /(```[\s\S]*?```|~~~[\s\S]*?~~~|``[^\n]+?``|`[^`\n]+`)/;
const INLINE_IMAGE = /!\[[^\]\n]*\]\((?:[^()\n]|\([^()\n]*\))*\)/g;
const REFERENCE_IMAGE = /!\[[^\]\n]*\]\[[^\]\n]*\]/g;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]\n]+\]:[ \t]*\S.*$/gm;
const INLINE_LINK = /\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"\n]*")?\)/g;
const HTML_OPENING = /<(?=[A-Za-z!/?])/g;
const MENTION = /(^|[^\w`@/])@([A-Za-z0-9][A-Za-z0-9-]*(?:\/[A-Za-z0-9_.-]+)?)/g;

const secretVariants = (secret) => {
  const base64 = Buffer.from(secret).toString('base64');
  const base64url = Buffer.from(secret).toString('base64url');
  return [secret, base64, base64.replace(/=+$/, ''), base64url];
};

export const redactSecrets = ({ text, secrets, language = 'en' }) => {
  const { redacted: mark } = MESSAGES[language];
  const variants = secrets
    .filter((secret) => secret && secret.length >= MIN_SECRET_LENGTH)
    .flatMap(secretVariants)
    .sort((left, right) => right.length - left.length);
  const withoutKnown = variants.reduce((redacted, variant) => redacted.split(variant).join(mark), text);
  return TOKEN_PATTERNS.reduce((redacted, pattern) => redacted.replace(pattern, mark), withoutKnown);
};

const sanitizeProse = ({ prose, imagePlaceholder }) =>
  prose
    .replace(INLINE_IMAGE, imagePlaceholder)
    .replace(REFERENCE_IMAGE, imagePlaceholder)
    .replace(REFERENCE_DEFINITION, '')
    .replace(INLINE_LINK, '$1 ($2)')
    .replace(HTML_OPENING, '&lt;')
    .replace(MENTION, `$1@${ZERO_WIDTH_SPACE}$2`);

export const sanitizeMarkdown = ({ text, language = 'en' }) =>
  text
    .split(CODE_SEGMENT)
    .map((segment, index) =>
      index % 2 === 1
        ? segment
        : sanitizeProse({ prose: segment, imagePlaceholder: MESSAGES[language].imagePlaceholder }),
    )
    .join('');

export const capLength = ({ text, maxChars, language = 'en' }) => {
  const { truncationMark } = MESSAGES[language];
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - truncationMark.length)}${truncationMark}`;
};

export const cleanModelText = ({ text, secrets, maxChars, language = 'en' }) =>
  capLength({
    text: sanitizeMarkdown({ text: redactSecrets({ text, secrets, language }), language }),
    maxChars,
    language,
  });
