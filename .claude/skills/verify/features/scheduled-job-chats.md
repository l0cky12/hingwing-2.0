# Scheduled-job chats

Hermes runs each scheduled (cron) job in a chat of its own and refuses any message a person sends there. Highwing leaves those chats, and the other chats a job runs, out of the Chats column, so launch opens the newest chat the user can talk in, even while a job's chat is newer. When Hermes refuses a message anyway, the failed turn says so in Highwing's words and offers "Start a new chat", which opens a new chat in the same bot with the message in its box.

## Sub-features

- `job-chats-hidden` leaves a chat whose source is a job (`cron`, `acp`, `kanban`, `oneshot`, `subagent`, `tool`) out of the Chats column and out of the launch pick.
- `job-refusal-words` words a turn Hermes refused with code `cron_session_read_only` as "This chat runs a scheduled job, so your message was not run. Start a new chat to send it."
- `job-refusal-new-chat` opens a new chat in the same bot from the refused turn's "Start a new chat" button, with the message in the box after any text already there, and sends it there.

## How to get to it (user POV)

- Launch Highwing against a Hermes that has a scheduled job. The chat that opens is a chat the user started, and the job's chat is not in the Chats column.
- Send a message into a job's chat, for example from another client that still opens it. The turn ends with the refusal words and a "Start a new chat" button under them.
- Click "Start a new chat", then Send.

## Driving it with highwing-verify

Preconditions:

- `fixtures/cron.jsonl` comes from `python3 fixtures/make_cron_fixture.py`. Its live list holds a cron chat, "Nightly backup check", newer than the story's chat. Its story refuses the first `prompt.submit` the way Hermes refuses a message in a job's chat. The story's chat stands in for the job's chat, because launch must never open the real one.
- The story's admission echoes the text "Check the backups ran", so the recipe types exactly that.
- The gateway makes a new chat `chat-default-1` for an untitled `session.create` and answers there with `default: <text>`.

- **Hidden, refused, new chat.** Run `$H run --fixture fixtures/cron.jsonl --run scheduled-job-chats wait live absent "Nightly backup check" shot launched type "Message Hermes" "Check the backups ran" click button Send see "This chat runs a scheduled job, so your message was not run. Start a new chat to send it." shot refused click button "Start a new chat" wait unstarted focused textbox "Message Hermes" value "Message Hermes" "Check the backups ran" shot carried click button Send said "default: Check the backups ran" shot sent called session.create '{"source":"gui","follow_profile_config":true}' 1 called prompt.submit '{"session_id":"chat-default-1"}' 1 quiet`. `refused.png` shows the words with the button under them, `carried.png` the new chat's box holding the message, and `sent.png` the reply in the new chat.

## Gotchas

- The scripted gateway serves the cron row only in the live list. Its home profile's stored list holds only chats a branch made. Both lists go through the same row parser, and `packages/hermes/test/parse.test.ts` covers it.
- Attachments of the refused message are not carried to the new chat. Only its text is.
- The refusal words end in "Start a new chat to send it.", so `see "Start a new chat"` matches the words as well as the button. Click the button by its role.
