const REDACTED = '[ukryte]';
const MIN_SECRET_LENGTH = 8;
const TRUNCATION_MARK = '… (ucięte)';
const IMAGE_PLACEHOLDER = '(obraz usunięty)';
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

export const redactSecrets = ({ text, secrets }) => {
  const variants = secrets
    .filter((secret) => secret && secret.length >= MIN_SECRET_LENGTH)
    .flatMap(secretVariants)
    .sort((left, right) => right.length - left.length);
  const withoutKnown = variants.reduce((redacted, variant) => redacted.split(variant).join(REDACTED), text);
  return TOKEN_PATTERNS.reduce((redacted, pattern) => redacted.replace(pattern, REDACTED), withoutKnown);
};

const sanitizeProse = (prose) =>
  prose
    .replace(INLINE_IMAGE, IMAGE_PLACEHOLDER)
    .replace(REFERENCE_IMAGE, IMAGE_PLACEHOLDER)
    .replace(REFERENCE_DEFINITION, '')
    .replace(INLINE_LINK, '$1 ($2)')
    .replace(HTML_OPENING, '&lt;')
    .replace(MENTION, `$1@${ZERO_WIDTH_SPACE}$2`);

export const sanitizeMarkdown = (text) =>
  text
    .split(CODE_SEGMENT)
    .map((segment, index) => (index % 2 === 1 ? segment : sanitizeProse(segment)))
    .join('');

export const capLength = ({ text, maxChars }) =>
  text.length <= maxChars ? text : `${text.slice(0, maxChars - TRUNCATION_MARK.length)}${TRUNCATION_MARK}`;

export const cleanModelText = ({ text, secrets, maxChars }) =>
  capLength({ text: sanitizeMarkdown(redactSecrets({ text, secrets })), maxChars });
