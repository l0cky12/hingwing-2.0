# Open the app

Starting Highwing opens one window whose content area is 1180x860.

## Sub-features

- `open-window` opens a window and mounts the renderer.

## How to get to it (user POV)

- Run `pnpm --filter @highwing/desktop start` (or launch the packaged app).

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines.

- **Open.** Run `$H run --no-fixture --run open wait window shot open`. `steps.log` ends in `PASS`, and `open.png` is 1180x860.

## Gotchas

- `--no-fixture` removes `hermes` from `PATH`. Without that the app would dial the user's real gateway.
