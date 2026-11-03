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
 *
 * The browser delivers keyboard and mouse events at an undefined time
 * relative to the game's updates, so an input could reach the game one frame
 * late, depending on timing (e.g. when frame advancing). If libTAS provides
 * the inputs of each frame, the real input events are ignored, and the
 * inputs from libTAS are sent to the game as events at the start of each
 * frame instead.
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

    var signalPath = '/libtas/page_frame';

    function accessSignal() {
        try {
            fs.accessSync(signalPath);
            return true;
        } catch (e) {
            return false;
        }
    }

    /* Signals a frame and returns its inputs, or null if libTAS does not
     * provide them */
    function readlinkSignal() {
        try {
            return fs.readlinkSync(signalPath);
        } catch (e) {
            return null;
        }
    }

    /* Outside of libTAS, the path does not exist and the game is unchanged.
     * Older libTAS versions only support the frame signal with access(). */
    var directInputs = !!fs && (readlinkSignal() !== null);
    var underLibTAS = directInputs || (!!fs && accessSignal());

    /* X keysyms used by libTAS to browser key codes */
    var keyCodes = {
        0xff08: 8, 0xff09: 9, 0xff0d: 13, 0xff13: 19, 0xff1b: 27, 0x20: 32,
        0xff55: 33, 0xff56: 34, 0xff57: 35, 0xff50: 36,
        0xff51: 37, 0xff52: 38, 0xff53: 39, 0xff54: 40, 0xff63: 45, 0xffff: 46,
        0xffe1: 16, 0xffe2: 16, 0xffe3: 17, 0xffe4: 17, 0xffe9: 18, 0xffea: 18,
        0xffe5: 20, 0xff7f: 144, 0xff14: 145, 0xff8d: 13,
        0xffaa: 106, 0xffab: 107, 0xffad: 109, 0xffae: 110, 0xffaf: 111,
        0x3b: 186, 0x3d: 187, 0x2c: 188, 0x2d: 189, 0x2e: 190, 0x2f: 191,
        0x60: 192, 0x5b: 219, 0x5c: 220, 0x5d: 221, 0x27: 222
    };
    var k;
    for (k = 0; k < 26; k++) {
        keyCodes[0x61 + k] = 65 + k;
        keyCodes[0x41 + k] = 65 + k;
    }
    for (k = 0; k < 10; k++) {
        keyCodes[0x30 + k] = 48 + k;
        keyCodes[0xffb0 + k] = 96 + k;
    }
    for (k = 0; k < 12; k++) {
        keyCodes[0xffbe + k] = 112 + k;
    }

    /* libTAS pointer button bits to browser buttons */
    var mouseButtons = [
        {bit: 1, button: 0, buttons: 1},
        {bit: 2, button: 1, buttons: 4},
        {bit: 4, button: 2, buttons: 2}
    ];

    /* Inputs last sent to the game */
    var sentKeys = {};
    var sentMouse = {x: 0, y: 0, mask: 0};

    if (directInputs) {
        /* Ignore the real input events, the game gets them from libTAS */
        ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'mousemove',
         'click', 'dblclick', 'wheel'].forEach(function(type) {
            window.addEventListener(type, function(event) {
                if (event.isTrusted)
                    event.stopImmediatePropagation();
            }, true);
        });
    }

    function sendKey(type, keyCode, keys) {
        var event = new KeyboardEvent(type, {
            bubbles: true, cancelable: true,
            shiftKey: !!keys[16], ctrlKey: !!keys[17], altKey: !!keys[18]
        });
        Object.defineProperty(event, 'keyCode', {value: keyCode});
        Object.defineProperty(event, 'which', {value: keyCode});
        document.dispatchEvent(event);
    }

    function sendMouse(type, x, y, button, mask, keys) {
        var buttons = 0;
        mouseButtons.forEach(function(b) {
            if (mask & b.bit)
                buttons |= b.buttons;
        });
        document.dispatchEvent(new MouseEvent(type, {
            bubbles: true, cancelable: true,
            clientX: x, clientY: y, screenX: x, screenY: y,
            button: button, buttons: buttons,
            shiftKey: !!keys[16], ctrlKey: !!keys[17], altKey: !!keys[18]
        }));
    }

    /* Send the changes of the inputs from libTAS as events to the game */
    function applyInputs(inputs) {
        var fields = inputs.split(' ');
        var x = parseInt(fields[0], 10);
        var y = parseInt(fields[1], 10);
        var mask = parseInt(fields[2], 10);
        var wheel = parseInt(fields[3], 10);
        var keys = {};
        fields.slice(4).forEach(function(keysym) {
            var keyCode = keyCodes[parseInt(keysym, 16)];
            if (keyCode)
                keys[keyCode] = true;
        });

        Object.keys(sentKeys).forEach(function(keyCode) {
            if (!keys[keyCode])
                sendKey('keyup', Number(keyCode), keys);
        });
        Object.keys(keys).forEach(function(keyCode) {
            if (!sentKeys[keyCode])
                sendKey('keydown', Number(keyCode), keys);
        });
        sentKeys = keys;

        if (x !== sentMouse.x || y !== sentMouse.y)
            sendMouse('mousemove', x, y, 0, mask, keys);
        mouseButtons.forEach(function(b) {
            if ((mask & b.bit) && !(sentMouse.mask & b.bit))
                sendMouse('mousedown', x, y, b.button, mask, keys);
            if (!(mask & b.bit) && (sentMouse.mask & b.bit))
                sendMouse('mouseup', x, y, b.button, mask, keys);
        });
        if (wheel) {
            document.dispatchEvent(new WheelEvent('wheel', {
                bubbles: true, cancelable: true,
                clientX: x, clientY: y, deltaY: -100 * wheel
            }));
        }
        sentMouse = {x: x, y: y, mask: mask};
    }

    function signalFrame() {
        if (directInputs) {
            var inputs = readlinkSignal();
            if (inputs !== null)
                applyInputs(inputs);
            else
                accessSignal();
        }
        else {
            accessSignal();
        }
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
