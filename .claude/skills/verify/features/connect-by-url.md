# Connect by URL

The connection card has a third segment, "Web address", with a "Gateway address" field. Connect checks the address, opens Hermes's sign-in page in the browser, and waits. After the sign-in the check opens the gateway and saves the connection. On a first run it shows the intro, and Skip opens the chat. [First-run intro](./first-run-intro.md) covers the steps. In Settings the card folds on the address and says "Highwing now uses the Hermes on <host>." A bad address is refused in words before anything is contacted, and a plain http address gets a warning under the field while Connect stays on. A check that fails says what is wrong and one thing to try. After a restart the chat opens with no browser when the computer has a keyring. With no keyring, or after Hermes ended the sign-in, the banner says so and offers Sign in, which opens Settings and checks the address there. Close then goes back to the chat.

## Sub-features

- `url-form` shows the four segments and the "Gateway address" field.
- `url-plain-http` shows the warning under the field for an `http://` address, with Connect on.
- `url-problem` shows "That isn't a web address.", the username-or-password words and the `?`-or-`#` words, each before any request.
- `url-sign-in-waiting` shows "Waiting for you to sign in" with "It never sees your password." and Stop waiting.
- `settings-sign-in-wait` shows the same wait in Settings, with Cancel and no Sign in in the row.
- `url-failed` shows one failure per scenario, each with its words and its fix line.
- `url-chat` goes live through the fake Webapp and plays the errand.
- `url-relaunch` reopens the saved address after a restart: straight to the chat with a keyring, and the Sign in banner with none.
- `url-sign-in-ended` shows "Your sign-in to the Hermes on 127.0.0.1 has ended." and signs in again from the banner.
- `url-login-form` signs in on Hermes's own password form, as a run against a real gateway does.

## How to get to it (user POV)

- Start Highwing for the first time, or press the Hermes button at the foot of the sidebar (or Ctrl+,) and then Change, and pick "Web address".

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines.
- Every recipe passes `--fake-webapp`, except the last, which reaches a real gateway.

Set `U="Web address"` first. `@webapp` types the address of the run's gateway. Each recipe that connects starts with `C`:

```
C=(wait setup click radio "$U" type "Gateway address" @webapp click button Connect)
```

