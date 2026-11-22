#!/usr/bin/bash
export CHROME_DESKTOP=highwing.desktop
exec /usr/lib/highwing/highwing --ozone-platform-hint=auto "$@"
