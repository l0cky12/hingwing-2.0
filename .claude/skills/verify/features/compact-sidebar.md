# Compact sidebar

In bot mode, the Compact sidebar button at the right end of the sidebar head, or Ctrl+B (Cmd+B on macOS), shrinks the bots column from 288 px to 72 px. Each bot shows only its face, and the face's tooltip names the bot. The default bot keeps its star, the open bot keeps its marker, a group chat keeps its stack of faces, and the section headings turn into thin rules. A row's menu opens beside its face from Shift+F10, the menu key or a right-click. The + menu opens beside the column. A search in progress ends when the sidebar compacts, since the compact head has no room for it. A status note or a refusal floats beside the column, and clicks pass through it. The same button, now at the top of the column, or Ctrl+B again brings the full sidebar back. Main keeps the pick in `sidebar-width.json` in the user-data directory, as `{"version":1,"width":"compact"}`, so it holds across a restart. Chat mode lists chats, not bots, so it keeps its full width, and Ctrl+B does nothing there.

## Sub-features

- `compact-toggle` compacts the sidebar with Ctrl+B and brings it back with the button, which keeps focus.
- `compact-restart` keeps the compact sidebar across a restart.
- `compact-menu` opens a face's menu beside it from Shift+F10, and Escape gives focus back to the face.
- `compact-search` ends a search when the sidebar compacts, so every bot shows again, and keeps focus on the toggle.
- `compact-new` opens the + menu beside the column, every row in view.
- `compact-groups` draws a group chat's faces inside the column.
- `compact-said` floats the "Pinned …" note beside the column, and a click on the paperclip under it still lands.
- `compact-unit` holds the rules in `apps/desktop/test/bots.test.tsx`, `bot-menu.test.ts`, `preferences.test.ts` and `ipc.test.ts`, not a run: the toggle says whether the sidebar is compact, each face carries its name as a tooltip only when compact, a menu with no ⋯ to hang from opens beside the row, `sidebar-width.json` reads and writes like `mode.json`, and `setSidebarWidth` reaches only main.

## How to get to it (user POV)

- In bot mode, press the Compact sidebar button in the sidebar head, or press Ctrl+B.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.
- Use a fresh `--run` name for each recipe. A `--fixture` run keeps its user-data directory, so a second run with the same name opens compact, and its Ctrl+B expands the sidebar.

- **Toggle, restart and menu.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --theme light --run compact-toggle wait window wait live pressed button "Compact sidebar" false shot full press Control+b pressed button "Compact sidebar" true shot compact relaunch wait window wait live pressed button "Compact sidebar" true shot relaunched click button Research current button Research press Shift+F10 see "Edit…" shot menu press Escape focused button Research click button "Compact sidebar" pressed button "Compact sidebar" false focused button "Compact sidebar" shot expanded`. `compact.png` shows the column of faces with Emu's star, and `menu.png` shows Research's menu beside its face. Run it again with `--theme dark` and a new `--run` name for the dark palette.
- **Search and the + menu.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run compact-search wait window wait live click button "Search bots" type "Search bots" Res count button "dr eggbot" 0 press Control+b pressed button "Compact sidebar" true focused button "Compact sidebar" count button "dr eggbot" 1 click button New see "New bot…" inview menuitem "New bot…" shot new-menu`. `new-menu.png` shows the menu to the right of the column.
- **Group chats.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/launch-group.json --theme dark --run compact-groups wait window wait live press Control+b pressed button "Compact sidebar" true shot groups`. `groups.png` shows Launch plan's three faces inside the column, between two rules.
- **Status note.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run compact-said wait window wait live press Control+b click button Research press Shift+F10 click menuitem "Pin to top" see "Pinned Research." shot said click button "Attach files"`. `said.png` shows the note beside the column, over the paperclip. The click on Attach files after it passes because the note lets clicks through.

## Gotchas

- A face's tooltip is the native `title`, which no shot shows. `bots.test.tsx` checks it.
- Below 680 px of window width the sidebar hides in both widths, as it always did.
- The window opens only once main has sent the width, so a compact window never draws the full column first.
