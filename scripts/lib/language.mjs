const POLISH_LETTERS = /[ąćęłńóśźż]/giu;
const LETTERS = /\p{L}/gu;
const POLISH_SHARE = 0.01;

export const detectReviewLanguage = (rubricText) => {
  const letters = rubricText.match(LETTERS)?.length ?? 0;
  if (letters === 0) return 'en';
  const polish = rubricText.match(POLISH_LETTERS)?.length ?? 0;
  return polish / letters >= POLISH_SHARE ? 'pl' : 'en';
};
