# Account menu

The foot of the sidebar, in bot mode and in chat mode, names the Hermes this window is connected to: a round mark, "Hermes", the machine (`on hermes-host`) when there is a saved connection, and Connected or Not connected. Its accessible name says all three, such as "Hermes on hermes-host, Connected". A press, Enter or Space opens the Account menu above it, in three groups with icons. The first group holds the open chat's usage, read as Settings' Usage section reads it (`session.account_usage`, then `usage.bars`, then `insights.get`): one row per line in monospace with Hermes's spacing kept, so its `[|||       ]` gauges read true, "Reading usage…" while it asks, "Open a chat to see usage." with no chat, "This model reports no usage limits." when Hermes sends no lines, "This Hermes does not report usage." when all three calls are unknown methods, and Hermes's own words for any other refusal. The usage rows are disabled, and the arrow keys still reach them. The second group holds Settings, which opens Settings as the top bar's button does and is left out when there is no connection to change, and Help, which opens the Hermes docs in the browser. The third holds Quit Highwing. The Connect apps button sits beside the foot in the same row, and opens the Connect apps window as [Connect apps](./connect-apps.md) says.

## Sub-features

- `account-foot` shows the foot with the menu closed.
- `account-usage` lists the usage lines a fixture cans, with every row of the menu inside the window.
- `account-keys` moves through the menu with the arrow keys, Home and End, closes it with Escape onto the foot, and runs a row with Enter.
- `account-settings` opens Settings from the menu.
- `account-unsupported` says this Hermes does not report usage.
- `account-quit` closes the app.
- `account-row` puts Connect apps beside the foot, and opens its window from there.

## How to get to it (user POV)

- Press the Hermes row at the bottom of the sidebar.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.

- **Usage and keys.** Run `$H run --latency 400 --fixture fixtures/errand.jsonl --mode bots --profiles fixtures/profiles/roster.json --account fixtures/usage/account.json --run account-usage wait window wait bots shot account-foot click button /^Hermes,/ see "Reading usage…" focused menuitem "Reading usage…" see "34% used" focused menuitem "Acme Pro" inview menuitem "Quit Highwing" inview menuitem "Acme Pro" press ArrowDown press ArrowDown press ArrowDown focused menuitem Help shot account-usage press Escape gone menu Account focused button /^Hermes,/ press Enter see "Reading usage…" press ArrowDown press ArrowDown focused menuitem "Quit Highwing" see "34% used" focused menuitem "Quit Highwing" inview menuitem "Quit Highwing" press Home focused menuitem "Acme Pro" press End press ArrowUp press Enter opened browse https://hermes-agent.nousresearch.com/docs/ gone menu Account quiet`. The latency holds "Reading usage…" long enough to see, and the run proves focus stays on its row and every row stays in the window when the usage lands. `account-usage.png` shows the plan and two gauges in monospace, each gauge's empty cells kept, then Help and Quit Highwing above the foot. A fixture run has no saved connection, so the menu has no Settings.
- **Settings, an older Hermes, and Quit.** Run `$H run --fake-host ok --saved remote --mode bots --run account-host wait window wait live click button "/^Hermes on hermes-host, Connected$/" see "This Hermes does not report usage." shot account-unsupported click menuitem Settings wait settings click button "/^Hermes on/" click menuitem "Quit Highwing"`. The run ends in `PASS` about 0.2 s after the click, as the app quit by itself and ended its ssh.
- **Quit closes the window.** Run `$H run --fixture fixtures/errand.jsonl --run account-quit wait window wait live click button /^Hermes,/ click menuitem "Quit Highwing" pause 1500 see Hermes`. It must end in `FAIL` with `Target page, context or browser has been closed` at the `pause`.
- **Connect apps beside it.** Run `$H run --fixture fixtures/errand.jsonl --connectors fixtures/connectors/two.json --run account-row wait window wait live count button "Connect apps" 1 click button "Connect apps" wait apps see "1 connected" press Escape gone dialog "Connect apps" focused button "Connect apps" quiet`.
- **Chat mode, dark.** Run `$H run --fixture fixtures/errand.jsonl --mode chats --theme dark --run account-chats wait window wait live click button /^Hermes,/ see "This Hermes does not report usage." count menuitem Settings 0 shot account-chats quiet`.

## Gotchas

- `--account` does nothing with `--fake-host`, so a fake-host run always shows "This Hermes does not report usage."
- The menu asks for usage each time it opens, for the chat open then. The menu moves to fit its new height when the answer lands, so it stays inside the window.
