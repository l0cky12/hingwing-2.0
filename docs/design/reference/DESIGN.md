# Design plan (throwaway prototype)

## Brief, grounded
- Subject: Hermes Agent working on the user's own Linux machine. It writes files, edits them and runs commands.
- Audience: one technical person who delegates errands and checks the work afterwards.
- Primary job: tell at a glance what the agent is doing now, what it changed, and when it needs a yes.
- The decision these screens serve: how tool calls appear (A status mark, B tool rows, C grouped).

## Concept: the errand thread
A turn reads like a dispatch: the person's request on top, the agent's reply below.
One thin vertical thread runs down the left of each turn. It encodes a real sequence (the steps the agent took).
The live end of the thread is the status mark. That tip is the one bold element on screen.
- A: the thread carries only its tip. No step nodes.
- B: every step is a node on the thread with an expandable record.
- C: runs of steps collapse into one node that names the work ("Edited notes.md").

## Color and type

Superseded by #205. The colors, type sizes, spacing, radii, shadows and durations are now the named tokens on `:root` in `apps/desktop/src/renderer/styles/app.css`. That file is the source of truth, and this section no longer lists values.

- Dark first: a near-black sidebar (`--rail`), a slightly lighter chat ground (`--paper`), raised surfaces one step lighter (`--sheet`) and quiet one-pixel dividers (`--rule`). The light theme has the same roles.
- One accent (`--signal`) for live state and the thread tip, and one warning color (`--caution`) for approvals.
- Schibsted Grotesk is the one text family, for prose and for UI. JetBrains Mono is only for literal code, commands, paths and diffs.
- Type scale: `--text-2xs` to `--text-3xl`, 11 / 12 / 13 / 14 / 15 / 16 / 20 / 22 px. Body UI is 14, prose 15.
- Radii: small marks 2 and 4, controls 8, menus 12, cards and dialogs 16, pills fully round.

## Layout
```
+--------------------------------------------------------------+
| UI prototype recording            [ Status mark | Rows | Grouped ] |
+--------------------------------------------------------------+
|   Your request, in sans, with a short ink rule on its left      |
|                                                              |
|   |  Agent prose, left aligned, ~66ch                          |
|   o  Edited notes.md                              +1 -1        |
|   |  More prose                                              |
|   *  Running ls -la   <- the tip, viridian, pulses            |
+--------------------------------------------------------------+
|   [ Message Hermes                                   ] Send   |
+--------------------------------------------------------------+
```
Left aligned throughout. No chat bubbles, no cards around steps when closed.

## Review against the generic defaults
- Was: near-black ground with one bright blue accent (default 2). Now: a dark-first rail, paper and sheet with one teal signal, and the same roles in light.
- Was: rounded identical cards for every tool row (default 4). Now: closed steps are thread nodes with no box; only an open record gets a sheet.
- Was: ALL-CAPS section labels and middle-dot meta strings (default 5). Now: sentence-case labels, meta set as separate quiet text.
- Was: mono for durations and badges (default 5). Now: tabular sans numerals.
- Was: chat bubbles for the user. Now: a request block with an ink rule, reads like the start of a dispatch.
- Avoided: cream plus terracotta (default 1), broadsheet hairlines with zero radius (default 3).

## Words
- Step titles say what happened: "Wrote notes.md", "Edited notes.md", "Ran ls -la". Raw tool name is secondary.
- Approval: "Run this command?" with Hermes's reason. Buttons "Run once", "Allow in this chat", "Always allow", "Don't run". Answered: "You allowed this once."
- Status tip: "Thinking", "Writing", "Running ls -la", "Waiting for your OK", "Done".

## Quality floor
Visible keyboard focus. prefers-reduced-motion stops the pulse. Contrast at least 4.5:1 for text.