- **The form.** Run `$H run --fake-webapp ok --run url-form wait setup click radio "$U" shot url-form`. The shot shows the four segments and the field with `https://hermes.example.com` as its placeholder.
- **Plain http.** Run `$H run --fake-webapp ok --run url-plain-http wait setup click radio "$U" type "Gateway address" "http://hermes.example.com:9120" see "This address uses plain http" enabled button Connect shot url-plain-http browsed 0`.
- **A problem with the address.** Run `$H run --fake-webapp ok --run url-problems wait setup click radio "$U" type "Gateway address" "ftp://hermes.example.com" click button Connect wait setup-failed shot url-not-an-address type "Gateway address" "https://ada:password@hermes.example.com" click button Connect wait setup-failed shot url-credentials type "Gateway address" "https://hermes.example.com/?token=abc" click button Connect wait setup-failed shot url-extras browsed 0`.
- **Connect and chat.** Run `$H run --fake-webapp ok --run url-connect "${C[@]}" wait intro click button Skip wait live shot url-chat-live browsed 1 type "Message Hermes" @request click button Send wait approval click button "Run once" wait settled shot url-chat-settled quiet`. The top bar reads "on 127.0.0.1".
- **A failure.** Run `$H run --fake-webapp <scenario> --run url-<scenario> "${C[@]}" wait setup-failed shot url-<scenario>`, once for each of `url-unreachable`, `url-certificate`, `not-hermes`, `no-sign-in`, `dashboard`, `sign-in-refused`, `url-no-socket`, `url-legacy`, `too-old` and `ungated`. The `.aria.txt` holds the alert's two lines.
- **Waiting, then Stop waiting.** Run `$H run --fake-webapp sign-in-cancelled --run url-sign-in-cancelled "${C[@]}" wait setup-checking see "Waiting for you to sign in to 127.0.0.1 in your browser" browsed 1 shot url-sign-in-waiting click button "Stop waiting" wait setup-failed shot url-sign-in-cancelled`.
- **Waiting in Settings, then Cancel.** Run `$H run --fake-webapp sign-in-cancelled --saved url --run settings-sign-in-wait wait offline click button "Sign in" wait settings wait setup-checking see "Waiting for you to sign in to 127.0.0.1 in your browser" see "It never sees your password." count button "Sign in" 0 enabled button Cancel shot settings-sign-in-wait click button Cancel gone status Checking wait settings count button "Sign in" 1 count button Change 1 quiet`. The row offers no Sign in while the check waits, since main runs one check at a time, and Cancel stays in Settings with Sign in back.
- **The sign-in times out.** Run `$H run --fake-webapp sign-in-timed-out --sign-in-ms 1500 --run url-sign-in-timed-out "${C[@]}" wait setup-failed shot url-sign-in-timed-out`.
- **Restart with a keyring.** Run `$H run --fake-webapp ok --keyring test --run url-relaunch-kept "${C[@]}" wait intro click button Skip wait live browsed 1 relaunch wait live shot url-relaunch-kept type "Message Hermes" @request click button Send wait approval click button "Run once" wait settled browsed 1`. The second `browsed 1` proves the restart opened no browser.
- **Restart with no keyring.** Run `$H run --fake-webapp ok --run url-relaunch-no-keyring "${C[@]}" wait intro click button Skip wait live browsed 1 relaunch wait offline see "This computer has no keyring, so Highwing asks each time it starts." shot url-relaunch-no-keyring click button "Sign in" wait settings see "Highwing now uses the Hermes on 127.0.0.1." focused button Change click button Close wait live gone status Connection browsed 2`.
- **Hermes ended the sign-in.** Run `$H run --fake-webapp ok --keyring test --run url-sign-in-ended "${C[@]}" wait intro click button Skip wait live webapp sign-out relaunch wait offline see "Your sign-in to the Hermes on 127.0.0.1 has ended." shot url-sign-in-ended click button "Sign in" wait settings see "Highwing now uses the Hermes on 127.0.0.1." focused button Change click button Close wait live gone status Connection browsed 2`.
- **Saved at launch.** Run `$H run --fake-webapp ok --saved url --run url-saved-launch wait offline shot url-saved-launch`. The saved address opens on the chat with the Sign in banner, because the run has no keyring.
- **Hermes's password form.** Put a made-up username in one file and a made-up password in another, set `HIGHWING_VERIFY_USER_FILE` and `HIGHWING_VERIFY_PASSWORD_FILE` to the two paths, and run `$H run --fake-webapp ok --login-form --run url-login-form "${C[@]}" wait intro click button Skip wait live browsed 1`. `steps.log` holds "the browser filled Hermes's form and reached Highwing's callback", and `sign-in-page-1.png` is the form before anything was typed.
- **A real gateway.** With the two variables naming the files of a real user, run `$H run --webapp-url <address> --timeout 60000 --run url-real "${C[@]}" wait intro shot real-intro click button Skip wait live shot real-chat browsed 1`. Delete the two files afterwards. Add `relaunch wait offline shot real-relaunch click button "Sign in" wait settings see "Highwing now uses the Hermes on" click button Close wait live browsed 2` to prove the restart with no keyring.

## Gotchas

- The fake Webapp listens on `http://127.0.0.1:<port>`, so the words name the gateway as "127.0.0.1". The port changes with each run. Type the address with `@webapp`.
- A loopback address is not plain http to Highwing, so a `--fake-webapp` run never shows the warning for its own gateway. Type an `http://` address of another host to see it.
- Main records each page it would open in `opens.jsonl` and opens nothing. The run answers each request for the gateway's sign-in page itself: the fake's user follows it in the `signs-in` scenarios and leaves it open in `sign-in-cancelled` and `sign-in-timed-out`.
- A run with no `--keyring` passes `--password-store=basic`, so it never reaches the desktop's own keyring, and fails if the app wrote `sign-ins.json`. `--keyring test` keeps sign-ins unsealed, which only a build that is not installed allows. `--keyring system` uses the desktop's keyring, and can make the keyring ask you to unlock it.
- A run fails if any evidence file, or any file in the app's user-data directory, holds a token, a code or a ticket the fake Webapp made. A `--login-form` or `--webapp-url` run fails the same way on the username or the password.
- `sign-in-timed-out` says "within 10 minutes" however short `--sign-in-ms` makes the wait. The words are fixed.
- `relaunch` takes about 5 s, because the app does not finish quitting before the helper's limit and is then killed.
- In a `--webapp-url` run every shot, `.aria.txt` and log names the gateway's host as `hermes.example.com`. The port is left as it is.
- A `--webapp-url` run plays no fixture, so `@request` means nothing there. Type the message yourself.
