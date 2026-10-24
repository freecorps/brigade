---
name: before-and-after
description: "Put screenshots or screen recordings on a freecorps/brigade pull request as before/after or preview blocks, uploaded to the PR itself. Use when a PR needs visual evidence."
---

# Visual evidence on a PR

GitHub hosts the media: `gh --attach` uploads the files and rewrites the `![alt](./file.png)` references in
the body to `https://github.com/user-attachments/assets/...` URLs. Never push an asset-only branch to host images.

`scripts/pr-media.mjs` owns the markup and calls `gh` itself, so it works the same from Bash, PowerShell,
macOS and Linux. Its marked block (`<!-- pr-media:start/end -->`) is the only part of the body it touches.

## What needs evidence in Brigade

| Surface                     | Capture                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| Web dashboard (`apps/web`)  | Playwright or a browser screenshot of the dev server, **light and dark**                    |
| Site and docs (`apps/site`) | Same, desktop and phone width                                                               |
| Mobile app (`apps/mobile`)  | iOS simulator and Android emulator screenshots (`eas-simulator` skill for cloud simulators) |
| Notifications, call screen  | Simulator/device screenshot or recording of the lock screen                                 |
| Slack messages              | Screenshot of the message in a test workspace                                               |
| Motion or timing            | Short video (mp4/webm)                                                                      |

Responders read Brigade at 3 a.m.: dark theme is not optional evidence for dashboard and mobile changes.

## Capture rules

- The **before** is `main` actually running, not memory: capture it from a worktree on `main`, or before
  switching to the branch.
- Same viewport, same state, same theme and same locale for a pair. For full-page pairs, make both files the
  same pixel height (pad the shorter page) so GitHub aligns the top edges in the table.
- Use the seeded demo workspace and fake incidents. **Nothing in a capture may show tokens, secrets, internal
  hostnames, real people's phone numbers or real incident data** — the repository is public.
- When a change touches translated strings, add one pair in `pt-BR` next to the `en` one.
- Save under `test-results/pr-media/` (gitignored, inside the repo, no spaces in file names).
  Supported: png, jpg, gif, webp, mp4, mov, webm. A before and its after share a media type.

## Publish

One `--before`/`--after` pair per comparison, `--label` once per pair, `--after` alone for a net-new preview
(`--before -` marks a preview when the same call also has pairs). Images render in a two-column table; videos
render as players on their own line.

Creating the PR, with the block inserted after the opening paragraph of the body:

```bash
node scripts/pr-media.mjs create --title "<title>" --body-file body.md \
  --before test-results/pr-media/web-dark-before.png \
  --after  test-results/pr-media/web-dark-after.png --label "Web, dark"
```

Adding to (or updating) an existing PR:

```bash
node scripts/pr-media.mjs publish --pr <n> \
  --before test-results/pr-media/ios-before.png \
  --after  test-results/pr-media/ios-after.png --label iOS
```

Both fetch the body back afterwards and fail if any `./test-results/...` reference survived, so a silent miss
cannot happen. `--dry-run` prints the `gh` command instead of running it. `format` prints the markdown block
alone (or a body with the block inserted, with `--body-file`) when you want to compose by hand.

After publishing, open the PR and confirm the evidence sits after the opening context and before the
implementation details, and that videos play.
