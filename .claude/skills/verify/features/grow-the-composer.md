# Grow the composer

The "Message Hermes" box starts at one line and grows as the user adds lines. It stops growing at eight lines, or at 40% of the window height if that is smaller, and then scrolls inside itself. Send and Stop stay in the toolbar row under the box. When the thread was at its end, it stays at its end as the box grows, so the last line of the reply stays above the composer. Deleting the text returns the box to one line.

## Sub-features

- `grow-lines` grows the box one line at a time up to the cap.
- `grow-cap` stops at the cap and shows the box's own scrollbar.
- `grow-pinned` keeps the thread at its end while the box grows.
- `grow-paste` keeps the thread at its end when a paste replaces the text of a full box.
- `grow-shrink` returns the box to one line when the text is deleted.

## How to get to it (user POV)

- Type a request of several lines into the "Message Hermes" box, with Shift+Enter between lines.

## Driving it with highwing-verify

Preconditions:

- `fixtures/errand.jsonl`, and three multi-line texts in the shell: `T12=$(printf 'Line %s of the request\n' $(seq 1 12)); T12=${T12%$'\n'}`, and `T2` and `T30` the same way with 2 and 30.

- **Grow, cap and shrink.** Run `$H run --fixture fixtures/errand.jsonl --run grow-checked wait live field "Message Hermes" 1 fits shot one-line type "Message Hermes" "$T2" field "Message Hermes" 2 fits type "Message Hermes" "$T12" field "Message Hermes" 8 scrolls pinned shot grown type "Message Hermes" "$T30" field "Message Hermes" 8 scrolls pinned shot capped type "Message Hermes" "" field "Message Hermes" 1 fits shot cleared`. `grown.png` and `capped.png` show an eight-line box with its scrollbar and Send on its bottom edge. `cleared.png` shows a one-line box again. It keeps the focus ring, which `one-line.png` does not.
- **The thread stays pinned.** Run `$H run --fixture fixtures/errand.jsonl --run grow-thread wait live type "Message Hermes" @request click button Send wait approval type "Message Hermes" "$T12" shot running-grown click button "Run once" wait settled shot settled type "Message Hermes" "$T30" field "Message Hermes" 8 scrolls pinned shot settled-grown`. `running-grown.png` shows Stop and Send on the bottom edge of the grown box while the turn waits for approval. `settled-grown.png` shows the Done ring of the settled turn above the grown box.
- **Paste over a full box.** Run `$H run --fixture fixtures/errand.jsonl --run grow-paste wait live type "Message Hermes" @request click button Send wait approval click button "Run once" wait settled type "Message Hermes" "$T30" press Control+a press Control+c press Control+End press x press Control+a press Control+v value "Message Hermes" "$T30" pinned shot pasted`. The `value` step proves the paste replaced the text. `pasted.png` shows the Done ring above the full box.

## Gotchas

- At the reference size of 1180x860, 40% of the window is 344px, so the eight-line cap applies. A shorter window caps the box at fewer lines, and the expected count in `field` changes with it.
- `field` reports `clientHeight`. The box has no border of its own. One line reads 30px and eight lines read 182px.
- `scrolls` holds only when the text is taller than the box and the box draws a scrollbar wider than 2px, so a box that clips its text or hides its scrollbar fails it.
- A run with only `type` and `shot` steps also passes on a box that never grows. Keep the `field` steps in.
- `pinned` needs the thread's last row, such as the Done ring or a pending message's status line, wholly in view, not only the turn around it. A row taller than the thread area only needs its bottom in view.
- In a window about 250px tall, the grown box leaves the thread less room than the transcript's bottom padding, and `pinned` fails. That is a known gap of short windows, not of this recipe.
- `type` over text selects it all and inserts the new text, as a paste over a selection does. The browser lays the box out empty between the delete and the insert. In `grow-thread`, going from 12 lines to 30 in a full box is that paste, and before the composer re-pinned the thread on each edit, it left the thread 97px short.
- In the errand fixture the thread is empty until the first send, so `pinned` passes there whether the thread follows the composer or not. `grow-thread` and `grow-paste` overflow the thread and test the pinning.
- Every recipe here also passes without the `ResizeObserver` in `Chat.tsx`, because each edit re-pins the thread. The observer covers resizes that are not edits, such as narrowing the window: without it, narrowing a 1180x510 window to 420x510 with a draft leaves the thread 169px short. Keep the observer even when these recipes pass without it.
