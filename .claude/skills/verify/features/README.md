# Highwing verification map

This directory is the maintained source for verifying what a Highwing user sees and does. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Run commands from the repo root, with `H=.claude/skills/verify/scripts/highwing-verify.mjs`.
- `$H doctor` prints only `ok` lines.
- The build is current. Run `$H build` after any source change.
- Never drive an instance this run did not start.

## Driving conventions

- Start every recipe from a fresh `run`. The app keeps no state between runs.
- Prefer ARIA roles and accessible names (`click button "Send"`) and the named states in the helper's `STATES` table over CSS selectors.
- Wait on a named state, never on a fixed sleep.
- Treat every command as literal. Keep quoted names unchanged.

## Proof and skip reporting

- A run's `steps.log` must end in `PASS`.
- UI proof is a shot and its `.aria.txt` for the action and for the resulting state.
- Record the run name and the feature with every artifact you cite.
- Report an unreachable path with the attempted command and the unmet precondition. Do not report it as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with highwing-verify`, and `Gotchas`.

## Features

- [Open the app](./open-the-app.md) covers launching a window at the reference size.
- [Replay a fixture](./replay-a-fixture.md) covers `HIGHWING_FIXTURE`, the tool-running, approval and settled moments, open records, and the reference composites.
- [Send a message](./send-a-message.md) covers the composer's Send button, Enter, and Stop while a turn runs.
- [Answer an approval](./answer-an-approval.md) covers the approval card and "Run once" releasing the story to Done.
- [Offline banner](./offline-banner.md) covers the blocked banner with Retry, the dropped banner with disabled buttons, and recovery.
- [Copy a block](./copy-a-block.md) covers the Copy control on the request, a reply, an approval command and an open step's record, its keyboard reach, and the closed thread without controls.
