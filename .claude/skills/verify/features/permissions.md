# Permissions

Settings → Permissions lists what the open chat's bot always allows and always denies, as its Hermes holds them: the `command_allowlist` as "Always allowed" and `approvals.deny` as "Denied". Each rule is a code line with a Remove button. Remove asks first, in a dialog that names the rule and says what Hermes does once it is gone, with Cancel and "Remove rule". Under the lists, "Add a rule" takes a text field, an Allow or Deny choice (Allow to start) and an Add button, which is off until the field holds a rule the chosen list lacks. A list with no rule says "Nothing is always allowed." or "No commands are denied." Hermes has no list of commands to ask about first, so there are two lists and no third.

Highwing reads the lists over the gateway's HTTP API, since no socket call carries them, and writes only the one list a change touches, so `approvals.mode` and every other key stay as they are. After a save it reads them again and draws what Hermes holds: a Hermes that dropped the save says "Hermes didn't save that change. An administrator may manage this setting." under the form, and the lists stay as they were. A Hermes whose route or ticket is missing says "This Hermes can't show its command rules to Highwing. Update Hermes, then try again." in place of the lists. While the page is open it asks the socket for the config's token every few seconds and when the window comes back to the front, and reads the lists again only when it moved.

After "Always allow" on an approval card, the answered card adds "Saved as an allow rule." and an Open Permissions button, which opens Settings on this page.

## Sub-features

- `permissions-lists` shows both lists with each rule in its own row, with its Remove button, and the line that says whose rules they are.
- `permissions-add` adds a rule to Always allowed and another to Denied. The field empties, the lists show the rule, and Add stays off for a rule the chosen list already holds.
- `permissions-remove` asks before a rule goes. Cancel and Escape keep it. "Remove rule" removes it.
- `permissions-search` finds the page's rows by words such as allowlist and remove rule.
- `permissions-unsupported` says a Hermes with no `/api/config` for Highwing can't show its rules.
- `permissions-locked` says Hermes didn't save a change on a managed install, and leaves the lists as they were.
- `permissions-open-from-approval` follows Open Permissions on an answered Always allow card into Settings on this page.

## How to get to it (user POV)

- Open Settings from the Hermes button at the foot of the sidebar, Ctrl+Comma, or Open Settings in the palette, then Permissions. The page shows the bot whose chat is open.
- Choose "Always allow" on an approval card, then Open Permissions on the card.

## Driving it with highwing-verify

Preconditions:

- Settings opens only in a `--fake-host` run, which plays a Hermes on another machine. Its fake `hermes gateway tickets --serve` mints a `native-http` ticket, bound to a profile when the line names one, and its loopback listener serves `GET` and `PUT /api/config` behind Hermes's gate, from the fixture header's `rules`. Make the fixture once with `--rules`, in a `--fixture` run, and hand its `fixture-edited.jsonl` to the `--fake-host` run, as the Usage recipe does.
- `R` is `/tmp/highwing-verify/permissions-fixture/fixture-edited.jsonl`, made by `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --rules '{"allow":["delete in root path","podman *"],"deny":["rm -rf /","git push --force"]}' --run permissions-fixture wait live wait bots`.
- `L` is `/tmp/highwing-verify/permissions-locked-fixture/fixture-edited.jsonl`, made the same way with `--rules '{"allow":[],"deny":[],"locked":true}'` and `--run permissions-locked-fixture`.
- `A` is `/tmp/highwing-verify/permissions-always-fixture/fixture-edited.jsonl`, made from `fixtures/always.jsonl` instead of the errand, with the same `--rules` as `R` and `--run permissions-always-fixture`.
- The roster fixture of `$F`, made without `--rules`, has no `/api/config`, so its page shows the unsupported words.
- The page opens on the open chat's bot, the default one. The rules are the fixture's for every bot, and a save moves only the bot it names.

