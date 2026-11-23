# Helpers and plans in the thread

Mockups for issue #39: two new thread node kinds, a helper and a plan. They are proposals for approval, not built code. `index.html` loads the app's own stylesheet and fonts, draws hard-coded data, and adds the proposed rules for the new kinds in one `<style>` block.

## Screens

| File | Moment |
| --- | --- |
| `running.png` | Two helpers. One finished, one working and holding the live end. |
| `running-open.png` | The working helper opened. Its steps sit on a second, indented thread line. |
| `parallel.png` | A plan open while it runs, then four helpers: done, thinking, working with the live end, and waiting to start. |
| `asking.png` | A command needs an approval while a helper works. The card comes after the helper node. |
| `settled.png` | The finished turn. Helpers and the plan are closed. One helper failed, and one plan item was cancelled. |
| `settled-open.png` | The same turn with the plan and one helper opened. |

To capture them again, from the repo root:

```
env -u WAYLAND_DISPLAY xvfb-run -a -s '-screen 0 1600x1200x24' \
  apps/desktop/node_modules/.bin/electron --ozone-platform=x11 --force-device-scale-factor=1 \
  --disable-gpu --no-sandbox docs/design/reference/mockups/capture.mjs -- \
  docs/design/reference/mockups/helpers/index.html running running-open parallel asking settled settled-open
```

## Open decision: helpers that outlive their turn

The screens draw helpers that finish inside the turn that started them. A default Hermes setup doesn't work that way:

- Highwing's gateway reads `delegation.gateway_mode`, default `auto` (`hermes_cli/config_defaults.py:1328`).
- Under `auto`, a chat with interim assistant messages on runs helpers in the background (`tools/delegate_tool_config.py:124-136`). Interim messages are on by default (`config_defaults.py:904`).
- In the background mode, the turn that hands off work ends right away. The helpers keep sending `subagent.*` frames after that turn's `message.complete` (`gateway/local_viewer_events.py:109-122`). Their results come back as a new turn that Hermes starts itself.
- `gateway_mode: inline` makes helpers finish inside the turn, which is what the screens draw.

The product owner chooses which shape Highwing designs for. The background shape needs three more screens:

1. The turn that hands off work, ending while its helpers still run.
2. The turn their results start, which has no typed request.
3. Where an approval card goes when no turn is open.

It also changes "stopping the turn stops its helpers", because a settled turn has no Stop. A recorded fixture settles which shape a Highwing chat gets in practice.

## What the wire carries, and what the mockups draw from it

The installed Hermes sends every `subagent.*` event with one payload, `SubagentEventPayload`, and sends `todo.updated` with `{todos, revision}`. Both match the vendored contract.

- **Folding.** The parent's `delegate_task` step becomes the helper nodes, and its to-do steps become the plan node. Neither shows as a step row of its own.
- **Title.** A helper's title is its `goal`, after the quiet word "Helper". Highwing doesn't reword the goal. A helper's own helpers use the same form.
- **Helper steps.** `subagent.tool` sends a tool name and a preview, and nothing else. The preview is Hermes's display summary: a file read is the basename and any line range, and a command is summarized. A helper step has no duration and no record, so its row is a title only and doesn't open.
- **Now.** A closed, working helper shows one line under its title. "Started `<preview>`" follows `subagent.tool`. It claims only a start, because Hermes doesn't report when a helper's tool finishes. "Thinking" follows `subagent.thinking`, whose text Highwing never shows. "Waiting to start" covers the gap between `subagent.spawn_requested` and `subagent.start`. The line hides when the node opens. It also hides when its preview is the command of an open approval card, so a helper never looks like it is mid-run while the card asks.
- **End.** `subagent.complete` gives `status`, `tool_count`, `duration_seconds` and `summary`. The closed node shows the step count beside the title, as a group does, and the duration in the meta. A status other than `completed` shows as a word in brick: "Failed" for `failed` and `error`, "Timed out" for `timeout`, "Stopped" for `interrupted`. The summary shows as "Helper's summary" at the bottom of the open node. Hermes cuts it at 500 characters, so a cut summary ends in an ellipsis.
- **Marks.** A filled diamond is a finished helper, and a brick one is a helper that didn't complete. A hollow diamond is a helper that is queued or working without the live end.
- **Live end.** A turn keeps one live end. An open approval holds it first, then Hermes's own activity, then the newest working helper. Other working helpers show the hollow mark.
- **Color.** Signal colors only the live end: its glyph, its node's title and its now line, and the in-progress plan box while its turn is live. Rows inside an open helper stay ink. An in-progress item in a settled turn is graphite.
- **Nesting.** `depth` and `parent_id` place a helper. The open node draws its own helpers as rows. Anything deeper is counted in words: "and 1 helper of its own".
- **Approvals.** `approval.request` doesn't say which helper asked. The card goes where every approval card goes, after the newest node. The helper node doesn't claim to be waiting.
- **Plan.** One node per turn, placed where the first `todo.updated` arrives and redrawn in place on each later one. Items are `pending`, `in_progress`, `completed` or `cancelled`, and `parent` nests one under another as a nested list. Cancelled items are struck through and left out of the done count, which names them separately: "4 of 4 done", "1 cancelled". The plan mark is a hollow box while items remain and a filled, ticked box when none do.
- **Plan placement.** The plan stays where it first appeared. It isn't pinned or moved, because the thread encodes order and the live end already says what is happening now.
- **Plan opening.** A plan opens by itself when it first appears in a live turn and closes when the turn settles. Once you open or close it, your choice sticks for that node. Plans in turns loaded from history start closed.

## Accessibility

- Each head is a button with `aria-expanded` and `aria-controls`.
- A helper's head carries its state as hidden text: done, working, waiting to start. A failed helper's state is visible.
- The now line is linked to the head with `aria-describedby` and is a polite live region. The plan list is a polite live region too.
- Every plan item carries its state as hidden text, including "to do".
- Focus, contrast and reduced motion come from the existing rules in `app.css`.
