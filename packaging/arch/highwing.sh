#!/usr/bin/bash
export CHROME_DESKTOP=highwing.desktop
# Wayland whenever a compositor is reachable. Electron 45's --ozone-platform-hint=auto picks X11
# unless XDG_SESSION_TYPE=wayland, which a launch from a systemd user unit may not have.
# A later --ozone-platform in "$@" wins, so `highwing --ozone-platform=x11` still forces X11.
if [[ -n $WAYLAND_DISPLAY ]]; then
  platform=wayland
else
  platform=x11
fi
exec /usr/lib/highwing/highwing --ozone-platform="$platform" "$@"
