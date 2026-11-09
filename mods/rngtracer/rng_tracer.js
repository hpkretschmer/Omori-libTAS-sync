//=============================================================================
// RNG Tracer
//-----------------------------------------------------------------------------
// Shows on screen how many times the game used its random number generator
// (Math.random) in the current frame, the values it got, and where the calls
// came from.
//
// All randomness of the game comes from Math.random. The libTAS fork seeds it
// with the initial time (the V8 flag --random-seed in the app manifest), so
// it is one sequence of numbers, and its state is the number of calls since
// boot, shown as "total" (without the call before this plugin was loaded).
//
// Sources:
//   ev 12,1,23        map event 12, page 1, line 23 of its commands
//   CE 104,7          common event 104, line 7
//   troop 5,2,3       battle event of troop 5, page 2, line 3
//   text ev 12,1,23   message added by the command at ev 12,1,23,
//                     e.g. its letter sounds
//   ev 3,1,5 > CE 104,7  common event 104 called at ev 3,1,5
//   ev 12 move        autonomous movement of map event 12 (e.g. random)
//   ev 12 route 4     command 4 of a move route of event 12 (player and
//                     followers are "player" and "follower N")
// followed by the name of the function that called Math.random, e.g.
// "Game_Action.makeDamageValue". Lines are numbered as in the editor, from 1.
//
// The plugin does not change the random numbers or the game, so movies
// sync with and without it.
//
// Prediction: the display also shows the seed and the next values, computed
// from the seed as V8 does, and checks each call against them.
//
// Hotkey G: writes the next RNG_DUMP_COUNT (default 100000) values to
// RNG_DUMP_FILE (default rng_dump.txt in the game folder), one "index value"
// per line, as tools/rngtool.py dump. The values are computed, so the game's
// random numbers stay the same. Shift+G calls Math.random for real instead:
// make a savestate before and load it after.
//
// Environment variables:
//   RNG_TRACE_LOG    file to which every frame with calls is written, with
//                    each call ("#index value source")
//   RNG_DUMP_FILE, RNG_DUMP_COUNT   see the hotkey
//=============================================================================

