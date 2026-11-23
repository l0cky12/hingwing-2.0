# Bots sidebar

A column at the left of the window lists the bots of the Hermes that Highwing is connected to. The default bot sits at the top as a large avatar with a star. The other bots sit under their sections, with the bots in no section last under "Unassigned". Each row shows the bot's initial, its name, its role and one line from its newest chat. Clicking a bot selects it and changes nothing else. Search narrows the list by name and role. The chat sits to the right of the column and works as before.

## Sub-features

- `bots-roster` lists the bots Hermes names, in their sections, with the default bot selected.
- `bots-select` selects a bot on a click and opens no chat.
- `bots-search` swaps the header for a search box, narrows by name and role, says when nothing matches, and closes on Escape, Close search, or leaving the empty box.
- `bots-keys` keeps Escape and the paging keys to the search box while it has focus.
- `bots-older` says "This Hermes can't list its bots." on a Hermes with no `profiles.list`, and asks once.
- `bots-offline` keeps the last roster while the connection is down.
- `bots-new` shows New bot as unavailable and still reachable by keyboard.
- `chat-unchanged` proves the chat column draws the same pixels before and after a change.
- `chat-narrow` proves the chat's compact layout follows its column, not the window.

## How to get to it (user POV)

- Open Highwing with a connection to Hermes. The column is at the left of the chat.

## Driving it with highwing-verify

Preconditions:

- `--profiles fixtures/profiles/roster.json` gives the scripted gateway five placeholder bots. `fixtures/profiles/edge.json` gives it thirty, with a joined emoji and a flag as names, a long name, a profile name with a space, a chosen tone, a hex colour and a second default bot. Without `--profiles` the gateway refuses `profiles.list` as unknown.
- `chat-unchanged` needs a build from before your change. Take its shots first.

