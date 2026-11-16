const POLISH_LETTERS = /[ąćęłńóśźż]/giu;
const LETTERS = /\p{L}/gu;
const FENCED_CODE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[`~]*[ \t]*$|(?![\s\S]))/gm;
const INLINE_CODE = /(`+)[\s\S]*?\1/g;
const POLISH_SHARE = 0.01;

const proseOf = (text) => text.replace(FENCED_CODE, '').replace(INLINE_CODE, '');

export const detectReviewLanguage = ({ text, source }) => {
  if (source !== 'base') return 'en';
  const prose = proseOf(text);
  const letters = prose.match(LETTERS)?.length ?? 0;
  if (letters === 0) return 'en';
  const polish = prose.match(POLISH_LETTERS)?.length ?? 0;
  return polish / letters >= POLISH_SHARE ? 'pl' : 'en';
};
