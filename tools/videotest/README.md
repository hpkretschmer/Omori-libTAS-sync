# Video determinism test

A minimal NW.js page to test how videos behave under libTAS, without a game.

It plays `clip.webm` at 85% speed from frame 30, draws it on a canvas every frame, and writes the video's time at every 100th frame and the frame of its `ended` event to the file named by the environment variable `VIDEOTEST_OUT`.

1. Copy any WebM video here as `clip.webm` (it isn't included). We used `www/movies/Spaceshipflightcrash.webm` from Ventil Rohr 404 (8 s).
2. Run it under libTAS like a game: executable `nw` (Linux NW.js 0.29.0), command-line option `/path/to/tools/videotest`, the same environment variables as for a game (`LIBTAS_PAGE_FRAMES=1`, `LIBTAS_CHROMIUM_ARGS=...`), plus `VIDEOTEST_OUT=/path/to/result.txt`.
3. Run a few hundred frames, once normally, once fast-forwarding, and once loading a savestate made during the video, and compare the result files. With a deterministic setup, they are identical: for an 8 s video at 85% speed started at frame 30, `ended` comes at frame 594.

Results for the libTAS fork with and without video support are in [games/ventil-rohr-404.md](../../games/ventil-rohr-404.md#videos).
