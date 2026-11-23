# Choose the model

Under the message box, a quiet readout names the model the chat runs on, such as "Model: fast-small". Pressing it opens a list of the models Hermes offers this chat, one radio each, grouped by provider when there are several. Choosing one switches the chat. While a turn runs, the switch waits for that turn to end. The list and the readout then say "Applies to the next message." When Hermes offers no model, the readout says "No model set up" in the caution color, and Send still works. A Hermes that does not list its models shows no readout at all.

## Sub-features

- `model-list` opens the list, with the current model checked.
- `model-switch` switches an idle chat with one call to Hermes. The readout names the new model once Hermes says it.
- `model-deferred` holds a switch made during a turn, shows "Applies to the next message.", and leaves the turn running.
- `model-none` shows "No model set up" when Hermes offers no model.
- `model-confirm` shows Hermes's question when a switch needs a second yes, at once or when the turn it waited on ends, with "Use <model> anyway" and "Keep <current>".
- `model-unsupported` hides the readout when Hermes refuses `model.options` as an unknown method.

## How to get to it (user POV)

- Open a chat. The readout sits under the message box, at its left edge. Press it.

## Driving it with highwing-verify

Preconditions:

- `--models fixtures/models/three.json` offers fast-small (current), careful-large and local-7b. `--models fixtures/models/none.json` offers none. Without `--models` the scripted gateway refuses `model.options` as unknown.

- **List and switch.** Run `$H run --fixture fixtures/errand.jsonl --models fixtures/models/three.json --run model-switch wait live click button "Model: fast-small" count radio 3 checked radio fast-small shot list-open click radio careful-large see "Model: careful-large" called session.mutate '{"operation":"model","payload":{"model":"careful-large"}}' 1 shot switched quiet`.
- **Switch during a turn.** Run `$H run --fixture fixtures/errand.jsonl --models fixtures/models/three.json --run model-deferred wait live type "Message Hermes" @request click button Send wait approval click button "Model: fast-small" click radio careful-large see "Applies to the next message." press Escape see "Model: fast-small, then careful-large" called session.interrupt '{}' 0 click button "Run once" wait settled see "Model: careful-large" gone "Applies to the next message." shot committed quiet`.
- **None set up.** Run `$H run --fixture fixtures/errand.jsonl --models fixtures/models/none.json --run model-none wait live see "No model set up" enabled button Send shot no-model`.
- **Confirm a held switch.** Run `$H run --fixture fixtures/errand.jsonl --models fixtures/models/three.json --guarded careful-large --run model-confirm wait live type "Message Hermes" @request click button Send wait approval click button "Model: fast-small" click radio careful-large see "Applies to the next message." press Escape click button "Run once" wait settled see "careful-large costs more per message." click button "Use careful-large anyway" see "Model: careful-large" called session.mutate '{"operation":"model","payload":{"model":"careful-large","confirm":"confirm-careful-large"}}' 1 shot confirmed quiet`.
- **Not supported.** Run `$H run --fixture fixtures/errand.jsonl --run model-unsupported wait live called model.options '{"explicit_only":true}' 1 gone "Model:" gone "No model set up" quiet`. The rest of the errand and its C shots are unchanged.

## Gotchas

- The readout changes only when Hermes names the new model on the chat's stream. A switch is never shown before Hermes confirms it.
- The list stays open after a choice. Press Escape or the readout to close it.
- `called` counts what reached the scripted gateway, from `gateway-calls.jsonl`. It works only in `--fixture` runs.
