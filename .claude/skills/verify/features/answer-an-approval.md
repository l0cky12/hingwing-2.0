# Answer an approval

When Hermes asks before running a command, the thread shows an amber "Run this command?" card with the command, Hermes's reason and four buttons. Choosing one answers Hermes. "Always allow" asks a second time first, in a dialog. The card then becomes one quiet line ("You allowed this once."), the command's step appears under it, and the turn carries on.

When Hermes asks a question that takes several answers (`clarify.request` with `multi_select: true`), the card shows a checkbox for each choice and one for "Other", which opens a text field. Answer sends the checked labels as a JSON array string, the typed Other answer last. Typed words alone go as plain text. Skip sends an empty answer.

## Sub-features

- `approval-ask` shows the card as the turn's live end, with "Run once" as the primary button and "Don't run" set apart on the right.
- `approval-once` answers "Run once" and releases the story to Done.
- `approval-busy` disables the buttons while the link is down (see the offline banner).
- `always-ask` opens the "Always allow commands like this?" dialog, which names Hermes's pattern (or the command when Hermes sent none) and shows the command. Cancel has focus, and Cancel or Escape sends nothing.
- `always-confirm` answers `always` once from the dialog's "Always allow".
- `multi-select` checks two labels and answers them as one JSON array.

## How to get to it (user POV)

- Send a request that makes Hermes run a flagged command. In the errand fixture, that is the `rm -rf` of the scratch folder.
- Send a request that makes Hermes ask a question with several answers. In the choose fixture, that is where to deploy the build.

## Driving it with highwing-verify

Preconditions:

- `fixtures/errand.jsonl`, sent with `@request`. `fixtures/always.jsonl` is the same errand answered `always`. `fixtures/choose.jsonl` asks one multi-select question. `fixtures/make_fixture.py` writes all three (stories `errand`, `always` and `choose`).

- **Card appears.** Run `$H run --fixture fixtures/errand.jsonl --run approve wait live type "Message Hermes" @request click button Send wait approval shot approval click button "Run once" wait settled shot settled`. `approval.aria.txt` shows `group "Run this command?"` with the command, `Hermes flagged it as “delete in root path”.` and the four buttons.
- **Released.** In the same run, `settled.aria.txt` reads `You allowed this once.`, then `button "Ran rm -rf /tmp/hermes-proto-work/scratch"`, then the paragraph starting `Done. I created`. `steps.log` ends in `PASS`, and `wait settled` only passes once the Done ring (`data-end="done"`) is shown.
- **Always asks first.** Run `$H run --fixture fixtures/errand.jsonl --chat-only --run always-cancel wait live type "Message Hermes" @request click button Send wait approval click button "Always allow" see "Always allow commands like this?" focused button Cancel shot always-dialog press Escape gone dialog "Always allow commands like this?" focused button "Always allow" click button "Always allow" see "Always allow commands like this?" click button Cancel gone dialog "Always allow commands like this?" enabled button "Run once" called approval.respond '{}' 0 quiet`. `always-dialog.aria.txt` shows `dialog "Always allow commands like this?"` with `Hermes won't ask again for commands matching “delete in root path”, in this chat or any other.`, the command, `button "Cancel"` and `button "Always allow"`.
- **Always confirmed.** Run `$H run --fixture fixtures/always.jsonl --run always-confirm wait live type "Message Hermes" @request click button Send wait approval click button "Always allow" see "Always allow commands like this?" shot always-dialog-window click-at button "Always allow" 2 gone dialog "Always allow commands like this?" called approval.respond '{"choice":"always"}' 1 wait settled see "You allowed commands like this from now on." quiet`. `gateway-calls.jsonl` holds one `approval.respond`.
- **Several answers.** Run `$H run --fixture fixtures/choose.jsonl --chat-only --run multi wait live type "Message Hermes" @request click button Send see "Pick all that apply" disabled button Answer enabled button Skip click checkbox "staging (Recommended)" click checkbox canary press Tab focused checkbox Other click checkbox Other focused textbox "Other answer" click checkbox Other gone textbox "Other answer" shot multi-select click button Answer called clarify.respond '{"answer":"[\"staging (Recommended)\",\"canary\"]"}' 1 see "You answered “staging (Recommended)” and “canary”." wait settled shot multi-settled quiet`. `multi-select.aria.txt` shows `group "Hermes has a question"` holding `group "Pick all that apply"` with four checkboxes, `button "Answer"` and `button "Skip"`.

## Gotchas

- The fixture records the answer "once". Another button gets a reply the story did not expect: the scripted gateway rejects it and the run never settles.
- The card is answerable only while the chat is live. `wait approval` waits for an enabled "Run once", not just for the card.
- While the dialog is open the card's "Always allow" is still in the accessibility tree, so `click button "Always allow"` matches two buttons. Use `click-at button "Always allow" 2` for the dialog's.
- `called` is checked again when the steps end. Keep `called approval.respond '{}' 0` out of a run that answers.
- `choose.jsonl` records the answer Highwing sends, with Hermes's "(Recommended)" mark on the first label. Check other labels, or none, and the scripted gateway rejects the answer.
- No recipe drives the dialog closing when the link drops: `--drop-after` cannot drop the link after the dialog opens, since the errand sends no frame while it waits.
