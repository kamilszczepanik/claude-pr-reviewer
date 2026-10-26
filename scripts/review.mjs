import { runAgentReview } from './lib/agent.mjs';
import { readConfig } from './lib/config.mjs';
import { rightLinesByPath, truncateDiff } from './lib/diff.mjs';
import { skipError } from './lib/failure.mjs';
import { createGithub } from './lib/github.mjs';
import { buildPrompt, readRubric, SYSTEM_PROMPT } from './lib/prompt.mjs';
import { buildReviewBody, redactSecrets, toInlineComment } from './lib/review-body.mjs';
import { selectComments } from './lib/review-result.mjs';

const DIFF_TOO_LARGE = 406;
const UNPROCESSABLE = 422;
const MAX_ERROR_LOG_CHARS = 300;

const fetchDiff = async (github) => {
  try {
    return await github.diff();
  } catch (error) {
    if (error.status === DIFF_TOO_LARGE) throw skipError('diff za duży dla API GitHuba');
    throw error;
  }
};

const postReview = async ({ github, commitId, body, comments, fallbackBody }) => {
  try {
    await github.postReview({ commitId, body, comments });
  } catch (error) {
    if (error.status !== UNPROCESSABLE || comments.length === 0) throw error;
    await github.postReview({ commitId, body: fallbackBody, comments: [] });
  }
};

const reviewPullRequest = async ({ config, github }) => {
  if (!config.apiKey) throw skipError('brak sekretu ANTHROPIC_API_KEY');
  const pullRequest = await github.pullRequest();
  const fullDiff = await fetchDiff(github);
  const { diff, omittedFiles } = truncateDiff({ diff: fullDiff, maxBytes: config.maxDiffBytes });
  console.log(`Przegląd PR #${config.prNumber}: diff ${Buffer.byteLength(diff)} B, pominięte pliki ${omittedFiles.length}`);
  const { review, turns, tokens } = await runAgentReview({
    model: config.model,
    cwd: config.repoDir,
    systemPrompt: SYSTEM_PROMPT,
    prompt: buildPrompt({
      title: pullRequest.title,
      description: pullRequest.body,
      rubric: await readRubric(config.repoDir),
      diff,
      omittedFiles,
      maxComments: config.maxComments,
    }),
  });
  const { comments, droppedOutsideDiff, droppedOverCap } = selectComments({
    comments: review.comments,
    validLines: rightLinesByPath(fullDiff),
    maxComments: config.maxComments,
  });
  const clean = (text) => redactSecrets({ text, secrets: [config.apiKey, config.githubToken] });
  const cleanComments = comments.map((comment) => ({ ...comment, body: clean(comment.body) }));
  const bodyInput = { summary: clean(review.summary), model: config.model, turns, tokens, omittedFiles, droppedOverCap };
  await postReview({
    github,
    commitId: config.headSha ?? pullRequest.head.sha,
    body: buildReviewBody(bodyInput),
    comments: cleanComments.map(toInlineComment),
    fallbackBody: buildReviewBody({ ...bodyInput, fallbackComments: cleanComments }),
  });
  console.log(
    `Wynik: ${comments.length} uwag w linii, poza diffem ${droppedOutsideDiff}, tury ${turns}, tokeny ${tokens.input}/${tokens.output}`,
  );
};

const main = async () => {
  const config = await readConfig(process.env);
  const github = createGithub({ token: config.githubToken, repo: config.repo, prNumber: config.prNumber });
  try {
    await reviewPullRequest({ config, github });
  } catch (error) {
    if (!error.skipReason) throw error;
    console.log(`Przegląd Claude pominięty: ${error.skipReason}`);
    await github.postComment(`Przegląd Claude pominięty: ${error.skipReason}`);
  }
};

try {
  await main();
} catch (error) {
  console.error(`Przegląd Claude nie powiódł się: ${String(error.message).slice(0, MAX_ERROR_LOG_CHARS)}`);
  process.exitCode = 1;
}
