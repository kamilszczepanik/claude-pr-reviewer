# Contributing

Issues and pull requests are welcome. Keep pull requests small and focused, and follow Conventional Commits
(`feat: ...`, `fix: ...`).

## Development

Node 22, plain ESM, dependencies pinned to exact versions. `npm test` runs `node --test` over the pure logic: diff
line mapping, truncation, result validation, error classification, sanitizing, publishing fallbacks, the repository
boundary, route selection, review language and pin consistency. The pin tests need full git history
(`git fetch --unshallow` in a shallow clone).

## Releases

Each release gets a fixed tag `v1.x.y`; tags are never moved. A breaking change to inputs, secrets or permissions
is `v2`. A release pull request ends with three commits:

1. Code plus `version` in `package.json` and `package-lock.json`. This commit is the action SHA.
2. `.github/workflows/review.yml` calls `kamilszczepanik/claude-pr-reviewer@<action SHA> # v1.x.y`. This commit is
   the release SHA.
3. The release SHA in the README quick start example, a new top row in the README pin table and in
   `.github/workflows/claude-review.yml`.

Merge with a merge commit only (squash and rebase change the SHAs). `npm test` checks that the code under every pin
matches the tree.
