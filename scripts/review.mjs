import { runAgentReview } from './lib/agent.mjs';
import { readConfig } from './lib/config.mjs';
import { rightLinesByPath, truncateDiff } from './lib/diff.mjs';
import { skipError } from './lib/failure.mjs';
import { createGithub } from './lib/github.mjs';
import { buildPrompt, readRubric, SYSTEM_PROMPT } from './lib/prompt.mjs';
import { failureLine, publishReview, settleReview } from './lib/publish.mjs';
import { buildReviewBody, buildShortBody, cleanReview, toInlineComment } from './lib/review-body.mjs';
import { selectComments } from './lib/review-result.mjs';

const DIFF_TOO_LARGE = 406;

const log = (line) => console.log(line);

const fetchDiff = async ({ github, baseSha, headSha }) => {
  try {
    return await github.diff({ baseSha, headSha });
  } catch (error) {
    if (error.status === DIFF_TOO_LARGE) throw skipError('diff za duży dla API GitHuba');
    throw error;
  }
};

const reviewAttempts = ({ headSha, review, bodyInput }) => {
  const inline = review.comments.map(toInlineComment);
  return [
    { commitId: headSha, body: buildReviewBody(bodyInput), comments: inline },
    ...(inline.length > 0
      ? [{ commitId: headSha, body: buildReviewBody({ ...bodyInput, fallbackComments: review.comments }), comments: [] }]
      : []),
    { body: buildShortBody(bodyInput), comments: [] },
  ];
};

const reviewPullRequest = async ({ config, github }) => {
  if (!config.apiKey) throw skipError('brak sekretu ANTHROPIC_API_KEY');
  const pullRequest = await github.pullRequest();
  const headSha = config.headSha ?? pullRequest.head.sha;
  const fullDiff = await fetchDiff({ github, baseSha: pullRequest.base.sha, headSha });
  const { diff, omittedFiles } = truncateDiff({ diff: fullDiff, maxBytes: config.maxDiffBytes });
  const rubric = await readRubric({ repoDir: config.repoDir, baseSha: pullRequest.base.sha });
  log(
    `Przegląd PR #${config.prNumber}: diff ${Buffer.byteLength(diff)} B, pominięte pliki ${omittedFiles.length}, rubryka z ${rubric.source}`,
  );
  const { review, turns, tokens, costUsd, denials } = await runAgentReview({
    model: config.model,
    maxBudgetUsd: config.maxBudgetUsd,
    cwd: config.repoDir,
    systemPrompt: SYSTEM_PROMPT,
    prompt: buildPrompt({
      title: pullRequest.title,
      description: pullRequest.body,
      rubric: rubric.text,
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
  const clean = cleanReview({ review: { summary: review.summary, comments }, secrets: [config.apiKey, config.githubToken] });
  const bodyInput = { summary: clean.summary, model: config.model, turns, tokens, omittedFiles, droppedOverCap };
  const used = await publishReview({ github, attempts: reviewAttempts({ headSha, review: clean, bodyInput }) });
  log(
    `Wynik: ${comments.length} uwag, wariant publikacji ${used}, poza diffem ${droppedOutsideDiff}, tury ${turns}, tokeny ${tokens.input}/${tokens.output}, koszt ${costUsd.toFixed(2)} USD, odmowy narzędzi ${denials}`,
  );
};

const main = async () => {
  const config = await readConfig(process.env);
  const github = createGithub({ token: config.githubToken, repo: config.repo, prNumber: config.prNumber });
  return settleReview({ run: () => reviewPullRequest({ config, github }), github, log });
};

try {
  process.exitCode = await main();
} catch (error) {
  console.error(failureLine(error));
  process.exitCode = 1;
}
