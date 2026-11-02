import { runAgentReview } from './lib/agent.mjs';
import { readConfig } from './lib/config.mjs';
import { rightLinesByPath, truncateDiff } from './lib/diff.mjs';
import { skipError } from './lib/failure.mjs';
import { createGithub } from './lib/github.mjs';
import { buildPrompt, readRubric, SYSTEM_PROMPT } from './lib/prompt.mjs';
import { failureLine, publishReview, settleReview } from './lib/publish.mjs';
import { buildReviewBody, buildShortBody, cleanReview, toInlineComment } from './lib/review-body.mjs';
import { selectComments } from './lib/review-result.mjs';
import { firstRoute, ROUTE_LABELS, runRoutedReview } from './lib/routes.mjs';

const DIFF_TOO_LARGE = 406;

const log = (line) => console.log(line);

const costLine = ({ route, costUsd }) =>
  route === 'gateway' && costUsd === 0 ? 'koszt nieznany' : `koszt ${costUsd.toFixed(2)} USD`;

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
      ? [
          {
            commitId: headSha,
            body: buildReviewBody({ ...bodyInput, fallbackComments: review.comments }),
            comments: [],
          },
        ]
      : []),
    { body: buildShortBody(bodyInput), comments: [] },
  ];
};

const reviewPullRequest = async ({ config, github }) => {
  const route = firstRoute(config);
  const pullRequest = await github.pullRequest();
  const headSha = config.headSha ?? pullRequest.head.sha;
  const fullDiff = await fetchDiff({ github, baseSha: pullRequest.base.sha, headSha });
  const { diff, omittedFiles } = truncateDiff({ diff: fullDiff, maxBytes: config.maxDiffBytes });
  const secrets = [config.apiKey, config.gatewayKey, config.githubToken].filter(Boolean);
  const rubric = await readRubric({ repoDir: config.repoDir, baseSha: pullRequest.base.sha });
  log(
    `Przegląd PR #${config.prNumber}: diff ${Buffer.byteLength(diff)} B, pominięte pliki ${omittedFiles.length}, rubryka z ${rubric.source}`,
  );
  const prompt = buildPrompt({
    title: pullRequest.title,
    description: pullRequest.body,
    rubric: rubric.text,
    diff,
    omittedFiles,
    maxComments: config.maxComments,
  });
  const outcome = await runRoutedReview({
    route,
    config,
    log,
    attempt: ({ route: used, model }) =>
      runAgentReview({
        model,
        route: used,
        gatewayKey: config.gatewayKey,
        maxBudgetUsd: config.maxBudgetUsd,
        secrets,
        cwd: config.repoDir,
        systemPrompt: SYSTEM_PROMPT,
        prompt,
      }),
  });
  const { review, turns, tokens, costUsd, denials, model } = outcome;
  const { comments, droppedOutsideDiff, droppedOverCap } = selectComments({
    comments: review.comments,
    validLines: rightLinesByPath(fullDiff),
    maxComments: config.maxComments,
  });
  const clean = cleanReview({
    review: { summary: review.summary, comments },
    secrets,
  });
  const bodyInput = {
    summary: clean.summary,
    route: outcome.route,
    model,
    turns,
    tokens,
    omittedFiles,
    droppedOverCap,
  };
  const used = await publishReview({ github, attempts: reviewAttempts({ headSha, review: clean, bodyInput }) });
  log(
    `Wynik: ${comments.length} uwag, wariant publikacji ${used}, poza diffem ${droppedOutsideDiff}, trasa ${ROUTE_LABELS[outcome.route]}, model ${model}, tury ${turns}, tokeny ${tokens.input}/${tokens.output}, ${costLine({ route: outcome.route, costUsd })}, odmowy narzędzi ${denials}`,
  );
};

const main = async () => {
  const config = await readConfig(process.env);
  const github = createGithub({ token: config.githubToken, repo: config.repo, prNumber: config.prNumber, log });
  return settleReview({ run: () => reviewPullRequest({ config, github }), github, log });
};

try {
  process.exitCode = await main();
} catch (error) {
  console.error(failureLine(error));
  process.exitCode = 1;
}
