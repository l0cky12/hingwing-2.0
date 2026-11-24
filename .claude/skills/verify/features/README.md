# Highwing verification map

This directory is the maintained source for verifying what a Highwing user sees and does. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Run commands from the repo root, with `H=.claude/skills/verify/scripts/highwing-verify.mjs`.
- `$H doctor` prints only `ok` lines.
- The build is current. Run `$H build` after any source change.
- Never drive an instance this run did not start.

## Driving conventions

- Start every recipe from a fresh `run`. Each run gets an empty user-data directory, so the app's one saved setting, the connection, is what `--saved` wrote.
- Prefer ARIA roles and accessible names (`click button "Send"`) and the named states in the helper's `STATES` table over CSS selectors.
- Wait on a named state, never on a fixed sleep.
- Treat every command as literal. Keep quoted names unchanged.
- A shot shows the whole window, sidebar included. Add `--chat-only` when a shot must show the chat column alone at the reference size.

## Proof and skip reporting

- A run's `steps.log` must end in `PASS`.
- UI proof is a shot and its `.aria.txt` for the action and for the resulting state.
- Record the run name and the feature with every artifact you cite.
- Report an unreachable path with the attempted command and the unmet precondition. Do not report it as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with highwing-verify`, and `Gotchas`.

## Features

- [Open the app](./open-the-app.md) covers launching a window at the reference size.
- [Set up a connection](./set-up-a-connection.md) covers the first-run setup screen, each check failure, the saved screen, the remote chat, and changing the connection from the top bar.
- [Replay a fixture](./replay-a-fixture.md) covers `HIGHWING_FIXTURE`, the tool-running, approval and settled moments, open records, and the reference composites.
- [Send a message](./send-a-message.md) covers the composer's Send button, Enter, and Stop while a turn runs.
- [Answer an approval](./answer-an-approval.md) covers the approval card and "Run once" releasing the story to Done.
- [Open a file](./open-a-file.md) covers the path button in an open record, Show in folder, and Copy path.
- [Markdown replies](./markdown.md) covers lists, headings, links, tables and code blocks in a reply, and the code block's Copy button.
- [Images in the thread](./images.md) covers a reply image, a tool image, the larger view and what main refuses.
- [Choose the model](./choose-the-model.md) covers the model readout under the composer, the list of models, a switch, a switch during a turn, "No model set up", and a Hermes that does not list its models.
- [Offline banner](./offline-banner.md) covers the blocked banner with Retry, the dropped banner with disabled buttons, and recovery.
- [Copy a block](./copy-a-block.md) covers the Copy control on the request, a reply, an approval command, a command that ran and an open step's record, its keyboard reach, and the closed thread without controls.
- [Grow the composer](./grow-the-composer.md) covers the message box growing with its text, its cap and scrollbar, the thread staying pinned, and shrinking back to one line.
- [Find in chat](./find-in-chat.md) covers Ctrl+F, the match count, stepping, opening closed steps, the highlight marks, and Escape returning focus to the composer.
- [Forced colors](./forced-colors.md) covers the forced-colors and more-contrast renderings of the thread, the waiting card, diffs and focus, and the pixel checker.
- [Jump to latest](./jump-to-latest.md) covers the round control that appears when you scroll up, its "New steps below" and "Waiting for your OK" words, and the End key.
- [Bots sidebar](./bots-sidebar.md) covers the list of Hermes's bots, search, a Hermes that cannot list its bots, the unavailable New bot, and pixel parity of the chat column.
- [Open a bot](./open-a-bot.md) covers opening a bot's chat from the sidebar, a message running as that bot, returning to the same chat, a bot with no chat yet, and a Hermes that cannot switch bots.
- [New chat](./new-chat.md) covers the top bar's New chat button, Ctrl+N, the first message making the chat in the shown bot, the chat staying open after Hermes's lists refresh, and `/new`.
- [Slash menu](./slash-menu.md) covers the `/` list of commands and skills, narrowing, completion, Escape, and a Hermes without the catalog.
- [Edit a message](./edit-a-message.md) covers the pencil on a sent message, the editing line and Escape, the dialog that counts the later messages, Remove and send, Regenerate under the last reply, both disabled while a turn runs, and Hermes refusing the cut.
