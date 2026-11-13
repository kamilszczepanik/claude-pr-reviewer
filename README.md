# claude-pr-reviewer

A pull request reviewer powered by Claude. It runs in GitHub Actions on the
[Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk), reads the diff and the surrounding code, and
posts one review with inline comments and a short summary.

- **What it does:** one review per pull request, when it opens or leaves draft. Comments only, never approves or
  blocks a merge.
- **Cost:** about $0.10 to $0.50 per review on Claude Sonnet (usually $0.30 to $0.50, measured over seven reviews),
  with a hard cap per run (`max-budget-usd`, default $2).
- **Fallback:** when the Anthropic API credit or usage limit runs out, the review retries once through
  [Vercel AI Gateway](https://vercel.com/ai-gateway) and says which route it took.
- **Safety:** the model can only read the checked-out repository, secrets never reach the model or the published
  text, and every `uses:` is pinned to a full commit SHA.

## Quick start

1. Add an `ANTHROPIC_API_KEY` secret to your repository (optionally also `AI_GATEWAY_API_KEY` for the fallback).
2. Add `.github/workflows/claude-review.yml`:

```yaml
name: Claude review

on:
  pull_request:
    types: [opened, ready_for_review]
  workflow_dispatch:
    inputs:
      pr-number:
        description: PR number to review again
        required: true
        type: string

permissions:
  contents: read

concurrency:
  group: claude-review-${{ github.event.pull_request.number || inputs.pr-number }}
  cancel-in-progress: false

jobs:
  review:
    if: github.event_name == 'workflow_dispatch' || (!github.event.pull_request.draft && github.event.pull_request.head.repo.full_name == github.repository)
    permissions:
      contents: read
      pull-requests: write
    uses: kamilszczepanik/claude-pr-reviewer/.github/workflows/review.yml@2d24e5d68433b0e014ee1c7ade9207acb8bc587e
    with:
      pr-number: ${{ inputs.pr-number }}
    secrets:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      AI_GATEWAY_API_KEY: ${{ secrets.AI_GATEWAY_API_KEY }}
```

Only the review job gets `pull-requests: write`; the workflow level stays at `contents: read`. The `if` skips drafts
(the review comes on "Ready for review") and pull requests from forks, which do not receive secrets.

For a deeper review, pass `model: claude-opus-5-5` under `with:`.

## Pinning

Callers pin a full commit SHA, not a tag: the job receives an API key and a token with `pull-requests: write`, so the
code behind the pin must not change without a visible change in the caller. Add the `github-actions` ecosystem to the
caller's `dependabot.yml` to get a pull request for each new release.

| Version  | SHA                                        |
| -------- | ------------------------------------------ |
| `v1.4.1` | `2d24e5d68433b0e014ee1c7ade9207acb8bc587e` |
| `v1.4.0` | `1313a005734da1b79cea63a5001594c74efb94d7` |
| `v1.3.0` | `725b78491692931764120191d62166f253e470a6` |
| `v1.2.0` | `ba77aed05eb571e266c481bc044291f0ad0bfd14` |
| `v1.1.1` | `794dfb62ff44b703a756b854a39de03e369caa44` |
| `v1.1.0` | `9ad909a21e759e6ae14e607beafb2d2297c1ac1a` |

## Inputs

All inputs of the reusable workflow (`workflow_call`) are optional:

| Input            | Type   | Default                       | Meaning                                                              |
| ---------------- | ------ | ----------------------------- | -------------------------------------------------------------------- |
| `model`          | string | `claude-sonnet-5-5`           | Claude model id                                                      |
| `max-comments`   | number | 15                            | maximum inline comments; the rest are counted in the summary         |
| `max-diff-bytes` | number | 150000                        | diff size sent to the model, cut at file boundaries, smallest first  |
| `max-budget-usd` | number | 2                             | hard cost cap of one review; above it the review is skipped          |
| `pr-number`      | string | empty                         | pull request number for a manual rerun; digits only                  |
| `gateway-model`  | string | `anthropic/claude-sonnet-5.5` | model id on the AI Gateway route                                     |

Secrets: `ANTHROPIC_API_KEY` and `AI_GATEWAY_API_KEY`, both optional, passed explicitly (not `secrets: inherit`).
With neither, the review is skipped with a comment and no red check.

## How it works

- `.github/workflows/review.yml` resolves the pull request, checks out its head with `persist-credentials: false`
  and calls the action in this repository, pinned to the commit that holds the release code.
- `scripts/review.mjs` fetches the diff for the same head SHA, so line numbers match the files the model reads. A
  large lockfile or fixture cannot push code changes out of the budget: files are added smallest first, and the review
  lists the files it did not cover.
- The rubric is `CLAUDE.md` and `AGENTS.md` from the base commit, so a pull request cannot weaken the rules that
  judge it.
- The Agent SDK runs with `Read`, `Grep` and `Glob` only, no settings from disk (hooks in the pull request do not
  run), a turn limit, a time limit and the budget cap. A `PreToolUse` hook rejects any path outside the repository,
  including through symlinks. The result is JSON validated against a schema.
- Before publishing, the text is cleaned: secrets and anything shaped like an Anthropic key or GitHub token are
  redacted, `@mentions` are disarmed, images and HTML are removed, and lengths are capped. Comments outside the diff
  are dropped. If GitHub rejects inline comments, the review falls back to a summary with the comments in the body.
- Expected failures (exhausted credit, rate limits, rejected key, API outage, timeout, budget) post a "review
  skipped" comment and exit 0. Unexplained API errors and bugs exit 1.

## Fallback route: Vercel AI Gateway

When the Anthropic API answers with exhausted credit (402) or an exhausted usage limit, the reviewer reruns the whole
review once through Vercel AI Gateway (`ANTHROPIC_BASE_URL=https://ai-gateway.vercel.sh/claude-code`). Without
`ANTHROPIC_API_KEY` but with a gateway key, it goes straight to the gateway. The cost is the same on both routes,
since both bill the same tokens of the same model at list price, and the review's status line names the route.

## Manual rerun

Actions, then "Claude review", then Run workflow with the PR number, or:

```sh
gh workflow run claude-review.yml --repo <owner>/<repo> -f pr-number=<n>
```

Each run is a new paid review. `workflow_dispatch` works only once the caller workflow is on the default branch.

## Releases

Each release gets a fixed tag `v1.x.y`; tags are never moved. A breaking change to inputs, secrets or permissions
is `v2`. A release pull request ends with three commits:

1. Code plus `version` in `package.json` and `package-lock.json`. This commit is the action SHA.
2. `.github/workflows/review.yml` calls `kamilszczepanik/claude-pr-reviewer@<action SHA> # v1.x.y`. This commit is
   the release SHA.
3. The release SHA in the quick start example, a new top row in the pin table and in
   `.github/workflows/claude-review.yml`.

Merge with a merge commit only (squash and rebase change the SHAs). `npm test` checks that the code under every pin
matches the tree.

## Development

Node 22, plain ESM, dependencies pinned to exact versions. `npm test` runs `node --test` over the pure logic: diff
line mapping, truncation, result validation, error classification, sanitizing, publishing fallbacks, the repository
boundary, route selection and pin consistency. The pin tests need full git history (`git fetch --unshallow` in a
shallow clone).

## License

[MIT](LICENSE)
