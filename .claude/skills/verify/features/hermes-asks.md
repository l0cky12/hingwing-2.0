# Hermes asks

Hermes can ask the people watching a chat for a sudo password, a secret, a one-time code, a batch of questions or a connector sign-in. The window answers two of these. A sudo password and a secret such as an API key each get a card under the thread, with a masked field, **Skip** and **Send**. The value goes to Hermes in the reply and nowhere else: not the thread, the find index, a log or a recording. The other requests are held for the chat and drawn as nothing, because the window has no card for them yet. A request for part of Hermes Desktop's own window, such as its theme picker, is refused at once while the window shows the chat, and the thread says so in one line.

## Sub-features

- `asks-sudo-card` asks "Hermes needs your sudo password" with the redacted command, when Hermes stops waiting, and a `Password` field.
- `asks-secret-card` asks "Hermes needs a secret" with Hermes's reason, the variable name and a `Secret value` field.
- `asks-send` sends the typed value once and clears the field. The card becomes "You sent a password." or "You sent the secret."
- `asks-skip` sends `{ value: "" }`. The card becomes "You skipped this."
- `asks-withdrawn` closes the card when Hermes withdraws the request, with "Hermes withdrew this request."
- `asks-reconnect` keeps the card across a dropped link, shows it disabled while the link is down, and answers once it is back.
- `asks-elsewhere` plays the whole story with another client answering. The card closes with "Answered from another window."
- `asks-bridge-declined` answers the theme picker request with one `-32601`, and shows "Hermes sent a request Highwing can't show yet (theme.pick), so it said no."
- `asks-batch-declared` sends `clarify_batch: true` with the message, because the gateway said it sends batches.

## How to get to it (user POV)

- Send a request that makes Hermes run a `sudo` command, or load a skill that needs a key. In `fixtures/asks.jsonl` the one request does both, then asks for a code, a batch of questions and a connector sign-in.

## Driving it with highwing-verify

Preconditions:

- `fixtures/asks.jsonl`, sent with `@request`.
- The test password is `hunter2`. A `type` step into a password field logs `"•••"`, and `gateway-calls.jsonl` writes the value as `•••`, so no evidence file holds it.
- The card's **Send** shares its name with the composer's, so press it with `click-at button Send 1`. The card comes first in the page.

- **Left open.** Run `$H run --fixture fixtures/asks.jsonl --run asks-waiting wait live type "Message Hermes" @request click button Send wait tool-running shot waiting answered sudo '{}' 0 quiet`. `waiting.aria.txt` ends with `text: Running` and `code: sudo apt-get install -y jq`, then `group "Hermes needs your sudo password"` holding the command, `Hermes waits until <time>.`, `textbox "Password"`, `button "Skip"` and a disabled `button "Send"`. The story stops here: it waits for the window's answer.
- **Sudo sent.** Run `$H run --fixture fixtures/asks.jsonl --answered-elsewhere --answer-here sudo --timeout 40000 --run asks-sudo-sent wait live type "Message Hermes" @request click button Send see "Hermes needs your sudo password" shot card disabled-at button Send 1 type Password hunter2 click-at button Send 1 said "You sent a password." shot sent answered sudo '{"result":{"value":"•••"}}' 1 wait settled shot settled quiet`. The gateway got a non-empty value once, `sent.aria.txt` has the line "You sent a password." where the card was, and `steps.log` shows the typed text as `"•••"`.
- **Secret shown and skipped.** Run `$H run --fixture fixtures/asks.jsonl --answered-elsewhere --answer-here secret --timeout 40000 --run asks-secret-skipped wait live type "Message Hermes" @request click button Send see "Hermes needs a secret" count group "Hermes needs a secret" 1 count textbox "Secret value" 1 value "Secret value" "" see TENOR_API_KEY shot card click-at button Skip 1 said "You skipped this." shot skipped answered secret '{"result":{"value":""}}' 1 gone group "Hermes needs a secret" wait settled quiet`. `card.aria.txt` holds `group "Hermes needs a secret"`, `code: TENOR_API_KEY` and `textbox "Secret value"` with no value. The gateway got `{ value: "" }` once.
- **Withdrawn.** Run `$H run --fixture fixtures/asks.jsonl --answered-elsewhere --cancel sudo=shutdown --timeout 40000 --run asks-sudo-withdrawn wait live type "Message Hermes" @request click button Send see "Hermes needs your sudo password" shot card said "Hermes withdrew this request." gone group "Hermes needs your sudo password" shot withdrawn answered sudo '{}' 0 wait settled quiet`. The card is open for about 1.5 s, then the thread reads "Hermes withdrew this request." and the gateway got no answer.
- **Reconnect.** Run `$H run --fixture fixtures/asks.jsonl --answered-elsewhere --answer-here sudo --drop-after sudo --timeout 40000 --run asks-sudo-reconnect wait live type "Message Hermes" @request click button Send wait offline disabled-at button Skip 1 shot dropped wait live count group "Hermes needs your sudo password" 1 shot reconnected type Password hunter2 click-at button Send 1 said "You sent a password." answered sudo '{"result":{"value":"•••"}}' 1 wait settled quiet`. The socket drops 50 ms after the sudo request. The card stays, its buttons are disabled until the redial lands, and Send then answers the request once.
- **Whole story.** Run `$H run --fixture fixtures/asks.jsonl --answered-elsewhere --timeout 40000 --run asks-elsewhere wait live type "Message Hermes" @request click button Send wait settled shot settled answered theme.pick '{"error":{"code":-32601}}' 1 answered sudo '{}' 0 answered secret '{}' 0 answered vault.code '{}' 0 answered clarify '{}' 0 called clarify.lock '{}' 0 called connection.respond '{}' 0 called prompt.submit '{"clarify_batch":true}' 1 quiet`. `settled.aria.txt` holds the six steps from `Ran sudo apt-get install -y jq` to `Used set_theme`, "Answered from another window." after the sudo and after the secret step, the line about `theme.pick`, and the closing paragraph.

## Gotchas

- At recorded timing the story takes about 15 s, so `wait settled` needs `--timeout 40000`.
- Without `--answered-elsewhere` the run never settles past the sudo request unless the window answers it.
- `--answer-here sudo` and `--answer-here secret` leave the window the request. Without it `--answered-elsewhere` plays another client answering, and the sudo and secret cards close with "Answered from another window." after a moment.
- `answered` reads the request's method from the fixture the run plays. A method the fixture never asks counts 0.
- Requests with no card (a code, a login or vault request, a batch of questions, a connector card) leave no line in the thread. The line about `theme.pick` is the notice for a request refused at once.
- The card's "Hermes waits until" time is the clock of the run, so a snapshot of it changes from run to run.
