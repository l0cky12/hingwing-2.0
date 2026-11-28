# The bot's picture while it works

Under Replies only (see [Show the bot's work](./show-work.md)), a running turn ends in the bot's working mark on the thread rail. When the open chat's bot has a picture, that mark is the picture: 44 px, round, hopping with the same `hop` keyframes the face uses. The tip's words ("Thinking", "Working") move to the screen-reader-only `sr` class, and the elapsed time stays. A bot with no picture keeps the 22 px working face and its words, as before, and so does a bot whose picture is still loading or has not decoded in full: the face and words stay until the whole picture decodes, so a cut-off PNG never replaces them. Settings' Animations at 0 ms and the system's reduced motion both stop the hop, the first because `--duration-hop` scales with Animations, the second through the global `prefers-reduced-motion` rule.

Every bot can get a pet-style picture that Hermes draws with `image.generate`. Highwing redraws it onto a 512 px PNG, as the look picker's Generate tab does, and stores it with `profiles.set_asset`:

- A bot made with New bot… and left on its default look, or made from a template, gets one once, right after it is made. The bot shows its face until the pet arrives. A Hermes with no image model or without `image.generate` leaves the face, with no message.
- Each bot's Edit… dialog, and the bot details panel, have Generate pet picture after Upload picture. It reads "Drawing…" while Hermes draws, and shows Hermes's or Highwing's words when it cannot.

## Sub-features

- `working-picture` shows a pictured bot's picture hopping in place of the face, with the words for screen readers only.
- `working-picture-face` keeps the face, hopping, for a bot with no picture.
- `working-picture-still` stops the hop at Animations 0 ms and under reduced motion.
- `pet-from-edit` draws a pet for the default bot from its Edit… dialog, and `pet-from-edit-none` shows the refusal of a Hermes with no image model.
- `pet-at-creation` draws a pet for a new bot left on its default look, and `pet-from-template` for a bot made from a template.
- The unit tests in `apps/desktop/test/working-face.test.tsx` cover the mark under each pick, and `apps/desktop/test/pet-picture.test.ts` covers the prompt and each answer of the draw-and-save.

## How to get to it (user POV)

- Press Ctrl+Comma, open Appearance and pick Replies only under "Show the bot’s work". Send a message to a bot that has a picture.
- Right-click a bot in the Bots column, choose Edit…, and press Generate pet picture.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.
- Settings needs `--fake-host`, and a `--fake-host` run takes `--profiles` and `--images` only inside its fixture. Make that fixture once: `$H run --fixture fixtures/delegate.jsonl --profiles fixtures/profiles/rae.json --images fixtures/images/drawn.json --run working-picture-fixture wait live wait bots quiet`, then use `/tmp/highwing-verify/working-picture-fixture/fixture-edited.jsonl` as `$F` below. The story's chat is a new chat with Emu, the default bot, which has no picture.
- `working-mark <picture|face> <hopping|still>` reads the last working mark of the thread: whether it is the picture (loaded) or the face, its size, and the animations running on it with a duration above 0. Screenshots freeze animations, so this step is what proves the motion.

- **The picture hops.** Run `$H run --fake-host ok --fixture $F --saved remote --pick-file fixtures/pictures/rae.png --theme dark --timeout 30000 --run working-picture wait live press Control+Comma wait settings click button Appearance click radio "Replies only" checked radio "Replies only" click button Close wait live click button "More for Emu" click menuitem Edit… see "Upload picture" click button "Upload picture" avatar "Emu, default bot" picture press Escape type "Message Hermes" @request click button Send wait pet-picture working-mark picture hopping shot picture quiet`. The log says `the working mark is a 44 px picture, hopping (hop 1000 ms), beside "", read out as "Thinking"`, and `picture.aria.txt` still holds `status: Thinking`. Run it again with `--theme light`. On main the same steps fail at `wait pet-picture`, and `picture.png` shows the 22 px hexagon beside "Thinking".
- **No picture.** Run the same without `--pick-file` and the five upload steps, ending `wait pet working-mark face hopping shot face quiet` (`working-picture-face`). The log says `a 22 px face, hopping (hop 1000 ms), beside "Thinking", read out as ""`.
- **A cut-off picture.** Run the picture recipe with `--pick-file fixtures/pictures/truncated.png`, `reached profiles.set_asset '{"name":"default"}' 1` in place of `avatar "Emu, default bot" picture`, and `wait pet pause 1500 working-mark face hopping shot tip quiet` after Send. Main types a picture by its first bytes, so the upload is kept, but the tip keeps the face and "Thinking".
- **Still.** Run the picture recipe with `click slider Animations press Home see "0 ms"` before `click button Close`, and `working-mark picture still` in place of `working-mark picture hopping` (`working-picture-still`). Run it again with `--reduced-motion` and no slider steps, and once more without a picture and with `working-mark face still`. Each log says `still (none)`. On main the face run at 0 ms fails with `hopping (hop 1000 ms)`.
- **Pet from Edit….** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/rae.json --images fixtures/images/drawn.json --run pet-from-edit wait live wait bots avatar "Emu, default bot" letter click button "More for Emu" click menuitem Edit… see "Upload picture" click button "Generate pet picture" see Drawing… disabled button "Upload picture" shot drawing reached profiles.set_asset '{"name":"default","asset":"avatar"}' 1 avatar "Emu, default bot" picture see "Generate pet picture" count button "Remove picture" 1 shot drawn called image.generate '{"aspect_ratio":"square","max_bytes":8000000}' 1 quiet`. `drawn.png` shows the robot in the dialog and on Emu's row.
- **No image model.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/rae.json --images fixtures/images/none.json --run pet-from-edit-none wait live wait bots click button "More for Emu" click menuitem Edit… see "Upload picture" click button "Generate pet picture" see "No image generation backend configured" count alert "" 1 enabled button "Generate pet picture" shot refused called profiles.set_asset '{}' 0 avatar "Emu, default bot" letter quiet`. Without `--images` the alert says "This Hermes can't draw pictures."
- **At creation.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --images fixtures/images/drawn.json --run pet-at-creation wait live wait bots click button New click menuitem "New bot…" type Name Rae type Description "Writes the weekly report" click button Create gone dialog "New bot" count button rae 1 reached profiles.set_asset '{"name":"rae","asset":"avatar"}' 2 avatar rae picture shot created called image.generate '{"aspect_ratio":"square"}' 1 called profiles.set_asset '{"name":"rae"}' 2 quiet`. `gateway-calls.jsonl` holds the prompt, which names Rae and "Writes the weekly report". With `--images fixtures/images/none.json`, end with `reached image.generate '{}' 1 avatar rae picture absent "with a warning" called profiles.set_asset '{"name":"rae"}' 1 quiet`: the bot keeps its face, with no message.
- **From a template.** Run `$H run --run pet-from-template --fixture fixtures/errand.jsonl --profiles fixtures/profiles/skills.json --images fixtures/images/drawn.json --mode bots --yolo off --approvals manual wait window wait bots click button Connectors wait apps click tab /^Templates/ click button "Use template Bot Builder" click button "Create bot" gone dialog "Use template: Bot Builder" count button bot-builder 1 reached profiles.set_asset '{"name":"bot-builder","asset":"avatar"}' 2 avatar bot-builder picture shot template-pet called image.generate '{"aspect_ratio":"square"}' 1 called profiles.set_asset '{"name":"bot-builder"}' 2 quiet`.
- **Recording.** Run the picture recipe with `--video`, and with `click button "Generate pet picture" see Drawing… avatar "Emu, default bot" picture see "Generate pet picture"` in place of the upload, and `pause 3000 wait settled shot settled` after `working-mark picture hopping`. `video.webm` shows the pet drawn, then hopping until the turn settles with the Done ring.

## Gotchas

- `wait pet` waits for the working face, so a pictured run waits on `wait pet-picture` instead.
- The picture comes from the same cache as the sidebar avatar, so it is usually drawn at once. Until it is, the face shows.
- `called profiles.set_asset` for a new bot counts two calls with `--images`: the face from Create, then the pet. Without `--images` the gateway refuses `image.generate`, and the count stays at one.
