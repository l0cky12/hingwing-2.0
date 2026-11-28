# Forced colors

With the desktop's forced-colors setting on, Highwing still shows the thread line and its nodes, the live end of the turn as a larger `Highlight` dot with a ring, the waiting approval card with a thick left edge, added diff lines with a solid left edge and removed lines with a dotted one, bordered record sheets and code blocks, and a visible focus ring. With the more-contrast preference on, graphite text and the thread rule are darker.

## Sub-features

- `forced-thread` draws the thread line and every step, group and approval node in `CanvasText`, with the live node as a larger `Highlight` dot circled by a `Highlight` outline.
- `forced-approval` gives the waiting card a `CanvasText` border with a 4px left edge. Its node, the live end, stays the only `Highlight` element.
- `forced-diff` marks added lines with a solid left edge and removed lines with a dotted one, next to the `+` and `−` marks.
- `forced-focus` shows a `Highlight` ring on the composer card while its message box has focus, and the system focus ring on the approval buttons.
- `forced-outlines` draws a 1px `CanvasText` outline around the request pill and each reply card, since their tinted backgrounds are gone.
- `more-contrast` darkens `--graphite` and `--rule`.

## How to get to it (user POV)

- On Windows, turn on a high-contrast theme, then open Highwing.
- On Linux the desktop's high-contrast theme does not turn on forced colors in Highwing, and the engine's own `--force-high-contrast` switch draws text white on white there. Reach this view through `--forced-colors` below.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and `$H build` has run since the last CSS change.

- **Whole story.** Run `$H run --fixture fixtures/errand.jsonl --stretch 6 --forced-colors --chat-only --run fc-forced wait live type "Message Hermes" @request click button Send wait tool-running shot tool-running wait approval shot approval click button "Run once" wait settled shot settled click button "Created and edited notes.md 2 steps" click button "Created notes.md +5" click button "Edited notes.md +1 −1" click button "Ran ls -la && ls scratch" shot settled-expanded`.
- **Check the pixels.** Run `node .claude/skills/verify/scripts/forced-colors-check.mjs /tmp/highwing-verify/fc-forced`. For each shot it checks that the thread line has no gap, that it carries the expected number of nodes, and that the end mark is the last node: a live end at least 16px tall, or the Done ring with its tick. In `settled-expanded` it also checks that added and removed lines have different left edges. It ends in `PASS` or `FAIL`, and exits non-zero on `FAIL`.
- **Focus ring.** Run `$H run --fixture fixtures/errand.jsonl --forced-colors --run fc-focus wait live type "Message Hermes" @request click button Send wait approval press Shift+Tab press Shift+Tab press Shift+Tab press Shift+Tab press Shift+Tab focused button "Run once" shot approval-focus`. After `click button Send` focus is back in the message box, and five Shift+Tab presses reach "Run once" (two reach "Don't run").
- **A waiting card while offline.** Run `$H run --fixture fixtures/errand.jsonl --forced-colors --drop-after approval.request --run fc-askoff wait live type "Message Hermes" @request click button Send wait offline shot offline-asking`. The thread line runs unbroken past the card's top and bottom edges. The checker does not read this shot, because the banner sits where it looks for the request's rule.
- **More contrast.** Add `--more-contrast` in place of `--forced-colors`.
- **Normal mode unchanged.** Run the whole story without `--forced-colors` and compare each shot with `magick compare -metric AE a.png b.png null:`. The forced-colors block must leave normal shots at 0.

## Gotchas

- Chromium replaces author backgrounds, box-shadows and non-system border colors in this mode, so every state is a border in a system color. A `transparent` border is forced to a visible color, so diff lines align with padding instead.
- The whole story passes `--stretch 6` because `tool-running` lives about 144 ms at recorded timing, and with other verify runs going the shot often took longer than that and failed. Stretched, the step lasts about 864 ms, and the shots are the same.
- Chromium snaps border widths to whole pixels. A 1.5px border draws 1px wide.
- The universal `box-sizing: border-box` rule does not reach pseudo-elements. The thread nodes set it themselves.
- `settled-expanded` shows the top of the turn, as the design C reference does, so the Done ring is below the fold. The checker reports `n/a` for its end mark. The `settled` shot shows the same end mark.
- The checker finds the thread column as the vertical run at most 2px wide in the left half with the most ink, and the background from the pixel at (20, 70), so it needs the 1180x860 reference size and a shot of the chat column alone. Without `--chat-only` it finds no border above the composer and fails.
- The `tool-running` moment lives a few hundred ms, and a forced-colors shot can take longer, so `shot tool-running` sometimes fails with `state "tool-running" ended before tool-running.png was taken`. Run the story again.
