# Setting up OMORI for TASing with libTAS on Linux

This guide gets OMORI 1.0.0 running deterministically under [libTAS](https://github.com/clementgallet/libTAS) on Linux. OMORI only ships for Windows, but it's an RPG Maker MV game that runs on NW.js (Chromium with Node.js), so its game files run on the Linux build of the same NW.js version, without Wine or Proton.

The game stays as close to unmodified as possible: besides the Steam stub that Linux needs, nothing in the game is changed. libTAS injects its script into the game (see [README.md](README.md)). Mods are optional.

Tested on Linux Mint with X11. The paths below are examples; adjust them to your system.

| What | Example path |
| --- | --- |
| Working copy of the game | `~/Games/omori-tas` |
| Linux NW.js | `~/Games/nwjs/nwjs-v0.29.0-linux-x64` |
| Game data and NW.js profile | `~/Games/omori-tas-data` |

The files referred to below (`linux/...`) are in this repository.

## 1. Get the Windows game files

OMORI has no Linux build, so Steam has to download the Windows version:

1. In the Steam library, right-click OMORI → Properties → Compatibility, and check "Force the use of a specific Steam Play compatibility tool" with any Proton version.
2. Install the version of the game you want to TAS. This guide was tested with 1.0.0.

It doesn't matter if the game only shows a black window when started from Steam; Proton isn't used after this.

## 2. Make a working copy

Work on a copy: Steam's updates and "verify files" would undo the changes below.

```sh
mkdir -p ~/Games/omori-tas
cp -a ~/.steam/debian-installation/steamapps/common/OMORI/. ~/Games/omori-tas/
```

Your Steam library may be in a different place, e.g. `~/.local/share/Steam/steamapps/common/OMORI`.

## 3. Download Linux NW.js 0.29.0

v0.29.0 is the only NW.js release with exactly OMORI's Chromium (65.0.3325.146) and Node.js (9.7.1) versions. The SDK build adds the developer tools (F12), which help with debugging but aren't needed.

```sh
mkdir -p ~/Games/nwjs && cd ~/Games/nwjs
for f in nwjs-v0.29.0-linux-x64 nwjs-sdk-v0.29.0-linux-x64; do
    curl -fLO https://dl.nwjs.io/v0.29.0/$f.tar.gz && tar xzf $f.tar.gz
done
```

NW.js doesn't need to be copied into the game folder; it is started with the game folder as argument.

## 4. Build and install libTAS with NW.js support

The support for NW.js games is on the `nwjs-support` branch of a libTAS fork, not in upstream libTAS yet. Install the dependencies listed in libTAS's README, then:

```sh
git clone -b nwjs-support https://github.com/hpkretschmer/libTAS.git
cd libTAS
./build.sh
cd build
sudo make install
```

This installs libTAS, and `libtas-casefold.so` (see step 7) next to it in `/usr/local/bin`. Restart libTAS after installing a new build.

## 5. Replace the Steam integration with a stub

The game's Steam binding needs a running Steam client. Replace it with a stub that reports Steam as unavailable, which makes the game turn off achievements, cloud saves and the overlay:

```sh
cd ~/Games/omori-tas/www/js/libs
mv greenworks.js greenworks.js.orig
cp /path/to/Omori-libTAS-sync/linux/greenworks.js .
```

## 6. The libTAS script

Nothing to do: the libTAS fork from step 8 injects its script, `libtas_web.js`, into the game when it starts it with `LIBTAS_PAGE_FRAMES=1`, and the game's files stay unchanged.

If you followed an earlier version of this guide, which added `<script type="text/javascript" src="libtas_web.js"></script>` to `index.html`, remove that line and `www/libtas_web.js`.

## 7. Test the game without libTAS

`linux/run-linux.sh` starts the game with the NW.js options needed for libTAS (single process, no GPU). It also:

- sets `LOCALAPPDATA`, where the game stores which cutscenes can be skipped (`OMORI/CUTSCENE.json`); that variable doesn't exist on Linux.
- loads `libtas-casefold.so` from step 4. The game accesses some files with a different case than they have (e.g. `www/Languages/` for `www/languages/`, `Leaf.png` for `leaf.rpgmvp`), which only works on Windows. The library finds these files ignoring case. Under libTAS, libTAS does the same itself (step 8).

```sh
cp /path/to/Omori-libTAS-sync/linux/run-linux.sh ~/Games/omori-tas/
~/Games/omori-tas/run-linux.sh --enable-logging=stderr
```

The title screen should appear. These log lines are expected:

| Log line | Meaning |
| --- | --- |
| `Cannot use V8 Proxy resolver in single process mode` | Network proxy feature, unused |
| `Lost UI shared context` | Side effect of `--disable-gpu` |
| `Steamworks failed to initialize.` | The Steam stub is working |
| `fail_if_major_perf_caveat + swiftshader` | WebGL is refused, the game uses its Canvas renderer |
| `ENOENT ... OMORI/CUTSCENE.json` | No cutscene has been seen yet |

If you see `ENOENT ... www/Languages/` or `$atlasData is not defined`, `libtas-casefold.so` was not loaded: check that it's in `/usr/local/bin`, or set `CASEFOLD=/path/to/libtas-casefold.so`.

## 8. Configure libTAS

Main window:

- **Game executable:** `~/Games/nwjs/nwjs-v0.29.0-linux-x64/nw` (as an absolute path)
- **Command-line options** (one line, with absolute paths, no line break at the end):

  ```
  /home/you/Games/omori-tas --user-data-dir=/home/you/Games/omori-tas-data/nw-profile --single-process --in-process-gpu --no-sandbox --no-zygote --disable-gpu --run-all-compositor-stages-before-draw --enable-logging=stderr
  ```

  `--enable-logging=stderr` is optional; it puts the game's console output in the terminal.

File → Executable Options:

- **Working directory:** `/home/you/Games/omori-tas`
- **Environment variables:**
  - `LOCALAPPDATA` = `/home/you/Games/omori-tas-data`
  - `LIBTAS_PAGE_FRAMES` = `1`: libTAS only ends a frame when the script signals one.
  - `LIBTAS_CASE_INSENSITIVE` = `1`: libTAS finds files ignoring case (see step 7).

Settings → Runtime:

- **Prevent writing to disk:** off. With it on, libTAS currently confuses some of the game's files with its in-memory save files, which gives truncated reads and crashes.
- **Time tracking:** `clock_gettime() monotonic` on. This is the tested configuration.
- Wait timeout, sleep handling and asynchronous events: defaults.
- **Savestates:** turn on **Incremental savestates** and **Skip unmapped pages**, and keep **Compressed savestates** on. Chromium reserves a lot of memory it never uses, and without these options saving or loading a state takes several seconds; with them, it takes well under a second. Leave **Fork to save states** off: it crashes the game.

Tools → Fast-forward mode:

- **Skipping all rendering** fast-forwards fastest: the game then doesn't draw on screen, and its frames don't wait for the browser's frame rate. With **Skipping most rendering**, the frames that are drawn still wait for it. This needs a current build of the libTAS fork.

Movie → Movie Settings:

- **Mouse support:** on, if you want to use the mouse (e.g. with the Enable Mouse mod).
- **Framerate:** 60. Multiples of 60 work too: at 120 fps, the game runs at normal speed with one logic step every other frame (180 fps: every third frame, …). The game only reads keyboard and gamepad inputs on the frames with a logic step, so on the frames in between, only mouse clicks have an effect (see "Using it").

## 9. Optional: OneLoader and mods

Mods are useful while working on a TAS, but they change the game: a TAS that is meant to sync on the unmodified game should be made without mods that change the gameplay.

1. Install OneLoader (from mods.one) into the game folder as described in its instructions. It works unmodified: `LIBTAS_CASE_INSENSITIVE` and `libtas-casefold.so` find the files that OneLoader accesses in lowercase.
2. Put mods in `www/mods/`, e.g. **Enable Mouse** to use the mouse. The Run in Background mod is not needed: libTAS keeps the game focused.

## Using it

- libTAS's frame counter counts the game's animation frames, and the game runs one logic step per frame. While files are loading, frames stand still: loading takes no frames, as if it was instant.
- Inputs entered on a frame reach the game at the start of the next frame, also when frame advancing.
- The game can't see a key pressed on two logic steps in a row as two presses: it compares the state of each button at each logic step, so the key has to be released for at least one logic step in between. This is how RPG Maker reads keys, also without libTAS. Mouse clicks are different: the game collects them between two logic steps, so at 120 fps, pressing on one frame and releasing on the next counts as one click per logic step. That needs a mod that enables the mouse, because OMORI ignores mouse clicks by default (not tested yet).
- The on-screen display works.
- Encoding works. The window starts at 680×480 and the game then resizes it to 640×480, so libTAS writes the first frame into its own file: encoding to `omori.mkv` gives a one-frame `omori.mkv` and the actual video in `omori_1.mkv`.
- If the game doesn't start after a crash or kill, delete NW.js's stale lock files:

  ```sh
  rm -f ~/Games/omori-tas-data/nw-profile/Singleton*
  ```

## Known issues

- **Prevent writing to disk** has to stay off (see above).
- **Stop** may leave the game running without libTAS controlling it; use **Kill** in that case.
- Movies made with the earlier libTAS Sync mod (release v1.0.0) don't sync with `libtas_web.js`: frames and input timing are defined differently.
- Not tested yet: the game's video cutscenes, which play in real time inside the browser, F2 (the game's FPS display), mouse clicks, and the mouse wheel.
