# Create a bot

New bot, the plus in the Bots column's header, opens a dialog with four fields: Name, Description, Model and Persona. Create makes the bot in Hermes (`profiles.create`), lists it under Unassigned and opens it, as a chat that has no message yet. The name is checked against the listed bots before anything is sent, and Hermes's own reason for a name it refuses shows under the field. Any other refusal shows above the buttons, and every typed value stays. Hermes's warnings show in the sidebar in words, and the bot exists all the same. While the link is down, or Hermes has not listed its bots or cannot create one, New bot stays focusable and says why.

## Sub-features

- `create-bot-dialog` opens the dialog with its four fields and Create disabled while Name is blank, and closes it with Escape or Cancel.
- `create-bot` fills the form, sends the typed values, lists the new bot, and opens it.
- `create-bot-taken` stops a name the roster has, a slash, and `default` in any case before any call.
- `create-bot-warnings` shows the warnings of a create in the sidebar, and clears them on the next bot picked.
- `create-bot-refused` shows Hermes's reason for a name under Name, and keeps the typed text.
- `create-bot-unsupported` shows a Hermes that refuses the call above the buttons, and keeps the typed text.

## How to get to it (user POV)

- Press the plus in the Bots column's header, or Tab to it and press Enter.

## Driving it with highwing-verify

Preconditions:

- `--profiles fixtures/profiles/roster.json` gives the gateway the six bots, and makes it answer `profiles.create` as Hermes does. `--models fixtures/models/three.json` gives the Model list its three models, which Hermes reads from the profile's own config when no chat is open.
- The bot is made as the lowercase name, so Rae shows as `button "rae"`. A new bot has no Bot Chat and no chats. A chat made in it answers `<profile>: <text>`.
- `called profiles.create '{...}' <n>` reads the params the app sent. The gateway records them in `gateway-calls.jsonl`.

- **The dialog.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --models fixtures/models/three.json --run create-bot-dialog wait live wait bots click button "New bot" count dialog "New bot" 1 count textbox Name 1 count textbox Description 1 count combobox Model 1 count textbox Persona 1 focused textbox Name disabled button Create shot dialog-open type Name Rae enabled button Create shot named press Escape gone dialog "New bot" focused button "New bot" click button "New bot" value Name "" click button Cancel gone dialog "New bot" called profiles.create '{}' 0 quiet`. `dialog-open.aria.txt` holds `dialog "New bot"` with the four fields and `button "Create" [disabled]`. Escape and Cancel close it with nothing sent, Escape gives focus back to New bot, and a reopened form is empty.
- **Create.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --models fixtures/models/three.json --run create-bot wait live wait bots click button "New bot" type Name Rae type Description "Writes the weekly report" select Model careful-large type Persona "You write short, plain reports for the team." shot filled click button Create gone dialog "New bot" count button rae 1 current button rae wait unstarted see "No chats yet." count heading "Hermes rae" 1 called profiles.create '{"name":"Rae","description":"Writes the weekly report","soul":"You write short, plain reports for the team.","model":"careful-large","provider":"acme"}' 1 shot created type "Message Hermes" hello click button Send said "rae: hello" called session.create '{"profile":"rae","title":"Bot Chat"}' 1 quiet`. `created.aria.txt` holds `button "rae"` in the Bots column, `status: No chats yet.` in the Chats column and `heading "Hermes rae"` in the top bar, so the chat pane is open on the new bot. The first message makes its Bot Chat in the `rae` profile and gets `rae: hello`.
- **A name the roster has.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run create-bot-taken wait live wait bots click button "New bot" disabled button Create type Name Research see "There's already a bot called research." disabled button Create press Enter shot taken type Name "my/bot" see "A name can't hold a slash." disabled button Create type Name " DEFAULT " see "There's already a bot called default." called profiles.create '{}' 0 quiet`. `taken.aria.txt` holds `textbox "Name" [invalid]: Research` and the sentence under it. Enter in the field sends nothing, and the run ends with no `profiles.create` call at all.
- **Warnings.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --create-warnings fixtures/profiles/create-warnings.json --run create-bot-warnings wait live wait bots click button "New bot" type Name Rae click button Create gone dialog "New bot" count button rae 1 see "Hermes made rae, with a warning: subscription logins not carried over (acme)" shot warned click button Research absent "with a warning" quiet`. The warning shows under the Bots column, and the bot is listed. Picking another bot clears it.
- **Hermes refuses the name.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run create-bot-refused wait live wait bots click button "New bot" type Name Root type Description "Keeps the books" type Persona "You keep the books." click button Create see "Profile name 'root' is reserved" shot refused count dialog "New bot" 1 value Name Root value Description "Keeps the books" value Persona "You keep the books." enabled button Create type Name Ledger click button Create gone dialog "New bot" count button ledger 1 called profiles.create '{"name":"Root"}' 1 called profiles.create '{"name":"Ledger","description":"Keeps the books"}' 1 quiet`. Hermes's words show under Name, the form keeps all three values, and a second name sends them again.
- **Hermes refuses the call.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --bound --run create-bot-unsupported wait bots click button "New bot" type Name Rae type Persona "You write reports." click button Create see "This Hermes can't create bots from Highwing." shot unsupported value Name Rae value Persona "You write reports." count dialog "New bot" 1 count button rae 0 quiet`. A socket with no interactive grant lists the bots but gets -32601 for `profiles.create`. The line shows above the buttons, the dialog stays and no bot is listed.

## Gotchas

- `select Model <option>` waits for the option, which is how a recipe waits for the model list. The list is read when the dialog opens, so a `shot` taken at once shows only "Hermes's default".
- The name Hermes keeps is the lowercase one, so the typed `Rae` is `rae` in the Bots column, the top bar and `called`.
- Without `--profiles` the gateway has no `profiles.create`, and the Bots column says the Hermes cannot list its bots, so New bot is unavailable. [Bots sidebar](./bots-sidebar.md) covers that.
- `called profiles.create '{}' 0` is checked again when the steps end, so it also fails on a call made by a later step.
- `see "..."` matches the dialog, the sidebar and the chat alike. Use `count` on the dialog to tell the dialog is still open.
- The dialog's `showModal()` makes the rest of the page inert, so a step that clicks outside it waits until the timeout.
