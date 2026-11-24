# Getting RPG Maker games to run in libTAS on Linux

This folder collects what we learned getting RPG Maker games (other than OMORI) to run deterministically under the [libTAS fork with NW.js support](https://github.com/hpkretschmer/libTAS/tree/nwjs-support). This file describes the general approach. Each game has its own file with what was done for it, and how we found out what works:

| Game | Engine | NW.js | Status |
| --- | --- | --- | --- |
| [OMORI](../SETUP.md) | RPG Maker MV | 0.29.0 | Works; full guide in [SETUP.md](../SETUP.md) |
| [Ventil Rohr 404](ventil-rohr-404.md) | RPG Maker MV 1.6.1 | 0.29.0 | Intro, video, savestates, fast-forward and encoding work; later gameplay not tested yet |

The idea is always the same: RPG Maker MV and MZ games are web pages running in NW.js (Chromium with Node.js). The Windows release ships the Windows NW.js, but the game files run unchanged on the Linux build of the same NW.js version, without Wine or Proton. libTAS then runs that Linux NW.js and injects its script `libtas_web.js` into the page, which makes time, inputs, loading and videos deterministic (see the [main README](../README.md)).

## 1. Identify the engine and the NW.js version

A Windows RPG Maker MV game has `Game.exe`, `nw.dll`, `node.dll` and a `www/` folder. RPG Maker MZ games have no `www/` folder: `index.html`, `js/` and `data/` are next to `Game.exe`, and the core scripts are called `rmmz_*.js` instead of `rpg_*.js`.

The RPG Maker version is in the core script:

```sh
grep -m1 RPGMAKER_VERSION www/js/rpg_core.js     # MV
grep -m1 RPGMAKER_VERSION js/rmmz_core.js        # MZ
```

The NW.js version isn't written anywhere directly, but the Chromium and Node.js versions are in the DLLs:

```sh
strings nw.dll | grep -m1 -oE '[0-9]+\.0\.[0-9]{4}\.[0-9]+'   # Chromium, e.g. 65.0.3325.146
strings node.dll | grep -m1 -E '^v[0-9]+\.[0-9]+\.[0-9]+$'     # Node.js, e.g. v9.7.1
```

Each NW.js release uses one Chromium and one Node.js version; the [NW.js release notes](https://nwjs.io/blog/) and the version list at [dl.nwjs.io](https://dl.nwjs.io/) give the matching release. Chromium 65.0.3325.146 with Node.js 9.7.1 is NW.js 0.29.0, which most RPG Maker MV 1.6.x games ship.

Download the normal (not SDK) Linux build of that version, as in [SETUP.md](../SETUP.md) step 3. Using the exact version matters: a different Chromium can draw, time and decode differently, and the libTAS fork is only tested with 0.29.0 so far. (NW.js 0.44 and later load libraries in a way that bypasses libTAS's `LD_PRELOAD` hooks.)

## 2. Make a working copy

Copy the game to a separate folder and work only there, so that the original (and Steam's copy) stays untouched. Leave out the save folder (`www/save/` for MV, `save/` for MZ): a TAS starts from a fresh install, and `config.rpgsave` stores options (e.g. "always dash") that change how the game plays.

```sh
rsync -a --exclude=/www/save /path/to/Game/ ~/Games/game-tas/
```

## 3. Look at what the game uses

Before running anything, check the game for things that commonly break on Linux or under libTAS:

- **Steam:** `www/js/libs/greenworks.js` or plugins that use `greenworks` need a running Steam client. Replace the binding with the stub [`linux/greenworks.js`](../linux/greenworks.js), as for OMORI.
- **File name case:** Windows finds files ignoring case, Linux doesn't. [`tools/rpgm_casecheck.py`](../tools/rpgm_casecheck.py) lists references in the game data whose case doesn't match the file on disk:

  ```sh
  python3 -I tools/rpgm_casecheck.py ~/Games/game-tas/www   # MV; for MZ, the game folder
  ```

  Some hits are false positives (ordinary words that happen to match a file name). If there are real ones, set `LIBTAS_CASE_INSENSITIVE=1` in libTAS, and preload `libtas-casefold.so` when running the game without libTAS (see [SETUP.md](../SETUP.md) step 7).
- **Encrypted assets** (`.rpgmvp`, `.rpgmvo`, `.png_`, `.ogg_`): nothing to do, the game decrypts them itself.
- **Videos** (`www/movies/`, video plugins such as DK_Video_Player): need the libTAS fork from commit [b33b5528](https://github.com/hpkretschmer/libTAS/commit/b33b5528) or later (see "Videos" below). The normal Linux NW.js plays WebM; MP4 (H.264) needs proprietary codecs it doesn't have.
- **Plugins** (`www/js/plugins.js` lists the active ones): look for anything that uses real time, opens windows, or reads files with hard-coded names.
- **`package.json`:** NW.js stores its profile in `~/.config/` followed by the `name` field. If the name is empty, NW.js writes its profile files directly into `~/.config`; give it `--user-data-dir=/some/folder` in that case, if the game accepts extra arguments.

## 4. Run the game without libTAS

NW.js is started with the game folder as argument. [`linux/run-rpgmaker.sh`](../linux/run-rpgmaker.sh) does that, with the case-insensitivity library preloaded and the NW.js profile kept next to the game folder. Put it into the game folder and run it from there:

```sh
cp /path/to/Omori-libTAS-sync/linux/run-rpgmaker.sh ~/Games/game-tas/
~/Games/game-tas/run-rpgmaker.sh --enable-logging=stderr
```

```sh
#!/bin/sh
GAMEDIR="$(cd "$(dirname "$0")" && pwd)"
NW="${NW:-$HOME/Games/nwjs/nwjs-v0.29.0-linux-x64/nw}"

# Windows finds files ignoring case, Linux doesn't (under libTAS: LIBTAS_CASE_INSENSITIVE=1)
CASEFOLD="${CASEFOLD:-/usr/local/bin/libtas-casefold.so}"
if [ -f "$CASEFOLD" ]; then
    export LD_PRELOAD="$CASEFOLD${LD_PRELOAD:+:$LD_PRELOAD}"
else
    echo "Warning: $CASEFOLD not found, the game may fail to load some files" >&2
fi

# NW.js profile, next to the game folder instead of ~/.config
PROFILE="${PROFILE:-$GAMEDIR-data/nw-profile}"
mkdir -p "$PROFILE"

exec "$NW" "$GAMEDIR" --user-data-dir="$PROFILE" "$@"
```

`NW`, `CASEFOLD` and `PROFILE` can be set as environment variables, e.g. `NW=/path/to/nw ./run-rpgmaker.sh` for another NW.js version. Arguments are passed on to NW.js: `--enable-logging=stderr` prints the game's console (errors, `console.log`) in the terminal.

Some games refuse extra arguments: OMORI 1.0.6 takes all its arguments as a decryption key, so it has its own script, [`linux/run-linux.sh`](../linux/run-linux.sh), and its console is only visible with the SDK build of NW.js and its developer tools (F12), if the game allows it.

Get to the title screen and start a new game. Console errors aren't necessarily caused by Linux: the same error may happen on Windows (Ventil Rohr 404 has one). Only errors that point to missing files, Steam or the platform need fixing.

## 5. Configure libTAS

Start from the OMORI configuration ([SETUP.md](../SETUP.md) step 8) and drop what is specific to OMORI:

- **Game executable:** the Linux `nw`.
- **Command-line options:** the game folder, plus anything the game needs (OMORI: its Steam key; a game with an empty `name`: `--user-data-dir=...`).
- **Environment variables:**
  - `LIBTAS_PAGE_FRAMES` = `1`
  - `LIBTAS_CASE_INSENSITIVE` = `1` (if the case check found anything)
  - `LIBTAS_CHROMIUM_ARGS` = `--single-process --in-process-gpu --no-sandbox --no-zygote --disable-gpu --run-all-compositor-stages-before-draw`
  - `DBUS_SESSION_BUS_ADDRESS` and `DBUS_SYSTEM_BUS_ADDRESS` = `unix:path=/nonexistent`: Chromium otherwise talks to the session's power manager, and aborts after loading a savestate when the connection no longer matches.
- **Runtime settings:** as in SETUP.md (Prevent writing to disk off, incremental savestates with "Skip unmapped pages", Fast-forward mode "Skipping all rendering").

libTAS keeps one configuration per executable name, so all games run with the same `nw` share it. Keep a note of each game's options, or use a separate copy of NW.js per game.

## 6. Test checklist

Test these under libTAS, roughly in this order. Each game's file says what was tested.

1. **Title screen and new game.** The game should look and behave as without libTAS.
2. **Savestate determinism.** Save, advance a bit, take a screenshot; load, advance to the same frame, take another screenshot. The two must be identical, apart from libTAS's own OSD.
3. **Fast-forward** to a later point and check that the game is in the same state as at normal speed.
4. **Videos**, if the game has any (see below).
5. **Encoding** (Tools → Start encode), with and without "OSD on video encode".
6. **Game-specific features**: whatever the plugins do (battle systems with real-time gauges, minigames, mouse input).

## Videos

Browsers decode video on their own threads, in real time. Under libTAS without fast-forward, Chromium's media clock follows libTAS's clock, so a video plays at the right speed, but:

- whether a video has finished loading by a given frame depends on how fast the computer is (in fast-forward, it may not load at all), and
- in fast-forward, the browser reports the end of a video late, so a game that waits for a video to end (RPG Maker's "Play Movie" command does) continues on a different frame.

The libTAS fork's `libtas_web.js` handles this, from commit [b33b5528](https://github.com/hpkretschmer/libTAS/commit/b33b5528): a video counts as loading until it has data, so loading takes no frames; and for the game, the position of a playing video advances by one frame duration (times its playback rate) per frame, and its end is reported on that frame. The picture and sound still come from the browser, which is corrected when it drifts away.

[`tools/videotest/`](../tools/videotest/) is a minimal NW.js page that tests this outside of any game: it plays a WebM video and writes the frame of its end to a file. See [ventil-rohr-404.md](ventil-rohr-404.md#videos) for the results that led to the change.

## Debugging techniques

What helped to find out what was going on:

- **The game's console:** `--enable-logging=stderr` (or the SDK's developer tools).
- **A temporary debug script:** a script added to `index.html` in the working copy, after `main.js`, that logs the game's state every 60 frames: the scene (`SceneManager._scene.constructor.name`), `Graphics.frameCount`, the map and the event interpreter's wait mode (`$gameMap._interpreter._waitMode`), and the state of video elements. Comparing its output with and without libTAS shows whether the game logic or only the picture is stuck. Plugins load after `main.js` runs, so wrap their functions only once the game loop runs. Remove the script afterwards. Heavy console output under libTAS seemed to make the page hang at random points, so log little.
- **libTAS's log:** the logging level and categories (Settings → Debug, or `logging_level` and `logging_include_flags` in the game's `.ini`) can trace every hooked call of one category, e.g. the window functions (`LCF_WINDOW`), to see how the browser presents its frames. Tracing all categories at once crashes NW.js.
- **A nested X server:** running libTAS with `-n` (non-interactive), a Lua script that presses keys, takes screenshots with `xwd` and quits, inside `Xephyr`, gives repeatable tests that don't open windows on the desktop. Two pitfalls: give it its own `XDG_CONFIG_HOME` with a copy of `libTAS.ini` (otherwise a first-start dialog waits for an answer), and call `runtime.setFastForward(0)` on every frame (in our runs, libTAS was in fast-forward otherwise, which looked like a frozen screen).
- **Minimal test pages:** to find out how Chromium itself behaves under libTAS, a tiny NW.js app (a `package.json` and an `index.html`) is much easier to test than the game. `tools/videotest/` is one.
- **Comparing with the plain game:** a screenshot sequence of the same scene without libTAS shows what the game should look like.
