# Library

The details panel of [Bot details](./bot-details.md) has a Library tab after Routines. It lists the files, images and links the bot's chats made, newest first, each with its type and when its chat made it. Main reads the bot's stored chats ten at a time with `session.list` and `session.transcript` under the bot's profile: a file is one a `write_file` or `patch` that worked reported, an image is a written image file or an http(s) markdown image in a reply, and a link is an http(s) link in a reply. One row stands for one file or address, from its newest mention. While older chats remain, the tab says "From Rae's 10 newest chats." and offers Look in older chats. A name opens the item in the preview pane and closes the panel. A file of the Hermes machine has Save…. With Hermes on this computer Save copies the file. With Hermes on another machine or at a web address it asks Hermes for the file through `GET /api/fs/download`, and never opens the file at that path on this computer. [docs/compatibility.md](../../../../docs/compatibility.md) lists the routes, the credentials and every refusal's words.

## Sub-features

- `library-list` lists the items of Rae's two chats, newest first, with a failed write left out and one row for a file both chats wrote, reads under Rae's profile, and saves a file of a Hermes on this computer by copying it.
- `library-preview` opens a file, an image file, a link and a web image in the preview pane, each closing the panel.
- `library-save-web` saves a file from a Hermes at a web address through its download route, with Hermes's text and not this computer's, and shows the file's row in the pane as a file on that machine.
- `library-save-ssh` does the same for a Hermes on another machine, with a `native-http` ticket minted for Rae through a relay of its own.
- `library-cant-send` says "This Hermes can't send files to Highwing. Update Hermes, then try again." for a Hermes with no download route, and saves nothing.

## How to get to it (user POV)

- Open a bot's chat, click the bot's name in the top bar, then click Library.

## Driving it with highwing-verify

Preconditions: `--profiles fixtures/profiles/library.json`. Its chats name `/tmp/highwing-library/notes.md` and `chart.svg`, and its `files` key holds the Hermes machine's own text of both, "Sent by the Hermes machine.". Before a run, write this computer's copies, with other words, so a save that read this computer would save the wrong text:

```
mkdir -p /tmp/highwing-library
printf '# Weekly report\n\nWritten on this computer.\n' > /tmp/highwing-library/notes.md
printf '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#f43f5e"/></svg>\n' > /tmp/highwing-library/chart.svg
```

Set `O=(wait live wait bots click button Rae said "The weekly report is ready" click button "Details for Rae" see "Upload picture" click tab Library)`, which opens Rae's Library, and `W=(wait setup click radio Web type "Gateway address" @webapp click button Connect wait intro click button Skip)`, which connects to the fake Webapp.

- **List, and save on this computer.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/library.json --run library-list "${O[@]}" see "Sales by week" see "source data" see "chart.svg" see "notes.md" see "https://hermes-agent.nousresearch.com/docs" same-row button "New bot…" heading Rae inview tab Library count list Library 1 count button "Save notes.md…" 1 count button "Save chart.svg…" 1 count button "/^Save .*(source data|Sales by week|docs)/" 0 count button "Look in older chats" 0 absent "draft.md" count button Close 1 count button Save 0 shot library-list called session.list '{"scope":"stored","include_hidden":true,"limit":11,"profile":"rae"}' 1 called session.transcript '{"session_id":"local-0301","inline_images":false,"profile":"rae"}' 1 click button "Save notes.md…" see "Saved notes.md to" saved notes.md "Written on this computer." count dialog Rae 1 shot library-saved quiet`. `library-list.aria.txt` holds, in order, Sales by week (Image), source data (Link), chart.svg (Image), notes.md (File) and the docs link (Link), with Save… on the two files only. `library-saved.aria.txt` holds `status: Saved notes.md to …/saves/notes.md.`.
- **Preview.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/library.json --run library-preview "${O[@]}" click button notes.md gone dialog Rae wait preview previewing "/notes\.md$/" page-says "Written on this computer." shot library-preview-file click button "Details for Rae" see "Upload picture" click tab Library click button chart.svg gone dialog Rae previewing "/chart\.svg$/" shot library-preview-image click button "Details for Rae" see "Upload picture" click tab Library click button "source data" gone dialog Rae previewing https://example.com/data click button "Details for Rae" see "Upload picture" click tab Library click button "Sales by week" gone dialog Rae previewing https://example.com/sales.png nothing-opened nothing-saved quiet`. `library-preview-image.png` shows the rose rectangle of this computer's `chart.svg`.
- **Save from a web address.** Run `$H run --fake-webapp ok --profiles fixtures/profiles/library.json --run library-save-web "${W[@]}" "${O[@]}" see "notes.md" click button "Save notes.md…" see "Saved notes.md to" saved notes.md "Sent by the Hermes machine." shot library-web-saved click button notes.md gone dialog Rae wait preview see "This file is on 127.0.0.1. Save it to open it on this computer." shot library-web-preview quiet`.
- **Save over ssh.** Run `$H run --fake-host ok --saved remote --profiles fixtures/profiles/library.json --run library-save-ssh "${O[@]}" see "notes.md" click button "Save notes.md…" see "Saved notes.md to" saved notes.md "Sent by the Hermes machine." shot library-ssh-saved click button notes.md gone dialog Rae wait preview see "This file is on hermes-host. Save it to open it on this computer." shot library-ssh-preview quiet`. The file comes only through the fake gateway's download route, which only a `native-http` ticket minted for Rae reaches, through a relay to a port only the fake `ssh -W` knows.
- **Can't send.** Write a copy of the profiles with no `files`, `node -e "const f=JSON.parse(require('fs').readFileSync('fixtures/profiles/library.json','utf8')); delete f.files; require('fs').writeFileSync('/tmp/highwing-library/no-files.json', JSON.stringify(f))"`, then run `$H run --fake-webapp ok --profiles /tmp/highwing-library/no-files.json --run library-cant-send "${W[@]}" "${O[@]}" see "notes.md" click button "Save notes.md…" see "This Hermes can't send files to Highwing. Update Hermes, then try again." count alert "" 1 count dialog Rae 1 nothing-saved shot library-cant-send quiet`.

## Gotchas

- Each open of the tab reads the chats again, so `called session.list` counts one call per open in a run.
- The verify run's time zone decides the dates the rows show, so a recipe checks names and types, and leaves dates to `apps/desktop/test/library-tab.test.tsx`.
- A `--fixture` run is a Hermes on this computer, so its Save always copies. The decoy file at the same path, and `apps/desktop/test/library.test.ts`, prove a remote Save never opens it.
- `example.com` may not answer in a sandbox. `previewing` passes once the page's load has stopped, loaded or failed.
- `--profiles` is the one fixture option `--fake-host` and `--fake-webapp` take.
