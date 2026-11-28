# Attachments

The user adds a screenshot, a PDF or any file to a message: the paperclip at the left of the composer's toolbar row opens the file dialog, a paste puts a clipboard image in, and a drop anywhere on the window adds the dropped files. Each file sits above the box: an image as a large tile with its "Remove <name>" button over the top-right corner, and anything else as a chip with its type mark, its name and a "Remove <name>" button. Alt+Left and Alt+Right move a focused chip. A file over Hermes's limit is refused in words under the chips that name the file and the limit, and the rest stay. While files are dragged over the window, the composer's border turns to the signal color and a line says "Drop to attach". The chips belong to the chat's draft, so they follow a switch and a restart. Send still needs text. A sent request shows its attachments above it in the thread, and pressing an image there opens the larger view. The paperclip is disabled while the link is down.

## Sub-features

- `attach-pick` stages files from the file dialog, and a chip's Remove button takes one away.
- `attach-limit` refuses a file over the limit the fixture states, names the file and the limit under the chips, and sends the rest.
- `attach-paste` stages one chip from a clipboard image. A paste of text stays text.
- `attach-drop` shows "Drop to attach" while files are dragged over the window, and stages what is dropped.
- `attach-order` moves a focused chip with Alt+Left and Alt+Right, and keeps focus on it.
- `attach-thread` shows a sent request's attachments above it, and opens an image in the larger view.
- `attach-offline` disables the paperclip while the link is down.
- `attach-draft` keeps the chips across a restart, clears exactly the sent ones on Send, and deletes stored files no draft names at the next launch.

## How to get to it (user POV)

- Press the paperclip ("Attach files") at the left of the toolbar row under the message box, paste an image into the box, or drop files on the window.
- Type a message and press Send.

## Driving it with highwing-verify

Preconditions:

- `fixtures/attach/` holds `error.png` (127 bytes), `error-big.png` (about 27 KB) and `contract.pdf`. `python3 -I fixtures/make_attach_files.py` writes them again.
- `--pick <path[,path]>` answers every press of the paperclip with those files, and no dialog opens.
- `--attach-limit <bytes>` sets the app's largest image and largest file to that many bytes.
- Any fixture whose first step awaits `prompt.submit` takes a message with attachments. The recipes use `fixtures/markdown.jsonl`, which settles with no approval.
- A run's `gateway-calls.jsonl` holds the attach calls and the submit, in the order sent.

Recipes:

- **Pick and remove.** Run `$H run --fixture fixtures/markdown.jsonl --pick fixtures/attach/error.png --run attach-pick wait live click button "Attach files" shot staged click button "Remove error.png" gone button "Remove error.png" shot removed quiet`. `staged.aria.txt` holds `list "Attachments"` with `listitem "error.png"` and `button "Remove error.png"`. `removed.aria.txt` has no list.
- **Over the limit, then send.** Run `$H run --fixture fixtures/markdown.jsonl --attach-limit 20000 --pick fixtures/attach/error.png,fixtures/attach/error-big.png,fixtures/attach/contract.pdf --run attach-limit wait live click button "Attach files" see "error-big.png is 27.2 KB. Hermes takes images up to 19.5 KB." shot refused type "Message Hermes" @request click button Send wait settled shot sent called image.attach_bytes '{"ext":"png"}' 1 called file.attach '{"name":"contract.pdf"}' 1 called prompt.submit '{}' 1 quiet`. `refused.png` shows two chips and the words under them. `sent.aria.txt` holds the turn's `list "Attachments"`, with `button "error.png"` and `listitem: contract.pdf`, above the request. In `gateway-calls.jsonl` both attach calls come before `prompt.submit`, whose `attachments` names the staged image and whose `api_text` ends with the file's `@file:` reference.
- **Paste.** Run `$H run --fixture fixtures/markdown.jsonl --run attach-paste wait live paste-image fixtures/attach/error.png count listitem "Pasted image 1.png" 1 count button "/^Remove /" 1 value "Message Hermes" "" shot pasted quiet`.
- **Drag and drop.** Run `$H run --fixture fixtures/markdown.jsonl --run attach-drop wait live drag-file shot.png see "Drop to attach" shot dragging drop-file see "shot.png isn't a file on this computer" absent "Drop to attach" quiet`. `dragging.png` shows the signal border and the line.
- **Order.** Run `$H run --fixture fixtures/markdown.jsonl --pick fixtures/attach/error.png,fixtures/attach/contract.pdf --run attach-order wait live click button "Attach files" click listitem error.png press Alt+ArrowRight focused listitem error.png shot reordered quiet`. `reordered.aria.txt` lists `contract.pdf` before `error.png`.
- **The larger view.** Run `$H run --fixture fixtures/markdown.jsonl --size 1180x1300 --pick fixtures/attach/error.png,fixtures/attach/contract.pdf --run attach-thread wait live click button "Attach files" type "Message Hermes" @request click button Send wait settled shot thread click button error.png see Close shot viewer press Escape focused button error.png quiet`.
- **Link down.** Run `$H run --fixture fixtures/markdown.jsonl --drop-after message.start --run attach-offline wait live enabled button "Attach files" type "Message Hermes" @request click button Send wait offline disabled button "Attach files" shot offline wait settled enabled button "Attach files" quiet`.
- **Restart, send, sweep.** Run these in order with one name. `$H run --fixture fixtures/markdown.jsonl --pick fixtures/attach/error.png,fixtures/attach/contract.pdf --run attach-draft wait live click button "Attach files" type "Message Hermes" "half a thought" drafts 1 quiet`, then `$H run --fixture fixtures/markdown.jsonl --run attach-draft wait live count button "/^Remove /" 2 value "Message Hermes" "half a thought" click button Send wait settled count button "/^Remove /" 0 drafts 0 quiet`. `/tmp/highwing-verify-scratch/attach-draft/user-data/attachments` still holds four files, two per attachment. A third run with the same name and `wait live count button "/^Remove /" 0 quiet` leaves it empty.

## Gotchas

- `drag-file` and `drop-file` build the dropped file in the page, so it has no path on this computer and main refuses it with "isn't a file on this computer". They prove the drag line and the drop wiring. A drop of a real file from the desktop is not reachable under Xvfb.
- `paste-image` writes the PNG to the clipboard with `clipboard.write` in main, then presses Control+V in the message box. The chip is named "Pasted image <n>.png", counted from 1 in each run.
- Hermes's history holds no record of attachments, so a request read back from Hermes, after a restart or a rebuild, shows none.
- The scripted gateway stages an image under `/hermes/<profile>/cache/images/` and a file under `/hermes/<profile>/attachments/`. Neither path exists on disk.
- The "Drop to attach" line is a `status` with no accessible name, so `gone status "Drop to attach"` matches nothing and passes at once, even while the line shows. Use `absent "Drop to attach"`.
