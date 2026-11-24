# claude-pr-reviewer

[![CI](https://github.com/kamilszczepanik/claude-pr-reviewer/actions/workflows/ci.yml/badge.svg)](https://github.com/kamilszczepanik/claude-pr-reviewer/actions/workflows/ci.yml)

**A second reviewer on every pull request, for cents per review.**

Human review is slow, and generic AI review does not know your rules. This is a reusable GitHub Actions workflow
that reviews each pull request with Claude on the
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview). It reads the diff and the code around it,
checks the change against your repository's own rules (`CLAUDE.md` / `AGENTS.md`), and posts one review with inline
comments and a short summary. It is in daily use in three repositories.

- **Reviews against your rules, not generic advice.** The rubric is your `CLAUDE.md` and `AGENTS.md` from the base
  branch, so a pull request cannot rewrite the rules that judge it.
- **Costs cents, with a hard cap.** About $0.10 to $0.50 per review on Claude Sonnet 5.5, usually $0.30 to $0.50
  (measured over seven real reviews). Each run stops at `max-budget-usd` (default $2).
- **Never breaks your checks.** Out of credit, rate limited or timed out: it posts "review skipped" and exits green.
- **Fallback:** when the Anthropic API credit or usage limit runs out, the review retries once through
  [Vercel AI Gateway](https://vercel.com/ai-gateway) and says which route it took.
- **Safe by default.** The model can only read the checked-out repository (`Read`, `Grep`, `Glob`), secrets never
  reach the model or the published text, and every `uses:` is pinned to a full commit SHA.
- **One review per pull request,** when it opens or leaves draft. Comments only, never approves or blocks a merge.

## Example review

From [pull request #13](https://github.com/kamilszczepanik/claude-pr-reviewer/pull/13) in this repository, where the
reviewer reviewed its own change. The summary:

> The change is mostly consistent: language is picked in code, prompts and fixed texts are per language, and the
> tests cover both languages. I read only `readRubric` in `prompt.mjs` beyond the diff, and I did not run the tests.
> Two small gaps remain: skip comments for early failures are always English, and the language detection counts the
> Polish letters in a loose way.
>
> <sub>Claude review · route: API credit · model claude-sonnet-5-5 · turns 3 · input tokens 119403, output 1329</sub>

One of its inline comments, on `scripts/lib/language.mjs`:

> **Severity: low**
>
> Detection runs on the whole rubric, including code blocks, identifiers and quoted Polish UI copy. `readRubric`
> also falls back to the head-branch rubric (`source: 'head'`), which lets a PR author flip the review language.
> Fix: count letters only outside code segments, and use the head rubric for detection only if the base has none.

## How it differs from GitHub Copilot code review

|                          | claude-pr-reviewer                                        | Copilot code review         |
| ------------------------ | --------------------------------------------------------- | --------------------------- |
| Rules it reviews against | your `CLAUDE.md` / `AGENTS.md`, read from the base branch | Copilot custom instructions |
| Model                    | any Claude model you pick (Sonnet 5.5 default, Opus 5.5)  | chosen by GitHub            |
| Billing                  | your Anthropic API key, pay per review, hard cap per run  | your Copilot plan           |
| Runs where               | your GitHub Actions runner, on code you can read and pin  | GitHub's service            |

It works next to Copilot, or instead of it when Copilot is unavailable or out of quota.

## Quick start

1. Create an API key in the [Claude Console](https://console.anthropic.com/settings/keys) (Settings, then API keys).
   The API is billed separately: a Claude Pro or Max subscription does not cover it. Add prepaid credit first.
   Save the key as a repository secret named `ANTHROPIC_API_KEY`: Settings, then Secrets and variables, then
   Actions, then New repository secret.
2. Optional fallback: create an [AI Gateway API key](https://vercel.com/docs/ai-gateway) in your Vercel dashboard
   and save it as `AI_GATEWAY_API_KEY`. It is used only when the Anthropic API credit or usage limit runs out, and
   Vercel bills those tokens at the same list price. With only `AI_GATEWAY_API_KEY`, every review goes through the
   gateway.
3. Add `.github/workflows/claude-review.yml` with the content below (or copy
   [examples/claude-review.yml](examples/claude-review.yml)), merge it to your default branch, and open a pull
   request.

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
    uses: kamilszczepanik/claude-pr-reviewer/.github/workflows/review.yml@9a9f06675ac799e0ddce4d160899d15a51a8f8c0 # v1.5.0
    with:
      pr-number: ${{ inputs.pr-number }}
    secrets:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      AI_GATEWAY_API_KEY: ${{ secrets.AI_GATEWAY_API_KEY }}
```

Only the review job gets `pull-requests: write`; the workflow level stays at `contents: read`. The `if` skips drafts
(the review comes on "Ready for review") and pull requests from forks, which do not receive secrets.

To review every new commit too, use [examples/claude-review-every-push.yml](examples/claude-review-every-push.yml)
instead. It adds `synchronize`, so each push to an open pull request is a new paid review.

For a deeper review, pass `model: claude-opus-5-5` under `with:`.

If your organization allows only selected actions, add `kamilszczepanik/claude-pr-reviewer@*` to the allow list.

## What it does not do

- **One review per pull request.** New commits pushed to an open pull request are not reviewed again, to keep the
  cost predictable. Rerun by hand (see [Manual rerun](#manual-rerun)), or add `synchronize` to `types` if you accept
  a paid review on every push.
- **No fork pull requests.** Pull requests from forks are always skipped, also on a manual rerun: the reusable
  workflow does not check out a fork's code next to your keys. In a project that takes most contributions from
  forks, it reviews little.
- **No bot pull requests.** Pull requests opened by bots such as Dependabot are skipped. A manual rerun still
  reviews them.
- **No rules file, generic review.** Without `CLAUDE.md` or `AGENTS.md` in the repository root it still reviews,
  but only against general good practice. Rules files in subdirectories are not part of the rubric.
- **No tests, no builds.** The model reads code; it does not run it.
- **Never approves or blocks.** It posts comments; merging stays your decision.
- **English or Polish only.** The review is in Polish when the rubric is mostly Polish; any other rubric gets an
  English review.

## Inputs

All inputs of the reusable workflow (`workflow_call`) are optional:

| Input            | Type   | Default                       | Meaning                                                             |
| ---------------- | ------ | ----------------------------- | ------------------------------------------------------------------- |
| `model`          | string | `claude-sonnet-5-5`           | Claude model id                                                     |
| `max-comments`   | number | 15                            | maximum inline comments; the rest are counted in the summary        |
| `max-diff-bytes` | number | 150000                        | diff size sent to the model, cut at file boundaries, smallest first |
| `max-budget-usd` | number | 2                             | hard cost cap of one review; at the cap the run stops               |
| `pr-number`      | string | empty                         | pull request number for a manual rerun; digits only                 |
| `gateway-model`  | string | `anthropic/claude-sonnet-5.5` | model id on the AI Gateway route                                    |

Secrets: `ANTHROPIC_API_KEY` and `AI_GATEWAY_API_KEY`, both optional, passed explicitly (not `secrets: inherit`).
With neither, the review is skipped with a comment and no red check. At the `max-budget-usd` cap the run posts
"review skipped", and the tokens used so far are still billed. On the API route the job log shows the cost of
each run.

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

The floating `v1` tag is frozen at `v1.4.0`; use the SHAs above. Older releases:
[tags](https://github.com/kamilszczepanik/claude-pr-reviewer/tags).

## Manual rerun

Actions, then "Claude review", then Run workflow with the PR number, or:

```sh
gh workflow run claude-review.yml --repo <owner>/<repo> -f pr-number=<n>
```

Each run is a new paid review. `workflow_dispatch` works only once the caller workflow is on the default branch.

## Security

Report a vulnerability privately: [SECURITY.md](SECURITY.md).

## Contributing

Development and the release process: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
