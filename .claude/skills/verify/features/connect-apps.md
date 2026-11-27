# Connect apps

Ctrl+Shift+M (Cmd+Shift+M on a Mac) or the Connect apps button at the bottom of the sidebar opens a dialog over the chat. One search field narrows the list by app name. Chips filter by category, and All lifts the Recommended category above the others. The line under the search says how many apps are connected, for the whole list. Each app shows Connected, Needs sign-in again, or Disconnected. Connect and Reconnect open the sign-in page in the browser, the row says Connecting…, and Open sign-in again opens that same page if the wait stalls. The row then shows the new standing. Remove drops a connected app. Escape or Ctrl+Shift+M closes the dialog.

## Sub-features

- `apps-open` opens the dialog from the Bots column and lists GitHub, Slack and Notion with 1 connected.
- `apps-search` keeps GitHub for "Git" and hides Slack.
- `apps-chip` shows only Chat, with Slack, and All brings the rest back.
- `apps-connect` shows Connecting…, opens the sign-in page once, then Connected and 2 connected.
- `apps-remove` drops Slack and leaves 1 connected.
- `apps-shortcut` closes and reopens the dialog with Ctrl+Shift+M.
- `apps-chats` opens the same dialog from the Chats column and reconnects Notion.

## How to get to it (user POV)

- Click Connect apps at the bottom of the Bots column or the Chats column.
- Press Ctrl+Shift+M. It does nothing while another dialog is open, and the first-run screen has no such shortcut.
- Settings lists the shortcut. A fixture run has no Settings, so that row is not driven here.

## Driving it with highwing-verify

Preconditions:

- `--connectors fixtures/connectors/two.json` gives the board. GitHub is Recommended and not connected. Slack is Chat and connected. Notion is Notes and needs sign-in again. Every connect opens `https://example.com/connect/github`.
- `--profiles fixtures/profiles/roster.json` lists the bots. The count starts at 1 connected.

- **Search, chips, connect, remove, shortcut.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --connectors fixtures/connectors/two.json --run connect-apps wait live wait bots count button "Connect apps" 1 shot closed click button "Connect apps" wait apps see "1 connected" see "Needs sign-in again" see "Disconnected" shot open type "Search apps" Git count button "Reconnect Slack" 0 count button "Connect GitHub" 1 shot search type "Search apps" "" see Slack click button Chat pressed button Chat true pressed button All false count button "Connect GitHub" 0 click button All pressed button All true click button "Connect GitHub" see "Connecting…" see "Open sign-in again" disabled button "Connect GitHub" shot connecting gone button "Open sign-in again" count button "Reconnect GitHub" 1 gone paragraph Disconnected see "2 connected" opened browse https://example.com/connect/github click button "Remove Slack" see "1 connected" count button "Reconnect Slack" 0 shot removed press Escape gone dialog "Connect apps" focused button "Connect apps" press Control+Shift+M wait apps see "1 connected" press Control+Shift+M gone dialog "Connect apps" called connectors.connect '{"owner":{"type":"account"},"connectors":["github"]}' 1 called connectors.accounts.remove '{"connection_id":"slack-1"}' 1 called connectors.operation.status '{}' 2 quiet`. `open.aria.txt` holds `dialog "Connect apps"`, the summary "1 connected", chips All, Recommended, Chat and Notes, and the three rows. `search.aria.txt` holds GitHub and no Slack. `connecting.aria.txt` holds "Connecting…" and "Open sign-in again".
- **Chats column and reconnect.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --connectors fixtures/connectors/two.json --mode chats --run connect-apps-chats wait live wait bots click button "Connect apps" wait apps see "1 connected" shot chats click button "Reconnect Notion" see "Connecting…" see "Open sign-in again" gone button "Open sign-in again" see "2 connected" absent "Needs sign-in again" opened browse https://example.com/connect/github quiet`. The button sits at the bottom of the Chats column. Reconnect settles the same way Connect does.

## Gotchas

- The sign-in settles on the second status read, about 800 ms after the click. Slack is already Connected, so that word does not prove a new sign-in. GitHub is proven by Reconnect GitHub, the Disconnected paragraph gone, and 2 connected. Notion is proven by the Needs sign-in again paragraph gone and 2 connected.
- `opened browse` wants exactly one browser open in the run. Connect and Reconnect each open the page, so a run that does both fails that step.
- `--connectors` answers `connectors.connect` itself. A story that waits on that call does not advance. `fixtures/errand.jsonl` does not wait on it.
- The in-turn sign-in card is a different surface. These runs do not open it.
- A fixture run has no Settings, so the shortcut row there is not in these runs.
