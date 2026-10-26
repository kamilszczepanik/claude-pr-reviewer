const UNPROCESSABLE = 422;
const MAX_LOG_CHARS = 300;
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

const reportSkip = async ({ github, reason, log }) => {
  log(`Przegląd Claude pominięty: ${reason}`);
  const body = `${SKIP_MARKER}\nPrzegląd Claude pominięty: ${reason}`;
  try {
    const existing = (await github.listComments()).find(isOwnSkipComment);
    if (existing) await github.updateComment({ id: existing.id, body });
    else await github.postComment(body);
  } catch (error) {
    log(`Komentarz o pominięciu nie powstał (${error.status ?? error.name}), kończę bez błędu`);
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
    await reportSkip({ github, reason: error.skipReason, log });
    return 0;
  }
};
