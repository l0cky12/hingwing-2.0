# Hermes button

The foot of the sidebar, in bot mode and in chat mode, names the Hermes this window is connected to: a round mark, "Hermes", the machine (`on hermes-host`) when there is a saved connection, and Connected or Not connected. It is one button, and its accessible name says all three, such as "Hermes on hermes-host, Connected". A press, Enter or Space opens [Settings](./settings.md), and Close or Escape there puts focus back on the button. A `--fixture` run has no connection to change, so the button is off and named "Hermes, Connected". The Connectors button sits beside it in the same row, and opens the Connectors screen as [Connectors](./connectors.md) says. The row ends in the mode toggle, "Switch to Chats" or "Switch to Bots", as [Bot mode and chat mode](./modes.md) says. In the compact bots column (Ctrl+B) the foot shows only the round mark, stacked over the Connectors button and the mode toggle, and the button keeps its full accessible name.

## Sub-features

- `hermes-foot` names the machine and the link at the foot of the sidebar.
- `hermes-settings` opens Settings, and closing Settings puts focus back on the button.
- `hermes-offline` says Not connected while the link is down, and still opens Settings.
- `hermes-fixture` is off in a fixture run.
- `hermes-row` puts the Connectors button and the mode toggle beside the button, and opens the Connectors screen from there.

## How to get to it (user POV)

- Press the Hermes row at the bottom of the sidebar.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.

- **Settings and back.** Run `$H run --fake-host ok --saved remote --mode chats --run hermes-settings wait window wait live shot hermes-foot click button "/^Hermes on hermes-host, Connected$/" wait settings click button Close focused button "/^Hermes on/" press Enter wait settings press Escape focused button "/^Hermes on/" quiet`. `hermes-foot.png` shows the mark, "Hermes", "on hermes-host" and a green "Connected".
- **Bot mode, compact.** Run `$H run --fake-host ok --saved remote --mode bots --run hermes-compact wait window wait live press Control+b click button "/^Hermes on hermes-host, Connected$/" wait settings click button Close focused button "/^Hermes on/" shot hermes-compact quiet`. `hermes-compact.png` shows the round mark alone over the Connectors button and the mode toggle.
- **Not connected.** Run `$H run --fake-host hermes-not-found --saved local --run hermes-offline wait window wait offline count button "Hermes on this computer, Not connected" 1 click button "/^Hermes on/" wait settings quiet`.
- **A fixture run.** Run `$H run --fixture fixtures/errand.jsonl --run hermes-fixture wait window wait live disabled button "Hermes, Connected" quiet`.
- **Connectors beside it.** Run `$H run --fixture fixtures/errand.jsonl --connectors fixtures/connectors/two.json --run hermes-row wait window wait live count button Connectors 1 click button Connectors wait apps see "Needs sign-in again" press Escape gone region Connectors focused button Connectors quiet`.

## Gotchas

- Settings fills the window and hides the sidebar, so the button is out of reach while Settings is open.
- Below 680 px wide the window hides the sidebar, and the button with it. Ctrl+Comma and the palette's Open Settings still open Settings there.
