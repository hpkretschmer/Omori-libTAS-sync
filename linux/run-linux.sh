#!/bin/sh
# Launch OMORI's game files with native Linux NW.js 0.29.0 (same Chromium/Node as the Windows build).
GAMEDIR="$(cd "$(dirname "$0")" && pwd)"
NW="${NW:-$HOME/Games/nwjs/nwjs-v0.29.0-linux-x64/nw}"

# GTP_OmoriFixes stores persistent data under %LOCALAPPDATA%/OMORI, which is unset on Linux.
export LOCALAPPDATA="${LOCALAPPDATA:-$HOME/Games/omori-tas-data}"
mkdir -p "$LOCALAPPDATA/OMORI"

exec "$NW" "$GAMEDIR" \
    --user-data-dir="$LOCALAPPDATA/nw-profile" \
    --single-process --in-process-gpu --no-sandbox --no-zygote --disable-gpu \
    "$@"
