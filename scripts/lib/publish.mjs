import { MAX_LOG_CHARS } from './config.mjs';

const UNPROCESSABLE = 422;
const HIDDEN_MESSAGE_ERRORS = new Set(['SyntaxError', 'ZodError']);

export const SKIP_MARKER = '<!-- claude-pr-reviewer:skipped -->';

export const publishReview = async ({ github, attempts }) => {
  for (const [index, attempt] of attempts.entries()) {
    try {
      await github.postReview(attempt);
      return index;
    } catch (error) {
      if (error.status !== UNPROCESSABLE || index === attempts.length - 1) throw error;
    }
  }
  throw new Error('Brak wariantu przeglądu do wysłania');
};

const isOwnSkipComment = (comment) => comment.user?.type === 'Bot' && comment.body?.startsWith(SKIP_MARKER);

const skipLine = ({ reason, detail }) =>
  `Przegląd Claude pominięty: ${reason}${detail ? `; odpowiedź API: ${detail}` : ''}`.slice(0, MAX_LOG_CHARS);

const reportSkip = async ({ github, reason, detail, failsCheck, log }) => {
  log(skipLine({ reason, detail }));
  const body = `${SKIP_MARKER}\nPrzegląd Claude pominięty: ${reason}.\n\nTen przebieg nie sprawdził PR-a i nie zostawił żadnych uwag, więc nie traktuj go jako przeglądu bez uwag. Uruchom przegląd ponownie albo sprawdź zmiany ręcznie.`;
  try {
    const existing = (await github.listComments()).find(isOwnSkipComment);
    if (existing) await github.updateComment({ id: existing.id, body });
    else await github.postComment(body);
  } catch (error) {
    log(
      `Komentarz o pominięciu nie powstał (${error.status ?? error.name}), ${failsCheck ? 'kończę kodem 1' : 'kończę bez błędu'}`,
    );
  }
};

export const failureLine = (error) => {
  const detail = HIDDEN_MESSAGE_ERRORS.has(error.name) ? 'treść ukryta' : String(error.message);
  return `Przegląd Claude nie powiódł się: ${error.name}: ${detail}`.slice(0, MAX_LOG_CHARS);
};

export const settleReview = async ({ run, github, log }) => {
  try {
    await run();
    return 0;
  } catch (error) {
    if (!error.skipReason) {
      log(failureLine(error));
      return 1;
    }
    await reportSkip({ github, reason: error.skipReason, detail: error.skipDetail, failsCheck: error.failsCheck, log });
    return error.failsCheck ? 1 : 0;
  }
};
