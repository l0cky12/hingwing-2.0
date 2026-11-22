# Answer an approval

When Hermes asks before running a command, the thread shows an amber "Run this command?" card with the command, Hermes's reason and four buttons. Choosing one answers Hermes. The card then becomes one quiet line ("You allowed this once."), the command's step appears under it, and the turn carries on.

## Sub-features

- `approval-ask` shows the card as the turn's live end, with "Run once" as the primary button and "Don't run" set apart on the right.
- `approval-once` answers "Run once" and releases the story to Done.
- `approval-busy` disables the buttons while the link is down (see the offline banner).

## How to get to it (user POV)

- Send a request that makes Hermes run a flagged command. In the errand fixture, that is the `rm -rf` of the scratch folder.

## Driving it with highwing-verify

Preconditions:

- `fixtures/errand.jsonl`, sent with `@request`.

- **Card appears.** Run `$H run --fixture fixtures/errand.jsonl --run approve wait live type "Message Hermes" @request click button Send wait approval shot approval click button "Run once" wait settled shot settled`. `approval.aria.txt` shows `group "Run this command?"` with the command, `Hermes flagged it as “delete in root path”.` and the four buttons.
- **Released.** In the same run, `settled.aria.txt` reads `You allowed this once.`, then `button "Ran rm -rf /tmp/hermes-proto-work/scratch"`, then the paragraph starting `Done. I created`. `steps.log` ends in `PASS`, and `wait settled` only passes once the Done ring (`data-end="done"`) is shown.

## Gotchas

- The fixture records the answer "once". Another button gets a reply the story did not expect: the scripted gateway rejects it and the run never settles.
- The card is answerable only while the chat is live. `wait approval` waits for an enabled "Run once", not just for the card.
