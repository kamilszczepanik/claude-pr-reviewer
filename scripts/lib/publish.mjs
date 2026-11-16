import { MAX_LOG_CHARS } from './config.mjs';
import { apiErrorDetail } from './failure.mjs';
import { MESSAGES } from './messages.mjs';

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
  throw new Error('No review variant left to post');
};

const isOwnSkipComment = (comment) => comment.user?.type === 'Bot' && comment.body?.startsWith(SKIP_MARKER);

const skipLine = ({ reason, detail }) =>
  `Claude review skipped: ${reason}${detail ? `; API response: ${detail}` : ''}`.slice(0, MAX_LOG_CHARS);

const reportSkip = async ({ github, reason, detail, failsCheck, language, log }) => {
  log(skipLine({ reason, detail }));
  const body = `${SKIP_MARKER}\n${MESSAGES[language ?? 'en'].skipComment(reason)}`;
  try {
    const existing = (await github.listComments()).find(isOwnSkipComment);
    if (existing) await github.updateComment({ id: existing.id, body });
    else await github.postComment(body);
  } catch (error) {
    log(
      `Skip comment not created (${error.status ?? error.name}), ${failsCheck ? 'exiting with code 1' : 'exiting without an error'}`,
    );
  }
};

const SECRET_ENV_NAMES = ['ANTHROPIC_API_KEY', 'AI_GATEWAY_API_KEY', 'GH_TOKEN'];

const envSecrets = (env) => SECRET_ENV_NAMES.map((name) => env[name]).filter(Boolean);

const UNREADABLE_THROWN = '<unreadable value>';

const thrownText = (thrown) => {
  try {
    return String(thrown);
  } catch {
    return UNREADABLE_THROWN;
  }
};

const asError = (thrown) => (thrown instanceof Error ? thrown : new Error(thrownText(thrown)));

export const failureLine = ({ error: thrown, secrets }) => {
  const error = asError(thrown);
  const detail = HIDDEN_MESSAGE_ERRORS.has(error.name)
    ? 'content hidden'
    : apiErrorDetail({ text: String(error.message), secrets });
  return `Claude review failed: ${error.name}: ${detail}`.slice(0, MAX_LOG_CHARS);
};

export const withLanguage = async ({ language, run }) => {
  try {
    return await run();
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.language === undefined) error.language = language;
    throw error;
  }
};

export const settleReview = async ({ run, github, log, secrets = [] }) => {
  try {
    await run();
    return 0;
  } catch (error) {
    if (!error?.skipReason) {
      log(failureLine({ error, secrets }));
      return 1;
    }
    await reportSkip({
      github,
      reason: error.skipReason,
      detail: error.skipDetail,
      failsCheck: error.failsCheck,
      language: error.language,
      log,
    });
    return error.failsCheck ? 1 : 0;
  }
};

export const runReviewProcess = async ({ main, env, log }) => {
  try {
    return await main();
  } catch (error) {
    log(failureLine({ error, secrets: envSecrets(env) }));
    return 1;
  }
};
