# Task board

Ctrl+Shift+T (Cmd+Shift+T on a Mac) opens the Tasks view in place of the chat, with the Bots or Chats column kept at its left. It shows the kanban board of the connected Hermes: one column for each status that holds a card, in Hermes's order (triage, todo, scheduled, ready, running, blocked, review, done), each headed by its name and its count, and each card a button named by its title, with its assignee and the preview of its latest summary under it. Highwing reads the board afresh each time the view opens and when Refresh is pressed, over the gateway's HTTP API, since no socket call reads it. Refresh is off while a read runs. Close, or a chat picked in the left column, goes back to the chat.

A card opens the chat working on it. Highwing reads the card's detail, takes the session of its newest `owner_admitted` event and the bot named by that run's profile, and opens that chat in that bot, then the view closes. Hermes lists a kanban worker's chat in no chat list, so Highwing never finds it by asking. A card that never ran says "This task has no chat yet." under itself. A board with no card in any column says "No tasks yet." A Hermes with no kanban plugin says "This Hermes has no task board." A read that got no answer says "Highwing couldn't reach Hermes's task board." Live updates and editing a card are not part of it.

## Sub-features

- `task-board-shows` lists each column that holds a card with its count and each card with its title, assignee and summary.
- `task-board-refresh` reads the board again on Refresh.
- `task-board-open-chat` opens a running card's chat in the bot of its run, and closes the view.
- `task-board-no-chat` says a card that never ran has no chat yet, and opens nothing.
- `task-board-unsupported` says a Hermes with no kanban plugin has no task board.
- `task-board-fit` shrinks the lanes from 240 px down to 160 px so they share the column's width, and when even 160 px lanes don't fit, scrolls the board sideways with its scrollbar at the panel's bottom edge.
- `task-board-narrow` stacks the columns one above the other in a column too narrow for two of them, such as the chat column of a window 700 px wide, so every card shows whole.

## How to get to it (user POV)

- Press Ctrl+Shift+T (Cmd+Shift+T on a Mac). The shortcut sheet (Ctrl+/) lists it under Window as Tasks.
- Click a card to open its chat. Click Refresh to read the board again, and Close to leave.

## Driving it with highwing-verify

Preconditions:

- `K` is `--fixture fixtures/errand.jsonl --profiles fixtures/profiles/chats.json --kanban fixtures/kanban/small.json --mode bots`. `--kanban` sets the header's `kanban`, `{ board, tasks }`: the replies of Hermes's board route and of each card's detail route, as Hermes sends them, so the app's own readers run on them. Without it every read of the kanban routes is a 404, as on a Hermes without the plugin. `fixtures/kanban/small.json` holds Draft the quarterly summary (todo, never ran), Sort the invoices (running, assigned to `research`, its newest `owner_admitted` event naming `local-0102`) and two done cards.
- `fixtures/kanban/four-lanes.json` is `small.json` with a triage card, Check the new vendor contract. `fixtures/kanban/eight-lanes.json` also has a card in scheduled, ready, blocked and review, so every column holds one, and sixteen done cards, a lane taller than the window.
- `local-0102` is the "Sort the invoices" chat `chats.json` seeds in Research. It is listed by Research's own chat list, which a bots-mode run does not ask for, so opening the card puts the chat in Research only because the card names the bot. A chat Hermes lists nowhere cannot be seeded, so the run cannot show that part.
- Column names are drawn capitalized and are plain text, so `see todo` finds them. A card is `button "/<title>/"`, and its notes are `status` text.
- `said` reads the thread only. `see` reads the whole window.

- **Board, refresh and a card's chat.** Run `$H run $K --run task-board wait window wait live press Control+Shift+T see todo see "Sort the invoices" shot board click button Refresh see "Sort the invoices" click button "/Sort the invoices/" said "Sorted fourteen invoices" shot opened quiet`. The heading then reads "Research · Sort the invoices". Hermes sends all eight columns, and the board shot shows the three that hold cards: Todo 1, Running 1 and Done 2.
- **A card with no chat.** Run `$H run $K --run task-no-chat wait window wait live press Control+Shift+T click button "/Draft the quarterly summary/" see "This task has no chat yet." quiet`.
- **Lanes that shrink to fit.** Run `$H run $K --size 900x860 --run task-fit-900 wait window wait live press Control+Shift+T see "Sort the invoices" inview button "/Clean up Downloads/" inview button "/Archive last year's receipts/" shot fit-900`, then `$H run $K --kanban fixtures/kanban/four-lanes.json --run task-fit-1180 wait window wait live press Control+Shift+T see "Sort the invoices" inview button "/Check the new vendor contract/" inview button "/Clean up Downloads/" shot fit-1180`. The later `--kanban` wins. The 612 px column fits Todo, Running and Done, and the full window fits all four lanes, each narrower than 240 px.
- **More lanes than fit.** Run `$H run $K --kanban fixtures/kanban/eight-lanes.json --run task-scroll wait window wait live press Control+Shift+T see "Sort the invoices" inview button "/Check the new vendor contract/" flush .tasks "main:has(> .tasks)" shot scroll`. Eight 160 px lanes are wider than the column, so the board scrolls sideways. The Tasks body ends at the panel's bottom edge even though Done is taller than the window, and `scroll.png` shows the board's sideways scrollbar there, not under the lanes.
- **In a narrow column.** Run `$H run $K --size 700x860 --run task-narrow wait window wait live press Control+Shift+T see "Sort the invoices" inview button "/Sort the invoices/" inview button "/Clean up Downloads/" inview button "/Archive last year's receipts/" shot narrow`. The 412 px column is too narrow for two lanes, so `narrow.png` shows Todo, Running and Done one above the other, each card the column's width. Side by side, even 160 px lanes would not fit, so the board would scroll sideways and the `inview` steps would fail. Tasks pauses a page open full window, as Settings does (#284), so the board never sits in the 400 px panel beside one.
- **No task board.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/chats.json --mode bots --run task-none wait window wait live press Control+Shift+T see "This Hermes has no task board." click button Close see "New chat" quiet`.
