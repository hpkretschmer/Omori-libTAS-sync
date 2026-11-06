# libTAS for OMORI

Makes OMORI deterministic when TASing it with [libTAS](https://github.com/clementgallet/libTAS) on Linux, so that movies don't desync, with as little change to the game as possible: one script, `libtas_web.js`, loaded by one line in the game's `index.html`. No mods are needed.

The script knows nothing about OMORI or RPG Maker. It should also work for other games running on NW.js, such as other RPG Maker MV and MZ games, but it has only been tested with OMORI so far.

## What the script does

Outside of libTAS, nothing. Under libTAS, it changes how the game sees its surroundings (time, inputs, loading), not the game's logic:

- **Frames are signaled to libTAS.** The browser presents images on its own schedule, sometimes without a new frame from the game, so libTAS can't tell game frames apart by itself. The script tells libTAS when the game starts an animation frame (`requestAnimationFrame`), and changes an invisible pixel every frame, so that each frame is presented.
- **Time advances exactly one frame duration per frame.** The game decides from the elapsed time how many logic steps to run each frame. The page's clock (`performance.now()`, `Date.now()` and the time of animation frames) advances by exactly one frame duration per frame, at the framerate set in libTAS, like on a perfectly steady screen. At 60 fps, the game runs one logic step per frame; at 120 fps, one step every other frame, at normal speed.
- **Inputs apply on the frame they are entered.** The browser delivers keyboard and mouse events at an undefined time, so an input could reach the game one frame late, or a one-frame press could get lost, depending on timing (e.g. when frame advancing). The script ignores these events, and gets the inputs of each frame from libTAS instead.
- **Loading takes no frames.** Loading files takes a different time every run. While images, data files or audio are loading (also the files that mod loaders such as OneLoader read through Node.js), the script holds back the game's animation frames, as if loading was instant.

## Requirements

See [SETUP.md](SETUP.md) for the complete setup. In short:

- OMORI 1.0.0 running on Linux with the Linux build of NW.js 0.29.0, with the Steam integration stubbed. OMORI only ships for Windows, so this needs some setup.
- libTAS with support for page frames and case-insensitive file names. This is currently on the [`nwjs-support` branch](https://github.com/hpkretschmer/libTAS/tree/nwjs-support) of a libTAS fork, not in upstream libTAS.

## Installation

1. Download `libtas_web.js` from the [latest release](https://github.com/hpkretschmer/Omori-libTAS-sync/releases/latest) (or take [`libtas_web.js`](libtas_web.js) from this repository), and copy it into the game's `www` folder.
2. Add this line to `www/index.html`, as the first `<script>` line:

   ```html
   <script type="text/javascript" src="libtas_web.js"></script>
   ```

   With OneLoader, add it to OneLoader's `index.html` instead.
3. In libTAS (File → Executable Options), set the environment variables `LIBTAS_PAGE_FRAMES` = `1` and `LIBTAS_CASE_INSENSITIVE` = `1`, and add `--run-all-compositor-stages-before-draw` to the NW.js arguments.

## Technical details

The frame signal is a call to `fs.readlinkSync('/libtas/page_frame')`, which libTAS intercepts in its `readlink()` hook and answers with the inputs of the frame. It is documented in `src/library/PageFrame.h` of the libTAS fork. With older libTAS builds that only support `fs.accessSync('/libtas/page_frame')`, the script falls back to that, and inputs arrive as browser events.

For debugging, a page can set `window.__libtasAfterFrame` to a function, which the script calls with the frame number after each frame.

## History

Before `libtas_web.js`, this repository contained the libTAS Sync mod, a OneLoader mod for OMORI that changed the game's main loop instead (release [v1.0.0](https://github.com/hpkretschmer/Omori-libTAS-sync/releases/tag/v1.0.0), and in the git history). Movies made with it don't sync with `libtas_web.js`.
