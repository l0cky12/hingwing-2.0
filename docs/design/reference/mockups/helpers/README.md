# Helpers and plans in the thread

Mockups for issue #39: two new thread node kinds, a helper and a plan. They are proposals for approval, not built code. `index.html` loads the app's own stylesheet and fonts, draws hard-coded data, and adds the proposed rules for the new kinds in one `<style>` block.

## Screens

| File | Moment |
| --- | --- |
| `running.png` | Two helpers. One finished, one running and holding the live end. |
| `running-open.png` | The running helper opened. Its steps sit on a second, indented thread line. |
| `parallel.png` | A plan open while it runs, then three helpers from one request. Two are still running. |
| `asking.png` | A helper's command needs an approval. The card comes after the helper node. |
| `settled.png` | The finished turn. Helpers and the plan are closed. One helper failed. |
| `settled-open.png` | The finished turn with the plan and one helper opened. |

To capture them again, from the repo root:

```
env -u WAYLAND_DISPLAY xvfb-run -a -s '-screen 0 1600x1200x24' \
  apps/desktop/node_modules/.bin/electron --ozone-platform=x11 --force-device-scale-factor=1 \
  --disable-gpu --no-sandbox docs/design/reference/mockups/capture.mjs -- \
  docs/design/reference/mockups/helpers/index.html running running-open parallel asking settled settled-open
```

## What the wire carries, and what the mockups draw from it

The installed Hermes sends every `subagent.*` event with one payload, `SubagentEventPayload`, and sends `todo.updated` with `{todos, revision}`. Both are the same in the vendored contract.

- **Title.** A helper's title is its `goal`, as Hermes wrote it, after the quiet word "Helper". Highwing doesn't reword the goal.
- **Helper steps.** `subagent.tool` gives a tool name and a preview, and nothing else. A helper step has no duration, no result and no record, so its row is a title only and does not open. A step ends when the next one starts or the helper ends.
- **Now.** A running helper shows its newest step under its title, so the closed node still says what it is doing.
- **End.** `subagent.complete` gives `status`, `tool_count`, `duration_seconds` and `summary`. The closed node shows the step count and the duration. A status other than `completed` shows as a word in the meta: "Failed", "Timed out" or "Stopped". The summary shows as "Helper's reply" at the bottom of the open node.
- **Live end.** A turn keeps one live end. With several helpers running, the newest one to start holds it, and the others show a hollow mark.
- **Nesting.** `depth` and `parent_id` place a helper. The open node draws its own helper's helpers as rows. Anything deeper is counted in words: "and 1 helper of its own".
- **Approvals.** `approval.request` does not say which helper asked. The card goes where every approval card goes, after the newest node. The helper node does not claim to be waiting.
- **Plan.** One node per turn, placed where the first `todo.updated` arrives, redrawn in place on each later one. Items are `pending`, `in_progress`, `completed` or `cancelled`, and `parent` nests one under another. A cancelled item is struck through and left out of the count, so "4 of 4 done" can sit over five items.

## Open questions for the approval

1. The plan opens by itself while the turn runs and closes when it settles, so you can watch items tick off. Is that right, or should it stay as you left it?
2. The plan stays where it first appeared. A long turn can scroll it out of view.
