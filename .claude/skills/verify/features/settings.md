# Settings

The top bar's Settings button, or Open Settings in the Ctrl+K palette, opens Settings in the chat column. The sidebar stays beside it, so a Bots or Chats pick changes it live. The bar reads "Hermes Settings" with Close at its right, and the page holds three cards. Connection names the machine Highwing talks to: its short name, the full name in mono when it says more, and an Online pill, or the link's own words in place of the mono line with the banner's Retry or Start Hermes. Change opens the editor in the same card: "Where Hermes runs" as Tailnet machine or This computer, the "Hermes machine" field, and a footer with Cancel and Connect. A check shows its step in the footer, and a failure shows its alert under the field while the current connection stays Online. Cancel folds the editor, or stops a check. A check that passes folds the editor on the new machine, puts focus on Change and says "Highwing now uses the Hermes on <machine>." Sidebar picks the left column, and Keyboard shortcuts lists Ctrl K, Ctrl N and Ctrl F. Close or Esc goes back to the chat and puts focus on the Settings button. A sidebar or palette pick of a bot or chat closes Settings and opens it, and so do a notification click, a chat link and a bot made from the sidebar. Main closes Settings before any open, and stops a running check as Close does. While it saves a new connection it refuses the open, and nothing moves. The connection banner and the preview pane stay hidden while Settings is open.

## Sub-features

- `settings-open` opens Settings folded, with focus on its heading, and closes it with Esc and with Close, focus back on the Settings button.
- `settings-failed` shows a failed check under the field, with focus back in the field and the current connection still Online.
- `settings-checking` shows a running check, then Cancel stops it and keeps Settings open, folded, with focus on Change.
- `settings-saved` folds on the new machine after a check passes, with focus on Change and the news in a status region.
- `settings-pick` closes Settings and opens the bot picked in the sidebar.
- `settings-pick-checking` closes Settings for a sidebar pick while a check runs, and the check stops.
- `settings-palette` opens the palette in Settings without Open Settings, and a bot picked there closes Settings. Ctrl+N and Ctrl+F do nothing in Settings.
- `settings-mode` switches the sidebar to chat mode and back from the Sidebar card.
- `settings-blocked` shows a blocked link's words and Retry in the connection row, with the banner hidden.
- `settings-narrow` stacks the editor's rows and wraps a long host name in a narrow window.
- `settings-forced` draws the picked segment and keyboard focus apart in forced colors.

## How to get to it (user POV)

- With a saved connection, press Settings in the top bar, or press Ctrl+K and pick Open Settings.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines.
- Make the roster fixture once: `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run settings-roster wait live wait bots`. Then set `F=/tmp/highwing-verify/settings-roster/fixture-edited.jsonl` and `M=hermes-host.example-tailnet.ts.net`.

- **Open and close.** Run `$H run --fake-host ok --fixture $F --saved remote --run settings-open wait live wait bots click button Settings wait settings focused heading Settings checked radio Bots shot settings press Escape gone heading Settings focused button Settings wait live click button Settings wait settings click button Close gone heading Settings focused button Settings quiet`.
- **A failed check.** Run `$H run --fake-host ok --fixture $F --saved remote --run settings-failed wait live click button Settings wait settings click button Change focused textbox "Hermes machine" type "Hermes machine" hermes-lab click button Connect wait setup-failed focused textbox "Hermes machine" see "Online" see "No machine called hermes-lab is on your tailnet." shot settings-failed`.
- **A running check, then Cancel.** Run `$H run --fake-host ok --hold-at ssh --saved local --run settings-checking wait live click button Settings wait settings click button Change focused radio "This computer" click radio "Tailnet machine" type "Hermes machine" hermes-host click button Connect wait setup-checking see "Connecting to hermes-host" disabled button Connect enabled button Cancel enabled button Close shot settings-checking click button Cancel gone status Checking wait settings focused button Change count button Connect 0`.
- **A check that passes.** Run `$H run --fake-host ok --fixture $F --saved local --run settings-saved wait live wait bots click button Settings wait settings click button Change click radio "Tailnet machine" type "Hermes machine" $M click button Connect gone button Connect wait settings focused button Change see "Online" shot settings-saved click button Close gone heading Settings focused button Settings wait live see "on hermes-host" quiet`. `settings-saved.aria.txt` holds `status: Highwing now uses the Hermes on hermes-host.`
- **A sidebar pick.** Run `$H run --fake-host ok --fixture $F --saved remote --run settings-pick wait live wait bots current button "Emu, default bot" click button Settings wait settings click button Research gone heading Settings current button Research wait live quiet`.
- **A sidebar pick during a check.** Run `$H run --fake-host ok --fixture $F --hold-at ssh --saved local --run settings-pick-checking wait live wait bots click button Settings wait settings click button Change click radio "Tailnet machine" type "Hermes machine" hermes-host click button Connect wait setup-checking shot pick-checking click button Research gone heading Settings current button Research wait live click button Settings wait settings count status Checking 0 count button Connect 0 count button Change 1 shot pick-checking-after quiet`. Main closes Settings before it opens Research and stops the check, so Settings opens again folded on This computer, as `pick-checking-after.png` shows.
- **The palette and the chat's shortcuts.** Run `$H run --fake-host ok --fixture $F --saved remote --run settings-palette wait live wait bots click button Settings wait settings press Control+n press Control+f count heading Settings 1 press Escape gone heading Settings count textbox "Find in chat" 0 current button "Emu, default bot" click button Settings wait settings press Control+k count dialog "Command palette" 1 count option "Open Settings" 0 count option "New chat" 1 shot settings-palette type "Search chats, bots and actions" Research press Enter gone heading Settings current button Research wait live quiet`.
- **The sidebar.** Run `$H run --fake-host ok --fixture $F --saved remote --run settings-mode wait live wait bots click button Settings wait settings click radio Chats checked radio Chats focused radio Chats count navigation Chats 1 count complementary Bots 0 shot settings-mode click radio Bots checked radio Bots count complementary Bots 1 quiet`.
- **A blocked link.** Run `$H run --fake-host hermes-not-found --saved local --run settings-blocked wait window wait offline click button Settings wait settings gone status Connection count button Retry 1 count button Change 1 shot settings-blocked`.
- **Narrow.** Run `$H run --fake-host ok --fixture $F --saved remote --size 760x860 --run settings-narrow wait live click button Settings wait settings click button Change type "Hermes machine" someone@$M click button Connect gone button Connect wait settings inview button Change inview radio Chats shot narrow-saved click button Change type "Hermes machine" hermes-lab click button Connect wait setup-failed inview button Connect inview textbox "Hermes machine" shot narrow-failed`.
- **Forced colors.** Run `$H run --fake-host ok --fixture $F --saved remote --forced-colors --run settings-forced wait live wait bots click button Settings wait settings click button Change focused textbox "Hermes machine" press Shift+Tab focused radio "Tailnet machine" checked radio "Tailnet machine" shot settings-forced`. The picked segments carry a `Highlight` border, and the focused one has the focus outline outside it.

## Gotchas

- `--hold-at ssh` holds the live remote connection's own probe too, so a running check is pinned from a saved `local` connection.
- The hidden chat's top bar still names the machine, as "on this computer", so a `see` of a machine name can match hidden text first. Prove the editor folded with `count button Connect 0` or `gone button Connect`.
- A passing check on a new machine starts a new epoch, which remounts the window. The sidebar is empty until the new connection lists the bots again.
- `wait settings` passes while the Settings heading is shown, whatever the card's state.
- The fake tailnet holds only the fake machine, so any other name fails at the peer step with "No machine called … is on your tailnet."
