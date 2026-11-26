# Set up a connection

With no saved connection Highwing opens on a setup screen that asks where Hermes runs: another machine of the tailnet, named in the "Hermes machine" field, a gateway at a web address, or this computer. [Connect by URL](./connect-by-url.md) covers the web address. Connect checks the choice one step at a time and shows the step it is at. A check that fails says what is wrong and one thing to try, and saves nothing. A check that passes saves the connection and shows the saved screen, and "Open chat" shows the chat. From then on Highwing opens on the chat. The Connection button in the top bar opens the setup screen again, and Cancel goes back to the chat with its draft unchanged.

## Sub-features

- `setup-empty` shows the form on a first run, with no Cancel button.
- `setup-checking` shows the step in flight, with the form and Connect disabled.
- `setup-failed` shows one failure per scenario, each with its words and its fix line.
- `setup-saved` shows the saved screen after a check passed.
- `setup-remote-chat` goes live on the fake machine's gateway through the fake `ssh`.
- `setup-saved-launch` starts on the chat when a connection is saved.
- `setup-edit-cancel` opens the form over a live chat and goes back with the composer draft kept.
- `setup-switch` changes a saved connection from this computer to the fake machine.
- `setup-notice` says why a saved connection was not used when the file is unreadable or from a newer Highwing.

## How to get to it (user POV)

- Start Highwing for the first time, or press Connection in the top bar of the chat.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines.
- Every recipe passes `--fake-host`. The fake machine is `hermes-host.example-tailnet.ts.net`.

Set `M=hermes-host.example-tailnet.ts.net` first.

- **Empty.** Run `$H run --fake-host ok --saved none --run setup-empty wait setup shot setup-empty`. The shot shows "Where does Hermes run?", the three choices, the "Hermes machine" field and Connect, and no Cancel.
- **Checking.** Run `$H run --fake-host ok --hold-at ssh --saved none --run setup-checking wait setup type "Hermes machine" $M click button Connect wait setup-checking shot setup-checking disabled button Connect`. The shot shows "Connecting to hermes-host".
- **A failure.** Run `$H run --fake-host <failure> --saved none --run setup-<failure> wait setup type "Hermes machine" $M click button Connect wait setup-failed shot setup-<failure>`, once per failure scenario. The `.aria.txt` holds the alert's two lines. `ssh-check` needs `--timeout 30000`.
- **Saved, then the remote chat.** Run `$H run --fake-host ok --saved none --run setup-connect wait setup type "Hermes machine" $M click button Connect wait setup-saved shot setup-saved click button "Open chat" wait live shot remote-chat-live`. The second shot shows "on hermes-host" in the top bar and an enabled Send button.
- **Saved at launch.** Run `$H run --fake-host ok --saved remote --run setup-saved-launch wait live shot saved-remote-launch`. No setup screen shows.
- **Edit, then Cancel.** Run `$H run --fake-host ok --saved remote --run setup-edit-cancel wait live type "Message Hermes" "half a thought" click button Connection wait setup shot setup-editing click button Cancel wait live value "Message Hermes" "half a thought" shot cancel-kept-draft`.
- **Switch.** Run `$H run --fake-host ok --saved local --run setup-switch wait live click button Connection wait setup click radio "Another machine on my tailnet" type "Hermes machine" $M click button Connect wait setup-saved click button "Open chat" wait live shot switched-to-remote`. The top bar changes from "on this computer" to "on hermes-host".
- **This computer.** Run `$H run --fake-host ok --saved none --run setup-local wait setup click radio "This computer" click button Connect wait setup-saved click button "Open chat" wait live shot local-chat-live`.
- **A file Highwing can't use.** Run `$H run --fake-host ok --saved unreadable --run setup-unreadable wait setup shot setup-unreadable`, and the same with `--saved newer`.

## Gotchas

- `ssh-check` takes 20 s. The fake ssh prints Tailscale's check link and waits, as the real one does, and the check reads what it printed when its deadline ends it.
- `slow` ends as `unreachable` after the same 20 s.
- `cant-save` is a machine that passes the check. The helper puts a directory where the settings file's temp file goes, so the save fails for real.
- In a `--fixture` run the app has no setup, and the top bar has no Connection button.
- `wait setup` needs the Connect button enabled. During a check use `wait setup-checking`.
- A run fails at teardown when the app quits and leaves a fake tool running. That is a defect in the app, not in the run.
