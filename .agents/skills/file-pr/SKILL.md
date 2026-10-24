---
name: file-pr
description: "File a concise pull request on freecorps/brigade. Use when the user asks to file, open, or create a PR."
---

# File a PR

Brigade is a public open-source repository: the PR is read by maintainers, review bots and strangers.
Write it so someone who never saw the conversation can decide whether to care and whether it is right.

Run `gh` and `git` from **Bash** (Git Bash on Windows), never PowerShell: PowerShell mangles non-ASCII
characters. Bodies always go through `--body-file`.

## Before filing

- **Does a PR for this branch exist?** `gh pr view --json number,url,state`. Reuse it only when `state` is
  `OPEN`. For a `MERGED` or `CLOSED` one, ask whether to reopen or open a new one.
- **Never file from `main`.** Create a branch first (`git switch -c <short-kebab-name>`).
- **Review the diff:** `git fetch origin && git diff origin/main...HEAD`. It must match what the user asked
  for. Anything nobody asked for comes out before filing.
- **Rebase onto the latest `main`.** A stale branch conflicts and burns a review round.
- **One concern per PR.** If the description needs an "also", it is two PRs.
- **The gate passes locally:** `vp check` and the tests of the packages you touched
  (`vp run --filter <pkg> test`). CI runs the full set.
- **Decisions stay in sync:** if the change contradicts or settles something in `docs/rfcs/` or
  `docs/open-questions.md`, update that document in the same PR.
- **User-facing strings** go through `packages/i18n` with every launch locale (`en`, `pt-BR`) filled in.
- **No secrets, tokens, internal hostnames or customer data** in the diff, the body or any screenshot. The repository is public.

## Title

Titles become the squash commit message. **English, imperative, descriptive, no conventional-commit prefix.**
Read `gh pr list --state merged --limit 15` for recent examples.

> **BAD** `Phase 1 part 2` — says when, not what. Useless in `git log`.
>
> **GOOD** `Resume sync subscriptions from the last version after a reconnect`

Prefer what the change achieves over the mechanism:

> **BAD** `Add apns-collapse-id header`
>
> **GOOD** `Stop repeated pages for the same incident from stacking on iOS`

## Description

English. Open with **the problem**, in plain words and grounded in the user's request, then the solution in
a sentence or two. Do not lead with an inventory of files:

> **BAD** "Added `SyncClient.resume()`, changed `WorkspaceDO.fetch`, new test file."
>
> **GOOD** "After a phone woke from the background, the incident list stayed stale until a manual refresh.
> The client now resumes each subscription from its last version, so the list catches up in one round trip."

Then, only what a reviewer needs:

```md
## How it works

<non-obvious design points; link the RFC section if one applies>

## How to verify

<commands or steps a reviewer can run>

Closes #<issue> (if any)
```

## Visual evidence

A UI change (web dashboard, site/docs, mobile app, Slack messages, notifications) carries before/after
screenshots; motion or timing carries a short video. Media is uploaded **to the PR itself**; never push an
asset-only branch to host images. Capture rules are in the `before-and-after` skill.

## Filing

Open a **real PR, not a draft**, so the review bots run. Write the body to a file, then:

```bash
# with media: inserts the before/after block after the opening paragraph, uploads, verifies
node scripts/pr-media.mjs create --title "<title>" --body-file /tmp/body.md \
  --before test-results/pr-media/web-before.png \
  --after  test-results/pr-media/web-after.png --label "Web, light"

# without media
gh pr create --base main --title "<title>" --body-file /tmp/body.md
```

`create` fails if GitHub did not rewrite a local reference, so check its output. For media on an existing PR:
`node scripts/pr-media.mjs publish --pr <n> ...` with the same flags.

Never file a PR the user did not ask for, and never merge one unless they explicitly asked.

If the user also asked to babysit it, continue with the `babysit-pr` skill.
