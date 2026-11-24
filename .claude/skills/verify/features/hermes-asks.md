# Hermes asks

Hermes can ask the people watching a chat for a sudo password, a secret, a one-time code, a batch of questions or a connector sign-in. Highwing holds each of these for the chat and answers none of them yet, because the window has no card for them. The window draws nothing new while one waits. A request for part of Hermes Desktop's own window, such as its theme picker, is refused at once while the window shows the chat, and the thread says so in one line.

## Sub-features

- `asks-waiting` leaves a sudo request open while the turn shows the command still running.
- `asks-elsewhere` plays the whole story with another client answering, and ends Done with no card and no new line.
- `asks-bridge-declined` answers the theme picker request with one `-32601`, and shows "Hermes sent a request Highwing can't show yet (theme.pick), so it said no."
- `asks-batch-declared` sends `clarify_batch: true` with the message, because the gateway said it sends batches.

## How to get to it (user POV)

- Send a request that makes Hermes run a `sudo` command, load a skill that needs a key, or ask several questions at once. In `fixtures/asks.jsonl` the one request does all of them.

## Driving it with highwing-verify

Preconditions:

- `fixtures/asks.jsonl`, sent with `@request`.

- **Left open.** Run `$H run --fixture fixtures/asks.jsonl --run asks-waiting wait live type "Message Hermes" @request click button Send wait tool-running shot waiting answered sudo '{}' 0 quiet`. `waiting.aria.txt` ends with `text: Running` and `code: sudo apt-get install -y jq`, and holds no group or textbox beside the composer's. The story stops here: it waits for an answer the window cannot give.
- **Whole story.** Run `$H run --fixture fixtures/asks.jsonl --answered-elsewhere --timeout 40000 --run asks-elsewhere wait live type "Message Hermes" @request click button Send wait settled shot settled answered theme.pick '{"error":{"code":-32601}}' 1 answered sudo '{}' 0 answered secret '{}' 0 answered vault.code '{}' 0 answered clarify '{}' 0 called clarify.lock '{}' 0 called connection.respond '{}' 0 called prompt.submit '{"clarify_batch":true}' 1 quiet`. `settled.aria.txt` holds the six steps from `Ran sudo apt-get install -y jq` to `Used set_theme`, the line about `theme.pick`, and the closing paragraph.

## Gotchas

- At recorded timing the story takes about 15 s, so `wait settled` needs `--timeout 40000`.
- Without `--answered-elsewhere` the run never settles. Nothing in the window can answer the sudo request.
- `answered` reads the request's method from the fixture the run plays. A method the fixture never asks counts 0.
- The line about `theme.pick` is the notice the thread already drew for a refused request. The other requests leave `closed` notices, which the window does not draw yet.
