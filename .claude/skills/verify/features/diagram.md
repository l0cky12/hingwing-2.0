# Diagrams in replies

A fenced `mermaid` block in a reply shows as a drawn diagram, not as its source, once its fence closes. While the fence is still open it is a plain code block. The block keeps the code sheet and its corner: the language, **Diagram** and **Source** toggle buttons, and **Copy**, which copies the source in both views. The drawn diagram is an `img` named "Diagram: " plus the first line of its source, and it scrolls inside its block when it is larger than the reply. The source stays in the page, hidden, so Find counts it, and a match there scrolls the diagram into view. A diagram Mermaid cannot parse shows its source and the line "Couldn’t draw this diagram.", with no toggle, and the rest of the reply still draws. Mermaid ships in the app and loads on the first diagram, so it needs no network and the app starts as fast as it did without it. Mermaid runs at security level `strict` and its SVG passes through DOMPurify's SVG profile, so a label cannot run script.

## Sub-features

- `diagram-drawn` draws a `flowchart LR` as boxes, arrows and labels, named "Diagram: flowchart LR", with its source hidden, and Copy gives the source.
- `diagram-source` switches the first diagram to its source with **Source**, copies the source there, and switches back with **Diagram**.
- `diagram-broken` shows a broken diagram's source and "Couldn’t draw this diagram.", and the closing sentence after it.
- `diagram-script` draws the diagram whose labels hold `<script>alert(1)</script>` and `<img src=x onerror=alert(2)>`, and a sequence diagram whose messages hold `$$x^2$$`, which Mermaid draws as HTML, and `<img src=x onerror=alert(3)>`. No dialog opens.
- `diagram-find` finds text in a drawn diagram's hidden source and scrolls that diagram into view.
- `diagram-offline` draws the three diagrams with only the loopback link up.
- `diagram-start` measures how long the app takes to be live, to compare with a build without Mermaid.
- `diagram-unit` holds the rules in `apps/desktop/test/markdown.test.tsx`, not a run: only a `mermaid` fence is drawn, a closed one offers the toggle and keeps its source where Find searches, and an open one is a plain code block.

## How to get to it (user POV)

- Run `HIGHWING_FIXTURE=$PWD/fixtures/diagram.jsonl pnpm --filter @highwing/desktop start` from the repo root, type in the "Message Hermes" box and press Send.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.
- `fixtures/diagram.jsonl` comes from `python3 -I fixtures/make_diagram_fixture.py`. `--check` fails when the file is not what the script writes.

The reply holds four `mermaid` blocks in this order: a `flowchart LR` that draws, a broken `flowchart LR` that does not, a `flowchart TD` whose labels try to run code, and a `sequenceDiagram` with a math message and a markup message. "That covers the relay from end to end." closes it. Every recipe ends in `quiet-except "/^Executing inline event handler/"`, for the reason under Gotchas. Set `Q='/^Executing inline event handler/'` first.

