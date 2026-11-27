# Skills library

Settings has a Skills card under Sidebar. It lists the skills of the bot the window has open, since Hermes keeps skills per bot: "Skills Emu can use", then one row for each installed skill, by name. Each row shows the skill's one-line description, an Open button ("Open <name>") and a switch ("Use <name>"). An enabled skill's description is the one the `/` catalog gives. A turned-off skill is missing from the catalog, so on the default bot its row shows the `description:` of its SKILL.md. Open shows the skill's SKILL.md read-only in a dialog named by the skill, with focus on Close. Escape or Close shuts only the dialog. A switch moves at once and stays disabled until Hermes's list says the new value, or until Hermes refuses, which shows the reason in an alert under the rows. The card reads the bot's skills again when Hermes pushes `skills.changed`, so a skill turned on or off elsewhere moves its switch with no click. Hermes is asked only while Settings is open.

## Sub-features

- `skills-list` shows the three skills of `fixtures/profiles/skills.json` with their descriptions, `weekly-report` off.
- `skills-open` opens release-notes' SKILL.md in a dialog, and Escape closes only the dialog.
- `skills-toggle` turns `weekly-report` on, and the switch settles on.
- `skills-elsewhere` turns `triage-inbox` off from elsewhere, and its switch settles off with no click.

## How to get to it (user POV)

- Open Settings from the top bar or the Ctrl+K palette, and scroll to Skills.

## Driving it with highwing-verify

Preconditions:

- Make the fixture once: `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/skills.json --run i200-skills-fixture wait live wait bots`. Then set `F=/tmp/highwing-verify/i200-skills-fixture/fixture-edited.jsonl`.
- `skillsElsewhere` in `skills.json` turns `triage-inbox` off 6 s after the card first reads Emu's skills, so the steps before it must run inside that time.

- **The list.** Run `$H run --fake-host ok --fixture $F --saved remote --run i200-after wait live wait bots click button Settings wait settings see release-notes see "Write release notes from the merged pull requests since the last tag." see "Summarize the week’s merged work and open risks for the team." checked switch "Use release-notes" shot settings-after reveal heading Skills shot skills-card`. `skills-card.png` shows the three rows with `weekly-report` unchecked. Its description comes from its SKILL.md.
- **Open, turn on, and a change from elsewhere.** Run `$H run --fake-host ok --fixture $F --saved remote --run i200-flow wait live wait bots click button Settings wait settings see release-notes switched switch "Use triage-inbox" on switched switch "Use weekly-report" off click button "Open release-notes" count dialog release-notes 1 see "Group them under Added, Changed and Fixed." focused button Close shot skill-open press Escape gone dialog release-notes count heading Settings 1 click switch "Use weekly-report" checked switch "Use weekly-report" switched switch "Use weekly-report" on shot weekly-on switched switch "Use triage-inbox" off shot triage-off quiet`. `skill-open.png` shows the SKILL.md over Settings. `triage-off.png` shows `weekly-report` on and `triage-inbox` off.

## Gotchas

- Settings needs a saved connection, so these runs use `--fake-host`. A `--fake-host` run writes no `gateway-calls.jsonl`, so `called` cannot check the `profiles.configure` payload. `packages/hermes/test/skills.test.ts` checks it.
- `checked` and `enabled` read once. Use `switched` to wait for Hermes's answer.
- Hermes's `learning.detail` names no profile and reads the gateway's own, the default bot. On another bot, Open says "This Hermes can show only the default bot's SKILL.md files." and a skill turned off there has no description, so the card never shows the default bot's file for another bot's skill.
