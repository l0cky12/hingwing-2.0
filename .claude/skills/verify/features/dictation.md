# Dictation

A microphone button sits beside the paperclip in a chat's composer. It and Ctrl+D (Cmd+D on macOS) in the message box start and stop dictation. While it records, the button is filled in and pressed ("Stop dictating"), and a line under the box says "Listening. Press Ctrl+D or the microphone to stop." Holding the keys while talking works too: letting go after at least 400 ms stops. Hermes then turns the recording into text ("Turning speech into text…"), and the text lands at the caret, in place of any selection, ready to edit. Nothing is sent until the user sends. Hermes does the transcription through its own `/api/audio/transcribe`, so a Hermes with no speech-to-text answers in its own words. A missing microphone and a refused one have plain words of their own. The group composer has no microphone, as it has no paperclip.

## Sub-features

- `dictate-keys` starts with Ctrl+D, stops with Ctrl+D, and puts the text after what was typed, with nothing sent.
- `dictate-button` starts and stops with the button, and puts the text at the caret in the middle of the text.
- `dictate-no-stt` shows Hermes's words when it cannot transcribe, and leaves the box as it was.
- `dictate-no-mic` shows "Highwing can't find a microphone. Connect one, then try again."
- `dictate-denied` shows "Highwing isn't allowed to use the microphone. Allow it in your system's privacy settings, then try again."

## How to get to it (user POV)

- Press the microphone left of the message box, or Ctrl+D in it, speak, and press either again.

## Driving it with highwing-verify

Preconditions:

- A fixture whose first step awaits `prompt.submit`, such as `fixtures/errand.jsonl`, and a WAV file of speech for `--microphone`. `espeak-ng -w speech.wav "book a table"` makes one.

- **Keys.** Run `$H run --fixture fixtures/errand.jsonl --transcribe fixtures/transcribe/heard.json --microphone speech.wav --run dictate wait live type "Message Hermes" "Book a table for two" press Control+d pressed button "Stop dictating" true shot recording pause 1500 press Control+d see "Turning speech into text…" pause 1200 value "Message Hermes" "Book a table for two at seven by the window" focused textbox "Message Hermes" shot heard pause 1000 absent "In /tmp/hermes-proto-work" click button Send see "In /tmp/hermes-proto-work" called prompt.submit '{"text":"Book a table for two at seven by the window"}' 1 called prompt.submit '{}' 1`. `recording.aria.txt` shows `button "Stop dictating" [pressed]` and the Listening status.
- **Button, at the caret.** With a `--transcribe` file holding `{ "text": "a table", "delay_ms": 300 }`, run `... wait live type "Message Hermes" "Book for two" press Home press Control+ArrowRight click button Dictate pause 800 click button "Stop dictating" pause 900 value "Message Hermes" "Book a table for two"`.
- **No speech-to-text.** Run `$H run --fixture fixtures/errand.jsonl --transcribe fixtures/transcribe/no-stt.json --microphone speech.wav --run dictate-no-stt wait live click button Dictate pause 600 click button "Stop dictating" see "Hermes couldn't turn that into text." value "Message Hermes" ""`.
- **No microphone.** Run `$H run --fixture fixtures/errand.jsonl --run dictate-no-mic wait live click button Dictate see "Highwing can't find a microphone"`.
- **Refused.** Run `$H run --fixture fixtures/errand.jsonl --microphone speech.wav --arg=--use-fake-ui-for-media-stream=deny --run dictate-denied wait live click button Dictate see "Highwing isn't allowed to use the microphone"`.

## Gotchas

- The fixture answers its `transcribe` text whatever the recording said. A real Hermes is the only proof of the words themselves.
- `value` reads the box at once. Pause past the file's `delay_ms` before it.
- `called` is checked again when the steps end, so assert the submit count once, after Send, and prove nothing went before it with `absent` on the reply.
