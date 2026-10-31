# libTAS Sync for OMORI

A OneLoader mod that makes OMORI deterministic when TASing it with [libTAS](https://github.com/clementgallet/libTAS), so that movies don't desync.

Without it, the same inputs give different results from run to run, especially around loading. The mod makes three changes, which apply only when the game runs under libTAS. Outside of libTAS the game is unchanged.

- **One logic step per frame.** OMORI normally decides from the elapsed time how many logic steps to run each frame (0, 1 or 2). Under libTAS this time varies slightly from run to run. With the mod, every frame runs exactly one step.
- **Frames are signaled to libTAS.** The browser sometimes presents an image without a new frame from the game, depending on timing. The mod tells libTAS when the game produced a frame, so libTAS only ends a frame then. It also changes an invisible pixel every frame, so that each frame is presented.
- **Loading takes no frames.** Loading a scene takes a different number of updates every time. Those updates are not counted as frames, and they don't read inputs or advance the game's frame count. While a running scene waits for images to load, the game logic pauses.

## Requirements

See [SETUP.md](SETUP.md) for the complete setup. In short:

- OMORI 1.0.0 running on Linux with the Linux build of NW.js 0.29.0, with the Steam integration stubbed. OMORI only ships for Windows, so this needs some setup.
- OneLoader, patched for Linux, and the Run in Background mod.
- libTAS with support for page frames. This is currently on the [`nwjs-support` branch](https://github.com/hpkretschmer/libTAS/tree/nwjs-support) of a libTAS fork, not in upstream libTAS.

## Installation

1. Download [`libtassync.zip`](https://github.com/hpkretschmer/Omori-libTAS-sync/releases/latest/download/libtassync.zip) from the [latest release](https://github.com/hpkretschmer/Omori-libTAS-sync/releases/latest) (or build it, see below) and put it in OMORI's `www/mods/` folder.
2. Start the game once and check that the mod is enabled. It shows up as "libTAS Sync" in OneLoader's mod list.

## libTAS settings

- **Environment variable** (File > Executable Options): `LIBTAS_PAGE_FRAMES` = `1`. This makes libTAS wait for the game's first frame signal, so starting the game doesn't create frames either.
- **Game arguments**: add `--run-all-compositor-stages-before-draw` to the NW.js arguments.

With these settings, libTAS's frame counter counts game logic steps. It stands still while the game starts up and while it loads, and you can only pause or frame-advance between loading screens.

## Building the zip

```sh
./make-zip.sh
```

This writes `libtassync.zip`, with the files of the last commit in a `libtassync/` folder.

## Technical details

The frame signal is a call to `fs.accessSync('/libtas/page_frame')`, which libTAS intercepts in its `access()` hook. It is documented in `src/library/PageFrame.h` of the libTAS fork. The plugin only uses RPG Maker MV's `SceneManager`, `ImageManager` and `Graphics`, so it might also work in other RPG Maker MV games that run on NW.js, but it has only been tested with OMORI.

## Not tested yet

- OMORI's video cutscenes, which play in real time inside the browser.
