# Ventil Rohr 404

A German RPG Maker MV game, Windows release (title screen "Ver. 2.0"). This file describes how it was set up for libTAS on Linux and how we found out what works. The general approach is in [README.md](README.md).

**Status (2026-11-24):** the splash screen, title, new game, the scrolling intro text and the intro video work under libTAS. Savestates load back to identical frames, fast-forward reaches the same state as normal speed, and encoding works. Gameplay after the intro (battles, menus, map 48 with the second video) has not been tested yet.

## Summary

| What | Value |
| --- | --- |
| Engine | RPG Maker MV 1.6.1 |
| NW.js | 0.29.0 (Chromium 65.0.3325.146, Node.js 9.7.1), the same as OMORI |
| Steam | not used |
| Case-insensitive files | needed (`LIBTAS_CASE_INSENSITIVE=1`) |
| Command-line arguments | the game folder; extra arguments are fine |
| Videos | yes: needs the libTAS fork from commit [b33b5528](https://github.com/hpkretschmer/libTAS/commit/b33b5528) or later |

Example paths below: game copy in `~/Games/ventil-tas`, NW.js in `~/Games/nwjs/nwjs-v0.29.0-linux-x64`, NW.js profile in `~/Games/ventil-tas-data/nw-profile`.

## Setup

1. **Working copy** without the saves, so that the game starts as on a fresh install:

   ```sh
   rsync -a --exclude=/www/save /path/to/Ventil-Rohr-404/ ~/Games/ventil-tas/
   ```

2. **Linux NW.js 0.29.0**, as in [SETUP.md](../SETUP.md) step 3.

3. **Test the game without libTAS** with [`linux/run-rpgmaker.sh`](../linux/run-rpgmaker.sh) (shown in [README.md](README.md#4-run-the-game-without-libtas)). It needs `libtas-casefold.so`, which libTAS installs (SETUP.md step 4):

   ```sh
   cp /path/to/Omori-libTAS-sync/linux/run-rpgmaker.sh ~/Games/ventil-tas/
   ~/Games/ventil-tas/run-rpgmaker.sh
   ```

   The title screen should appear. The script keeps the NW.js profile in `~/Games/ventil-tas-data/nw-profile`, the same folder as under libTAS below. Add `--enable-logging=stderr` to see the game's console; the error about `pixi-gif.js` at startup is expected (see below).

4. **libTAS** (the fork, see SETUP.md step 4), configured like OMORI, without OMORI's Steam key and `LOCALAPPDATA`:

   - **Game executable:** `/home/you/Games/nwjs/nwjs-v0.29.0-linux-x64/nw`
   - **Command-line options:** `/home/you/Games/ventil-tas --user-data-dir=/home/you/Games/ventil-tas-data/nw-profile`
   - **Environment variables:** `LIBTAS_PAGE_FRAMES` = `1`, `LIBTAS_CASE_INSENSITIVE` = `1`, `LIBTAS_CHROMIUM_ARGS` = `--single-process --in-process-gpu --no-sandbox --no-zygote --disable-gpu --run-all-compositor-stages-before-draw`, `DBUS_SESSION_BUS_ADDRESS` = `unix:path=/nonexistent`, `DBUS_SYSTEM_BUS_ADDRESS` = `unix:path=/nonexistent`
   - Runtime and savestate settings as in SETUP.md.

   OMORI uses the same `nw`, so libTAS shares its configuration between the two games: switch the command-line options and `LOCALAPPDATA` when switching games.

Nothing in the game has to be changed.

## How we got there

### Identifying the game

`www/js/rpg_core.js` says `Utils.RPGMAKER_VERSION = "1.6.1"`. `strings nw.dll` contains Chromium `65.0.3325.146` and `strings node.dll` Node.js `v9.7.1`, the versions of NW.js 0.29.0, which was already set up for OMORI.

`www/package.json` (and the top-level one) has an empty `name`. NW.js then uses `~/.config` itself as its profile folder and writes `Local State`, `Default/` and lock files (`Singleton*`) directly into it. `--user-data-dir` moves the profile elsewhere; we checked that `~/.config` stays untouched with it. If the game is killed, stale `Singleton*` files can stay behind in the profile folder and keep NW.js from starting; delete them.

### Looking at the files

- `www/data/System.json` has `hasEncryptedImages` and `hasEncryptedAudio` set: the assets are `.rpgmvp`/`.rpgmvo`. The game decrypts them itself; nothing to do.
- There is no `greenworks.js` and no plugin that uses Steam.
- [`tools/rpgm_casecheck.py`](../tools/rpgm_casecheck.py) found references whose case doesn't match the files, e.g. the character sheet `Der CLown` is referenced as `Der Clown` while the face set `Der Clown` is referenced as `Der CLown`; also `Der freche Laslo`/`Der Freche Laslo` and `Worldmap`/`WorldMap`. (It also reports `damage` and `sleep`, which are probably ordinary words in the data.) So the game needs `LIBTAS_CASE_INSENSITIVE=1`, like OMORI.
- `www/movies/` has two WebM videos. The plugin list (`www/js/plugins.js`) includes `DK_Video_Player`. The start map (`Map002.json`) loads `Spaceshipflightcrash` with `LoadVideo` when the map starts and plays it with `PlayVideo 1 false false` (no wait) after the intro text; map 48 plays `DasComputerSpielUndDas10ElementIntro` with RPG Maker's own "Play Movie" command, which waits for the video to end.
- `js/plugins/pixi-gif.js` is a plugin for RPG Maker MZ (`@target MZ`, PixiJS 7), while MV uses PixiJS 4.5.4. It fails at startup with `Cannot read property 'shared' of undefined`, on Windows as well. It only matters if the game shows GIFs.

### Without libTAS

`run-rpgmaker.sh --enable-logging=stderr` shows the title screen right away. Starting a new game shows the scrolling warning text, "Über dem Horizont", "Auf dem Weg zur Erde", then the video of a cockpit flying through a storm. The only console error is the `pixi-gif.js` one.

### Under libTAS

With the configuration above, the game ran under libTAS on the first try. Most of the time went into what looked like problems but turned out to be our test setup, and into videos.

**The "frozen screen" was fast-forward.** In our automated runs (libTAS `-n` in a nested X server, driven by a Lua script), the picture seemed to freeze after starting a new game, at different points depending on the run. A debug script in `index.html` showed that the game logic kept running (the scrolling text advanced, `Graphics.frameCount` increased). libTAS's trace of the window functions showed that the browser only presented 21 images in 900 frames, and the window title finally gave it away: `status: running fastforward`. In fast-forward with "Skipping all rendering", the game doesn't draw on most frames. We never found out what enabled fast-forward in those runs; calling `runtime.setFastForward(0)` on every frame from the Lua script fixed it. With that, everything matched the run without libTAS, including libTAS's OSD.

**The renderer is Canvas.** PixiJS falls back from WebGL to its canvas renderer: Chromium refuses the WebGL context it asks for (`fail_if_major_perf_caveat + swiftshader` in the log). This is the same as for OMORI with `--disable-gpu`, and is the tested configuration.

**Savestates.** Saving at frame 1500, taking a screenshot at 1560, loading at 1700 and taking another screenshot at 1560 gave identical game pictures; only libTAS's OSD differed ("State 1 saved" vs "State 1 loaded" and the FPS value).

**Encoding** 700 frames gave one file with 700 frames at 816×624, with the OSD. Unlike OMORI, the game doesn't resize its window at startup, so libTAS doesn't split the video into two files.

### Videos

The video plays under libTAS and looks the same in two runs. To find out whether its timing is deterministic, we wrote a minimal NW.js page, [`tools/videotest/`](../tools/videotest/), that plays this game's 8-second video at 85% speed from frame 30 and writes the frame of the video's `ended` event to a file. With the libTAS fork as it was before (commit 34f7fc82):

| Run | Video loaded at frame 30 | `ended` event |
| --- | --- | --- |
| normal speed, 2 runs | yes | frame 595 both times |
| savestate at 300, load at 500 | yes | frame 595 |
| fast-forward, run 1 | yes | missing (the video only became paused around frame 1100) |
| fast-forward, run 2 | no: the video never loaded | never |

So at normal speed, Chromium's media clock already follows libTAS's clock. But whether a video has loaded by a given frame depends on real time, and in fast-forward the end of a video is reported late or not at all. A game waiting for the end of a video, like map 48's "Play Movie", would continue on a different frame when fast-forwarding, and the movie would desync.

We changed `libtas_web.js` (commit [b33b5528](https://github.com/hpkretschmer/libTAS/commit/b33b5528)): a video counts as loading until it has data (like images, so loading takes no frames), and for the page, the position of a playing video advances one frame duration times its playback rate per frame; its end and its time updates are sent by the script on those frames, and the browser's own `ended` and `timeupdate` events are dropped. The browser still plays the video for the picture and sound, and its position is corrected when it drifts by more than 0.2 s. With that:

| Run | Video loaded at frame 30 | `ended` event |
| --- | --- | --- |
| normal speed | yes | frame 594 |
| fast-forward, 2 runs | yes | frame 594 both times |
| savestate at 300, load at 500 | yes | frame 594 |

(The end comes one frame before the browser's own event, because the script advances the position at the start of each frame.) In the game, fast-forwarding through the intro also reaches the video, with the same pictures as at normal speed.

Two mistakes along the way, for reference: setting a video's `src` fires `emptied` right away, so `emptied` must not count as the end of the load; and a listener on `window` doesn't see the events of videos that aren't in the page (RPG Maker's and DK_Video_Player's aren't), so the script listens on each video when it is created.

## Not tested yet

- Gameplay after the intro: battles (the game uses the Yanfly ATB battle system), menus, saving in the game.
- Map 48 with the "Play Movie" video, in the game.
- Mouse and touch input (the game has `TouchInputSwitch` and `KeyInputSwitch` plugins).

## Open questions

- libTAS first registers one of NW.js's small hidden helper windows as the game window, and logs `Could not get xcb_query_tree` errors; the real window is only picked up when the game draws. We haven't seen an effect on the game yet.
