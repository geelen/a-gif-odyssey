(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
"use strict";

var StreamReader = require('./stream_reader.js'),
  Gif = require('./gif.sjs');

var Exploder = function (file, cb) {
  this.file = file;
  this.doneCallback = cb;
  this.loadAndExplode();
};

Exploder.prototype.loadAndExplode = function () {
  var loader = new XMLHttpRequest(),
    exploder = this.explode.bind(this);
  loader.open('GET', this.file, true);
  loader.responseType = 'arraybuffer';
  loader.onload = function () {
    exploder(this.response);
  };
  loader.send();
}

Exploder.prototype.explode = function (buffer) {
  var frames = [],
    streamReader = new StreamReader(buffer);

  // Ensure this is an animated GIF
  if (streamReader.readAscii(6) != "GIF89a") {
    deferred.reject();
    return;
  }

  streamReader.skipBytes(4); // Height & Width
  if (streamReader.peekBit(1)) {
    streamReader.log("GLOBAL COLOR TABLE")
    var colorTableSize = streamReader.readByte() & 0x07;
    streamReader.log("GLOBAL COLOR TABLE IS " + 3 * Math.pow(2, colorTableSize + 1) + " BYTES")
    streamReader.skipBytes(2);
    streamReader.skipBytes(3 * Math.pow(2, colorTableSize + 1));
  } else {
    streamReader.log("NO GLOBAL COLOR TABLE")
  }
  // WE HAVE ENOUGH FOR THE GIF HEADER!
  var gifHeader = buffer.slice(0, streamReader.index);

  var spinning = true, expectingImage = false;
  while (spinning) {

    if (streamReader.isNext([0x21, 0xFF])) {
      streamReader.log("APPLICATION EXTENSION")
      streamReader.skipBytes(2);
      var blockSize = streamReader.readByte();
      streamReader.log(streamReader.readAscii(blockSize));

      if (streamReader.isNext([0x03, 0x01])) {
        // we cool
        streamReader.skipBytes(5)
      } else {
        streamReader.log("A weird application extension. Skip until we have 2 NULL bytes");
        while (!(streamReader.readByte() === 0 && streamReader.peekByte() === 0));
        streamReader.log("OK moving on")
        streamReader.skipBytes(1);
      }
    } else if (streamReader.isNext([0x21, 0xFE])) {
      streamReader.log("COMMENT EXTENSION")
      streamReader.skipBytes(2);

      while (!streamReader.isNext([0x00])) {
        var blockSize = streamReader.readByte();
        streamReader.log(streamReader.readAscii(blockSize));
      }
      streamReader.skipBytes(1); //NULL terminator

    } else if (streamReader.isNext([0x2c])) {
      streamReader.log("IMAGE DESCRIPTOR!");
      if (!expectingImage) {
        // This is a bare image, not prefaced with a Graphics Control Extension
        // so we should treat it as a frame.
        frames.push({ index: streamReader.index, delay: 0 });
      }
      expectingImage = false;

      streamReader.skipBytes(9);
      if (streamReader.peekBit(1)) {
        streamReader.log("LOCAL COLOR TABLE");
        var colorTableSize = streamReader.readByte() & 0x07;
        streamReader.log("LOCAL COLOR TABLE IS " + 3 * Math.pow(2, colorTableSize + 1) + " BYTES")
        streamReader.skipBytes(2);
        streamReader.skipBytes(3 * Math.pow(2, colorTableSize + 1));
      } else {
        streamReader.log("NO LOCAL TABLE PHEW");
        streamReader.skipBytes(1);
      }

      streamReader.log("MIN CODE SIZE " + streamReader.readByte());
      streamReader.log("DATA START");

      while (!streamReader.isNext([0x00])) {
        var blockSize = streamReader.readByte();
//        streamReader.log("SKIPPING " + blockSize + " BYTES");
        streamReader.skipBytes(blockSize);
      }
      streamReader.log("DATA END");
      streamReader.skipBytes(1); //NULL terminator
    } else if (streamReader.isNext([0x21, 0xF9, 0x04])) {
      streamReader.log("GRAPHICS CONTROL EXTENSION!");
      // We _definitely_ have a frame. Now we're expecting an image
      var index = streamReader.index;

      streamReader.skipBytes(3);
      var disposalMethod = streamReader.readByte() >> 2;
      streamReader.log("DISPOSAL " + disposalMethod);
      var delay = streamReader.readByte() + streamReader.readByte() * 256;
      frames.push({ index: index, delay: delay, disposal: disposalMethod });
      streamReader.log("FRAME DELAY " + delay);
      streamReader.skipBytes(2);
      expectingImage = true;
    } else {
      var maybeTheEnd = streamReader.index;
      while (!streamReader.finished() && !streamReader.isNext([0x21, 0xF9, 0x04])) {
        streamReader.readByte();
      }
      if (streamReader.finished()) {
        streamReader.index = maybeTheEnd;
        streamReader.log("WE END");
        spinning = false;
      } else {
        streamReader.log("UNKNOWN DATA FROM " + maybeTheEnd);
      }
    }
  }
  var endOfFrames = streamReader.index;

  var gifFooter = buffer.slice(-1); //last bit is all we need
  for (var i = 0; i < frames.length; i++) {
    var frame = frames[i];
    var nextIndex = (i < frames.length - 1) ? frames[i + 1].index : endOfFrames;
    frame.blob = new Blob([ gifHeader, buffer.slice(frame.index, nextIndex), gifFooter ], {type: 'image/gif'});
    frame.url = URL.createObjectURL(frame.blob);
  }

  this.doneCallback(new Gif(frames));
}

module.exports = Exploder;

},{"./gif.sjs":3,"./stream_reader.js":5}],2:[function(require,module,exports){
"use strict";

var Playback = require('./playback.sjs');

var XGif = function () {
  var Strategies = {
    speed: function () {
      this.playback.startSpeed(this.speed, this['n-times']);
    },
    hardBpm: function () {
      this.playback.startHardBpm(this['hard-bpm']);
    },
    bpm: function () {
      this.playback.startBpm(this.bpm);
    },
    noop: function () {
    }
  }

  this.ready = function () {
    // Better than using a default attribute, since this
    // triggers change detectors below.
    this.src = this.src || "../gifs/nope.gif";
    if (this.exploded != null) {
      this.playbackStrategy = 'noop'
    } else if (this.sync != null) {
      this.playbackStrategy = 'noop';
    } else if (this['hard-bpm']) {
      this.playbackStrategy = 'hardBpm';
    } else if (this.bpm) {
      this.playbackStrategy = 'bpm';
    } else {
      this.speed = this.speed || 1.0;
      this.playbackStrategy = 'speed';
    }
  };

  this.srcChanged = function () {
    var playbackStrategy = Strategies[this.playbackStrategy].bind(this);
    console.log("GO TIME")
    console.log(this.fill != null)
    this.playback = new Playback(this, this.$.frames, this.src, {
      onReady: playbackStrategy,
      pingPong: this['ping-pong'] != null,
      fill: this.fill != null,
      stopped: this.stopped != null
    });
  };

  this.speedChanged = function (oldVal, newVal) {
    console.log("SPEED CHANGED")
    if (this.playback) this.playback.speed = newVal;
  }

  this.stoppedChanged = function (oldVal, newVal) {
    var nowStop = newVal != null;
    if (this.playback && nowStop && !this.playback.stopped) {
      console.log("TIME TO STOP")
      this.playback.stop();
    } else if (this.playback && !nowStop && this.playback.stopped) {
      console.log("TIME TO START")
      this.playback.start();
    }
  }

  this.togglePingPong = function () {
    this['ping-pong'] = (this['ping-pong'] != null) ? null : true;
    if (this.playback) this.playback.pingPong = this['ping-pong'] != null;
  }

  this.clock = function (beatNr, beatDuration, beatFraction) {
    if (this.playback && this.playback.gif) this.playback.fromClock(beatNr, beatDuration, beatFraction);
  };

  this.relayout = function () {
    if (this.fill != null) this.playback.scaleToFill();
  }
}

Polymer('x-gif', new XGif());

},{"./playback.sjs":4}],3:[function(require,module,exports){
'use strict';
;
var defaultFrameDelay$3338 = 10;
var Gif$3339 = function (frames$3340) {
    this.frames = frames$3340;
    this.length = 0;
    this.offsets = [];
    frames$3340.forEach(function (frame$3343) {
        this.offsets.push(this.length);
        this.length += frame$3343.delay || defaultFrameDelay$3338;
    }.bind(this));
};
Gif$3339.prototype.frameAt = function (fraction$3344) {
    var offset$3345 = fraction$3344 * this.length;
    for (var i$3346 = 1, l$3347 = this.offsets.length; i$3346 < l$3347; i$3346++) {
        if (this.offsets[i$3346] > offset$3345)
            break;
    }
    return i$3346 - 1;
};
module.exports = Gif$3339;

},{}],4:[function(require,module,exports){
'use strict';
;
var Exploder$3228 = require('./exploder.js');
// Private functions for setup
function addClasses$3229(element$3232, frame$3233) {
    element$3232.classList.add('frame');
    if (frame$3233.disposal == 2)
        element$3232.classList.add('disposal-restore');
}
var createImage$3230 = function (frame$3234) {
    var image$3235 = new Image();
    image$3235.src = frame$3234.url;
    addClasses$3229(image$3235, frame$3234);
    return image$3235;
};
var Playback$3231 = function (xgif$3236, element$3237, file$3238, opts$3239) {
    // Set up out instance variables
    this.xgif = xgif$3236;
    this.element = element$3237;
    this.onReady = opts$3239.onReady;
    this.pingPong = opts$3239.pingPong;
    this.fill = opts$3239.fill;
    this.stopped = opts$3239.stopped;
    new Exploder$3228(file$3238, function (gif$3241) {
        // Once we have the GIF data, add things to the DOM
        console.warn('Callbacks will hurt you. I promise.');
        console.log('Received ' + gif$3241.frames.length + ' frames of gif ' + file$3238);
        this.gif = gif$3241;
        this.element.innerHTML = '';
        var createFrameElement$3242 = createImage$3230;
        //(this.fill) ? createDiv : createImage;
        gif$3241.frames.map(createFrameElement$3242).forEach(this.element.appendChild, this.element);
        if (this.fill)
            requestAnimationFrame(this.scaleToFill.bind(this));
        this.onReady();
    }.bind(this));
};
Playback$3231.prototype.scaleToFill = function () {
    if (!(this.element.offsetWidth && this.element.offsetHeight)) {
        requestAnimationFrame(this.scaleToFill.bind(this));
    } else {
        var xScale$3243 = this.element.parentElement.offsetWidth / this.element.offsetWidth, yScale$3244 = this.element.parentElement.offsetHeight / this.element.offsetHeight;
        this.element.style.webkitTransform = 'scale(' + 1.1 * Math.max(xScale$3243, yScale$3244) + ')';
    }
};
Playback$3231.prototype.setFrame = function (fraction$3245, repeatCount$3246) {
    var frameNr$3247 = this.pingPong && repeatCount$3246 % 2 >= 1 ? this.gif.frameAt(1 - fraction$3245) : this.gif.frameAt(fraction$3245);
    this.element.dataset['frame'] = frameNr$3247;
};
Playback$3231.prototype.start = function () {
    this.stopped = false;
    this.startTime = performance.now();
    if (this.animationLoop)
        this.animationLoop();
};
Playback$3231.prototype.stop = function () {
    this.stopped = true;
};
Playback$3231.prototype.startSpeed = function (speed$3248, nTimes$3249) {
    this.speed = speed$3248;
    this.animationLoop = function () {
        var gifLength$3251 = 10 * this.gif.length / this.speed, duration$3252 = performance.now() - this.startTime, repeatCount$3253 = duration$3252 / gifLength$3251, fraction$3254 = repeatCount$3253 % 1;
        if (!nTimes$3249 || repeatCount$3253 < nTimes$3249) {
            this.setFrame(fraction$3254, repeatCount$3253);
            if (!this.stopped)
                requestAnimationFrame(this.animationLoop);
        } else {
            this.setFrame(nTimes$3249 % 1 || 1, repeatCount$3253);
            this.xgif.fire('x-gif-finished');
        }
    }.bind(this);
    if (!this.stopped)
        this.start();
};
Playback$3231.prototype.fromClock = function (beatNr$3255, beatDuration$3256, beatFraction$3257) {
    var speedup$3258 = 1.5, lengthInBeats$3259 = Math.max(1, Math.round(1 / speedup$3258 * 10 * this.gif.length / beatDuration$3256)), subBeat$3260 = beatNr$3255 % lengthInBeats$3259, repeatCount$3261 = beatNr$3255 / lengthInBeats$3259, subFraction$3262 = beatFraction$3257 / lengthInBeats$3259 + subBeat$3260 / lengthInBeats$3259;
    this.setFrame(subFraction$3262, repeatCount$3261);
};
Playback$3231.prototype.startHardBpm = function (bpm$3263) {
    var beatLength$3264 = 60 * 1000 / bpm$3263;
    this.animationLoop = function () {
        var duration$3266 = performance.now() - this.startTime, repeatCount$3267 = duration$3266 / beatLength$3264, fraction$3268 = repeatCount$3267 % 1;
        this.setFrame(fraction$3268, repeatCount$3267);
        if (!this.stopped)
            requestAnimationFrame(this.animationLoop);
    }.bind(this);
    if (!this.stopped)
        this.start();
};
Playback$3231.prototype.startBpm = function (bpm$3269) {
    var beatLength$3270 = 60 * 1000 / bpm$3269;
    this.animationLoop = function () {
        var duration$3272 = performance.now() - this.startTime, beatNr$3273 = Math.floor(duration$3272 / beatLength$3270), beatFraction$3274 = duration$3272 % beatLength$3270 / beatLength$3270;
        this.fromClock(beatNr$3273, beatLength$3270, beatFraction$3274);
        if (!this.stopped)
            requestAnimationFrame(this.animationLoop);
    }.bind(this);
    if (!this.stopped)
        this.start();
};
module.exports = Playback$3231;

},{"./exploder.js":1}],5:[function(require,module,exports){
"use strict";

var StreamReader = function (arrayBuffer) {
  this.data = new Uint8Array(arrayBuffer);
  this.index = 0;
  this.log("TOTAL LENGTH: " + this.data.length);
}

StreamReader.prototype.finished = function () {
  return this.index >= this.data.length;
}
StreamReader.prototype.readByte = function () {
  return this.data[this.index++];
};
StreamReader.prototype.peekByte = function () {
  return this.data[this.index];
};
StreamReader.prototype.skipBytes = function (n) {
  this.index += n;
};
StreamReader.prototype.peekBit = function (i) {
  return !!(this.peekByte() & (1 << 8 - i));
};
StreamReader.prototype.readAscii = function (n) {
  var s = '';
  for (var i = 0; i < n; i++) {
    s += String.fromCharCode(this.readByte());
  }
  return s;
};
StreamReader.prototype.isNext = function (array) {
  for (var i = 0; i < array.length; i++) {
    if (array[i] !== this.data[this.index + i]) return false;
  }
  return true;
};
StreamReader.prototype.log = function (str) {
//  console.log(this.index + ": " + str);
};
StreamReader.prototype.error = function (str) {
  console.error(this.index + ": " + str);
}

module.exports = StreamReader;

},{}]},{},[2])