# Jump to latest

When you scroll up more than 80px from the bottom of a thread, a small round control appears at the bottom centre, just above the composer. It says nothing until something new arrives below. Then it reads "New steps below", or "Waiting for your OK" in the caution colour when Hermes is asking you to approve something. Pressing it, or pressing End when the composer is empty, jumps to the live end and the thread follows new steps again. A thread you never scroll keeps following as before.

## Sub-features

- `jump-show` shows the control only while the thread is more than 80px from the bottom. Within 60px of the bottom the thread follows new steps, and the control is hidden.
- `jump-news` adds "New steps below" once the last turn gains a step, ends differently, or a message is pending, compared with the moment you left the bottom.
- `jump-asking` replaces the words with "Waiting for your OK" while an approval is the live end.
- `jump-press` jumps instantly to the live end, turns following back on, and moves focus from the control to the composer so it is not lost.
- `jump-keys` PageUp and PageDown scroll the thread by about seven eighths of its height, and End jumps. They act when focus is outside the thread (for example on Send) and not in a text field holding text. Inside the thread the browser already scrolls.
- `jump-fade` fades in and out over 0.15 s, and with reduced motion appears and disappears at once. The hidden control is out of the ARIA tree and not focusable.

## How to get to it (user POV)

- Send a request that makes Hermes work through many steps, scroll up with the wheel or PageUp while it runs, and read an earlier step. The long-turn fixture does this: about thirteen prose and tool pairs, a three second `terminal` step, a few more steps, then an `rm -rf` approval that is never answered.

## Driving it with highwing-verify

Preconditions:

- `fixtures/long-turn.jsonl`, sent with `@request`. The fixture ends at the approval, so no recipe here reaches `settled`.

- **Scrolled up, news, waiting, press.** Run `$H run --fixture fixtures/long-turn.jsonl --run jump wait live type "Message Hermes" @request click button Send wait tool-running shot at-bottom gone button "Jump to latest" press PageUp press PageUp shot scrolled-up see "New steps below" shot news wait approval see "Waiting for your OK" shot waiting click button "Jump to latest" inview group "Run this command?" gone button "Jump to latest" shot jumped`. `at-bottom.aria.txt` has no `button "Jump to latest"`. `news.aria.txt` has `button "Jump to latest"` and `status: New steps below`, `waiting.aria.txt` has `status: Waiting for your OK`, and `jumped.aria.txt` has no control.
- **End key.** Run the same steps up to `shot waiting`, then `press End inview group "Run this command?" gone button "Jump to latest"` in place of the `click`.
- **Following unchanged.** Run `$H run --fixture fixtures/long-turn.jsonl --run follow-long wait live type "Message Hermes" @request click button Send wait approval inview group "Run this command?" gone button "Jump to latest" shot follow-long`. The thread never stopped following, so the approval is in view with no control.
- **Errand.** The issue's `$H run --fixture fixtures/errand.jsonl --run follow wait settled shot settled` cannot pass. It never types or sends the request, and the errand waits at `prompt.submit` until the composer sends. Run `$H run --fixture fixtures/errand.jsonl --run follow wait live type "Message Hermes" @request click button Send wait approval click button "Run once" wait settled shot settled`, which ends in `PASS`.

## Gotchas

- `see "New steps below"` and `see "Waiting for your OK"` match the status text only while the control is shown. A hidden control has `visibility: hidden`, so `gone` and the ARIA snapshot treat it as absent.
- `gone` polls through the 0.15 s fade. Do not follow `click` with a sleep.
- `press PageUp` works because the document listens for it. After Send, focus sits on the Send button outside the thread, where the browser would not scroll.
- The words only show once you are more than 80px up. Between 60px and 80px you have left following, but the control stays hidden.
- `inview` checks every scrolling ancestor and the window. A card behind the composer's top edge fails it.
- The stop gate is the approval. The fixture never answers it, so the run stays at "Waiting for your OK".
