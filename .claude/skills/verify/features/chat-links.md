# Chat links

A `highwing://chat/<session id>` link opens that chat on the Hermes Highwing is connected to. The link can come from the launch command line, from a second launch while Highwing runs, or from macOS. A second launch hands its link to the running window, brings the window forward, and exits. A link that arrives before Highwing is connected, or during first run, waits and opens once the chat shows. A link that arrives while Settings is up closes Settings and opens, as a palette pick does. While Settings is saving a new connection it waits, and opens on the new one. When Hermes has no chat with that id, the open chat stays and the composer says "That chat isn't on this Hermes." until the next click. The top bar and each chat row's More menu offer Copy link, which puts the open chat's link, or the row's, on the clipboard.

## Sub-features

- `link-launch` opens the chat a launch names, in the bot it lives in.
- `link-second` opens the chat a second launch names in the first window, with no second window, and the second process exits.
- `link-missing` keeps the open chat and shows "That chat isn't on this Hermes." for an id Hermes has no chat for, until the next click.
- `link-copy` copies a chat's link from the top bar and from a row's More menu.
- `link-seek` opens a chat whose bot only Hermes's lists name, after searching every bot.
- `link-held` holds a link through the setup screen and opens it once the chat shows.
- `link-settings` closes Settings and opens the chat a second launch names.

## How to get to it (user POV)

- Click a `highwing://chat/...` link in a note, a terminal, a chat app or a browser, on a machine where the Highwing package is installed.
- Or run `highwing highwing://chat/<session id>`.
- To get a link, press Copy link in the top bar, or open a chat row's More menu (the `⋯` button) and choose Copy link.

## Driving it with highwing-verify

Preconditions:

- `--arg <link>` passes the link on the launch command line. `second <link>` starts a second instance with the same binary, arguments, user-data directory and environment, and waits for it to exit.
- `--profiles fixtures/profiles/roster.json` makes `local-0001` Research's Bot Chat, so its bot is known from the roster. `--profiles fixtures/profiles/chats.json` gives Research the chats `local-0101`, `local-0102` and `local-0103`, whose bot only a list names.
- A link search sends `session.list` with `{"scope":"stored","include_hidden":true,"limit":200}` once for each of the six bots. The sidebar's own lists send `limit` 100 with `picker`, so the step below counts only the search.

- **Launch.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --arg highwing://chat/local-0001 --mode chats --run link-launch wait window wait bots current button "Bot Chat" inview button "Bot: Research" see "Research · Bot Chat" wait live called session.list '{"scope":"stored","include_hidden":true,"limit":200}' 0 shot opened home quiet`. No search runs, because the roster names the chat's bot.
- **Second launch.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --mode chats --run link-second wait window wait bots wait live inview button "Bot: Emu" shot before second highwing://chat/local-0001 current button "Bot Chat" inview button "Bot: Research" see "Research · Bot Chat" home shot after quiet`. `steps.log` shows the second instance's exit code, and `home` proves the app still has one window.
- **Missing.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run link-missing wait window wait bots wait live current button "Emu, default bot" second highwing://chat/local-9999 see "That chat isn't on this Hermes." reached session.list '{"scope":"stored","include_hidden":true,"limit":200}' 6 current button "Emu, default bot" home shot missing click button Research current button Research absent "That chat isn't on this Hermes." quiet`.
- **Copy.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/chats.json --mode chats --run link-copy wait window wait bots wait live click button "/^Bot: /" click menuitemradio Research inview button "Bot: Research" see "Sort the invoices" click button "Sort the invoices" current button "Sort the invoices" click button "Copy link" copied highwing://chat/local-0102 see Copied click button "More for Clean up Downloads" click menuitem "Copy link" copied highwing://chat/local-0103 see "Link copied" shot copied current button "Sort the invoices" quiet`. Copying from a row leaves the open chat as it is.
- **A copied link, found by search.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/chats.json --arg highwing://chat/local-0103 --mode chats --run link-seek wait window wait bots current button "Clean up Downloads" inview button "Bot: Research" see "Research · Clean up Downloads" said "Clean up my Downloads folder." reached session.list '{"scope":"stored","include_hidden":true,"limit":200}' 6 home shot opened quiet`. Use `local-0101` and "Send invoice reminder" for the chat that waits on an approval.
- **Held through setup.** Set `M=hermes-host.example-tailnet.ts.net`, then run `$H run --fake-host ok --saved none --arg highwing://chat/local-9999 --run link-held wait setup type "Hermes machine" $M click button Connect wait intro shot held-on-intro click button Skip wait live see "That chat isn't on this Hermes." shot delivered quiet`. The fake machine lists no bots, so the search reads the socket's own profile and finds nothing. The first shot is the intro, and the notice shows that the link reached the chat after Skip.
- **Into Settings.** Make the roster fixture of [Settings](./settings.md) and set `F` as it says, then run `$H run --fake-host ok --fixture $F --saved remote --run link-settings wait live wait bots current button "Emu, default bot" click button Settings wait settings second highwing://chat/local-0001 gone heading Settings current button Research wait live home quiet`. The link closes Settings and opens Research's Bot Chat.

## Gotchas

- Only a packaged build registers the `highwing` scheme with the desktop, so a run never changes the user's `mimeapps.list`. The desktop side (`xdg-mime query default x-scheme-handler/highwing` and `xdg-open`) needs an installed Arch package and is not driven here.
- `copied` reads the system clipboard of the run's own X display. Two copies of the same text cannot be told apart, so copy two different chats.
- The top bar shows Copy link only while the open chat has a session. An unstarted chat has no link yet.
- A link for the chat already open changes nothing and searches nothing.
- The fake gateway gives every stored list in one page, so paging is proven by `packages/hermes/test/open.test.ts`, not by a run.
