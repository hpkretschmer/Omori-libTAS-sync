#!/bin/sh
# Launch the game files of a Windows RPG Maker MV/MZ game with native Linux
# NW.js, without libTAS. Put this script into the game folder (next to
# Game.exe and package.json) and run it from there. Arguments are passed on to
# NW.js, e.g. --enable-logging=stderr to see the game's console in the terminal.
#
# For games that accept extra arguments. OMORI doesn't: use run-linux.sh.
#
# Settings, as environment variables:
#   NW        the Linux nw binary of the NW.js version the game ships
#   CASEFOLD  libtas-casefold.so, for games that access files with the wrong case
#   PROFILE   NW.js profile folder (also needed when package.json has no name)
GAMEDIR="$(cd "$(dirname "$0")" && pwd)"
NW="${NW:-$HOME/Games/nwjs/nwjs-v0.29.0-linux-x64/nw}"

# Windows finds files ignoring case, Linux doesn't. libTAS's standalone library
# finds them ignoring case (under libTAS: LIBTAS_CASE_INSENSITIVE=1).
CASEFOLD="${CASEFOLD:-/usr/local/bin/libtas-casefold.so}"
if [ -f "$CASEFOLD" ]; then
    export LD_PRELOAD="$CASEFOLD${LD_PRELOAD:+:$LD_PRELOAD}"
else
    echo "Warning: $CASEFOLD not found, the game may fail to load some files" >&2
fi

# NW.js stores its profile in ~/.config/<name from package.json>, or directly
# in ~/.config if the name is empty. Keep it next to the game folder instead.
PROFILE="${PROFILE:-$GAMEDIR-data/nw-profile}"
mkdir -p "$PROFILE"

exec "$NW" "$GAMEDIR" --user-data-dir="$PROFILE" "$@"