- **Roster and select.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run bots wait live wait bots current button "Hermes Agent, default bot" shot roster click button "Reviewer, Code review" current button "Reviewer, Code review" called session.resume '{}' 1 shot selected quiet`. `roster.aria.txt` holds `complementary "Bots"` with `heading "Work"` before `heading "Unassigned"`. One `session.resume` for the whole run shows the click opened no chat.
- **The approved layout.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run bots-approved wait live wait bots type "Message Hermes" @request click button Send wait approval click button "Run once" wait settled click button Researcher press Tab press Enter current button "Reviewer, Code review" focused button "Reviewer, Code review" shot bots-approved quiet`, then `$H compare bots-approved`. Tab and Enter select Reviewer with the keyboard, so the row carries the focus ring the approved layout shows. Left of x=288 the shot differs from `docs/design/reference/bots-sidebar.png` only in the dimmed plus.
- **Search.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run bots-search wait live wait bots click button "Search bots" focused textbox "Search bots" shot search-open type "Search bots" code count button "Reviewer, Code review" 1 count button Researcher 0 shot narrowed type "Search bots" zzz see "No bots match “zzz”" shot no-match press Escape focused button "Search bots" count button Researcher 1 click button "Search bots" click textbox "Message Hermes" count button "Search bots" 1 click button "Search bots" click button "Close search" focused button "Search bots" quiet`. The click on the message box leaves the empty search box, which closes it.
- **A search with words stays open.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run bots-search-keeps wait live wait bots click button "Search bots" type "Search bots" ops click textbox "Message Hermes" value "Search bots" ops count button "Ops, On call" 1 count button Researcher 0 quiet`.
- **Escape leaves find open.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run bots-escape wait live wait bots type "Message Hermes" @request click button Send wait approval click button "Run once" wait settled press Control+f type "Find in chat" notes click button "Search bots" press Escape count textbox "Find in chat" 1 focused button "Search bots" quiet`.
- **Paging keys stay in the search box.** Run `$H run --fixture fixtures/long-turn.jsonl --profiles fixtures/profiles/roster.json --run bots-keys wait live wait bots type "Message Hermes" @request click button Send wait approval pinned click button "Search bots" press PageUp press Home press End press PageDown pinned gone button "Jump to latest" click button "Close search" press PageUp see "Waiting for your OK" quiet`. The thread stays pinned while the box has focus, and pages again once it is closed.
- **Older Hermes.** Run `$H run --fixture fixtures/errand.jsonl --run bots-older wait live see "This Hermes can't list its bots." type "Message Hermes" @request click button Send wait approval click button "Run once" wait settled called profiles.list '{}' 1 shot older quiet`. One call for the whole story shows Highwing does not ask again.
- **Offline.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --drop-after approval.request --run bots-offline wait live wait bots type "Message Hermes" @request click button Send wait offline wait bots shot offline`. The shot shows the connection banner and the five bots.
- **New bot.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run bots-new wait live wait bots disabled button "New bot" click button Researcher press Shift+Tab press Shift+Tab focused button "New bot" press Enter count button "New bot" 1 current button Researcher shot new-bot-focus press Shift+Tab focused button "Search bots" called session.resume '{}' 1 quiet`.
- **Many bots, long thread.** Run `$H run --fixture fixtures/long-turn.jsonl --profiles fixtures/profiles/edge.json --run bots-edge wait live wait bots type "Message Hermes" @request click button Send wait approval pinned inview group "Run this command?" inview button "Hermes Agent, default bot" shot edge click button "Tailor, Errands" current button "Tailor, Errands" inview button "Tailor, Errands" pinned shot edge-end quiet`. The bot list scrolls inside its column, and `pinned` shows the thread still scrolls inside its own.
- **Forced colors.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --forced-colors --run bots-forced wait live wait bots shot roster click button "Reviewer, Code review" current button "Reviewer, Code review" shot selected click button "Search bots" shot search quiet`. Each avatar and the star have a `CanvasText` border, and the selected row has a `Highlight` left edge.
- **Narrow.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --size 680x860 --run chat-narrow wait live wait bots minwidth 680 inview button Send type "Message Hermes" @request click button Send wait approval inview button "Run once" inview button Scribe shot narrow quiet`. 680 px is the window's minimum width, which leaves the chat 392 px. `minwidth` reads that limit from Electron, because Xvfb would open a narrower window.
- **Chat unchanged.** Before your change, run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --chat-only --run chat-before wait live shot open type "Message Hermes" @request click button Send wait tool-running shot tool-running wait approval shot approval click button "Run once" wait settled shot settled`. After it, run the same steps with `--run chat-after`. Then run `node .claude/skills/verify/scripts/chat-parity.mjs /tmp/highwing-verify/chat-before /tmp/highwing-verify/chat-after`. It must end in `PASS`. Add `--size 600x860` to both runs for the compact layout.

## Gotchas

- A shot of the whole window does not line up with the design C references, and `forced-colors-check.mjs` cannot find the thread in it. Run those recipes with `--chat-only`.
- `chat-parity.mjs` reaches zero only when both runs place the chat column at the same spot in the window. A build with no sidebar draws the same layout as a build with one, yet at 600 px and 892 px a few anti-aliased pixels differ by 1 to 14 levels of 255, because the column sits 288 px further right. At 1180 px the two match exactly.
- `current` reads `aria-current`. An ARIA snapshot does not print it.
- The search box and the Search bots button share the label "Search bots". Only one of them is on the page at a time.
- New bot is `aria-disabled`. Playwright treats that as disabled, so `click button "New bot"` waits until the timeout. Reach it with Tab.
- PageUp, PageDown and End page the chat while focus is on a bot. The bot list has no paging keys yet.
- The roster's previews come from the fixture header and do not change when the story runs.
- This machine has no emoji font, so the emoji names of `edge.json` draw as empty boxes in a shot. `roster-view.test.ts` proves the initial is the whole emoji.
