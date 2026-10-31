//=============================================================================
// libTAS_Sync.js
//=============================================================================
/*:
 * @plugindesc Runs exactly one game logic step per rendered frame, and tells
 * libTAS when a frame is produced.
 *
 * @help
 * By default, each frame runs round(smoothed elapsed time / (1/60 s)) logic
 * steps, so 0, 1 or 2 steps depending on how much time passed since the
 * previous frame. Under libTAS, the elapsed time is not exactly 1/60 s every
 * frame (time tracking, waits, loading), which makes the number of steps per
 * frame vary between runs and desyncs movies.
 *
 * With this plugin, the game runs one logic step per frame, regardless of time.
 *
 * Also, the browser may present images without a new frame from the game,
 * depending on timing. So that libTAS only ends a frame when the game produced
 * one, each frame is signaled to libTAS by accessing a special path, which
 * libTAS intercepts. Outside of libTAS, the path does not exist and the
 * game is left unchanged.
 *
 * Loading takes a different number of updates each time, so only updates
 * running the game logic are signaled as frames. Loading a scene, or waiting
 * for images, takes no frame, and does not consume inputs or advance the
 * frame count.
 */

(function() {
    function oneStepPerFrame(deltaTime) {
        return 1;
    }

    /* Use the real node fs, OneLoader replaces the fs module of the page */
    var fs = null;
    try {
        fs = process.mainModule.require('fs');
    } catch (e) {}

    /* The browser only presents an image when something changed on screen, so
     * change an invisible pixel every frame to get one present per frame */
    var marker = null;
    var markerState = false;

    function accessSignal() {
        try {
            fs.accessSync('/libtas/page_frame');
            return true;
        } catch (e) {
            return false;
        }
    }

    /* Outside of libTAS, the path does not exist and the game is unchanged */
    var underLibTAS = !!fs && accessSignal();

    function signalFrame() {
        accessSignal();
        if (!marker && document.body) {
            marker = document.createElement('div');
            marker.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;z-index:2147483647;pointer-events:none;';
            document.body.appendChild(marker);
        }
        if (marker) {
            markerState = !markerState;
            marker.style.backgroundColor = markerState ? '#000' : '#010101';
        }
    }

    function noInputUpdate() {}

    /* Other plugins may replace SceneManager with a subclass that defines its
     * own determineRepeatNumber or update (e.g. the Run in Background mod),
     * so apply the overrides when the game starts, on the final SceneManager
     * class, before the update loop is created. */
    var run = SceneManager.run;
    SceneManager.run = function(sceneClass) {
        this.determineRepeatNumber = oneStepPerFrame;
        if (!underLibTAS)
            return run.call(this, sceneClass);

        /* Loading takes a different number of updates each time, so only
         * updates running the game logic are frames:
         * - while the scene runs and all images are loaded, each update is
         *   a frame
         * - while the scene runs but waits for images, only the image loading
         *   queue is updated
         * - while a new scene loads, it is updated so that it can start, but
         *   this is not a frame, and inputs and the frame count are left
         *   untouched */
        var update = this.update;
        this.update = function(deltaTime) {
            if (this._sceneStarted && ImageManager.isReady()) {
                signalFrame();
                return update.call(this, deltaTime);
            }
            if (this._sceneStarted) {
                ImageManager.update();
                return;
            }

            var frameCount = Graphics.frameCount;
            var updateInputData = this.updateInputData;
            this.updateInputData = noInputUpdate;
            try {
                update.call(this, deltaTime);
            } finally {
                this.updateInputData = updateInputData;
                Graphics.frameCount = frameCount;
            }
        };
        return run.call(this, sceneClass);
    };
})();
