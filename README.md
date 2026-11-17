# claude-pr-reviewer

A pull request reviewer powered by Claude. It runs in GitHub Actions on the
[Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk), reads the diff and the code around it, and
posts one review with inline comments and a short summary.

- **One review per pull request,** when it opens or leaves draft. Comments only, never approves or blocks a merge.
- **About $0.10 to $0.50 per review** on Claude Sonnet, with a hard cap per run (`max-budget-usd`, default $2).
- **Safe by default:** the model can only read the checked-out repository, secrets never reach the model or the
  published text, and every `uses:` is pinned to a full commit SHA.
- **Fallback:** when the Anthropic API credit or usage limit runs out, the review retries once through
  [Vercel AI Gateway](https://vercel.com/ai-gateway) and says which route it took.

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
    uses: kamilszczepanik/claude-pr-reviewer/.github/workflows/review.yml@9a9f06675ac799e0ddce4d160899d15a51a8f8c0
    with:
      pr-number: ${{ inputs.pr-number }}
    secrets:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      AI_GATEWAY_API_KEY: ${{ secrets.AI_GATEWAY_API_KEY }}
```

Only the review job gets `pull-requests: write`; the workflow level stays at `contents: read`. The `if` skips drafts
(the review comes on "Ready for review") and pull requests from forks, which do not receive secrets.

For a deeper review, pass `model: claude-opus-5-5` under `with:`.

## Inputs

All inputs of the reusable workflow (`workflow_call`) are optional:

| Input            | Type   | Default                       | Meaning                                                             |
| ---------------- | ------ | ----------------------------- | ------------------------------------------------------------------- |
| `model`          | string | `claude-sonnet-5-5`           | Claude model id                                                     |
| `max-comments`   | number | 15                            | maximum inline comments; the rest are counted in the summary        |
| `max-diff-bytes` | number | 150000                        | diff size sent to the model, cut at file boundaries, smallest first |
| `max-budget-usd` | number | 2                             | hard cost cap of one review; above it the review is skipped         |
| `pr-number`      | string | empty                         | pull request number for a manual rerun; digits only                 |
| `gateway-model`  | string | `anthropic/claude-sonnet-5.5` | model id on the AI Gateway route                                    |

Secrets: `ANTHROPIC_API_KEY` and `AI_GATEWAY_API_KEY`, both optional, passed explicitly (not `secrets: inherit`).
With neither, the review is skipped with a comment and no red check.

## How it works

- The reusable workflow checks out the pull request head with `persist-credentials: false` and fetches the diff for
  the same SHA, so line numbers match the files the model reads. Large files cannot push code changes out of the
  budget: files are added smallest first, and the review lists the ones it did not cover.
- The rubric is `CLAUDE.md` and `AGENTS.md` from the base commit, so a pull request cannot weaken the rules that
  judge it. The review is in English, or in Polish when that rubric is mostly Polish.
- The Agent SDK runs with `Read`, `Grep` and `Glob` only, no settings from disk, a turn, time and budget limit, and a
  hook that rejects any path outside the repository. The result is JSON validated against a schema.
- Before publishing, secrets and anything shaped like a key or token are redacted, `@mentions` are disarmed, images
  and HTML are removed, and comments outside the diff are dropped.
- Expected failures (exhausted credit, rate limits, rejected key, outage, timeout, budget) post a "review skipped"
  comment and exit 0, so they never leave a red check.

## Pinning

Pin a full commit SHA, not a tag: the job receives an API key and a token with `pull-requests: write`, so the code
behind the pin must not change without a visible change in your workflow. Add the `github-actions` ecosystem to
`dependabot.yml` to get a pull request for each new release.

| Version  | SHA                                        |
| -------- | ------------------------------------------ |
| `v1.5.0` | `9a9f06675ac799e0ddce4d160899d15a51a8f8c0` |
| `v1.4.1` | `2d24e5d68433b0e014ee1c7ade9207acb8bc587e` |
| `v1.4.0` | `1313a005734da1b79cea63a5001594c74efb94d7` |

Older releases: [tags](https://github.com/kamilszczepanik/claude-pr-reviewer/tags).

## Manual rerun

Actions, then "Claude review", then Run workflow with the PR number, or:

```sh
gh workflow run claude-review.yml --repo <owner>/<repo> -f pr-number=<n>
```

Each run is a new paid review. `workflow_dispatch` works only once the caller workflow is on the default branch.

## Contributing

Development and the release process: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
