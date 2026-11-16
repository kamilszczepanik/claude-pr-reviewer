const POLISH_LETTERS = /[\u0105\u0107\u0119\u0142\u0144\u00f3\u015b\u017a\u017c]/giu;
const LETTERS = /\p{L}/gu;
const POLISH_SHARE = 0.01;

export const detectReviewLanguage = (rubricText) => {
  const letters = rubricText.match(LETTERS)?.length ?? 0;
  if (letters === 0) return 'en';
  const polish = rubricText.match(POLISH_LETTERS)?.length ?? 0;
  return polish / letters >= POLISH_SHARE ? 'pl' : 'en';
};
