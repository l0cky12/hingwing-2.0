# Bot templates

The Connectors screen's fifth tab, Templates, sits after Tools and shows "Templates 3" at once, without waiting on Hermes. It opens like the other tabs, from the Connectors button or Ctrl+Shift+M, then the tab. Above the cards it says "Start a new bot from a template." It does not depend on the "Configuring:" bot, because a template makes a new bot.

Three cards lie two to a row, and one to a row in a narrow window. Each shows the template's name, "Template", a one-line summary, "Turns on: " and the tools in plain words, and "Approval: Manual" or "Approval: Smart". Nightly Repo Auditor adds "Runs nightly at 2:00 AM". Each has a Use template button named "Use template <name>".

- **Bot Builder.** "Describe a bot, and it makes the bot for you." Turns on Terminal, Files, Ask you questions, Skills and To-do list. Manual approval.
- **Deep Researcher.** "Researches a question across many sources and writes a report with sources." Turns on Web, Browser, Helpers, Files, To-do list, Memory and Ask you questions, with no Terminal. Smart approval.
- **Nightly Repo Auditor.** "Checks a code repository every night and reports problems." Turns on Terminal, Files, Web and Memory. Smart approval. Runs nightly.

Use template opens a modal dialog titled "Use template: <name>" with focus in the Bot name field, which holds the template's name and can be edited. The auditor's dialog also has Repository folder, a required text field with the hint "A folder path on the computer Hermes runs on, not on this one.", and Run time, a time field that starts at 02:00. A "What it sets up" box lists the start of the personality, the tools, the approval mode as "Manual: asks before every command" or "Smart: asks only when a command looks risky", and for the auditor the schedule, which follows the Run time field. Create bot is disabled in this release, with "Making the bot comes in the next update." under it. Cancel and Escape close the dialog and put focus back on the Use template button. Escape does not also close the Connectors screen.

## Sub-features

- `bt-cards` shows the Templates tab in dark and light at 1440x900 and in a narrow window.
- `bt-builder` opens Bot Builder's dialog and closes it with Escape.
- `bt-auditor` opens the auditor's dialog, types a folder and closes it with Cancel.

## How to get to it (user POV)

- Open Connectors (the grid-plus button at the bottom right of the sidebar, or Ctrl+Shift+M) and choose the Templates tab, or press Right from the Tools tab.

## Driving it with highwing-verify

Every recipe uses the `cx-after` fixtures: `--fixture fixtures/errand.jsonl --profiles fixtures/profiles/skills.json --connectors fixtures/connectors/two.json --mcp fixtures/mcp/servers.json --plugins fixtures/plugins/two.json --tools fixtures/tools/three.json --mode bots`.

- **The cards.** Run `$H run --run bt-cards --fixture fixtures/errand.jsonl --profiles fixtures/profiles/skills.json --connectors fixtures/connectors/two.json --mcp fixtures/mcp/servers.json --plugins fixtures/plugins/two.json --tools fixtures/tools/three.json --mode bots --theme dark --size 1440x900 wait window wait bots click button Connectors wait apps count tab "Templates 3" 1 click tab /^Templates/ see "Start a new bot from a template." count button "Use template Bot Builder" 1 count button "Use template Deep Researcher" 1 count button "Use template Nightly Repo Auditor" 1 see "Runs nightly at 2:00 AM" shot templates-dark quiet`. Run it again with `--theme light` for the light shot, and with `--size 860x900` for the narrow one, where the cards stack one to a row.
- **Bot Builder's dialog.** Run `$H run --run bt-builder --fixture fixtures/errand.jsonl --profiles fixtures/profiles/skills.json --connectors fixtures/connectors/two.json --mcp fixtures/mcp/servers.json --plugins fixtures/plugins/two.json --tools fixtures/tools/three.json --mode bots --theme dark --size 1440x900 wait window wait bots click button Connectors wait apps click tab /^Templates/ click button "Use template Bot Builder" see "Use template: Bot Builder" value "Bot name" "Bot Builder" focused textbox "Bot name" count textbox "Repository folder" 0 absent "Run time" disabled button "Create bot" see "Making the bot comes in the next update." shot dialog-builder press Escape gone dialog "Use template: Bot Builder" count tab "Templates 3" 1 focused button "Use template Bot Builder" quiet`.
- **The auditor's dialog.** Run `$H run --run bt-auditor --fixture fixtures/errand.jsonl --profiles fixtures/profiles/skills.json --connectors fixtures/connectors/two.json --mcp fixtures/mcp/servers.json --plugins fixtures/plugins/two.json --tools fixtures/tools/three.json --mode bots --theme dark --size 1440x900 wait window wait bots click button Connectors wait apps click tab /^Templates/ click button "Use template Nightly Repo Auditor" see "A folder path on the computer Hermes runs on" type "Repository folder" /home/liam/code/billing-api value "Run time" "02:00" disabled button "Create bot" shot dialog-auditor click button Cancel gone dialog "Use template: Nightly Repo Auditor" focused button "Use template Nightly Repo Auditor" quiet`.

## Gotchas

- Every tab's panel stays in the page while hidden, so `see` can match another tab's text. The template names appear only on this tab.
- A `type` step moves focus to the field it fills, so check `focused textbox "Bot name"` before typing.
- Create bot is disabled until the next update makes it work, so no recipe clicks it and no gateway call is made.
