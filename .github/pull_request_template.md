<!--
One problem per PR. Use a conventional title in plain language:
  good: fix(ssh): reconnect after the laptop wakes from sleep
  bad:  fix bugs / update docs
Draft PRs are fine for unfinished work. Don't merge on red CI.
-->

## Problem
<!-- What is wrong or missing? Who sees it, on which platform, how often?
     Back any speed or memory claim with numbers. -->

Closes #
<!-- Regression? Fixes: <12-char sha> ("subject of the commit that broke it") -->

## Change
<!-- How does this fix it? Cleanup, refactors and a second fix go in their own PRs. -->

## Front-end change?
<!-- Tick exactly one. "Yes" means a user could see the difference: anything under
     apps/desktop/src/renderer, styles, icons, copy or wording on screen, layout,
     or main-process changes to windows, menus, dialogs or the tray.
     If unsure, tick Yes. -->
- [ ] Yes: the "Front-end evidence" section below is filled in
- [ ] No: nothing a user sees changes

## How I verified it
<!-- What you ran and what you saw. "Tests pass" is not enough.
     Say what you could NOT check (e.g. WebView2, real audio devices). -->
- [ ] `pnpm check` passes (lint, typecheck and tests)
- [ ] Ran the built app on: [ ] Windows  [ ] Linux (.deb / AppImage / Arch)
- [ ] Hermes tested against (version or commit): ___
- [ ] Settings → Diagnostics shows no newly unsupported features
- Steps and result:
- Not checked:

## Front-end evidence
<!-- Required when "Front-end change?" is Yes. Write "n/a" if No.
     Take Before on main and After on this branch, at the same window size and
     on the same screen or state, so they compare side by side. The verify skill
     (.claude/skills/verify) can capture both headlessly.
     Upload images and video to this PR; don't commit PR-only files.
     Mask secrets, server URLs and personal data before uploading. -->

**Before** (main):
<!-- screenshot -->

**After** (this branch):
<!-- screenshot -->

**Recording** of the change in use:
<!-- Short video or GIF that walks through the new or changed behavior,
     including any loading, error or empty states it touches. -->

## Compatibility
- [ ] No change to stored settings, backups or chat links, or a migration/note is included
- [ ] If this needs a newer Hermes route, `docs/compatibility.md` is updated and older servers show a "not supported" note

## Release notes
Notes: <!-- One past-tense line for users, e.g. "Fixed SSH reconnect after sleep." Or `none`. -->

## Self-review
- [ ] I read my own diff for quality, security and reliability
- [ ] One logical change; tests added or updated for new behavior
- [ ] Front-end change: before and after screenshots and a recording are attached above
- [ ] Docs, ADRs or CHANGELOG updated if users or design decisions are affected
- [ ] No secrets, server URLs, passwords or S3 details in the diff, logs or screenshots.
