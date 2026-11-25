# Queue and steer

Hermes keeps one queue per chat, for every client. Highwing draws each row of it under the last turn: "Queued" with Send now, Edit and Cancel as Hermes allows, "From another app" for another client's row, "On its way into this turn" for a row sent now, and a lost row that a restart left at the head of the queue, with Discard. A pressed button stays disabled, saying what it does ("Cancelling…"), until Hermes lists the row differently. Edit puts the row in the composer under "Editing a queued message. It moves to the back of the queue." While the chat's busy mode hands a send to the running turn, one line under the composer says so. Words steered into a turn show in it as a quiet line. An approval that can be denied offers "Tell Hermes what to do instead".

## Sub-features

- `queue-lost` shows the lost row "Hermes restarted during this message and can't finish it. Messages behind it wait until you discard it." with Discard, which sends `prompt.resolve_unknown` and lets the queue run.
- `queue-rows` shows this window's row as "Queued" and another client's as "Queued" and "From another app", each with Send now, Edit and Cancel.
- `queue-edit` puts a queued row in the composer with the editing line, and Send replaces it with `prompt.replace_queued`.
- `queue-cancel` and `queue-send-now` send `prompt.cancel` and `prompt.steer_queued`. A row sent now reads "On its way into this turn" and its words show in the turn.
- `busy-hint` reads "Hermes is working. It reads this after its current step." in `steer` mode and "Hermes is working. It stops this step to read this." in `interrupt` mode, and nothing in `queue` mode. A send then goes as `session.steer` or `session.redirect`, and its words show in the turn.
- `deny-and-tell` opens a field from the approval card. Escape closes it. "Don't run and send" sends `session.steer` with the words, then `approval.respond` with `deny`.

## How to get to it (user POV)

- Send a message while Hermes is still working on the one before. It waits under the thread as "Queued".
- Open a chat after Hermes restarted in the middle of a turn. The lost row waits under the thread.
- Type `/busy steer` or `/busy interrupt`, then send while Hermes works.
- Press "Tell Hermes what to do instead" on a "Run this command?" card.

## Driving it with highwing-verify

Preconditions:

- `fixtures/queue.jsonl`, played with `--catalog fixtures/catalog/busy.json`. The recorded story switches busy mode between sends, and the window does that with `/busy`, which Highwing runs only when Hermes's catalog lists it. The catalog holds Hermes's own `/busy` entry.

- **Whole story from the window.** Run `$H run --fixture fixtures/queue.jsonl --catalog fixtures/catalog/busy.json --timeout 20000 --run queue-window wait live see "Hermes restarted during this message" shot queue-lost click button Discard said "Listing what changed in the notes folder." type "Message Hermes" "Also update the changelog." click button Send see "And tag the release as v2." shot queue-rows click-at button Edit 1 see "Editing a queued message. It moves to the back of the queue." value "Message Hermes" "Also update the changelog." shot queue-editing type "Message Hermes" "Also update the changelog, under Unreleased." click button Send gone button "Saving…" click-at button Cancel 1 gone button "Cancelling…" absent "And tag the release as v2." click button "Send now" see "On its way into this turn" shot queue-steering said "update the changelog under Unreleased as well" said "Ran cat" type "Message Hermes" "/busy steer" click button Send see "busy input mode: steer" see "Hermes is working. It reads this after its current step." shot busy-steer type "Message Hermes" "Use ISO dates in the changelog." click button Send said "Use ISO dates in the changelog." type "Message Hermes" "/busy queue" click button Send see "busy input mode: queue" absent "Hermes is working." type "Message Hermes" "Now draft the release notes." click button Send see Queued said "Running git tag" type "Message Hermes" "/busy interrupt" click button Send see "Hermes is working. It stops this step to read this." shot busy-redirect type "Message Hermes" "Skip the tag for now." click button Send said "Skip the tag for now." wait approval click button "Tell Hermes what to do instead" press Escape gone textbox "What Hermes should do instead" click button "Tell Hermes what to do instead" type "What Hermes should do instead" "Move it to the trash instead of deleting it." shot deny-tell click button "Don't run and send" said "I left the drafts in place" said "Move it to the trash instead of deleting it." shot denied type "Message Hermes" "Keep them to three lines." click button Send said "Release notes: notes renamed" said "No tag yet." gone button Stop shot settled absent Queued called prompt.resolve_unknown '{}' 1 called prompt.replace_queued '{"text":"Also update the changelog, under Unreleased."}' 1 called prompt.cancel '{"admission_id":"c75b21de236841f792cf21a484fc796f"}' 1 called prompt.steer_queued '{"admission_id":"f820ae7717784565b88c96ec737e7239"}' 1 called session.steer '{"text":"Use ISO dates in the changelog."}' 1 called session.steer '{"text":"Move it to the trash instead of deleting it."}' 1 called session.redirect '{}' 2 called approval.respond '{"choice":"deny"}' 1 called prompt.submit '{}' 3 called config.get '{"key":"busy"}' 1 called config.set '{"key":"busy"}' 3 quiet`. `queue-rows.aria.txt` holds `Also update the changelog.` with `Queued` and three buttons, then `And tag the release as v2.` with `Queued`, `From another app` and three buttons. `settled.aria.txt` holds the lost turn, then `Then list what changed.` with the four steered lines in it, then the two turns that followed, each ending `Done`.

## Gotchas

- The story waits for each call at a fixed point. Act only after the line the recipe waits for, or the gateway fails the run with "the story did not expect …". In particular, Cancel waits for "Saving…" to go, because until Hermes lists the edit the first Cancel is the edited row's, and Send now waits for "Cancelling…" to go.
- `/busy` is a `config.set`, not a story call, so it can go at any time.
- The redirect of "Keep them to three lines." is rejected unread, so Highwing sends the words as a message: that is the third `prompt.submit`.
- A lost row reads "Hermes restarted…" with no sender, since after a restart even this window's rows read as another app's.
- The fixture's denial lands in the turn, so the card shows no line about where the words went. No fixture drives the `next` or `unsure` line.
