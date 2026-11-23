# Open the app

Starting Highwing opens one window whose content area is 1180x860. With no saved connection the window shows the setup screen. With one saved it shows the chat.

## Sub-features

- `open-window` opens a window and mounts the renderer.

## How to get to it (user POV)

- Run `pnpm --filter @highwing/desktop start` (or launch the packaged app).

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines.

- **Open.** Run `$H run --fake-host ok --run open wait window shot open`. `steps.log` ends in `PASS`, and `open.png` is 1180x860 and shows "Where does Hermes run?".

## Gotchas

- A run needs `--fixture` or `--fake-host`. Without one the app would run the real `ssh`, `tailscale` and `hermes` of this machine.
