# Queue and steer

Hermes keeps one queue per chat, for every client. Highwing holds that queue, the lost turn a restart leaves at its head, and the words another client steers into a running turn. The window has no control for any of it yet and draws nothing new: a message this window sent shows "Queued" under the last turn until Hermes starts it, cancels it or replaces it, as before. Another client's queued message, a row on its way into the turn, a lost row and a steered line are held and not drawn.

## Sub-features

- `queue-own` shows "Queued" under a message sent while a turn runs, and takes it away when Hermes lists it no more.
- `queue-lost-turn` opens a chat after a restart with the lost turn in the thread, ending "Ended while Highwing was disconnected."
- `queue-elsewhere` plays the whole story with another client making every queue and steer call, and ends with three settled turns and no error.
- `queue-busy-read` reads the chat's busy mode once when the chat is shown, and a message sent in `queue` mode is a `prompt.submit`.

## How to get to it (user POV)

- Send a message while Hermes is still working on the one before. It waits under the thread as "Queued".
- Open a chat after Hermes restarted in the middle of a turn. That turn ends with the disconnected line.

## Driving it with highwing-verify

Preconditions:

- `fixtures/queue.jsonl`, played with `--acted-elsewhere`. Without it the story waits at its first step for a release the window cannot make.

- **Whole story.** Run `$H run --fixture fixtures/queue.jsonl --acted-elsewhere --timeout 40000 --run queue-elsewhere wait live said "Ended while Highwing was disconnected." shot opened said "Listing what changed in the notes folder." shot running type "Message Hermes" "Also update the changelog." click button Send see Queued shot queued said "update the changelog under Unreleased as well" shot steered type "Message Hermes" "Now draft the release notes." click button Send see Queued wait approval click button "Don't run" said "I left the drafts in place" shot denied type "Message Hermes" "Keep them to three lines." click button Send said "Release notes: notes renamed" said "No tag yet." gone button Stop shot settled absent Queued called prompt.submit '{}' 3 called approval.respond '{"choice":"deny"}' 1 called config.get '{"key":"busy"}' 1 called prompt.resolve_unknown '{}' 0 called prompt.cancel '{}' 0 called prompt.replace_queued '{}' 0 called prompt.steer_queued '{}' 0 called session.steer '{}' 0 called session.redirect '{}' 0 quiet`. `queued.aria.txt` holds `Also update the changelog.` followed by `Queued`, and no line for `And tag the release as v2.`, the other client's message. `settled.aria.txt` holds the lost turn, then `Then list what changed.` with its four steps and `You said no.`, then the two turns that followed, each ending `Done`.

## Gotchas

- The story waits for each of the three messages at a fixed point. Send one only after the line the recipe waits for, or the gateway fails the run with "the story did not expect prompt.submit".
- The third message goes out before the reply to the second arrives: Hermes holds that turn until the message is queued behind it.
- The steered lines are in the session and in `outline`, with the glyph `»`. The window does not draw them, so no ARIA snapshot holds one.
- The fixture's busy mode is `queue`. The stand-in user of `play` sets `steer` and `interrupt` itself, which the window cannot do yet.
