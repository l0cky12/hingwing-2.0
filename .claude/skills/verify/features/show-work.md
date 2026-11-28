# Show the bot's work

Settings' Appearance page has "Show the bot’s work", after Accent, with Replies only, Actions and Everything. Everything is the default and draws the thread as it always has. Actions hides the reasoning blocks ("Thought for 3.4 s") and keeps tool steps, tool groups, helpers, the plan and mixture-of-agents rounds. Replies only hides those too, and keeps the replies, the requests, prompt cards, notices, status lines and steers. Under Replies only every running end is the bot's working face, hopping on the thread rail where the round glyph was, a slate "Hermes" face when the chat has no listed bot. A live end that sat on a hidden row becomes a row of its own, "Thinking" for a reasoning block and "Working" for any other. Find in chat searches only the rows drawn. Main keeps the pick in `show-work.json`.

## Sub-features

- `show-work-replies` picks Replies only, and a turn shows the hopping face (`.tip.pet`) while it runs and no reasoning, tool, helper or plan button once it settles. The pick stays across a restart.
- `show-work-actions` picks Actions, and the settled turn holds the plan, the tool groups and the helper, with no reasoning button.
- `show-work-all` is the control: with no pick the same story settles with two "Thought for" buttons.
- `show-work-filter` holds which kinds each pick keeps and how a live end on a hidden row is rewritten. The unit tests in `apps/desktop/test/show-work.test.ts` cover it, and `apps/desktop/test/working-face.test.tsx` covers the face under each pick.

## How to get to it (user POV)

- Press Ctrl+Comma, open Appearance, and pick a segment of "Show the bot’s work". Then send a message in any chat.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.
- Settings exists only in a `--fake-host` run. `fixtures/delegate.jsonl` reasons, keeps a three-item plan, hands a disk check to a helper and runs tool steps, as [Helpers and reasoning](./helpers-and-reasoning.md) says. Its sidebar says "This Hermes can't list its bots.", so the chat has no listed bot and the face is the stand-in's.

- **Replies only.** Run `$H run --fake-host ok --fixture fixtures/delegate.jsonl --saved remote --timeout 30000 --run show-work-replies wait live press Control+Comma wait settings click button Appearance checked radio Everything click radio "Replies only" checked radio "Replies only" click button Close wait live type "Message Hermes" @request click button Send wait pet shot pet wait settled count button "/^Thought/" 0 count button "/^Used/" 0 count button "/^Helper/" 0 count button "/^Plan/" 0 shot settled relaunch wait live press Control+Comma wait settings click button Appearance checked radio "Replies only" quiet`. `pet.png` shows the request and, under it, the slate face with "Thinking" and nothing else. `settled.png` shows the first reply alone on the thread with the Done ring.
- **Actions.** Run `$H run --fake-host ok --fixture fixtures/delegate.jsonl --saved remote --timeout 30000 --run show-work-actions wait live press Control+Comma wait settings click button Appearance click radio Actions checked radio Actions click button Close wait live type "Message Hermes" @request click button Send wait helper-running shot actions-helper wait settled count button "/^Thought/" 0 shot settled quiet`. `settled.aria.txt` holds `button "Plan 1 of 3 done"`, two `Used` groups and the helper's button, and no `Thought for` button.
- **Everything.** Run `$H run --fake-host ok --fixture fixtures/delegate.jsonl --saved remote --timeout 30000 --run show-work-all wait live type "Message Hermes" @request click button Send wait settled shot settled quiet`. `settled.aria.txt` holds two `Thought for` buttons, which proves the zero counts above count something the story draws.

## Gotchas

- Screenshots disable animations, so `pet.png` shows the face still. The `pet` state proves the class and the working face, not the motion. The global `prefers-reduced-motion` rule stops the hop too.
- `wait settled` passes on the first turn's Done ring. Both `Thought for` buttons of the control run sit in that first turn. The story then starts a second turn by itself, whose rows the counts may also see.
- A `--fake-host` run empties its user-data directory at launch, but `relaunch` keeps it, so the pick read after `relaunch` is the one main kept on disk.