- **Drawn.** Run `$H run --fixture fixtures/diagram.jsonl --size 1180x1300 --run diagram wait live type "Message Hermes" @request click button Send wait settled wait drawn count img /^Diagram/ 3 count img "Diagram: flowchart LR" 1 absent "A[Request] --> B{Signed in?}" see "That covers the relay from end to end." shot diagram click-at button "Copy code" 1 see Copied copied $'flowchart LR\n    A[Request] --> B{Signed in?}\n    B -->|yes| C[Relay to bot]\n    B -->|no| D[Ask to sign in]\n    C --> E[Reply]' quiet-except "$Q"`. The taller window shows the whole reply. `diagram.png` shows the flowchart's five boxes, its arrows and the "yes" and "no" labels, cut at the right edge with a scrollbar under it. `diagram.aria.txt` holds `img "Diagram: flowchart LR"`, `button "Diagram" [pressed]` and `button "Source"`.
- **Source.** Run `$H run --fixture fixtures/diagram.jsonl --size 1180x1300 --run diagram-source wait live type "Message Hermes" @request click button Send wait settled wait drawn click-at button Source 1 pressed button /^Source$/ true count img "Diagram: flowchart LR" 0 count img /^Diagram/ 2 see "A[Request] --> B{Signed in?}" shot diagram-source click-at button "Copy code" 1 see Copied copied $'flowchart LR\n    A[Request] --> B{Signed in?}\n    B -->|yes| C[Relay to bot]\n    B -->|no| D[Ask to sign in]\n    C --> E[Reply]' click-at button Diagram 1 count img "Diagram: flowchart LR" 1 absent "A[Request] --> B{Signed in?}" quiet-except "$Q"`. `diagram-source.aria.txt` holds the source as `code` and `button "Source" [pressed]` where the drawn recipe has the `img`.
- **Broken.** Run `$H run --fixture fixtures/diagram.jsonl --run diagram-broken wait live type "Message Hermes" @request click button Send wait settled wait drawn see "Couldn’t draw this diagram." see "A[Start --> B" see "That covers the relay from end to end." count button Source 3 shot diagram-broken quiet-except "$Q"`. Only the three drawn diagrams have a toggle. `diagram-broken.png` shows the broken source in a code sheet with the plain line under it.
- **Script.** Run `$H run --fixture fixtures/diagram.jsonl --run diagram-script wait live type "Message Hermes" @request click button Send wait settled wait drawn count img "Diagram: flowchart TD" 1 count img "Diagram: sequenceDiagram" 1 see "That covers the relay from end to end." shot diagram-script quiet-except "$Q"`. The run fails on any dialog, so a pass proves no `alert` ran. `diagram-script.png` shows an empty box where the script label was and the text `<img src="x">` in the other box. In the sequence diagram the first message is a typeset x², and the second is the markup as text.
- **Find.** Run `$H run --fixture fixtures/diagram.jsonl --size 1180x600 --run diagram-find wait live type "Message Hermes" @request click button Send wait settled wait drawn press Control+f type "Find in chat" "flowchart TD" press Enter see "1 of 1" inview img "Diagram: flowchart TD" shot diagram-find quiet-except "$Q"`. The short window puts the third diagram below the fold, so `inview` proves find scrolled to it.
- **Offline.** Run `unshare -rn sh -c "ip link set lo up && $H run --fixture fixtures/diagram.jsonl --size 1180x1300 --run diagram-offline wait live type 'Message Hermes' @request click button Send wait settled wait drawn count img /^Diagram/ 3 shot diagram-offline quiet-except '$Q'"`. The namespace has only the loopback link. `magick compare -metric AE /tmp/highwing-verify/diagram/diagram.png /tmp/highwing-verify/diagram-offline/diagram-offline.png null:` prints 0.
- **Start time.** Run `for i in 1 2 3 4 5; do $H run --fixture fixtures/markdown.jsonl --run diagram-start-$i wait live quiet; done`, then `grep -h 'live .* ms after launch' /tmp/highwing-verify/diagram-start-*/steps.log`. Do the same on a build without Mermaid and compare the medians. Run them one at a time, since parallel runs slow each other.

## Gotchas

- Mermaid cleans each label with DOMPurify, which parses the label in a document no script runs in. Chromium still checks the page's CSP when that parse meets an `onerror` attribute, and logs "Executing inline event handler violates the following Content Security Policy directive" once for the `<img src=x onerror=alert(2)>` label. Nothing ran: the run fails on any dialog, and the drawn SVG holds no `onerror`. That is why the recipes use `quiet-except` rather than `quiet`. Any other console error still fails them.
- `wait settled` is not enough before a diagram check, because Mermaid draws after the fence closes, and the first diagram also waits for Mermaid to load. Use `wait drawn`.
- `click button Source` fails in strict mode, because the reply has two. Use `click-at`.
- The toggle and Copy are at opacity 0 until hover or keyboard focus, like a code block's Copy. They are in the ARIA tree at rest.
- The drawn SVG is itself an `img` in the ARIA tree, inside the named one, so `tally img` counts it, and the bots sidebar's icons too. Count diagrams with `count img /^Diagram/`.
- A diagram is drawn in the palette the page shows, and drawn again when the palette changes. [Theme](./theme.md) has the recipe. A shot right after a switch can still show the old drawing: follow `system-theme` with `palette`, which waits for every diagram.
