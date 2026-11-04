//=============================================================================
// libtas_web.js
//=============================================================================
// Makes a web game (NW.js) deterministic under libTAS, without knowing anything
// about the game. Load it before any other script of the game, e.g. as the
// first script of the game's index.html:
//
//     <script src="libtas_web.js"></script>
//
// Outside of libTAS, it does nothing. Under libTAS:
// - Frames: each animation frame (requestAnimationFrame) of the page is one
//   libTAS frame, signaled to libTAS. The browser presents images on its own
//   schedule, so libTAS cannot tell game frames from other presents by itself.
// - Time: the page's clock (performance.now(), Date.now() and the time passed
//   to animation frame callbacks) advances exactly 1/60 s per frame.
// - Inputs: the inputs of each frame are read from libTAS and sent to the page
//   as keyboard and mouse events at the start of the frame. The real input
//   events, which arrive at an undefined time, are ignored.
// - Loading: while images, XMLHttpRequests, fetches or audio decoding are in
//   progress, the page's animation frames are held back, so that loading takes
//   no frames, as if loading was instant.
//
// It needs a libTAS with page frame support, started with LIBTAS_PAGE_FRAMES=1.
// Observers for debugging can set window.__libtasAfterFrame to a function,
// which is called with the frame number after each frame.
//=============================================================================

(function() {
    /* Use the real node fs (mod loaders such as OneLoader replace the fs
     * module of the page) */
    var fs = null;
    try {
        fs = process.mainModule.require('fs');
    } catch (e) {}

    var signalPath = '/libtas/page_frame';

    /* Signals a frame with access(), which all libTAS versions with page
     * frames support */
    function accessSignal() {
        try {
            fs.accessSync(signalPath);
            return true;
        } catch (e) {
            return false;
        }
    }

    /* Signals a frame with readlink() and returns its inputs, or null if
     * libTAS does not provide them */
    function readlinkSignal() {
        try {
            return fs.readlinkSync(signalPath);
        } catch (e) {
            return null;
        }
    }

    /* Outside of libTAS, the path does not exist and the page is unchanged */
    var directInputs = !!fs && (readlinkSignal() !== null);
    var underLibTAS = directInputs || (!!fs && accessSignal());
    if (!underLibTAS)
        return;

    //-------------------------------------------------------------------------
    // Inputs
    //-------------------------------------------------------------------------

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

    /* Inputs last sent to the page */
    var sentKeys = {};
    var sentMouse = {x: 0, y: 0, mask: 0};

    if (directInputs) {
        /* Ignore the real input events, the page gets them from libTAS */
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

    /* Send the changes of the inputs from libTAS as events to the page. The
     * inputs are "<pointer x> <pointer y> <button mask> <wheel> <keysym>...",
     * see PageFrame.h in libTAS. */
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

    //-------------------------------------------------------------------------
    // Time
    //-------------------------------------------------------------------------

    var frameDuration = 1000 / 60;
    var frames = 0;

    /* Fixed start values, because the time when the page loads varies. The
     * date is rounded to the minute, libTAS starts at a fixed date. */
    var clockStart = 1000;
    var dateStart = Math.floor(Date.now() / 60000) * 60000;

    function now() {
        return clockStart + frames * frameDuration;
    }
    performance.now = now;
    Date.now = function() {
        return Math.floor(dateStart + frames * frameDuration);
    };

    //-------------------------------------------------------------------------
    // Loading
    //-------------------------------------------------------------------------

    /* Number of resource loads in progress */
    var pendingLoads = 0;

    /* Count a load of `target` until one of `endEvents` */
    var tracked = new WeakSet();
    function track(target, endEvents) {
        if (tracked.has(target))
            return;
        tracked.add(target);
        pendingLoads++;
        function end() {
            tracked.delete(target);
            pendingLoads--;
            endEvents.forEach(function(type) {
                target.removeEventListener(type, end);
            });
        }
        endEvents.forEach(function(type) {
            target.addEventListener(type, end);
        });
    }

    function trackPromise(promise) {
        pendingLoads++;
        var end = function() { pendingLoads--; };
        promise.then(end, end);
        return promise;
    }

    var imageSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
        get: imageSrc.get,
        set: function(value) {
            if (value)
                track(this, ['load', 'error']);
            imageSrc.set.call(this, value);
        },
        configurable: true, enumerable: true
    });

    var xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
        track(this, ['loadend']);
        return xhrSend.apply(this, arguments);
    };

    if (window.fetch) {
        var fetchOrig = window.fetch;
        window.fetch = function() {
            return trackPromise(fetchOrig.apply(this, arguments));
        };
    }

    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
        var decode = AudioContextClass.prototype.decodeAudioData;
        AudioContextClass.prototype.decodeAudioData = function(data, success, error) {
            pendingLoads++;
            var finished = false;
            function finish() {
                if (!finished) {
                    finished = true;
                    pendingLoads--;
                }
            }
            var promise = decode.call(this, data,
                function(buffer) { finish(); if (success) success(buffer); },
                function(e) { finish(); if (error) error(e); });
            if (promise && promise.then)
                promise.then(finish, finish);
            return promise;
        };
    }

    //-------------------------------------------------------------------------
    // Frames
    //-------------------------------------------------------------------------

    /* The browser only presents an image when something changed on screen, so
     * change an invisible pixel every frame to get one present per frame */
    var marker = null;
    var markerState = false;

    function toggleMarker() {
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

    /* The page's animation frame callbacks run once per libTAS frame, and only
     * when no resource is loading */
    var raf = window.requestAnimationFrame.bind(window);
    var callbacks = [];
    var nextId = 1;
    var requested = false;
    var heldTicks = 0;

    function request() {
        if (!requested) {
            requested = true;
            raf(tick);
        }
    }

    function tick() {
        requested = false;
        if (pendingLoads > 0) {
            /* About 10 s at 60 fps */
            if (++heldTicks === 600)
                console.warn('libtas_web.js: frames held back for a long time, ' + pendingLoads + ' loads did not finish');
            request();
            return;
        }
        heldTicks = 0;

        var inputs = directInputs ? readlinkSignal() : null;
        if (inputs !== null)
            applyInputs(inputs);
        else
            accessSignal();
        toggleMarker();
        frames++;

        var current = callbacks;
        callbacks = [];
        var time = now();
        current.forEach(function(entry) {
            try {
                entry.callback(time);
            } catch (e) {
                /* Report it like an exception in a native callback */
                setTimeout(function() { throw e; });
            }
        });

        if (window.__libtasAfterFrame)
            window.__libtasAfterFrame(frames);
    }

    window.requestAnimationFrame = function(callback) {
        var id = nextId++;
        callbacks.push({id: id, callback: callback});
        request();
        return id;
    };
    window.cancelAnimationFrame = function(id) {
        callbacks = callbacks.filter(function(entry) {
            return entry.id !== id;
        });
    };
})();