(function() {
    'use strict';

    var MAX_LINES = 12;

    /* Distance of the display from the top of the screen, below the display
     * of the temporary variables mod */
    var TOP = 90;

    var originalRandom = Math.random;

    /* Number of calls since this plugin was loaded */
    var total = 0;

    /* Calls of the current frame, by source: their number, and the first
     * MAX_VALUES values */
    var frameCalls = new Map();
    var MAX_VALUES = 6;

    function addCalls(source, count, value) {
        var calls = frameCalls.get(source);
        if (!calls) {
            calls = { count: 0, values: [] };
            frameCalls.set(source, calls);
        }
        calls.count += count;
        if (value !== undefined && calls.values.length < MAX_VALUES)
            calls.values.push(value);
    }
    var frameCount = 0;

    /* Context of the calls: a stack of labels for the interpreter commands
     * and movements that are running */
    var contexts = [];

    //-------------------------------------------------------------------------
    // Files
    //-------------------------------------------------------------------------

    /* Node's own fs: OneLoader gives plugins a require of its own, with a
     * fs that only reads the game files */
    var fs = null;
    var path = null;
    var gameFolder = '.';
    try {
        fs = process.mainModule.require('fs');
        path = process.mainModule.require('path');
        /* The main module is www/index.html */
        gameFolder = path.dirname(path.dirname(process.mainModule.filename));
    } catch (e) {
        fs = null;
    }

    function env(name, defaultValue) {
        var value = (typeof process !== 'undefined') ? process.env[name] : undefined;
        return value ? value : defaultValue;
    }

    var logFd = null;
    try {
        if (fs && env('RNG_TRACE_LOG'))
            logFd = fs.openSync(env('RNG_TRACE_LOG'), 'a');
    } catch (e) {
        logFd = null;
    }

    //-------------------------------------------------------------------------
    // Prediction
    //-------------------------------------------------------------------------

    /* Seed of Math.random: the libTAS fork gives V8 the flag
     * --random-seed=<initial time> in the app manifest. Null without it. */
    var seed = null;
    try {
        var seedMatch = /--random-seed=(-?\d+)/.exec(nw.App.manifest['js-flags'] || '');
        if (seedMatch)
            seed = parseInt(seedMatch[1], 10);
    } catch (e) {
        seed = null;
    }

    /* Math.random of V8 6.5 (Runtime_GenerateRandomNumbers) is xorshift128+,
     * starting from the state (seed, seed): each value is the low 52 bits of
     * state0 + state1, divided by 2^52. V8 generates 62 values at once into a
     * cache of 64 doubles, returns them from the end, and keeps state0 and
     * state1 as doubles in the last 2 entries. Storing a double replaces a
     * NaN by the canonical NaN, so a state whose bits are a NaN becomes
     * 0x7FF8000000000000 after its block. 64-bit numbers are pairs of 32-bit
     * numbers [high, low] here (there is no BigInt in this V8). */
    var BLOCK = 62;
    var TWO32 = 4294967296;

    function shl(x, n) {
        return [((x[0] << n) | (x[1] >>> (32 - n))) >>> 0, (x[1] << n) >>> 0];
    }
    function shr(x, n) {
        return [x[0] >>> n, ((x[1] >>> n) | (x[0] << (32 - n))) >>> 0];
    }
    function xor(a, b) {
        return [(a[0] ^ b[0]) >>> 0, (a[1] ^ b[1]) >>> 0];
    }

    /* One step of V8's XorShift128 on state [s0, s1] */
    function step(state) {
        var a = state[0], b = state[1];
        a = xor(a, shl(a, 23));
        a = xor(a, shr(a, 17));
        a = xor(a, b);
        a = xor(a, shr(b, 26));
        state[0] = b;
        state[1] = a;
    }

    function output(state) {
        var low = state[0][1] + state[1][1];
        var carry = low >= TWO32 ? 1 : 0;
        var high = (state[0][0] + state[1][0] + carry) & 0xFFFFF;
        return (high * TWO32 + (low % TWO32)) / 4503599627370496;
    }

    /* The state as V8 stores it: a NaN becomes the canonical NaN */
    function stored(x) {
        var exponent = (x[0] >>> 20) & 0x7FF;
        var mantissa = (x[0] & 0xFFFFF) || x[1];
        return (exponent === 0x7FF && mantissa) ? [0x7FF80000, 0] : x;
    }

    /* Generates the next block from `state` (changed to the state that V8
     * stores after it), in the order of return */
    function generateBlock(state) {
        var block = [];
        for (var i = 0; i < BLOCK; i++) {
            step(state);
            block.push(output(state));
        }
        state[0] = stored(state[0]);
        state[1] = stored(state[1]);
        return block.reverse();
    }

    /* The prediction: the block that contains the next calls, its first
     * index, and the state after it. The sequence starts at the first call
     * ever, before this plugin was loaded, so the first call that the plugin
     * sees tells where it is. */
    var prediction = null;
    /* Why there is no prediction, '' while there is one or before the first
     * call */
    var predictionMessage = (seed === null) ? 'no seed (needs the libTAS fork with --random-seed)' : '';

    function findPrediction(index, value) {
        var high = seed < 0 ? 0xFFFFFFFF : 0;
        var state = [[high, seed >>> 0], [high, seed >>> 0]];
        for (var b = 0; b < 100; b++) {
            var block = generateBlock(state);
            var k = block.indexOf(value);
            if (k >= 0) {
                prediction = { index: index - k, state: state, block: block };
                return;
            }
        }
        predictionMessage = 'the values do not come from the seed ' + seed;
    }

    /* Advances `cursor` to the block that contains `index` */
    function advance(cursor, index) {
        while (index >= cursor.index + BLOCK) {
            cursor.index += BLOCK;
            cursor.block = generateBlock(cursor.state);
        }
    }

    function checkPrediction(index, value) {
        if (predictionMessage)
            return;
        if (!prediction)
            findPrediction(index, value);
        if (!prediction)
            return;
        advance(prediction, index);
        if (prediction.block[index - prediction.index] !== value) {
            prediction = null;
            predictionMessage = 'prediction wrong at #' + index;
            if (logFd !== null)
                frameCallLines.push('  ' + predictionMessage);
        }
    }

    /* `count` predicted values from `index`, without changing the prediction */
    function predictedValues(index, count) {
        advance(prediction, index);
        var cursor = {
            index: prediction.index,
            state: [prediction.state[0].slice(), prediction.state[1].slice()],
            block: prediction.block
        };
        var values = [];
        for (var i = index; i < index + count; i++) {
            advance(cursor, i);
            values.push(cursor.block[i - cursor.index]);
        }
        return values;
    }

    //-------------------------------------------------------------------------
    // Hotkey
    //-------------------------------------------------------------------------

    var KEY_G = 71;

    /* Message shown after the hotkey, until the frame `noticeUntil` */
    var notice = '';
    var noticeUntil = 0;

    function showNotice(text) {
        notice = text;
        noticeUntil = frameCount + 300;
    }

    function dumpValues(real) {
        var count = Math.max(1, parseInt(env('RNG_DUMP_COUNT', '100000'), 10) || 100000);
        var file = env('RNG_DUMP_FILE', path ? path.join(gameFolder, 'rng_dump.txt') : '');
        if (!fs || !file) {
            showNotice('G: cannot write files');
            return;
        }
        var first = total + 1;
        var values;
        if (real || !prediction) {
            real = true;
            values = [];
            for (var i = 0; i < count; i++) {
                var value = originalRandom();
                total++;
                checkPrediction(total, value);
                values.push(value);
            }
            addCalls('hotkey G', count);
            if (logFd !== null)
                frameCallLines.push('  #' + first + '-#' + total + ' hotkey G (' + count + ' calls)');
        } else {
            values = predictedValues(first, count);
        }
        var lines = values.map(function(value, i) {
            return (first + i) + ' ' + value.toPrecision(17);
        });
        try {
            fs.writeFileSync(file, lines.join('\n') + '\n');
        } catch (e) {
            showNotice('G: cannot write ' + file + ': ' + e.message);
            return;
        }
        var bound = (Input.keyMapper && Input.keyMapper[KEY_G]) ? '\nwarning: G is bound to "' + Input.keyMapper[KEY_G] + '" in the game' : '';
        if (real)
            showNotice('G: called Math.random ' + count + ' times (#' + first + '-#' + total + '),\nwrote the values to ' + file + '\nload your savestate!' + bound);
        else
            showNotice('G: wrote ' + count + ' predicted values (#' + first + '-) to\n' + file + ', RNG unchanged' + bound);
    }

    document.addEventListener('keydown', function(event) {
        if (event.keyCode !== KEY_G || event.repeat || event.ctrlKey || event.altKey || event.metaKey)
            return;
        dumpValues(event.shiftKey);
    });

    //-------------------------------------------------------------------------
    // Sources
    //-------------------------------------------------------------------------

    /* Command lists are found by identity, or else by content: the
     * interpreters of a loaded save have copies of their lists. The owner
     * of each list is cached, '' if it has none (e.g. lists of plugins). */
    var listOwners = new WeakMap();

    function sameList(a, b) {
        if (a === b)
            return true;
        if (!a || !b || a.length !== b.length)
            return false;
        return JSON.stringify(a) === JSON.stringify(b);
    }

    /* Owner of `list` ("CE 104", "ev 12,1", "troop 5,2"), or '' */
    function listOwner(interpreter, list) {
        var owner = listOwners.get(list);
        if (owner !== undefined)
            return owner;

        owner = '';
        var candidates = [];
        if (window.$dataCommonEvents) {
            $dataCommonEvents.forEach(function(ce) {
                if (ce)
                    candidates.push(['CE ' + ce.id, ce.list]);
            });
        }
        if (interpreter._eventId > 0 && window.$gameMap && interpreter._mapId === $gameMap.mapId()) {
            var event = $gameMap.event(interpreter._eventId);
            var pages = event ? event.event().pages : [];
            pages.forEach(function(page, i) {
                candidates.unshift(['ev ' + interpreter._eventId + ',' + (i + 1), page.list]);
            });
        }
        if (window.$gameParty && $gameParty.inBattle() && window.$dataTroops && window.$gameTroop) {
            var troop = $dataTroops[$gameTroop._troopId];
            if (troop) {
                troop.pages.forEach(function(page, i) {
                    candidates.unshift(['troop ' + troop.id + ',' + (i + 1), page.list]);
                });
            }
        }
        for (var pass = 0; pass < 2 && !owner; pass++) {
            for (var i = 0; i < candidates.length; i++) {
                if (pass === 0 ? (candidates[i][1] === list) : sameList(candidates[i][1], list)) {
                    owner = candidates[i][0];
                    break;
                }
            }
        }
        listOwners.set(list, owner);
        return owner;
    }

    /* `line` is the line of the command, from 1 */
    function interpreterLabel(interpreter, line) {
        var list = interpreter._list;
        if (!list)
            return 'script ' + line;
        var owner = listOwner(interpreter, list);
        if (owner)
            return owner + ',' + line;
        if (interpreter._eventId > 0)
            return 'ev ' + interpreter._eventId + ',?,' + line;
        return 'script ' + line;
    }

    function characterLabel(character) {
        if (window.Game_Event && character instanceof Game_Event)
            return 'ev ' + character.eventId();
        if (window.Game_Follower && character instanceof Game_Follower)
            return 'follower ' + character._memberIndex;
        if (window.Game_Player && character instanceof Game_Player)
            return 'player';
        return character.constructor ? character.constructor.name : 'character';
    }

    /* Name of a stack frame, with the file and line if it has no name */
    function siteName(site) {
        var name = site.getFunctionName();
        if (name)
            return name;
        var file = site.getFileName() || '';
        file = decodeURIComponent(file.substring(file.lastIndexOf('/') + 1));
        return '(anonymous) ' + file + ':' + site.getLineNumber();
    }

    /* Names of minified code are short, or have a short object name, like
     * "n.shuffle" */
    function isMinified(name) {
        var dot = name.indexOf('.');
        return (name.length <= 2) || (dot >= 0 && dot <= 2);
    }

    /* Name of the function that called Math.random, skipping helpers that
     * only wrap it. For minified code (e.g. filters of the PIXI library),
     * the first caller that is not minified is added. */
    var skippedFunctions = { 'Math.randomInt': true };
    function callerName() {
        var prepare = Error.prepareStackTrace;
        var limit = Error.stackTraceLimit;
        var sites;
        try {
            Error.prepareStackTrace = function(error, s) { return s; };
            Error.stackTraceLimit = 12;
            var holder = {};
            Error.captureStackTrace(holder, tracedRandom);
            sites = holder.stack;
        } finally {
            Error.prepareStackTrace = prepare;
            Error.stackTraceLimit = limit;
        }
        if (!Array.isArray(sites))
            return '?';
        var i = 0;
        while (i < sites.length && skippedFunctions[sites[i].getFunctionName()])
            i++;
        if (i >= sites.length)
            return '?';
        var name = siteName(sites[i]);
        if (isMinified(name)) {
            for (var j = i + 1; j < sites.length; j++) {
                var caller = sites[j].getFunctionName();
                if (caller && !isMinified(caller))
                    return name + ' < ' + caller;
            }
        }
        return name;
    }

    /* Lines of the calls of the current frame, for the log */
    var frameCallLines = [];

    function tracedRandom() {
        var value = originalRandom.apply(this, arguments);
        total++;
        var source = callerName();
        if (contexts.length > 0)
            source = contextChain() + ' ' + source;
        addCalls(source, 1, value);
        checkPrediction(total, value);
        if (logFd !== null)
            frameCallLines.push('  #' + total + ' ' + value.toPrecision(17) + ' ' + source);
        return value;
    }
    Math.random = tracedRandom;

    function contextChain() {
        return contexts.join(' > ');
    }

    /* Runs `fn` with the label of `labelOf(self)` as context */
    function withContext(owner, name, labelOf) {
        var original = owner[name];
        owner[name] = function() {
            contexts.push(labelOf(this));
            try {
                return original.apply(this, arguments);
            } finally {
                contexts.pop();
            }
        };
    }

    withContext(Game_Interpreter.prototype, 'executeCommand', function(interpreter) {
        return interpreterLabel(interpreter, interpreter._index + 1);
    });

    /* A common event called by an event runs in a child interpreter, after
     * the line of the call, so it shows as "ev 12,1,5 > CE 104,7" */
    withContext(Game_Interpreter.prototype, 'updateChild', function(interpreter) {
        return interpreterLabel(interpreter, interpreter._index);
    });

    /* Messages run after the command that added their text, as "text"
     * with the source of that command (kept here, not in the game objects,
     * which are saved) */
    var textSource = '';
    var gameMessageAdd = Game_Message.prototype.add;
    Game_Message.prototype.add = function() {
        textSource = contextChain();
        return gameMessageAdd.apply(this, arguments);
    };
    withContext(Window_Message.prototype, 'update', function() {
        return 'text' + (textSource ? ' ' + textSource : '');
    });
    withContext(Game_Event.prototype, 'updateSelfMovement', function(event) {
        return characterLabel(event) + ' move';
    });
    withContext(Game_Character.prototype, 'processMoveCommand', function(character) {
        return characterLabel(character) + ' route ' + (character._moveRouteIndex + 1);
    });

    //-------------------------------------------------------------------------
    // Display
    //-------------------------------------------------------------------------

    var overlay = null;
    var shownText = null;

    function createOverlay() {
        overlay = document.createElement('div');
        overlay.id = 'RngTracer';
        var style = overlay.style;
        style.position = 'absolute';
        style.zIndex = 20;
        style.pointerEvents = 'none';
        style.whiteSpace = 'pre';
        style.font = '11px monospace';
        style.lineHeight = '13px';
        style.color = '#fff';
        style.background = 'rgba(0, 0, 0, 0.6)';
        style.padding = '2px 4px';
        style.maxWidth = '400px';
        style.overflow = 'hidden';
        document.body.appendChild(overlay);
    }

    function frameLines() {
        var entries = Array.from(frameCalls.entries());
        entries.sort(function(a, b) { return b[1].count - a[1].count; });
        var count = 0;
        entries.forEach(function(entry) { count += entry[1].count; });
        var lines = ['RNG +' + count + '  total ' + total + (seed !== null ? '  seed ' + seed : '')];
        if (prediction) {
            lines.push('next ' + predictedValues(total + 1, 5).map(function(v) {
                return v.toFixed(4);
            }).join(' '));
        } else {
            lines.push(predictionMessage || 'waiting for the first call');
        }
        if (notice && frameCount < noticeUntil)
            lines.push(notice);
        entries.forEach(function(entry, i) {
            if (i >= MAX_LINES)
                return;
            /* The values that were rolled, before the source, which may be
             * too long for the display */
            var calls = entry[1];
            var values = calls.values.map(function(v) { return v.toFixed(4); }).join(' ');
            if (calls.count > calls.values.length && calls.values.length > 0)
                values += ' ...';
            lines.push(calls.count + (values ? ' [' + values + ']' : '') + ' ' + entry[0]);
        });
        if (entries.length > MAX_LINES)
            lines.push('+' + (entries.length - MAX_LINES) + ' more sources');
        return lines;
    }

    function showFrame(lines) {
        var canvas = Graphics._canvas;
        if (!canvas)
            return;
        if (!overlay)
            createOverlay();
        overlay.style.top = (canvas.offsetTop + TOP) + 'px';
        overlay.style.left = (canvas.offsetLeft + canvas.offsetWidth) + 'px';
        overlay.style.transform = 'translateX(-100%)';
        var text = lines.join('\n');
        if (text !== shownText) {
            overlay.textContent = text;
            shownText = text;
        }
    }

    //-------------------------------------------------------------------------
    // Log
    //-------------------------------------------------------------------------

    function logFrame(lines) {
        if (logFd === null || frameCalls.size === 0)
            return;
        lines = lines.filter(function(line) { return line.indexOf('\n') < 0; });
        var scene = SceneManager._scene ? SceneManager._scene.constructor.name : '-';
        var map = window.$gameMap ? $gameMap.mapId() : 0;
        var text = 'update ' + frameCount + ' ' + scene + ' map ' + map + ' | ' + lines.join(' | ') + '\n';
        if (frameCallLines.length > 0)
            text += frameCallLines.join('\n') + '\n';
        try {
            fs.writeSync(logFd, text);
        } catch (e) {
        }
    }

    //-------------------------------------------------------------------------
    // Frames
    //-------------------------------------------------------------------------

    /* One call of SceneManager.update per frame: the display shows the calls
     * of that update, and of what ran since the previous one (e.g. callbacks
     * of loaded files) */
    var sceneManagerUpdate = SceneManager.update;
    SceneManager.update = function() {
        sceneManagerUpdate.apply(this, arguments);
        frameCount++;
        var lines = frameLines();
        logFrame(lines.slice(0, 1).concat(lines.slice(2)));
        showFrame(lines);
        frameCalls.clear();
        frameCallLines = [];
    };
})();
