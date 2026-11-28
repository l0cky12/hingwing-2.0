# Set up a connection

With no saved connection Highwing opens on a setup screen, "Connect to Hermes", that holds the connection card: "Where Hermes runs" as Tailnet machine, named in the "Hermes machine" field, Web address, or This computer. [Connect by URL](./connect-by-url.md) covers the web address. Connect checks the choice one step at a time and shows the step it is at. A check that fails says what is wrong and one thing to try, and saves nothing. A check that passes on a first run saves the connection and shows the intro. Skip opens the chat. [First-run intro](./first-run-intro.md) covers the steps. From then on Highwing opens on the chat. The Hermes button at the foot of the sidebar opens Settings, where Change opens the same card, and Close goes back to the chat with its draft unchanged. [Settings](./settings.md) covers the card there.

## Sub-features

- `setup-empty` shows the form on a first run, with no Cancel button.
- `setup-checking` shows the step in flight, with the form and Connect disabled.
- `setup-failed` shows one failure per scenario, each with its words and its fix line.
- `setup-remote-chat` goes live on the fake machine's gateway through the fake `ssh`.
- `setup-saved-launch` starts on the chat when a connection is saved.
- `setup-edit-cancel` opens Settings over a live chat and closes it with the composer draft kept.
- `setup-switch` changes a saved connection from this computer to the fake machine in Settings.
- `setup-notice` says why a saved connection was not used when the file is unreadable or from a newer Highwing.

## How to get to it (user POV)

- Start Highwing for the first time, or press the Hermes button at the foot of the sidebar (or Ctrl+,), then Change.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines.
- Every recipe passes `--fake-host`. The fake machine is `hermes-host.example-tailnet.ts.net`.

Set `M=hermes-host.example-tailnet.ts.net` first.

- **Empty.** Run `$H run --fake-host ok --saved none --run setup-empty wait setup shot setup-empty`. The shot shows "Connect to Hermes", "Where Hermes runs" with Tailnet machine picked among its three segments, the "Hermes machine" field and Connect, and no Cancel.
- **Checking.** Run `$H run --fake-host ok --hold-at ssh --saved none --run setup-checking wait setup type "Hermes machine" $M click button Connect wait setup-checking shot setup-checking disabled button Connect`. The shot shows "Connecting to hermes-host".
- **A failure.** Run `$H run --fake-host <failure> --saved none --run setup-<failure> wait setup type "Hermes machine" $M click button Connect wait setup-failed shot setup-<failure>`, once per failure scenario. The `.aria.txt` holds the alert's two lines. `ssh-check` needs `--timeout 30000`.
- **Saved, then the remote chat.** Run `$H run --fake-host ok --saved none --run setup-connect wait setup type "Hermes machine" $M click button Connect wait intro click button Skip wait live shot remote-chat-live`. The shot shows "on hermes-host" in the top bar and an enabled Send button.
- **Saved at launch.** Run `$H run --fake-host ok --saved remote --run setup-saved-launch wait live shot saved-remote-launch`. No setup screen shows.
- **Edit, then Cancel.** Run `$H run --fake-host ok --saved remote --run setup-edit-cancel wait live type "Message Hermes" "half a thought" click button "/^Hermes on/" wait settings shot setup-editing click button Close wait live value "Message Hermes" "half a thought" shot cancel-kept-draft`.
- **Switch.** Run `$H run --fake-host ok --saved local --run setup-switch wait live click button "/^Hermes on/" wait settings click button Change click radio "Tailnet machine" type "Hermes machine" $M click button Connect gone button Connect focused button Change click button Close wait live shot switched-to-remote`. The top bar changes from "on this computer" to "on hermes-host". A check from Settings stays in Settings, so there is no "Open chat".
- **This computer.** Run `$H run --fake-host ok --saved none --run setup-local wait setup click radio "This computer" click button Connect wait intro click button Skip wait live shot local-chat-live`.
- **A file Highwing can't use.** Run `$H run --fake-host ok --saved unreadable --run setup-unreadable wait setup shot setup-unreadable`, and the same with `--saved newer`.

## Gotchas

- `ssh-check` takes 20 s. The fake ssh prints Tailscale's check link and waits, as the real one does, and the check reads what it printed when its deadline ends it.
- `slow` ends as `unreachable` after the same 20 s.
- `cant-save` is a machine that passes the check. The helper puts a directory where the settings file's temp file goes, so the save fails for real.
- In a `--fixture` run the app has no setup, and the Hermes button at the foot of the sidebar is off.
- `wait setup` needs the Connect button enabled. During a check use `wait setup-checking`.
- A run fails at teardown when the app quits and leaves a fake tool running. That is a defect in the app, not in the run.