- **Lists.** Run `$H run --fake-host ok --fixture $R --saved remote --run permissions-lists wait live wait bots click button "/^Hermes on/" wait settings click button Permissions see "Always allowed" see "podman *" see "delete in root path" see "rm -rf /" count list "Always allowed" 1 count list Denied 1 count button "Remove podman * from Always allowed" 1 count button "Remove rm -rf / from Denied" 1 disabled button Add shot permissions-lists quiet`.
- **Add to each list.** Run `$H run --fake-host ok --fixture $R --saved remote --run permissions-add wait live wait bots click button "/^Hermes on/" wait settings click button Permissions type "Rule to add" "cargo *" click button Add see "Added “cargo *” to Always allowed." count button "Remove cargo * from Always allowed" 1 value "Rule to add" "" disabled button Add click radio Deny type "Rule to add" "curl *" click button Add see "Added “curl *” to Denied." count button "Remove curl * from Denied" 1 type "Rule to add" "curl *" see "That rule is already in the denied list." disabled button Add shot permissions-add quiet`. Each Add is a read, a PUT of that list alone and a read, so the lists drawn are Hermes's.
- **Remove asks first.** Run `$H run --fake-host ok --fixture $R --saved remote --run permissions-remove wait live wait bots click button "/^Hermes on/" wait settings click button Permissions click button "Remove podman * from Always allowed" see "Stop always allowing “podman *”?" see "Hermes will ask before it runs a command that matches it" shot permissions-remove click button Cancel gone dialog "Stop always allowing “podman *”?" count button "Remove podman * from Always allowed" 1 click button "Remove rm -rf / from Denied" press Escape gone dialog "Stop denying “rm -rf /”?" count button "Remove rm -rf / from Denied" 1 click button "Remove rm -rf / from Denied" click button "Remove rule" gone dialog "Stop denying “rm -rf /”?" see "Removed “rm -rf /” from Denied." count button "Remove rm -rf / from Denied" 0 count button "Remove git push --force from Denied" 1 shot permissions-removed quiet`.
- **Search.** Run `$H run --fake-host ok --fixture $R --saved remote --run permissions-search wait live wait bots click button "/^Hermes on/" wait settings type "Search settings" allowlist count heading "Search results" 1 count button "Permissions (1 match)" 1 type "Search settings" "remove rule" count button "Permissions (2 matches)" 1 quiet`.
- **No rules for Highwing.** Run `$H run --fake-host ok --fixture $F --saved remote --run permissions-unsupported wait live wait bots click button "/^Hermes on/" wait settings click button Permissions see "This Hermes can't show its command rules to Highwing. Update Hermes, then try again." count list "Always allowed" 0 count textbox "Rule to add" 0 shot permissions-unsupported quiet`.
- **A managed install.** Run `$H run --fake-host ok --fixture $L --saved remote --run permissions-locked wait live wait bots click button "/^Hermes on/" wait settings click button Permissions see "Nothing is always allowed." see "No commands are denied." type "Rule to add" "podman *" click button Add see "Hermes didn't save that change. An administrator may manage this setting." see "Nothing is always allowed." shot permissions-locked quiet`.
- **From an approval.** Run `$H run --fake-host ok --fixture $A --saved remote --run permissions-open-from-approval wait live type "Message Hermes" @request click button Send wait approval click button "Always allow" click-at button "Always allow" 2 see "Saved as an allow rule." shot always-saved click button "Open Permissions" wait settings count heading Permissions 1 see "Always allowed" see "podman *" shot permissions-from-approval quiet`. `permissions-from-approval.png` shows Settings on Permissions, not Connection. Close and Open Settings again, and Settings opens on Connection.

## Gotchas

- `called` reads the socket's frames only. The PUT of a save goes over HTTP, so a recipe proves a save by the list that is drawn after the read-back, and a managed install by the words.
- The fake keeps a PUT's result per profile for the length of a run, and the fixture's lists are every bot's at the start. A run that edits one bot leaves every other bot with the fixture's lists.
- No step changes the fake's config from outside the window, so a change made elsewhere and the page reading it again are not driven here. `apps/desktop/test/permissions-page.test.tsx` covers when the page reads again, and `packages/hermes/test/command-rules-http.test.ts` covers the token's change through the real routes.
