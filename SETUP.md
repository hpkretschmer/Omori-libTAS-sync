# Setting up OMORI for TASing with libTAS on Linux

This guide gets OMORI 1.0.0 running deterministically under [libTAS](https://github.com/clementgallet/libTAS) on Linux. OMORI only ships for Windows, but it's an RPG Maker MV game that runs on NW.js (Chromium with Node.js), so its game files run on the Linux build of the same NW.js version, without Wine or Proton.

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

## 4. Replace the Steam integration with a stub

The game's Steam binding needs a running Steam client. Replace it with a stub that reports Steam as unavailable, which makes the game turn off achievements, cloud saves and the overlay:

```sh
cd ~/Games/omori-tas/www/js/libs
mv greenworks.js greenworks.js.orig
cp /path/to/Omori-libTAS-sync/linux/greenworks.js .
```

## 5. Fix the case of the Languages folder

The game reads `www/Languages/`, but the folder is `www/languages/`. Windows doesn't care, Linux does:

```sh
ln -s languages ~/Games/omori-tas/www/Languages
```

## 6. Test the game without libTAS

`linux/run-linux.sh` starts the game with the NW.js options needed for libTAS (single process, no GPU). It also sets `LOCALAPPDATA`, where the game stores which cutscenes can be skipped (`OMORI/CUTSCENE.json`); that variable doesn't exist on Linux.

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

If you see `ENOENT ... www/Languages/` or `$atlasData is not defined`, step 5 is missing.

## 7. Install OneLoader and patch it for Linux

Install OneLoader (from mods.one) into the game folder as described in its instructions. OneLoader lowercases every file path, which only works on case-insensitive file systems: on Linux the game hangs on a black screen with `ENOENT: ... archeia_corechanges.omori` in the log. Apply the patch from this repository, which maps lowercased paths back to the real file names:

```sh
cd ~/Games/omori-tas
for f in overlayfs_utils stage2 vfs_common vfs_node; do cp www/modloader/$f.js www/modloader/$f.js.orig; done
patch -p1 < /path/to/Omori-libTAS-sync/linux/oneloader-linux.patch
```

The patch also fixes an error handler in OneLoader that referenced an undefined variable. Reinstalling or updating OneLoader removes the patch, so keep its automatic updates off (`"check": "deny"` in `www/save/mods.json`).

## 8. Install the mods

Put these zips in `www/mods/`:

- **libTAS Sync** (this repository): required, makes the game deterministic under libTAS. See [README.md](README.md).
- **Run in Background** (from mods.one): required. libTAS doesn't give the game window the focus Chromium expects, and without this mod the game pauses itself.
- **Enable Mouse** (from mods.one): optional.

Start the game once with `run-linux.sh` and check that the mods are enabled in OneLoader's mod list.

## 9. Build and install libTAS with NW.js support

The support for NW.js games is on the `nwjs-support` branch of a libTAS fork, not in upstream libTAS yet. Install the dependencies listed in libTAS's README, then:

```sh
git clone -b nwjs-support https://github.com/hpkretschmer/libTAS.git
cd libTAS
./build.sh
cd build
sudo make install
```

Restart libTAS after installing a new build.

## 10. Configure libTAS

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
  - `LIBTAS_PAGE_FRAMES` = `1`

Settings → Runtime:

- **Prevent writing to disk:** off. With it on, libTAS currently confuses some of the game's files with its in-memory save files, which gives truncated reads and crashes.
- **Time tracking:** `clock_gettime() monotonic` on. This is the tested configuration.
- Wait timeout, sleep handling and asynchronous events: defaults.

Movie → Movie Settings:

- **Mouse support:** on, if you use the Enable Mouse mod.
- **Framerate:** 60.

## Using it

- libTAS's frame counter counts game logic steps: each frame is exactly one step of the game. It stands still while the game starts up and while it loads, and you can only pause or frame-advance once a loading screen is finished.
- The on-screen display works.
- Encoding works with the libTAS build from step 9 (older builds crash on the first frame, or write a broken file when libTAS runs in a terminal). The window starts at 680×480 and the game then resizes it to 640×480, so libTAS writes the first frame into its own file: encoding to `omori.mkv` gives a one-frame `omori.mkv` and the actual video in `omori_1.mkv`.
- If the game doesn't start after a crash or kill, delete NW.js's stale lock files:

  ```sh
  rm -f ~/Games/omori-tas-data/nw-profile/Singleton*
  ```

## Known issues

- **Prevent writing to disk** has to stay off (see above).
- **Stop** may leave the game running without libTAS controlling it; use **Kill** in that case.
- The game occasionally aborts right at the start (`FATAL:port_locker.cc` in the log, a check inside Chromium). This is rare and its cause is unknown; restart the game.
- **F2** (the game's FPS display) doesn't reach the game under libTAS.
- Not tested yet: libTAS savestates, and the game's video cutscenes, which play in real time inside the browser.
