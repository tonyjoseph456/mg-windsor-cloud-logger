var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// (disabled):crypto
var require_crypto = __commonJS({
  "(disabled):crypto"() {
  }
});

// node_modules/crypto-js/core.js
var require_core = __commonJS({
  "node_modules/crypto-js/core.js"(exports, module) {
    (function(root, factory) {
      if (typeof exports === "object") {
        module.exports = exports = factory();
      } else if (typeof define === "function" && define.amd) {
        define([], factory);
      } else {
        root.CryptoJS = factory();
      }
    })(exports, function() {
      var CryptoJS2 = CryptoJS2 || (function(Math2, undefined2) {
        var crypto2;
        if (typeof window !== "undefined" && window.crypto) {
          crypto2 = window.crypto;
        }
        if (typeof self !== "undefined" && self.crypto) {
          crypto2 = self.crypto;
        }
        if (typeof globalThis !== "undefined" && globalThis.crypto) {
          crypto2 = globalThis.crypto;
        }
        if (!crypto2 && typeof window !== "undefined" && window.msCrypto) {
          crypto2 = window.msCrypto;
        }
        if (!crypto2 && typeof global !== "undefined" && global.crypto) {
          crypto2 = global.crypto;
        }
        if (!crypto2 && typeof __require === "function") {
          try {
            crypto2 = require_crypto();
          } catch (err) {
          }
        }
        var cryptoSecureRandomInt = function() {
          if (crypto2) {
            if (typeof crypto2.getRandomValues === "function") {
              try {
                return crypto2.getRandomValues(new Uint32Array(1))[0];
              } catch (err) {
              }
            }
            if (typeof crypto2.randomBytes === "function") {
              try {
                return crypto2.randomBytes(4).readInt32LE();
              } catch (err) {
              }
            }
          }
          throw new Error("Native crypto module could not be used to get secure random number.");
        };
        var create = Object.create || /* @__PURE__ */ (function() {
          function F() {
          }
          return function(obj) {
            var subtype;
            F.prototype = obj;
            subtype = new F();
            F.prototype = null;
            return subtype;
          };
        })();
        var C = {};
        var C_lib = C.lib = {};
        var Base = C_lib.Base = /* @__PURE__ */ (function() {
          return {
            /**
             * Creates a new object that inherits from this object.
             *
             * @param {Object} overrides Properties to copy into the new object.
             *
             * @return {Object} The new object.
             *
             * @static
             *
             * @example
             *
             *     var MyType = CryptoJS.lib.Base.extend({
             *         field: 'value',
             *
             *         method: function () {
             *         }
             *     });
             */
            extend: function(overrides) {
              var subtype = create(this);
              if (overrides) {
                subtype.mixIn(overrides);
              }
              if (!subtype.hasOwnProperty("init") || this.init === subtype.init) {
                subtype.init = function() {
                  subtype.$super.init.apply(this, arguments);
                };
              }
              subtype.init.prototype = subtype;
              subtype.$super = this;
              return subtype;
            },
            /**
             * Extends this object and runs the init method.
             * Arguments to create() will be passed to init().
             *
             * @return {Object} The new object.
             *
             * @static
             *
             * @example
             *
             *     var instance = MyType.create();
             */
            create: function() {
              var instance = this.extend();
              instance.init.apply(instance, arguments);
              return instance;
            },
            /**
             * Initializes a newly created object.
             * Override this method to add some logic when your objects are created.
             *
             * @example
             *
             *     var MyType = CryptoJS.lib.Base.extend({
             *         init: function () {
             *             // ...
             *         }
             *     });
             */
            init: function() {
            },
            /**
             * Copies properties into this object.
             *
             * @param {Object} properties The properties to mix in.
             *
             * @example
             *
             *     MyType.mixIn({
             *         field: 'value'
             *     });
             */
            mixIn: function(properties) {
              for (var propertyName in properties) {
                if (properties.hasOwnProperty(propertyName)) {
                  this[propertyName] = properties[propertyName];
                }
              }
              if (properties.hasOwnProperty("toString")) {
                this.toString = properties.toString;
              }
            },
            /**
             * Creates a copy of this object.
             *
             * @return {Object} The clone.
             *
             * @example
             *
             *     var clone = instance.clone();
             */
            clone: function() {
              return this.init.prototype.extend(this);
            }
          };
        })();
        var WordArray = C_lib.WordArray = Base.extend({
          /**
           * Initializes a newly created word array.
           *
           * @param {Array} words (Optional) An array of 32-bit words.
           * @param {number} sigBytes (Optional) The number of significant bytes in the words.
           *
           * @example
           *
           *     var wordArray = CryptoJS.lib.WordArray.create();
           *     var wordArray = CryptoJS.lib.WordArray.create([0x00010203, 0x04050607]);
           *     var wordArray = CryptoJS.lib.WordArray.create([0x00010203, 0x04050607], 6);
           */
          init: function(words, sigBytes) {
            words = this.words = words || [];
            if (sigBytes != undefined2) {
              this.sigBytes = sigBytes;
            } else {
              this.sigBytes = words.length * 4;
            }
          },
          /**
           * Converts this word array to a string.
           *
           * @param {Encoder} encoder (Optional) The encoding strategy to use. Default: CryptoJS.enc.Hex
           *
           * @return {string} The stringified word array.
           *
           * @example
           *
           *     var string = wordArray + '';
           *     var string = wordArray.toString();
           *     var string = wordArray.toString(CryptoJS.enc.Utf8);
           */
          toString: function(encoder) {
            return (encoder || Hex).stringify(this);
          },
          /**
           * Concatenates a word array to this word array.
           *
           * @param {WordArray} wordArray The word array to append.
           *
           * @return {WordArray} This word array.
           *
           * @example
           *
           *     wordArray1.concat(wordArray2);
           */
          concat: function(wordArray) {
            var thisWords = this.words;
            var thatWords = wordArray.words;
            var thisSigBytes = this.sigBytes;
            var thatSigBytes = wordArray.sigBytes;
            this.clamp();
            if (thisSigBytes % 4) {
              for (var i = 0; i < thatSigBytes; i++) {
                var thatByte = thatWords[i >>> 2] >>> 24 - i % 4 * 8 & 255;
                thisWords[thisSigBytes + i >>> 2] |= thatByte << 24 - (thisSigBytes + i) % 4 * 8;
              }
            } else {
              for (var j = 0; j < thatSigBytes; j += 4) {
                thisWords[thisSigBytes + j >>> 2] = thatWords[j >>> 2];
              }
            }
            this.sigBytes += thatSigBytes;
            return this;
          },
          /**
           * Removes insignificant bits.
           *
           * @example
           *
           *     wordArray.clamp();
           */
          clamp: function() {
            var words = this.words;
            var sigBytes = this.sigBytes;
            words[sigBytes >>> 2] &= 4294967295 << 32 - sigBytes % 4 * 8;
            words.length = Math2.ceil(sigBytes / 4);
          },
          /**
           * Creates a copy of this word array.
           *
           * @return {WordArray} The clone.
           *
           * @example
           *
           *     var clone = wordArray.clone();
           */
          clone: function() {
            var clone = Base.clone.call(this);
            clone.words = this.words.slice(0);
            return clone;
          },
          /**
           * Creates a word array filled with random bytes.
           *
           * @param {number} nBytes The number of random bytes to generate.
           *
           * @return {WordArray} The random word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.lib.WordArray.random(16);
           */
          random: function(nBytes) {
            var words = [];
            for (var i = 0; i < nBytes; i += 4) {
              words.push(cryptoSecureRandomInt());
            }
            return new WordArray.init(words, nBytes);
          }
        });
        var C_enc = C.enc = {};
        var Hex = C_enc.Hex = {
          /**
           * Converts a word array to a hex string.
           *
           * @param {WordArray} wordArray The word array.
           *
           * @return {string} The hex string.
           *
           * @static
           *
           * @example
           *
           *     var hexString = CryptoJS.enc.Hex.stringify(wordArray);
           */
          stringify: function(wordArray) {
            var words = wordArray.words;
            var sigBytes = wordArray.sigBytes;
            var hexChars = [];
            for (var i = 0; i < sigBytes; i++) {
              var bite = words[i >>> 2] >>> 24 - i % 4 * 8 & 255;
              hexChars.push((bite >>> 4).toString(16));
              hexChars.push((bite & 15).toString(16));
            }
            return hexChars.join("");
          },
          /**
           * Converts a hex string to a word array.
           *
           * @param {string} hexStr The hex string.
           *
           * @return {WordArray} The word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.enc.Hex.parse(hexString);
           */
          parse: function(hexStr) {
            var hexStrLength = hexStr.length;
            var words = [];
            for (var i = 0; i < hexStrLength; i += 2) {
              words[i >>> 3] |= parseInt(hexStr.substr(i, 2), 16) << 24 - i % 8 * 4;
            }
            return new WordArray.init(words, hexStrLength / 2);
          }
        };
        var Latin1 = C_enc.Latin1 = {
          /**
           * Converts a word array to a Latin1 string.
           *
           * @param {WordArray} wordArray The word array.
           *
           * @return {string} The Latin1 string.
           *
           * @static
           *
           * @example
           *
           *     var latin1String = CryptoJS.enc.Latin1.stringify(wordArray);
           */
          stringify: function(wordArray) {
            var words = wordArray.words;
            var sigBytes = wordArray.sigBytes;
            var latin1Chars = [];
            for (var i = 0; i < sigBytes; i++) {
              var bite = words[i >>> 2] >>> 24 - i % 4 * 8 & 255;
              latin1Chars.push(String.fromCharCode(bite));
            }
            return latin1Chars.join("");
          },
          /**
           * Converts a Latin1 string to a word array.
           *
           * @param {string} latin1Str The Latin1 string.
           *
           * @return {WordArray} The word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.enc.Latin1.parse(latin1String);
           */
          parse: function(latin1Str) {
            var latin1StrLength = latin1Str.length;
            var words = [];
            for (var i = 0; i < latin1StrLength; i++) {
              words[i >>> 2] |= (latin1Str.charCodeAt(i) & 255) << 24 - i % 4 * 8;
            }
            return new WordArray.init(words, latin1StrLength);
          }
        };
        var Utf8 = C_enc.Utf8 = {
          /**
           * Converts a word array to a UTF-8 string.
           *
           * @param {WordArray} wordArray The word array.
           *
           * @return {string} The UTF-8 string.
           *
           * @static
           *
           * @example
           *
           *     var utf8String = CryptoJS.enc.Utf8.stringify(wordArray);
           */
          stringify: function(wordArray) {
            try {
              return decodeURIComponent(escape(Latin1.stringify(wordArray)));
            } catch (e) {
              throw new Error("Malformed UTF-8 data");
            }
          },
          /**
           * Converts a UTF-8 string to a word array.
           *
           * @param {string} utf8Str The UTF-8 string.
           *
           * @return {WordArray} The word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.enc.Utf8.parse(utf8String);
           */
          parse: function(utf8Str) {
            return Latin1.parse(unescape(encodeURIComponent(utf8Str)));
          }
        };
        var BufferedBlockAlgorithm = C_lib.BufferedBlockAlgorithm = Base.extend({
          /**
           * Resets this block algorithm's data buffer to its initial state.
           *
           * @example
           *
           *     bufferedBlockAlgorithm.reset();
           */
          reset: function() {
            this._data = new WordArray.init();
            this._nDataBytes = 0;
          },
          /**
           * Adds new data to this block algorithm's buffer.
           *
           * @param {WordArray|string} data The data to append. Strings are converted to a WordArray using UTF-8.
           *
           * @example
           *
           *     bufferedBlockAlgorithm._append('data');
           *     bufferedBlockAlgorithm._append(wordArray);
           */
          _append: function(data) {
            if (typeof data == "string") {
              data = Utf8.parse(data);
            }
            this._data.concat(data);
            this._nDataBytes += data.sigBytes;
          },
          /**
           * Processes available data blocks.
           *
           * This method invokes _doProcessBlock(offset), which must be implemented by a concrete subtype.
           *
           * @param {boolean} doFlush Whether all blocks and partial blocks should be processed.
           *
           * @return {WordArray} The processed data.
           *
           * @example
           *
           *     var processedData = bufferedBlockAlgorithm._process();
           *     var processedData = bufferedBlockAlgorithm._process(!!'flush');
           */
          _process: function(doFlush) {
            var processedWords;
            var data = this._data;
            var dataWords = data.words;
            var dataSigBytes = data.sigBytes;
            var blockSize = this.blockSize;
            var blockSizeBytes = blockSize * 4;
            var nBlocksReady = dataSigBytes / blockSizeBytes;
            if (doFlush) {
              nBlocksReady = Math2.ceil(nBlocksReady);
            } else {
              nBlocksReady = Math2.max((nBlocksReady | 0) - this._minBufferSize, 0);
            }
            var nWordsReady = nBlocksReady * blockSize;
            var nBytesReady = Math2.min(nWordsReady * 4, dataSigBytes);
            if (nWordsReady) {
              for (var offset = 0; offset < nWordsReady; offset += blockSize) {
                this._doProcessBlock(dataWords, offset);
              }
              processedWords = dataWords.splice(0, nWordsReady);
              data.sigBytes -= nBytesReady;
            }
            return new WordArray.init(processedWords, nBytesReady);
          },
          /**
           * Creates a copy of this object.
           *
           * @return {Object} The clone.
           *
           * @example
           *
           *     var clone = bufferedBlockAlgorithm.clone();
           */
          clone: function() {
            var clone = Base.clone.call(this);
            clone._data = this._data.clone();
            return clone;
          },
          _minBufferSize: 0
        });
        var Hasher = C_lib.Hasher = BufferedBlockAlgorithm.extend({
          /**
           * Configuration options.
           */
          cfg: Base.extend(),
          /**
           * Initializes a newly created hasher.
           *
           * @param {Object} cfg (Optional) The configuration options to use for this hash computation.
           *
           * @example
           *
           *     var hasher = CryptoJS.algo.SHA256.create();
           */
          init: function(cfg) {
            this.cfg = this.cfg.extend(cfg);
            this.reset();
          },
          /**
           * Resets this hasher to its initial state.
           *
           * @example
           *
           *     hasher.reset();
           */
          reset: function() {
            BufferedBlockAlgorithm.reset.call(this);
            this._doReset();
          },
          /**
           * Updates this hasher with a message.
           *
           * @param {WordArray|string} messageUpdate The message to append.
           *
           * @return {Hasher} This hasher.
           *
           * @example
           *
           *     hasher.update('message');
           *     hasher.update(wordArray);
           */
          update: function(messageUpdate) {
            this._append(messageUpdate);
            this._process();
            return this;
          },
          /**
           * Finalizes the hash computation.
           * Note that the finalize operation is effectively a destructive, read-once operation.
           *
           * @param {WordArray|string} messageUpdate (Optional) A final message update.
           *
           * @return {WordArray} The hash.
           *
           * @example
           *
           *     var hash = hasher.finalize();
           *     var hash = hasher.finalize('message');
           *     var hash = hasher.finalize(wordArray);
           */
          finalize: function(messageUpdate) {
            if (messageUpdate) {
              this._append(messageUpdate);
            }
            var hash = this._doFinalize();
            return hash;
          },
          blockSize: 512 / 32,
          /**
           * Creates a shortcut function to a hasher's object interface.
           *
           * @param {Hasher} hasher The hasher to create a helper for.
           *
           * @return {Function} The shortcut function.
           *
           * @static
           *
           * @example
           *
           *     var SHA256 = CryptoJS.lib.Hasher._createHelper(CryptoJS.algo.SHA256);
           */
          _createHelper: function(hasher) {
            return function(message, cfg) {
              return new hasher.init(cfg).finalize(message);
            };
          },
          /**
           * Creates a shortcut function to the HMAC's object interface.
           *
           * @param {Hasher} hasher The hasher to use in this HMAC helper.
           *
           * @return {Function} The shortcut function.
           *
           * @static
           *
           * @example
           *
           *     var HmacSHA256 = CryptoJS.lib.Hasher._createHmacHelper(CryptoJS.algo.SHA256);
           */
          _createHmacHelper: function(hasher) {
            return function(message, key) {
              return new C_algo.HMAC.init(hasher, key).finalize(message);
            };
          }
        });
        var C_algo = C.algo = {};
        return C;
      })(Math);
      return CryptoJS2;
    });
  }
});

// node_modules/crypto-js/x64-core.js
var require_x64_core = __commonJS({
  "node_modules/crypto-js/x64-core.js"(exports, module) {
    (function(root, factory) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function(undefined2) {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var Base = C_lib.Base;
        var X32WordArray = C_lib.WordArray;
        var C_x64 = C.x64 = {};
        var X64Word = C_x64.Word = Base.extend({
          /**
           * Initializes a newly created 64-bit word.
           *
           * @param {number} high The high 32 bits.
           * @param {number} low The low 32 bits.
           *
           * @example
           *
           *     var x64Word = CryptoJS.x64.Word.create(0x00010203, 0x04050607);
           */
          init: function(high, low) {
            this.high = high;
            this.low = low;
          }
          /**
           * Bitwise NOTs this word.
           *
           * @return {X64Word} A new x64-Word object after negating.
           *
           * @example
           *
           *     var negated = x64Word.not();
           */
          // not: function () {
          // var high = ~this.high;
          // var low = ~this.low;
          // return X64Word.create(high, low);
          // },
          /**
           * Bitwise ANDs this word with the passed word.
           *
           * @param {X64Word} word The x64-Word to AND with this word.
           *
           * @return {X64Word} A new x64-Word object after ANDing.
           *
           * @example
           *
           *     var anded = x64Word.and(anotherX64Word);
           */
          // and: function (word) {
          // var high = this.high & word.high;
          // var low = this.low & word.low;
          // return X64Word.create(high, low);
          // },
          /**
           * Bitwise ORs this word with the passed word.
           *
           * @param {X64Word} word The x64-Word to OR with this word.
           *
           * @return {X64Word} A new x64-Word object after ORing.
           *
           * @example
           *
           *     var ored = x64Word.or(anotherX64Word);
           */
          // or: function (word) {
          // var high = this.high | word.high;
          // var low = this.low | word.low;
          // return X64Word.create(high, low);
          // },
          /**
           * Bitwise XORs this word with the passed word.
           *
           * @param {X64Word} word The x64-Word to XOR with this word.
           *
           * @return {X64Word} A new x64-Word object after XORing.
           *
           * @example
           *
           *     var xored = x64Word.xor(anotherX64Word);
           */
          // xor: function (word) {
          // var high = this.high ^ word.high;
          // var low = this.low ^ word.low;
          // return X64Word.create(high, low);
          // },
          /**
           * Shifts this word n bits to the left.
           *
           * @param {number} n The number of bits to shift.
           *
           * @return {X64Word} A new x64-Word object after shifting.
           *
           * @example
           *
           *     var shifted = x64Word.shiftL(25);
           */
          // shiftL: function (n) {
          // if (n < 32) {
          // var high = (this.high << n) | (this.low >>> (32 - n));
          // var low = this.low << n;
          // } else {
          // var high = this.low << (n - 32);
          // var low = 0;
          // }
          // return X64Word.create(high, low);
          // },
          /**
           * Shifts this word n bits to the right.
           *
           * @param {number} n The number of bits to shift.
           *
           * @return {X64Word} A new x64-Word object after shifting.
           *
           * @example
           *
           *     var shifted = x64Word.shiftR(7);
           */
          // shiftR: function (n) {
          // if (n < 32) {
          // var low = (this.low >>> n) | (this.high << (32 - n));
          // var high = this.high >>> n;
          // } else {
          // var low = this.high >>> (n - 32);
          // var high = 0;
          // }
          // return X64Word.create(high, low);
          // },
          /**
           * Rotates this word n bits to the left.
           *
           * @param {number} n The number of bits to rotate.
           *
           * @return {X64Word} A new x64-Word object after rotating.
           *
           * @example
           *
           *     var rotated = x64Word.rotL(25);
           */
          // rotL: function (n) {
          // return this.shiftL(n).or(this.shiftR(64 - n));
          // },
          /**
           * Rotates this word n bits to the right.
           *
           * @param {number} n The number of bits to rotate.
           *
           * @return {X64Word} A new x64-Word object after rotating.
           *
           * @example
           *
           *     var rotated = x64Word.rotR(7);
           */
          // rotR: function (n) {
          // return this.shiftR(n).or(this.shiftL(64 - n));
          // },
          /**
           * Adds this word with the passed word.
           *
           * @param {X64Word} word The x64-Word to add with this word.
           *
           * @return {X64Word} A new x64-Word object after adding.
           *
           * @example
           *
           *     var added = x64Word.add(anotherX64Word);
           */
          // add: function (word) {
          // var low = (this.low + word.low) | 0;
          // var carry = (low >>> 0) < (this.low >>> 0) ? 1 : 0;
          // var high = (this.high + word.high + carry) | 0;
          // return X64Word.create(high, low);
          // }
        });
        var X64WordArray = C_x64.WordArray = Base.extend({
          /**
           * Initializes a newly created word array.
           *
           * @param {Array} words (Optional) An array of CryptoJS.x64.Word objects.
           * @param {number} sigBytes (Optional) The number of significant bytes in the words.
           *
           * @example
           *
           *     var wordArray = CryptoJS.x64.WordArray.create();
           *
           *     var wordArray = CryptoJS.x64.WordArray.create([
           *         CryptoJS.x64.Word.create(0x00010203, 0x04050607),
           *         CryptoJS.x64.Word.create(0x18191a1b, 0x1c1d1e1f)
           *     ]);
           *
           *     var wordArray = CryptoJS.x64.WordArray.create([
           *         CryptoJS.x64.Word.create(0x00010203, 0x04050607),
           *         CryptoJS.x64.Word.create(0x18191a1b, 0x1c1d1e1f)
           *     ], 10);
           */
          init: function(words, sigBytes) {
            words = this.words = words || [];
            if (sigBytes != undefined2) {
              this.sigBytes = sigBytes;
            } else {
              this.sigBytes = words.length * 8;
            }
          },
          /**
           * Converts this 64-bit word array to a 32-bit word array.
           *
           * @return {CryptoJS.lib.WordArray} This word array's data as a 32-bit word array.
           *
           * @example
           *
           *     var x32WordArray = x64WordArray.toX32();
           */
          toX32: function() {
            var x64Words = this.words;
            var x64WordsLength = x64Words.length;
            var x32Words = [];
            for (var i = 0; i < x64WordsLength; i++) {
              var x64Word = x64Words[i];
              x32Words.push(x64Word.high);
              x32Words.push(x64Word.low);
            }
            return X32WordArray.create(x32Words, this.sigBytes);
          },
          /**
           * Creates a copy of this word array.
           *
           * @return {X64WordArray} The clone.
           *
           * @example
           *
           *     var clone = x64WordArray.clone();
           */
          clone: function() {
            var clone = Base.clone.call(this);
            var words = clone.words = this.words.slice(0);
            var wordsLength = words.length;
            for (var i = 0; i < wordsLength; i++) {
              words[i] = words[i].clone();
            }
            return clone;
          }
        });
      })();
      return CryptoJS2;
    });
  }
});

// node_modules/crypto-js/lib-typedarrays.js
var require_lib_typedarrays = __commonJS({
  "node_modules/crypto-js/lib-typedarrays.js"(exports, module) {
    (function(root, factory) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function() {
        if (typeof ArrayBuffer != "function") {
          return;
        }
        var C = CryptoJS2;
        var C_lib = C.lib;
        var WordArray = C_lib.WordArray;
        var superInit = WordArray.init;
        var subInit = WordArray.init = function(typedArray) {
          if (typedArray instanceof ArrayBuffer) {
            typedArray = new Uint8Array(typedArray);
          }
          if (typedArray instanceof Int8Array || typeof Uint8ClampedArray !== "undefined" && typedArray instanceof Uint8ClampedArray || typedArray instanceof Int16Array || typedArray instanceof Uint16Array || typedArray instanceof Int32Array || typedArray instanceof Uint32Array || typedArray instanceof Float32Array || typedArray instanceof Float64Array) {
            typedArray = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
          }
          if (typedArray instanceof Uint8Array) {
            var typedArrayByteLength = typedArray.byteLength;
            var words = [];
            for (var i = 0; i < typedArrayByteLength; i++) {
              words[i >>> 2] |= typedArray[i] << 24 - i % 4 * 8;
            }
            superInit.call(this, words, typedArrayByteLength);
          } else {
            superInit.apply(this, arguments);
          }
        };
        subInit.prototype = WordArray;
      })();
      return CryptoJS2.lib.WordArray;
    });
  }
});

// node_modules/crypto-js/enc-utf16.js
var require_enc_utf16 = __commonJS({
  "node_modules/crypto-js/enc-utf16.js"(exports, module) {
    (function(root, factory) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function() {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var WordArray = C_lib.WordArray;
        var C_enc = C.enc;
        var Utf16BE = C_enc.Utf16 = C_enc.Utf16BE = {
          /**
           * Converts a word array to a UTF-16 BE string.
           *
           * @param {WordArray} wordArray The word array.
           *
           * @return {string} The UTF-16 BE string.
           *
           * @static
           *
           * @example
           *
           *     var utf16String = CryptoJS.enc.Utf16.stringify(wordArray);
           */
          stringify: function(wordArray) {
            var words = wordArray.words;
            var sigBytes = wordArray.sigBytes;
            var utf16Chars = [];
            for (var i = 0; i < sigBytes; i += 2) {
              var codePoint = words[i >>> 2] >>> 16 - i % 4 * 8 & 65535;
              utf16Chars.push(String.fromCharCode(codePoint));
            }
            return utf16Chars.join("");
          },
          /**
           * Converts a UTF-16 BE string to a word array.
           *
           * @param {string} utf16Str The UTF-16 BE string.
           *
           * @return {WordArray} The word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.enc.Utf16.parse(utf16String);
           */
          parse: function(utf16Str) {
            var utf16StrLength = utf16Str.length;
            var words = [];
            for (var i = 0; i < utf16StrLength; i++) {
              words[i >>> 1] |= utf16Str.charCodeAt(i) << 16 - i % 2 * 16;
            }
            return WordArray.create(words, utf16StrLength * 2);
          }
        };
        C_enc.Utf16LE = {
          /**
           * Converts a word array to a UTF-16 LE string.
           *
           * @param {WordArray} wordArray The word array.
           *
           * @return {string} The UTF-16 LE string.
           *
           * @static
           *
           * @example
           *
           *     var utf16Str = CryptoJS.enc.Utf16LE.stringify(wordArray);
           */
          stringify: function(wordArray) {
            var words = wordArray.words;
            var sigBytes = wordArray.sigBytes;
            var utf16Chars = [];
            for (var i = 0; i < sigBytes; i += 2) {
              var codePoint = swapEndian(words[i >>> 2] >>> 16 - i % 4 * 8 & 65535);
              utf16Chars.push(String.fromCharCode(codePoint));
            }
            return utf16Chars.join("");
          },
          /**
           * Converts a UTF-16 LE string to a word array.
           *
           * @param {string} utf16Str The UTF-16 LE string.
           *
           * @return {WordArray} The word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.enc.Utf16LE.parse(utf16Str);
           */
          parse: function(utf16Str) {
            var utf16StrLength = utf16Str.length;
            var words = [];
            for (var i = 0; i < utf16StrLength; i++) {
              words[i >>> 1] |= swapEndian(utf16Str.charCodeAt(i) << 16 - i % 2 * 16);
            }
            return WordArray.create(words, utf16StrLength * 2);
          }
        };
        function swapEndian(word) {
          return word << 8 & 4278255360 | word >>> 8 & 16711935;
        }
      })();
      return CryptoJS2.enc.Utf16;
    });
  }
});

// node_modules/crypto-js/enc-base64.js
var require_enc_base64 = __commonJS({
  "node_modules/crypto-js/enc-base64.js"(exports, module) {
    (function(root, factory) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function() {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var WordArray = C_lib.WordArray;
        var C_enc = C.enc;
        var Base64 = C_enc.Base64 = {
          /**
           * Converts a word array to a Base64 string.
           *
           * @param {WordArray} wordArray The word array.
           *
           * @return {string} The Base64 string.
           *
           * @static
           *
           * @example
           *
           *     var base64String = CryptoJS.enc.Base64.stringify(wordArray);
           */
          stringify: function(wordArray) {
            var words = wordArray.words;
            var sigBytes = wordArray.sigBytes;
            var map = this._map;
            wordArray.clamp();
            var base64Chars = [];
            for (var i = 0; i < sigBytes; i += 3) {
              var byte1 = words[i >>> 2] >>> 24 - i % 4 * 8 & 255;
              var byte2 = words[i + 1 >>> 2] >>> 24 - (i + 1) % 4 * 8 & 255;
              var byte3 = words[i + 2 >>> 2] >>> 24 - (i + 2) % 4 * 8 & 255;
              var triplet = byte1 << 16 | byte2 << 8 | byte3;
              for (var j = 0; j < 4 && i + j * 0.75 < sigBytes; j++) {
                base64Chars.push(map.charAt(triplet >>> 6 * (3 - j) & 63));
              }
            }
            var paddingChar = map.charAt(64);
            if (paddingChar) {
              while (base64Chars.length % 4) {
                base64Chars.push(paddingChar);
              }
            }
            return base64Chars.join("");
          },
          /**
           * Converts a Base64 string to a word array.
           *
           * @param {string} base64Str The Base64 string.
           *
           * @return {WordArray} The word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.enc.Base64.parse(base64String);
           */
          parse: function(base64Str) {
            var base64StrLength = base64Str.length;
            var map = this._map;
            var reverseMap = this._reverseMap;
            if (!reverseMap) {
              reverseMap = this._reverseMap = [];
              for (var j = 0; j < map.length; j++) {
                reverseMap[map.charCodeAt(j)] = j;
              }
            }
            var paddingChar = map.charAt(64);
            if (paddingChar) {
              var paddingIndex = base64Str.indexOf(paddingChar);
              if (paddingIndex !== -1) {
                base64StrLength = paddingIndex;
              }
            }
            return parseLoop(base64Str, base64StrLength, reverseMap);
          },
          _map: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
        };
        function parseLoop(base64Str, base64StrLength, reverseMap) {
          var words = [];
          var nBytes = 0;
          for (var i = 0; i < base64StrLength; i++) {
            if (i % 4) {
              var bits1 = reverseMap[base64Str.charCodeAt(i - 1)] << i % 4 * 2;
              var bits2 = reverseMap[base64Str.charCodeAt(i)] >>> 6 - i % 4 * 2;
              var bitsCombined = bits1 | bits2;
              words[nBytes >>> 2] |= bitsCombined << 24 - nBytes % 4 * 8;
              nBytes++;
            }
          }
          return WordArray.create(words, nBytes);
        }
      })();
      return CryptoJS2.enc.Base64;
    });
  }
});

// node_modules/crypto-js/enc-base64url.js
var require_enc_base64url = __commonJS({
  "node_modules/crypto-js/enc-base64url.js"(exports, module) {
    (function(root, factory) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function() {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var WordArray = C_lib.WordArray;
        var C_enc = C.enc;
        var Base64url = C_enc.Base64url = {
          /**
           * Converts a word array to a Base64url string.
           *
           * @param {WordArray} wordArray The word array.
           *
           * @param {boolean} urlSafe Whether to use url safe
           *
           * @return {string} The Base64url string.
           *
           * @static
           *
           * @example
           *
           *     var base64String = CryptoJS.enc.Base64url.stringify(wordArray);
           */
          stringify: function(wordArray, urlSafe) {
            if (urlSafe === void 0) {
              urlSafe = true;
            }
            var words = wordArray.words;
            var sigBytes = wordArray.sigBytes;
            var map = urlSafe ? this._safe_map : this._map;
            wordArray.clamp();
            var base64Chars = [];
            for (var i = 0; i < sigBytes; i += 3) {
              var byte1 = words[i >>> 2] >>> 24 - i % 4 * 8 & 255;
              var byte2 = words[i + 1 >>> 2] >>> 24 - (i + 1) % 4 * 8 & 255;
              var byte3 = words[i + 2 >>> 2] >>> 24 - (i + 2) % 4 * 8 & 255;
              var triplet = byte1 << 16 | byte2 << 8 | byte3;
              for (var j = 0; j < 4 && i + j * 0.75 < sigBytes; j++) {
                base64Chars.push(map.charAt(triplet >>> 6 * (3 - j) & 63));
              }
            }
            var paddingChar = map.charAt(64);
            if (paddingChar) {
              while (base64Chars.length % 4) {
                base64Chars.push(paddingChar);
              }
            }
            return base64Chars.join("");
          },
          /**
           * Converts a Base64url string to a word array.
           *
           * @param {string} base64Str The Base64url string.
           *
           * @param {boolean} urlSafe Whether to use url safe
           *
           * @return {WordArray} The word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.enc.Base64url.parse(base64String);
           */
          parse: function(base64Str, urlSafe) {
            if (urlSafe === void 0) {
              urlSafe = true;
            }
            var base64StrLength = base64Str.length;
            var map = urlSafe ? this._safe_map : this._map;
            var reverseMap = this._reverseMap;
            if (!reverseMap) {
              reverseMap = this._reverseMap = [];
              for (var j = 0; j < map.length; j++) {
                reverseMap[map.charCodeAt(j)] = j;
              }
            }
            var paddingChar = map.charAt(64);
            if (paddingChar) {
              var paddingIndex = base64Str.indexOf(paddingChar);
              if (paddingIndex !== -1) {
                base64StrLength = paddingIndex;
              }
            }
            return parseLoop(base64Str, base64StrLength, reverseMap);
          },
          _map: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
          _safe_map: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        };
        function parseLoop(base64Str, base64StrLength, reverseMap) {
          var words = [];
          var nBytes = 0;
          for (var i = 0; i < base64StrLength; i++) {
            if (i % 4) {
              var bits1 = reverseMap[base64Str.charCodeAt(i - 1)] << i % 4 * 2;
              var bits2 = reverseMap[base64Str.charCodeAt(i)] >>> 6 - i % 4 * 2;
              var bitsCombined = bits1 | bits2;
              words[nBytes >>> 2] |= bitsCombined << 24 - nBytes % 4 * 8;
              nBytes++;
            }
          }
          return WordArray.create(words, nBytes);
        }
      })();
      return CryptoJS2.enc.Base64url;
    });
  }
});

// node_modules/crypto-js/md5.js
var require_md5 = __commonJS({
  "node_modules/crypto-js/md5.js"(exports, module) {
    (function(root, factory) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function(Math2) {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var WordArray = C_lib.WordArray;
        var Hasher = C_lib.Hasher;
        var C_algo = C.algo;
        var T = [];
        (function() {
          for (var i = 0; i < 64; i++) {
            T[i] = Math2.abs(Math2.sin(i + 1)) * 4294967296 | 0;
          }
        })();
        var MD5 = C_algo.MD5 = Hasher.extend({
          _doReset: function() {
            this._hash = new WordArray.init([
              1732584193,
              4023233417,
              2562383102,
              271733878
            ]);
          },
          _doProcessBlock: function(M, offset) {
            for (var i = 0; i < 16; i++) {
              var offset_i = offset + i;
              var M_offset_i = M[offset_i];
              M[offset_i] = (M_offset_i << 8 | M_offset_i >>> 24) & 16711935 | (M_offset_i << 24 | M_offset_i >>> 8) & 4278255360;
            }
            var H = this._hash.words;
            var M_offset_0 = M[offset + 0];
            var M_offset_1 = M[offset + 1];
            var M_offset_2 = M[offset + 2];
            var M_offset_3 = M[offset + 3];
            var M_offset_4 = M[offset + 4];
            var M_offset_5 = M[offset + 5];
            var M_offset_6 = M[offset + 6];
            var M_offset_7 = M[offset + 7];
            var M_offset_8 = M[offset + 8];
            var M_offset_9 = M[offset + 9];
            var M_offset_10 = M[offset + 10];
            var M_offset_11 = M[offset + 11];
            var M_offset_12 = M[offset + 12];
            var M_offset_13 = M[offset + 13];
            var M_offset_14 = M[offset + 14];
            var M_offset_15 = M[offset + 15];
            var a = H[0];
            var b = H[1];
            var c = H[2];
            var d = H[3];
            a = FF(a, b, c, d, M_offset_0, 7, T[0]);
            d = FF(d, a, b, c, M_offset_1, 12, T[1]);
            c = FF(c, d, a, b, M_offset_2, 17, T[2]);
            b = FF(b, c, d, a, M_offset_3, 22, T[3]);
            a = FF(a, b, c, d, M_offset_4, 7, T[4]);
            d = FF(d, a, b, c, M_offset_5, 12, T[5]);
            c = FF(c, d, a, b, M_offset_6, 17, T[6]);
            b = FF(b, c, d, a, M_offset_7, 22, T[7]);
            a = FF(a, b, c, d, M_offset_8, 7, T[8]);
            d = FF(d, a, b, c, M_offset_9, 12, T[9]);
            c = FF(c, d, a, b, M_offset_10, 17, T[10]);
            b = FF(b, c, d, a, M_offset_11, 22, T[11]);
            a = FF(a, b, c, d, M_offset_12, 7, T[12]);
            d = FF(d, a, b, c, M_offset_13, 12, T[13]);
            c = FF(c, d, a, b, M_offset_14, 17, T[14]);
            b = FF(b, c, d, a, M_offset_15, 22, T[15]);
            a = GG(a, b, c, d, M_offset_1, 5, T[16]);
            d = GG(d, a, b, c, M_offset_6, 9, T[17]);
            c = GG(c, d, a, b, M_offset_11, 14, T[18]);
            b = GG(b, c, d, a, M_offset_0, 20, T[19]);
            a = GG(a, b, c, d, M_offset_5, 5, T[20]);
            d = GG(d, a, b, c, M_offset_10, 9, T[21]);
            c = GG(c, d, a, b, M_offset_15, 14, T[22]);
            b = GG(b, c, d, a, M_offset_4, 20, T[23]);
            a = GG(a, b, c, d, M_offset_9, 5, T[24]);
            d = GG(d, a, b, c, M_offset_14, 9, T[25]);
            c = GG(c, d, a, b, M_offset_3, 14, T[26]);
            b = GG(b, c, d, a, M_offset_8, 20, T[27]);
            a = GG(a, b, c, d, M_offset_13, 5, T[28]);
            d = GG(d, a, b, c, M_offset_2, 9, T[29]);
            c = GG(c, d, a, b, M_offset_7, 14, T[30]);
            b = GG(b, c, d, a, M_offset_12, 20, T[31]);
            a = HH(a, b, c, d, M_offset_5, 4, T[32]);
            d = HH(d, a, b, c, M_offset_8, 11, T[33]);
            c = HH(c, d, a, b, M_offset_11, 16, T[34]);
            b = HH(b, c, d, a, M_offset_14, 23, T[35]);
            a = HH(a, b, c, d, M_offset_1, 4, T[36]);
            d = HH(d, a, b, c, M_offset_4, 11, T[37]);
            c = HH(c, d, a, b, M_offset_7, 16, T[38]);
            b = HH(b, c, d, a, M_offset_10, 23, T[39]);
            a = HH(a, b, c, d, M_offset_13, 4, T[40]);
            d = HH(d, a, b, c, M_offset_0, 11, T[41]);
            c = HH(c, d, a, b, M_offset_3, 16, T[42]);
            b = HH(b, c, d, a, M_offset_6, 23, T[43]);
            a = HH(a, b, c, d, M_offset_9, 4, T[44]);
            d = HH(d, a, b, c, M_offset_12, 11, T[45]);
            c = HH(c, d, a, b, M_offset_15, 16, T[46]);
            b = HH(b, c, d, a, M_offset_2, 23, T[47]);
            a = II(a, b, c, d, M_offset_0, 6, T[48]);
            d = II(d, a, b, c, M_offset_7, 10, T[49]);
            c = II(c, d, a, b, M_offset_14, 15, T[50]);
            b = II(b, c, d, a, M_offset_5, 21, T[51]);
            a = II(a, b, c, d, M_offset_12, 6, T[52]);
            d = II(d, a, b, c, M_offset_3, 10, T[53]);
            c = II(c, d, a, b, M_offset_10, 15, T[54]);
            b = II(b, c, d, a, M_offset_1, 21, T[55]);
            a = II(a, b, c, d, M_offset_8, 6, T[56]);
            d = II(d, a, b, c, M_offset_15, 10, T[57]);
            c = II(c, d, a, b, M_offset_6, 15, T[58]);
            b = II(b, c, d, a, M_offset_13, 21, T[59]);
            a = II(a, b, c, d, M_offset_4, 6, T[60]);
            d = II(d, a, b, c, M_offset_11, 10, T[61]);
            c = II(c, d, a, b, M_offset_2, 15, T[62]);
            b = II(b, c, d, a, M_offset_9, 21, T[63]);
            H[0] = H[0] + a | 0;
            H[1] = H[1] + b | 0;
            H[2] = H[2] + c | 0;
            H[3] = H[3] + d | 0;
          },
          _doFinalize: function() {
            var data = this._data;
            var dataWords = data.words;
            var nBitsTotal = this._nDataBytes * 8;
            var nBitsLeft = data.sigBytes * 8;
            dataWords[nBitsLeft >>> 5] |= 128 << 24 - nBitsLeft % 32;
            var nBitsTotalH = Math2.floor(nBitsTotal / 4294967296);
            var nBitsTotalL = nBitsTotal;
            dataWords[(nBitsLeft + 64 >>> 9 << 4) + 15] = (nBitsTotalH << 8 | nBitsTotalH >>> 24) & 16711935 | (nBitsTotalH << 24 | nBitsTotalH >>> 8) & 4278255360;
            dataWords[(nBitsLeft + 64 >>> 9 << 4) + 14] = (nBitsTotalL << 8 | nBitsTotalL >>> 24) & 16711935 | (nBitsTotalL << 24 | nBitsTotalL >>> 8) & 4278255360;
            data.sigBytes = (dataWords.length + 1) * 4;
            this._process();
            var hash = this._hash;
            var H = hash.words;
            for (var i = 0; i < 4; i++) {
              var H_i = H[i];
              H[i] = (H_i << 8 | H_i >>> 24) & 16711935 | (H_i << 24 | H_i >>> 8) & 4278255360;
            }
            return hash;
          },
          clone: function() {
            var clone = Hasher.clone.call(this);
            clone._hash = this._hash.clone();
            return clone;
          }
        });
        function FF(a, b, c, d, x, s, t) {
          var n = a + (b & c | ~b & d) + x + t;
          return (n << s | n >>> 32 - s) + b;
        }
        function GG(a, b, c, d, x, s, t) {
          var n = a + (b & d | c & ~d) + x + t;
          return (n << s | n >>> 32 - s) + b;
        }
        function HH(a, b, c, d, x, s, t) {
          var n = a + (b ^ c ^ d) + x + t;
          return (n << s | n >>> 32 - s) + b;
        }
        function II(a, b, c, d, x, s, t) {
          var n = a + (c ^ (b | ~d)) + x + t;
          return (n << s | n >>> 32 - s) + b;
        }
        C.MD5 = Hasher._createHelper(MD5);
        C.HmacMD5 = Hasher._createHmacHelper(MD5);
      })(Math);
      return CryptoJS2.MD5;
    });
  }
});

// node_modules/crypto-js/sha1.js
var require_sha1 = __commonJS({
  "node_modules/crypto-js/sha1.js"(exports, module) {
    (function(root, factory) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function() {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var WordArray = C_lib.WordArray;
        var Hasher = C_lib.Hasher;
        var C_algo = C.algo;
        var W = [];
        var SHA1 = C_algo.SHA1 = Hasher.extend({
          _doReset: function() {
            this._hash = new WordArray.init([
              1732584193,
              4023233417,
              2562383102,
              271733878,
              3285377520
            ]);
          },
          _doProcessBlock: function(M, offset) {
            var H = this._hash.words;
            var a = H[0];
            var b = H[1];
            var c = H[2];
            var d = H[3];
            var e = H[4];
            for (var i = 0; i < 80; i++) {
              if (i < 16) {
                W[i] = M[offset + i] | 0;
              } else {
                var n = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16];
                W[i] = n << 1 | n >>> 31;
              }
              var t = (a << 5 | a >>> 27) + e + W[i];
              if (i < 20) {
                t += (b & c | ~b & d) + 1518500249;
              } else if (i < 40) {
                t += (b ^ c ^ d) + 1859775393;
              } else if (i < 60) {
                t += (b & c | b & d | c & d) - 1894007588;
              } else {
                t += (b ^ c ^ d) - 899497514;
              }
              e = d;
              d = c;
              c = b << 30 | b >>> 2;
              b = a;
              a = t;
            }
            H[0] = H[0] + a | 0;
            H[1] = H[1] + b | 0;
            H[2] = H[2] + c | 0;
            H[3] = H[3] + d | 0;
            H[4] = H[4] + e | 0;
          },
          _doFinalize: function() {
            var data = this._data;
            var dataWords = data.words;
            var nBitsTotal = this._nDataBytes * 8;
            var nBitsLeft = data.sigBytes * 8;
            dataWords[nBitsLeft >>> 5] |= 128 << 24 - nBitsLeft % 32;
            dataWords[(nBitsLeft + 64 >>> 9 << 4) + 14] = Math.floor(nBitsTotal / 4294967296);
            dataWords[(nBitsLeft + 64 >>> 9 << 4) + 15] = nBitsTotal;
            data.sigBytes = dataWords.length * 4;
            this._process();
            return this._hash;
          },
          clone: function() {
            var clone = Hasher.clone.call(this);
            clone._hash = this._hash.clone();
            return clone;
          }
        });
        C.SHA1 = Hasher._createHelper(SHA1);
        C.HmacSHA1 = Hasher._createHmacHelper(SHA1);
      })();
      return CryptoJS2.SHA1;
    });
  }
});

// node_modules/crypto-js/sha256.js
var require_sha256 = __commonJS({
  "node_modules/crypto-js/sha256.js"(exports, module) {
    (function(root, factory) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function(Math2) {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var WordArray = C_lib.WordArray;
        var Hasher = C_lib.Hasher;
        var C_algo = C.algo;
        var H = [];
        var K = [];
        (function() {
          function isPrime(n2) {
            var sqrtN = Math2.sqrt(n2);
            for (var factor = 2; factor <= sqrtN; factor++) {
              if (!(n2 % factor)) {
                return false;
              }
            }
            return true;
          }
          function getFractionalBits(n2) {
            return (n2 - (n2 | 0)) * 4294967296 | 0;
          }
          var n = 2;
          var nPrime = 0;
          while (nPrime < 64) {
            if (isPrime(n)) {
              if (nPrime < 8) {
                H[nPrime] = getFractionalBits(Math2.pow(n, 1 / 2));
              }
              K[nPrime] = getFractionalBits(Math2.pow(n, 1 / 3));
              nPrime++;
            }
            n++;
          }
        })();
        var W = [];
        var SHA256 = C_algo.SHA256 = Hasher.extend({
          _doReset: function() {
            this._hash = new WordArray.init(H.slice(0));
          },
          _doProcessBlock: function(M, offset) {
            var H2 = this._hash.words;
            var a = H2[0];
            var b = H2[1];
            var c = H2[2];
            var d = H2[3];
            var e = H2[4];
            var f = H2[5];
            var g = H2[6];
            var h = H2[7];
            for (var i = 0; i < 64; i++) {
              if (i < 16) {
                W[i] = M[offset + i] | 0;
              } else {
                var gamma0x = W[i - 15];
                var gamma0 = (gamma0x << 25 | gamma0x >>> 7) ^ (gamma0x << 14 | gamma0x >>> 18) ^ gamma0x >>> 3;
                var gamma1x = W[i - 2];
                var gamma1 = (gamma1x << 15 | gamma1x >>> 17) ^ (gamma1x << 13 | gamma1x >>> 19) ^ gamma1x >>> 10;
                W[i] = gamma0 + W[i - 7] + gamma1 + W[i - 16];
              }
              var ch = e & f ^ ~e & g;
              var maj = a & b ^ a & c ^ b & c;
              var sigma0 = (a << 30 | a >>> 2) ^ (a << 19 | a >>> 13) ^ (a << 10 | a >>> 22);
              var sigma1 = (e << 26 | e >>> 6) ^ (e << 21 | e >>> 11) ^ (e << 7 | e >>> 25);
              var t1 = h + sigma1 + ch + K[i] + W[i];
              var t2 = sigma0 + maj;
              h = g;
              g = f;
              f = e;
              e = d + t1 | 0;
              d = c;
              c = b;
              b = a;
              a = t1 + t2 | 0;
            }
            H2[0] = H2[0] + a | 0;
            H2[1] = H2[1] + b | 0;
            H2[2] = H2[2] + c | 0;
            H2[3] = H2[3] + d | 0;
            H2[4] = H2[4] + e | 0;
            H2[5] = H2[5] + f | 0;
            H2[6] = H2[6] + g | 0;
            H2[7] = H2[7] + h | 0;
          },
          _doFinalize: function() {
            var data = this._data;
            var dataWords = data.words;
            var nBitsTotal = this._nDataBytes * 8;
            var nBitsLeft = data.sigBytes * 8;
            dataWords[nBitsLeft >>> 5] |= 128 << 24 - nBitsLeft % 32;
            dataWords[(nBitsLeft + 64 >>> 9 << 4) + 14] = Math2.floor(nBitsTotal / 4294967296);
            dataWords[(nBitsLeft + 64 >>> 9 << 4) + 15] = nBitsTotal;
            data.sigBytes = dataWords.length * 4;
            this._process();
            return this._hash;
          },
          clone: function() {
            var clone = Hasher.clone.call(this);
            clone._hash = this._hash.clone();
            return clone;
          }
        });
        C.SHA256 = Hasher._createHelper(SHA256);
        C.HmacSHA256 = Hasher._createHmacHelper(SHA256);
      })(Math);
      return CryptoJS2.SHA256;
    });
  }
});

// node_modules/crypto-js/sha224.js
var require_sha224 = __commonJS({
  "node_modules/crypto-js/sha224.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_sha256());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./sha256"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function() {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var WordArray = C_lib.WordArray;
        var C_algo = C.algo;
        var SHA256 = C_algo.SHA256;
        var SHA224 = C_algo.SHA224 = SHA256.extend({
          _doReset: function() {
            this._hash = new WordArray.init([
              3238371032,
              914150663,
              812702999,
              4144912697,
              4290775857,
              1750603025,
              1694076839,
              3204075428
            ]);
          },
          _doFinalize: function() {
            var hash = SHA256._doFinalize.call(this);
            hash.sigBytes -= 4;
            return hash;
          }
        });
        C.SHA224 = SHA256._createHelper(SHA224);
        C.HmacSHA224 = SHA256._createHmacHelper(SHA224);
      })();
      return CryptoJS2.SHA224;
    });
  }
});

// node_modules/crypto-js/sha512.js
var require_sha512 = __commonJS({
  "node_modules/crypto-js/sha512.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_x64_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./x64-core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function() {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var Hasher = C_lib.Hasher;
        var C_x64 = C.x64;
        var X64Word = C_x64.Word;
        var X64WordArray = C_x64.WordArray;
        var C_algo = C.algo;
        function X64Word_create() {
          return X64Word.create.apply(X64Word, arguments);
        }
        var K = [
          X64Word_create(1116352408, 3609767458),
          X64Word_create(1899447441, 602891725),
          X64Word_create(3049323471, 3964484399),
          X64Word_create(3921009573, 2173295548),
          X64Word_create(961987163, 4081628472),
          X64Word_create(1508970993, 3053834265),
          X64Word_create(2453635748, 2937671579),
          X64Word_create(2870763221, 3664609560),
          X64Word_create(3624381080, 2734883394),
          X64Word_create(310598401, 1164996542),
          X64Word_create(607225278, 1323610764),
          X64Word_create(1426881987, 3590304994),
          X64Word_create(1925078388, 4068182383),
          X64Word_create(2162078206, 991336113),
          X64Word_create(2614888103, 633803317),
          X64Word_create(3248222580, 3479774868),
          X64Word_create(3835390401, 2666613458),
          X64Word_create(4022224774, 944711139),
          X64Word_create(264347078, 2341262773),
          X64Word_create(604807628, 2007800933),
          X64Word_create(770255983, 1495990901),
          X64Word_create(1249150122, 1856431235),
          X64Word_create(1555081692, 3175218132),
          X64Word_create(1996064986, 2198950837),
          X64Word_create(2554220882, 3999719339),
          X64Word_create(2821834349, 766784016),
          X64Word_create(2952996808, 2566594879),
          X64Word_create(3210313671, 3203337956),
          X64Word_create(3336571891, 1034457026),
          X64Word_create(3584528711, 2466948901),
          X64Word_create(113926993, 3758326383),
          X64Word_create(338241895, 168717936),
          X64Word_create(666307205, 1188179964),
          X64Word_create(773529912, 1546045734),
          X64Word_create(1294757372, 1522805485),
          X64Word_create(1396182291, 2643833823),
          X64Word_create(1695183700, 2343527390),
          X64Word_create(1986661051, 1014477480),
          X64Word_create(2177026350, 1206759142),
          X64Word_create(2456956037, 344077627),
          X64Word_create(2730485921, 1290863460),
          X64Word_create(2820302411, 3158454273),
          X64Word_create(3259730800, 3505952657),
          X64Word_create(3345764771, 106217008),
          X64Word_create(3516065817, 3606008344),
          X64Word_create(3600352804, 1432725776),
          X64Word_create(4094571909, 1467031594),
          X64Word_create(275423344, 851169720),
          X64Word_create(430227734, 3100823752),
          X64Word_create(506948616, 1363258195),
          X64Word_create(659060556, 3750685593),
          X64Word_create(883997877, 3785050280),
          X64Word_create(958139571, 3318307427),
          X64Word_create(1322822218, 3812723403),
          X64Word_create(1537002063, 2003034995),
          X64Word_create(1747873779, 3602036899),
          X64Word_create(1955562222, 1575990012),
          X64Word_create(2024104815, 1125592928),
          X64Word_create(2227730452, 2716904306),
          X64Word_create(2361852424, 442776044),
          X64Word_create(2428436474, 593698344),
          X64Word_create(2756734187, 3733110249),
          X64Word_create(3204031479, 2999351573),
          X64Word_create(3329325298, 3815920427),
          X64Word_create(3391569614, 3928383900),
          X64Word_create(3515267271, 566280711),
          X64Word_create(3940187606, 3454069534),
          X64Word_create(4118630271, 4000239992),
          X64Word_create(116418474, 1914138554),
          X64Word_create(174292421, 2731055270),
          X64Word_create(289380356, 3203993006),
          X64Word_create(460393269, 320620315),
          X64Word_create(685471733, 587496836),
          X64Word_create(852142971, 1086792851),
          X64Word_create(1017036298, 365543100),
          X64Word_create(1126000580, 2618297676),
          X64Word_create(1288033470, 3409855158),
          X64Word_create(1501505948, 4234509866),
          X64Word_create(1607167915, 987167468),
          X64Word_create(1816402316, 1246189591)
        ];
        var W = [];
        (function() {
          for (var i = 0; i < 80; i++) {
            W[i] = X64Word_create();
          }
        })();
        var SHA512 = C_algo.SHA512 = Hasher.extend({
          _doReset: function() {
            this._hash = new X64WordArray.init([
              new X64Word.init(1779033703, 4089235720),
              new X64Word.init(3144134277, 2227873595),
              new X64Word.init(1013904242, 4271175723),
              new X64Word.init(2773480762, 1595750129),
              new X64Word.init(1359893119, 2917565137),
              new X64Word.init(2600822924, 725511199),
              new X64Word.init(528734635, 4215389547),
              new X64Word.init(1541459225, 327033209)
            ]);
          },
          _doProcessBlock: function(M, offset) {
            var H = this._hash.words;
            var H0 = H[0];
            var H1 = H[1];
            var H2 = H[2];
            var H3 = H[3];
            var H4 = H[4];
            var H5 = H[5];
            var H6 = H[6];
            var H7 = H[7];
            var H0h = H0.high;
            var H0l = H0.low;
            var H1h = H1.high;
            var H1l = H1.low;
            var H2h = H2.high;
            var H2l = H2.low;
            var H3h = H3.high;
            var H3l = H3.low;
            var H4h = H4.high;
            var H4l = H4.low;
            var H5h = H5.high;
            var H5l = H5.low;
            var H6h = H6.high;
            var H6l = H6.low;
            var H7h = H7.high;
            var H7l = H7.low;
            var ah = H0h;
            var al = H0l;
            var bh = H1h;
            var bl = H1l;
            var ch = H2h;
            var cl = H2l;
            var dh = H3h;
            var dl = H3l;
            var eh = H4h;
            var el = H4l;
            var fh = H5h;
            var fl = H5l;
            var gh = H6h;
            var gl = H6l;
            var hh = H7h;
            var hl = H7l;
            for (var i = 0; i < 80; i++) {
              var Wil;
              var Wih;
              var Wi = W[i];
              if (i < 16) {
                Wih = Wi.high = M[offset + i * 2] | 0;
                Wil = Wi.low = M[offset + i * 2 + 1] | 0;
              } else {
                var gamma0x = W[i - 15];
                var gamma0xh = gamma0x.high;
                var gamma0xl = gamma0x.low;
                var gamma0h = (gamma0xh >>> 1 | gamma0xl << 31) ^ (gamma0xh >>> 8 | gamma0xl << 24) ^ gamma0xh >>> 7;
                var gamma0l = (gamma0xl >>> 1 | gamma0xh << 31) ^ (gamma0xl >>> 8 | gamma0xh << 24) ^ (gamma0xl >>> 7 | gamma0xh << 25);
                var gamma1x = W[i - 2];
                var gamma1xh = gamma1x.high;
                var gamma1xl = gamma1x.low;
                var gamma1h = (gamma1xh >>> 19 | gamma1xl << 13) ^ (gamma1xh << 3 | gamma1xl >>> 29) ^ gamma1xh >>> 6;
                var gamma1l = (gamma1xl >>> 19 | gamma1xh << 13) ^ (gamma1xl << 3 | gamma1xh >>> 29) ^ (gamma1xl >>> 6 | gamma1xh << 26);
                var Wi7 = W[i - 7];
                var Wi7h = Wi7.high;
                var Wi7l = Wi7.low;
                var Wi16 = W[i - 16];
                var Wi16h = Wi16.high;
                var Wi16l = Wi16.low;
                Wil = gamma0l + Wi7l;
                Wih = gamma0h + Wi7h + (Wil >>> 0 < gamma0l >>> 0 ? 1 : 0);
                Wil = Wil + gamma1l;
                Wih = Wih + gamma1h + (Wil >>> 0 < gamma1l >>> 0 ? 1 : 0);
                Wil = Wil + Wi16l;
                Wih = Wih + Wi16h + (Wil >>> 0 < Wi16l >>> 0 ? 1 : 0);
                Wi.high = Wih;
                Wi.low = Wil;
              }
              var chh = eh & fh ^ ~eh & gh;
              var chl = el & fl ^ ~el & gl;
              var majh = ah & bh ^ ah & ch ^ bh & ch;
              var majl = al & bl ^ al & cl ^ bl & cl;
              var sigma0h = (ah >>> 28 | al << 4) ^ (ah << 30 | al >>> 2) ^ (ah << 25 | al >>> 7);
              var sigma0l = (al >>> 28 | ah << 4) ^ (al << 30 | ah >>> 2) ^ (al << 25 | ah >>> 7);
              var sigma1h = (eh >>> 14 | el << 18) ^ (eh >>> 18 | el << 14) ^ (eh << 23 | el >>> 9);
              var sigma1l = (el >>> 14 | eh << 18) ^ (el >>> 18 | eh << 14) ^ (el << 23 | eh >>> 9);
              var Ki = K[i];
              var Kih = Ki.high;
              var Kil = Ki.low;
              var t1l = hl + sigma1l;
              var t1h = hh + sigma1h + (t1l >>> 0 < hl >>> 0 ? 1 : 0);
              var t1l = t1l + chl;
              var t1h = t1h + chh + (t1l >>> 0 < chl >>> 0 ? 1 : 0);
              var t1l = t1l + Kil;
              var t1h = t1h + Kih + (t1l >>> 0 < Kil >>> 0 ? 1 : 0);
              var t1l = t1l + Wil;
              var t1h = t1h + Wih + (t1l >>> 0 < Wil >>> 0 ? 1 : 0);
              var t2l = sigma0l + majl;
              var t2h = sigma0h + majh + (t2l >>> 0 < sigma0l >>> 0 ? 1 : 0);
              hh = gh;
              hl = gl;
              gh = fh;
              gl = fl;
              fh = eh;
              fl = el;
              el = dl + t1l | 0;
              eh = dh + t1h + (el >>> 0 < dl >>> 0 ? 1 : 0) | 0;
              dh = ch;
              dl = cl;
              ch = bh;
              cl = bl;
              bh = ah;
              bl = al;
              al = t1l + t2l | 0;
              ah = t1h + t2h + (al >>> 0 < t1l >>> 0 ? 1 : 0) | 0;
            }
            H0l = H0.low = H0l + al;
            H0.high = H0h + ah + (H0l >>> 0 < al >>> 0 ? 1 : 0);
            H1l = H1.low = H1l + bl;
            H1.high = H1h + bh + (H1l >>> 0 < bl >>> 0 ? 1 : 0);
            H2l = H2.low = H2l + cl;
            H2.high = H2h + ch + (H2l >>> 0 < cl >>> 0 ? 1 : 0);
            H3l = H3.low = H3l + dl;
            H3.high = H3h + dh + (H3l >>> 0 < dl >>> 0 ? 1 : 0);
            H4l = H4.low = H4l + el;
            H4.high = H4h + eh + (H4l >>> 0 < el >>> 0 ? 1 : 0);
            H5l = H5.low = H5l + fl;
            H5.high = H5h + fh + (H5l >>> 0 < fl >>> 0 ? 1 : 0);
            H6l = H6.low = H6l + gl;
            H6.high = H6h + gh + (H6l >>> 0 < gl >>> 0 ? 1 : 0);
            H7l = H7.low = H7l + hl;
            H7.high = H7h + hh + (H7l >>> 0 < hl >>> 0 ? 1 : 0);
          },
          _doFinalize: function() {
            var data = this._data;
            var dataWords = data.words;
            var nBitsTotal = this._nDataBytes * 8;
            var nBitsLeft = data.sigBytes * 8;
            dataWords[nBitsLeft >>> 5] |= 128 << 24 - nBitsLeft % 32;
            dataWords[(nBitsLeft + 128 >>> 10 << 5) + 30] = Math.floor(nBitsTotal / 4294967296);
            dataWords[(nBitsLeft + 128 >>> 10 << 5) + 31] = nBitsTotal;
            data.sigBytes = dataWords.length * 4;
            this._process();
            var hash = this._hash.toX32();
            return hash;
          },
          clone: function() {
            var clone = Hasher.clone.call(this);
            clone._hash = this._hash.clone();
            return clone;
          },
          blockSize: 1024 / 32
        });
        C.SHA512 = Hasher._createHelper(SHA512);
        C.HmacSHA512 = Hasher._createHmacHelper(SHA512);
      })();
      return CryptoJS2.SHA512;
    });
  }
});

// node_modules/crypto-js/sha384.js
var require_sha384 = __commonJS({
  "node_modules/crypto-js/sha384.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_x64_core(), require_sha512());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./x64-core", "./sha512"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function() {
        var C = CryptoJS2;
        var C_x64 = C.x64;
        var X64Word = C_x64.Word;
        var X64WordArray = C_x64.WordArray;
        var C_algo = C.algo;
        var SHA512 = C_algo.SHA512;
        var SHA384 = C_algo.SHA384 = SHA512.extend({
          _doReset: function() {
            this._hash = new X64WordArray.init([
              new X64Word.init(3418070365, 3238371032),
              new X64Word.init(1654270250, 914150663),
              new X64Word.init(2438529370, 812702999),
              new X64Word.init(355462360, 4144912697),
              new X64Word.init(1731405415, 4290775857),
              new X64Word.init(2394180231, 1750603025),
              new X64Word.init(3675008525, 1694076839),
              new X64Word.init(1203062813, 3204075428)
            ]);
          },
          _doFinalize: function() {
            var hash = SHA512._doFinalize.call(this);
            hash.sigBytes -= 16;
            return hash;
          }
        });
        C.SHA384 = SHA512._createHelper(SHA384);
        C.HmacSHA384 = SHA512._createHmacHelper(SHA384);
      })();
      return CryptoJS2.SHA384;
    });
  }
});

// node_modules/crypto-js/sha3.js
var require_sha3 = __commonJS({
  "node_modules/crypto-js/sha3.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_x64_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./x64-core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function(Math2) {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var WordArray = C_lib.WordArray;
        var Hasher = C_lib.Hasher;
        var C_x64 = C.x64;
        var X64Word = C_x64.Word;
        var C_algo = C.algo;
        var RHO_OFFSETS = [];
        var PI_INDEXES = [];
        var ROUND_CONSTANTS = [];
        (function() {
          var x = 1, y = 0;
          for (var t = 0; t < 24; t++) {
            RHO_OFFSETS[x + 5 * y] = (t + 1) * (t + 2) / 2 % 64;
            var newX = y % 5;
            var newY = (2 * x + 3 * y) % 5;
            x = newX;
            y = newY;
          }
          for (var x = 0; x < 5; x++) {
            for (var y = 0; y < 5; y++) {
              PI_INDEXES[x + 5 * y] = y + (2 * x + 3 * y) % 5 * 5;
            }
          }
          var LFSR = 1;
          for (var i = 0; i < 24; i++) {
            var roundConstantMsw = 0;
            var roundConstantLsw = 0;
            for (var j = 0; j < 7; j++) {
              if (LFSR & 1) {
                var bitPosition = (1 << j) - 1;
                if (bitPosition < 32) {
                  roundConstantLsw ^= 1 << bitPosition;
                } else {
                  roundConstantMsw ^= 1 << bitPosition - 32;
                }
              }
              if (LFSR & 128) {
                LFSR = LFSR << 1 ^ 113;
              } else {
                LFSR <<= 1;
              }
            }
            ROUND_CONSTANTS[i] = X64Word.create(roundConstantMsw, roundConstantLsw);
          }
        })();
        var T = [];
        (function() {
          for (var i = 0; i < 25; i++) {
            T[i] = X64Word.create();
          }
        })();
        var SHA3 = C_algo.SHA3 = Hasher.extend({
          /**
           * Configuration options.
           *
           * @property {number} outputLength
           *   The desired number of bits in the output hash.
           *   Only values permitted are: 224, 256, 384, 512.
           *   Default: 512
           */
          cfg: Hasher.cfg.extend({
            outputLength: 512
          }),
          _doReset: function() {
            var state = this._state = [];
            for (var i = 0; i < 25; i++) {
              state[i] = new X64Word.init();
            }
            this.blockSize = (1600 - 2 * this.cfg.outputLength) / 32;
          },
          _doProcessBlock: function(M, offset) {
            var state = this._state;
            var nBlockSizeLanes = this.blockSize / 2;
            for (var i = 0; i < nBlockSizeLanes; i++) {
              var M2i = M[offset + 2 * i];
              var M2i1 = M[offset + 2 * i + 1];
              M2i = (M2i << 8 | M2i >>> 24) & 16711935 | (M2i << 24 | M2i >>> 8) & 4278255360;
              M2i1 = (M2i1 << 8 | M2i1 >>> 24) & 16711935 | (M2i1 << 24 | M2i1 >>> 8) & 4278255360;
              var lane = state[i];
              lane.high ^= M2i1;
              lane.low ^= M2i;
            }
            for (var round = 0; round < 24; round++) {
              for (var x = 0; x < 5; x++) {
                var tMsw = 0, tLsw = 0;
                for (var y = 0; y < 5; y++) {
                  var lane = state[x + 5 * y];
                  tMsw ^= lane.high;
                  tLsw ^= lane.low;
                }
                var Tx = T[x];
                Tx.high = tMsw;
                Tx.low = tLsw;
              }
              for (var x = 0; x < 5; x++) {
                var Tx4 = T[(x + 4) % 5];
                var Tx1 = T[(x + 1) % 5];
                var Tx1Msw = Tx1.high;
                var Tx1Lsw = Tx1.low;
                var tMsw = Tx4.high ^ (Tx1Msw << 1 | Tx1Lsw >>> 31);
                var tLsw = Tx4.low ^ (Tx1Lsw << 1 | Tx1Msw >>> 31);
                for (var y = 0; y < 5; y++) {
                  var lane = state[x + 5 * y];
                  lane.high ^= tMsw;
                  lane.low ^= tLsw;
                }
              }
              for (var laneIndex = 1; laneIndex < 25; laneIndex++) {
                var tMsw;
                var tLsw;
                var lane = state[laneIndex];
                var laneMsw = lane.high;
                var laneLsw = lane.low;
                var rhoOffset = RHO_OFFSETS[laneIndex];
                if (rhoOffset < 32) {
                  tMsw = laneMsw << rhoOffset | laneLsw >>> 32 - rhoOffset;
                  tLsw = laneLsw << rhoOffset | laneMsw >>> 32 - rhoOffset;
                } else {
                  tMsw = laneLsw << rhoOffset - 32 | laneMsw >>> 64 - rhoOffset;
                  tLsw = laneMsw << rhoOffset - 32 | laneLsw >>> 64 - rhoOffset;
                }
                var TPiLane = T[PI_INDEXES[laneIndex]];
                TPiLane.high = tMsw;
                TPiLane.low = tLsw;
              }
              var T0 = T[0];
              var state0 = state[0];
              T0.high = state0.high;
              T0.low = state0.low;
              for (var x = 0; x < 5; x++) {
                for (var y = 0; y < 5; y++) {
                  var laneIndex = x + 5 * y;
                  var lane = state[laneIndex];
                  var TLane = T[laneIndex];
                  var Tx1Lane = T[(x + 1) % 5 + 5 * y];
                  var Tx2Lane = T[(x + 2) % 5 + 5 * y];
                  lane.high = TLane.high ^ ~Tx1Lane.high & Tx2Lane.high;
                  lane.low = TLane.low ^ ~Tx1Lane.low & Tx2Lane.low;
                }
              }
              var lane = state[0];
              var roundConstant = ROUND_CONSTANTS[round];
              lane.high ^= roundConstant.high;
              lane.low ^= roundConstant.low;
            }
          },
          _doFinalize: function() {
            var data = this._data;
            var dataWords = data.words;
            var nBitsTotal = this._nDataBytes * 8;
            var nBitsLeft = data.sigBytes * 8;
            var blockSizeBits = this.blockSize * 32;
            dataWords[nBitsLeft >>> 5] |= 1 << 24 - nBitsLeft % 32;
            dataWords[(Math2.ceil((nBitsLeft + 1) / blockSizeBits) * blockSizeBits >>> 5) - 1] |= 128;
            data.sigBytes = dataWords.length * 4;
            this._process();
            var state = this._state;
            var outputLengthBytes = this.cfg.outputLength / 8;
            var outputLengthLanes = outputLengthBytes / 8;
            var hashWords = [];
            for (var i = 0; i < outputLengthLanes; i++) {
              var lane = state[i];
              var laneMsw = lane.high;
              var laneLsw = lane.low;
              laneMsw = (laneMsw << 8 | laneMsw >>> 24) & 16711935 | (laneMsw << 24 | laneMsw >>> 8) & 4278255360;
              laneLsw = (laneLsw << 8 | laneLsw >>> 24) & 16711935 | (laneLsw << 24 | laneLsw >>> 8) & 4278255360;
              hashWords.push(laneLsw);
              hashWords.push(laneMsw);
            }
            return new WordArray.init(hashWords, outputLengthBytes);
          },
          clone: function() {
            var clone = Hasher.clone.call(this);
            var state = clone._state = this._state.slice(0);
            for (var i = 0; i < 25; i++) {
              state[i] = state[i].clone();
            }
            return clone;
          }
        });
        C.SHA3 = Hasher._createHelper(SHA3);
        C.HmacSHA3 = Hasher._createHmacHelper(SHA3);
      })(Math);
      return CryptoJS2.SHA3;
    });
  }
});

// node_modules/crypto-js/ripemd160.js
var require_ripemd160 = __commonJS({
  "node_modules/crypto-js/ripemd160.js"(exports, module) {
    (function(root, factory) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function(Math2) {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var WordArray = C_lib.WordArray;
        var Hasher = C_lib.Hasher;
        var C_algo = C.algo;
        var _zl = WordArray.create([
          0,
          1,
          2,
          3,
          4,
          5,
          6,
          7,
          8,
          9,
          10,
          11,
          12,
          13,
          14,
          15,
          7,
          4,
          13,
          1,
          10,
          6,
          15,
          3,
          12,
          0,
          9,
          5,
          2,
          14,
          11,
          8,
          3,
          10,
          14,
          4,
          9,
          15,
          8,
          1,
          2,
          7,
          0,
          6,
          13,
          11,
          5,
          12,
          1,
          9,
          11,
          10,
          0,
          8,
          12,
          4,
          13,
          3,
          7,
          15,
          14,
          5,
          6,
          2,
          4,
          0,
          5,
          9,
          7,
          12,
          2,
          10,
          14,
          1,
          3,
          8,
          11,
          6,
          15,
          13
        ]);
        var _zr = WordArray.create([
          5,
          14,
          7,
          0,
          9,
          2,
          11,
          4,
          13,
          6,
          15,
          8,
          1,
          10,
          3,
          12,
          6,
          11,
          3,
          7,
          0,
          13,
          5,
          10,
          14,
          15,
          8,
          12,
          4,
          9,
          1,
          2,
          15,
          5,
          1,
          3,
          7,
          14,
          6,
          9,
          11,
          8,
          12,
          2,
          10,
          0,
          4,
          13,
          8,
          6,
          4,
          1,
          3,
          11,
          15,
          0,
          5,
          12,
          2,
          13,
          9,
          7,
          10,
          14,
          12,
          15,
          10,
          4,
          1,
          5,
          8,
          7,
          6,
          2,
          13,
          14,
          0,
          3,
          9,
          11
        ]);
        var _sl = WordArray.create([
          11,
          14,
          15,
          12,
          5,
          8,
          7,
          9,
          11,
          13,
          14,
          15,
          6,
          7,
          9,
          8,
          7,
          6,
          8,
          13,
          11,
          9,
          7,
          15,
          7,
          12,
          15,
          9,
          11,
          7,
          13,
          12,
          11,
          13,
          6,
          7,
          14,
          9,
          13,
          15,
          14,
          8,
          13,
          6,
          5,
          12,
          7,
          5,
          11,
          12,
          14,
          15,
          14,
          15,
          9,
          8,
          9,
          14,
          5,
          6,
          8,
          6,
          5,
          12,
          9,
          15,
          5,
          11,
          6,
          8,
          13,
          12,
          5,
          12,
          13,
          14,
          11,
          8,
          5,
          6
        ]);
        var _sr = WordArray.create([
          8,
          9,
          9,
          11,
          13,
          15,
          15,
          5,
          7,
          7,
          8,
          11,
          14,
          14,
          12,
          6,
          9,
          13,
          15,
          7,
          12,
          8,
          9,
          11,
          7,
          7,
          12,
          7,
          6,
          15,
          13,
          11,
          9,
          7,
          15,
          11,
          8,
          6,
          6,
          14,
          12,
          13,
          5,
          14,
          13,
          13,
          7,
          5,
          15,
          5,
          8,
          11,
          14,
          14,
          6,
          14,
          6,
          9,
          12,
          9,
          12,
          5,
          15,
          8,
          8,
          5,
          12,
          9,
          12,
          5,
          14,
          6,
          8,
          13,
          6,
          5,
          15,
          13,
          11,
          11
        ]);
        var _hl = WordArray.create([0, 1518500249, 1859775393, 2400959708, 2840853838]);
        var _hr = WordArray.create([1352829926, 1548603684, 1836072691, 2053994217, 0]);
        var RIPEMD160 = C_algo.RIPEMD160 = Hasher.extend({
          _doReset: function() {
            this._hash = WordArray.create([1732584193, 4023233417, 2562383102, 271733878, 3285377520]);
          },
          _doProcessBlock: function(M, offset) {
            for (var i = 0; i < 16; i++) {
              var offset_i = offset + i;
              var M_offset_i = M[offset_i];
              M[offset_i] = (M_offset_i << 8 | M_offset_i >>> 24) & 16711935 | (M_offset_i << 24 | M_offset_i >>> 8) & 4278255360;
            }
            var H = this._hash.words;
            var hl = _hl.words;
            var hr = _hr.words;
            var zl = _zl.words;
            var zr = _zr.words;
            var sl = _sl.words;
            var sr = _sr.words;
            var al, bl, cl, dl, el;
            var ar, br, cr, dr, er;
            ar = al = H[0];
            br = bl = H[1];
            cr = cl = H[2];
            dr = dl = H[3];
            er = el = H[4];
            var t;
            for (var i = 0; i < 80; i += 1) {
              t = al + M[offset + zl[i]] | 0;
              if (i < 16) {
                t += f1(bl, cl, dl) + hl[0];
              } else if (i < 32) {
                t += f2(bl, cl, dl) + hl[1];
              } else if (i < 48) {
                t += f3(bl, cl, dl) + hl[2];
              } else if (i < 64) {
                t += f4(bl, cl, dl) + hl[3];
              } else {
                t += f5(bl, cl, dl) + hl[4];
              }
              t = t | 0;
              t = rotl(t, sl[i]);
              t = t + el | 0;
              al = el;
              el = dl;
              dl = rotl(cl, 10);
              cl = bl;
              bl = t;
              t = ar + M[offset + zr[i]] | 0;
              if (i < 16) {
                t += f5(br, cr, dr) + hr[0];
              } else if (i < 32) {
                t += f4(br, cr, dr) + hr[1];
              } else if (i < 48) {
                t += f3(br, cr, dr) + hr[2];
              } else if (i < 64) {
                t += f2(br, cr, dr) + hr[3];
              } else {
                t += f1(br, cr, dr) + hr[4];
              }
              t = t | 0;
              t = rotl(t, sr[i]);
              t = t + er | 0;
              ar = er;
              er = dr;
              dr = rotl(cr, 10);
              cr = br;
              br = t;
            }
            t = H[1] + cl + dr | 0;
            H[1] = H[2] + dl + er | 0;
            H[2] = H[3] + el + ar | 0;
            H[3] = H[4] + al + br | 0;
            H[4] = H[0] + bl + cr | 0;
            H[0] = t;
          },
          _doFinalize: function() {
            var data = this._data;
            var dataWords = data.words;
            var nBitsTotal = this._nDataBytes * 8;
            var nBitsLeft = data.sigBytes * 8;
            dataWords[nBitsLeft >>> 5] |= 128 << 24 - nBitsLeft % 32;
            dataWords[(nBitsLeft + 64 >>> 9 << 4) + 14] = (nBitsTotal << 8 | nBitsTotal >>> 24) & 16711935 | (nBitsTotal << 24 | nBitsTotal >>> 8) & 4278255360;
            data.sigBytes = (dataWords.length + 1) * 4;
            this._process();
            var hash = this._hash;
            var H = hash.words;
            for (var i = 0; i < 5; i++) {
              var H_i = H[i];
              H[i] = (H_i << 8 | H_i >>> 24) & 16711935 | (H_i << 24 | H_i >>> 8) & 4278255360;
            }
            return hash;
          },
          clone: function() {
            var clone = Hasher.clone.call(this);
            clone._hash = this._hash.clone();
            return clone;
          }
        });
        function f1(x, y, z) {
          return x ^ y ^ z;
        }
        function f2(x, y, z) {
          return x & y | ~x & z;
        }
        function f3(x, y, z) {
          return (x | ~y) ^ z;
        }
        function f4(x, y, z) {
          return x & z | y & ~z;
        }
        function f5(x, y, z) {
          return x ^ (y | ~z);
        }
        function rotl(x, n) {
          return x << n | x >>> 32 - n;
        }
        C.RIPEMD160 = Hasher._createHelper(RIPEMD160);
        C.HmacRIPEMD160 = Hasher._createHmacHelper(RIPEMD160);
      })(Math);
      return CryptoJS2.RIPEMD160;
    });
  }
});

// node_modules/crypto-js/hmac.js
var require_hmac = __commonJS({
  "node_modules/crypto-js/hmac.js"(exports, module) {
    (function(root, factory) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function() {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var Base = C_lib.Base;
        var C_enc = C.enc;
        var Utf8 = C_enc.Utf8;
        var C_algo = C.algo;
        var HMAC = C_algo.HMAC = Base.extend({
          /**
           * Initializes a newly created HMAC.
           *
           * @param {Hasher} hasher The hash algorithm to use.
           * @param {WordArray|string} key The secret key.
           *
           * @example
           *
           *     var hmacHasher = CryptoJS.algo.HMAC.create(CryptoJS.algo.SHA256, key);
           */
          init: function(hasher, key) {
            hasher = this._hasher = new hasher.init();
            if (typeof key == "string") {
              key = Utf8.parse(key);
            }
            var hasherBlockSize = hasher.blockSize;
            var hasherBlockSizeBytes = hasherBlockSize * 4;
            if (key.sigBytes > hasherBlockSizeBytes) {
              key = hasher.finalize(key);
            }
            key.clamp();
            var oKey = this._oKey = key.clone();
            var iKey = this._iKey = key.clone();
            var oKeyWords = oKey.words;
            var iKeyWords = iKey.words;
            for (var i = 0; i < hasherBlockSize; i++) {
              oKeyWords[i] ^= 1549556828;
              iKeyWords[i] ^= 909522486;
            }
            oKey.sigBytes = iKey.sigBytes = hasherBlockSizeBytes;
            this.reset();
          },
          /**
           * Resets this HMAC to its initial state.
           *
           * @example
           *
           *     hmacHasher.reset();
           */
          reset: function() {
            var hasher = this._hasher;
            hasher.reset();
            hasher.update(this._iKey);
          },
          /**
           * Updates this HMAC with a message.
           *
           * @param {WordArray|string} messageUpdate The message to append.
           *
           * @return {HMAC} This HMAC instance.
           *
           * @example
           *
           *     hmacHasher.update('message');
           *     hmacHasher.update(wordArray);
           */
          update: function(messageUpdate) {
            this._hasher.update(messageUpdate);
            return this;
          },
          /**
           * Finalizes the HMAC computation.
           * Note that the finalize operation is effectively a destructive, read-once operation.
           *
           * @param {WordArray|string} messageUpdate (Optional) A final message update.
           *
           * @return {WordArray} The HMAC.
           *
           * @example
           *
           *     var hmac = hmacHasher.finalize();
           *     var hmac = hmacHasher.finalize('message');
           *     var hmac = hmacHasher.finalize(wordArray);
           */
          finalize: function(messageUpdate) {
            var hasher = this._hasher;
            var innerHash = hasher.finalize(messageUpdate);
            hasher.reset();
            var hmac = hasher.finalize(this._oKey.clone().concat(innerHash));
            return hmac;
          }
        });
      })();
    });
  }
});

// node_modules/crypto-js/pbkdf2.js
var require_pbkdf2 = __commonJS({
  "node_modules/crypto-js/pbkdf2.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_sha256(), require_hmac());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./sha256", "./hmac"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function() {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var Base = C_lib.Base;
        var WordArray = C_lib.WordArray;
        var C_algo = C.algo;
        var SHA256 = C_algo.SHA256;
        var HMAC = C_algo.HMAC;
        var PBKDF2 = C_algo.PBKDF2 = Base.extend({
          /**
           * Configuration options.
           *
           * @property {number} keySize The key size in words to generate. Default: 4 (128 bits)
           * @property {Hasher} hasher The hasher to use. Default: SHA256
           * @property {number} iterations The number of iterations to perform. Default: 250000
           */
          cfg: Base.extend({
            keySize: 128 / 32,
            hasher: SHA256,
            iterations: 25e4
          }),
          /**
           * Initializes a newly created key derivation function.
           *
           * @param {Object} cfg (Optional) The configuration options to use for the derivation.
           *
           * @example
           *
           *     var kdf = CryptoJS.algo.PBKDF2.create();
           *     var kdf = CryptoJS.algo.PBKDF2.create({ keySize: 8 });
           *     var kdf = CryptoJS.algo.PBKDF2.create({ keySize: 8, iterations: 1000 });
           */
          init: function(cfg) {
            this.cfg = this.cfg.extend(cfg);
          },
          /**
           * Computes the Password-Based Key Derivation Function 2.
           *
           * @param {WordArray|string} password The password.
           * @param {WordArray|string} salt A salt.
           *
           * @return {WordArray} The derived key.
           *
           * @example
           *
           *     var key = kdf.compute(password, salt);
           */
          compute: function(password, salt) {
            var cfg = this.cfg;
            var hmac = HMAC.create(cfg.hasher, password);
            var derivedKey = WordArray.create();
            var blockIndex = WordArray.create([1]);
            var derivedKeyWords = derivedKey.words;
            var blockIndexWords = blockIndex.words;
            var keySize = cfg.keySize;
            var iterations = cfg.iterations;
            while (derivedKeyWords.length < keySize) {
              var block = hmac.update(salt).finalize(blockIndex);
              hmac.reset();
              var blockWords = block.words;
              var blockWordsLength = blockWords.length;
              var intermediate = block;
              for (var i = 1; i < iterations; i++) {
                intermediate = hmac.finalize(intermediate);
                hmac.reset();
                var intermediateWords = intermediate.words;
                for (var j = 0; j < blockWordsLength; j++) {
                  blockWords[j] ^= intermediateWords[j];
                }
              }
              derivedKey.concat(block);
              blockIndexWords[0]++;
            }
            derivedKey.sigBytes = keySize * 4;
            return derivedKey;
          }
        });
        C.PBKDF2 = function(password, salt, cfg) {
          return PBKDF2.create(cfg).compute(password, salt);
        };
      })();
      return CryptoJS2.PBKDF2;
    });
  }
});

// node_modules/crypto-js/evpkdf.js
var require_evpkdf = __commonJS({
  "node_modules/crypto-js/evpkdf.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_sha1(), require_hmac());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./sha1", "./hmac"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function() {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var Base = C_lib.Base;
        var WordArray = C_lib.WordArray;
        var C_algo = C.algo;
        var MD5 = C_algo.MD5;
        var EvpKDF = C_algo.EvpKDF = Base.extend({
          /**
           * Configuration options.
           *
           * @property {number} keySize The key size in words to generate. Default: 4 (128 bits)
           * @property {Hasher} hasher The hash algorithm to use. Default: MD5
           * @property {number} iterations The number of iterations to perform. Default: 1
           */
          cfg: Base.extend({
            keySize: 128 / 32,
            hasher: MD5,
            iterations: 1
          }),
          /**
           * Initializes a newly created key derivation function.
           *
           * @param {Object} cfg (Optional) The configuration options to use for the derivation.
           *
           * @example
           *
           *     var kdf = CryptoJS.algo.EvpKDF.create();
           *     var kdf = CryptoJS.algo.EvpKDF.create({ keySize: 8 });
           *     var kdf = CryptoJS.algo.EvpKDF.create({ keySize: 8, iterations: 1000 });
           */
          init: function(cfg) {
            this.cfg = this.cfg.extend(cfg);
          },
          /**
           * Derives a key from a password.
           *
           * @param {WordArray|string} password The password.
           * @param {WordArray|string} salt A salt.
           *
           * @return {WordArray} The derived key.
           *
           * @example
           *
           *     var key = kdf.compute(password, salt);
           */
          compute: function(password, salt) {
            var block;
            var cfg = this.cfg;
            var hasher = cfg.hasher.create();
            var derivedKey = WordArray.create();
            var derivedKeyWords = derivedKey.words;
            var keySize = cfg.keySize;
            var iterations = cfg.iterations;
            while (derivedKeyWords.length < keySize) {
              if (block) {
                hasher.update(block);
              }
              block = hasher.update(password).finalize(salt);
              hasher.reset();
              for (var i = 1; i < iterations; i++) {
                block = hasher.finalize(block);
                hasher.reset();
              }
              derivedKey.concat(block);
            }
            derivedKey.sigBytes = keySize * 4;
            return derivedKey;
          }
        });
        C.EvpKDF = function(password, salt, cfg) {
          return EvpKDF.create(cfg).compute(password, salt);
        };
      })();
      return CryptoJS2.EvpKDF;
    });
  }
});

// node_modules/crypto-js/cipher-core.js
var require_cipher_core = __commonJS({
  "node_modules/crypto-js/cipher-core.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_evpkdf());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./evpkdf"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      CryptoJS2.lib.Cipher || (function(undefined2) {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var Base = C_lib.Base;
        var WordArray = C_lib.WordArray;
        var BufferedBlockAlgorithm = C_lib.BufferedBlockAlgorithm;
        var C_enc = C.enc;
        var Utf8 = C_enc.Utf8;
        var Base64 = C_enc.Base64;
        var C_algo = C.algo;
        var EvpKDF = C_algo.EvpKDF;
        var Cipher = C_lib.Cipher = BufferedBlockAlgorithm.extend({
          /**
           * Configuration options.
           *
           * @property {WordArray} iv The IV to use for this operation.
           */
          cfg: Base.extend(),
          /**
           * Creates this cipher in encryption mode.
           *
           * @param {WordArray} key The key.
           * @param {Object} cfg (Optional) The configuration options to use for this operation.
           *
           * @return {Cipher} A cipher instance.
           *
           * @static
           *
           * @example
           *
           *     var cipher = CryptoJS.algo.AES.createEncryptor(keyWordArray, { iv: ivWordArray });
           */
          createEncryptor: function(key, cfg) {
            return this.create(this._ENC_XFORM_MODE, key, cfg);
          },
          /**
           * Creates this cipher in decryption mode.
           *
           * @param {WordArray} key The key.
           * @param {Object} cfg (Optional) The configuration options to use for this operation.
           *
           * @return {Cipher} A cipher instance.
           *
           * @static
           *
           * @example
           *
           *     var cipher = CryptoJS.algo.AES.createDecryptor(keyWordArray, { iv: ivWordArray });
           */
          createDecryptor: function(key, cfg) {
            return this.create(this._DEC_XFORM_MODE, key, cfg);
          },
          /**
           * Initializes a newly created cipher.
           *
           * @param {number} xformMode Either the encryption or decryption transormation mode constant.
           * @param {WordArray} key The key.
           * @param {Object} cfg (Optional) The configuration options to use for this operation.
           *
           * @example
           *
           *     var cipher = CryptoJS.algo.AES.create(CryptoJS.algo.AES._ENC_XFORM_MODE, keyWordArray, { iv: ivWordArray });
           */
          init: function(xformMode, key, cfg) {
            this.cfg = this.cfg.extend(cfg);
            this._xformMode = xformMode;
            this._key = key;
            this.reset();
          },
          /**
           * Resets this cipher to its initial state.
           *
           * @example
           *
           *     cipher.reset();
           */
          reset: function() {
            BufferedBlockAlgorithm.reset.call(this);
            this._doReset();
          },
          /**
           * Adds data to be encrypted or decrypted.
           *
           * @param {WordArray|string} dataUpdate The data to encrypt or decrypt.
           *
           * @return {WordArray} The data after processing.
           *
           * @example
           *
           *     var encrypted = cipher.process('data');
           *     var encrypted = cipher.process(wordArray);
           */
          process: function(dataUpdate) {
            this._append(dataUpdate);
            return this._process();
          },
          /**
           * Finalizes the encryption or decryption process.
           * Note that the finalize operation is effectively a destructive, read-once operation.
           *
           * @param {WordArray|string} dataUpdate The final data to encrypt or decrypt.
           *
           * @return {WordArray} The data after final processing.
           *
           * @example
           *
           *     var encrypted = cipher.finalize();
           *     var encrypted = cipher.finalize('data');
           *     var encrypted = cipher.finalize(wordArray);
           */
          finalize: function(dataUpdate) {
            if (dataUpdate) {
              this._append(dataUpdate);
            }
            var finalProcessedData = this._doFinalize();
            return finalProcessedData;
          },
          keySize: 128 / 32,
          ivSize: 128 / 32,
          _ENC_XFORM_MODE: 1,
          _DEC_XFORM_MODE: 2,
          /**
           * Creates shortcut functions to a cipher's object interface.
           *
           * @param {Cipher} cipher The cipher to create a helper for.
           *
           * @return {Object} An object with encrypt and decrypt shortcut functions.
           *
           * @static
           *
           * @example
           *
           *     var AES = CryptoJS.lib.Cipher._createHelper(CryptoJS.algo.AES);
           */
          _createHelper: /* @__PURE__ */ (function() {
            function selectCipherStrategy(key) {
              if (typeof key == "string") {
                return PasswordBasedCipher;
              } else {
                return SerializableCipher;
              }
            }
            return function(cipher) {
              return {
                encrypt: function(message, key, cfg) {
                  return selectCipherStrategy(key).encrypt(cipher, message, key, cfg);
                },
                decrypt: function(ciphertext, key, cfg) {
                  return selectCipherStrategy(key).decrypt(cipher, ciphertext, key, cfg);
                }
              };
            };
          })()
        });
        var StreamCipher = C_lib.StreamCipher = Cipher.extend({
          _doFinalize: function() {
            var finalProcessedBlocks = this._process(true);
            return finalProcessedBlocks;
          },
          blockSize: 1
        });
        var C_mode = C.mode = {};
        var BlockCipherMode = C_lib.BlockCipherMode = Base.extend({
          /**
           * Creates this mode for encryption.
           *
           * @param {Cipher} cipher A block cipher instance.
           * @param {Array} iv The IV words.
           *
           * @static
           *
           * @example
           *
           *     var mode = CryptoJS.mode.CBC.createEncryptor(cipher, iv.words);
           */
          createEncryptor: function(cipher, iv) {
            return this.Encryptor.create(cipher, iv);
          },
          /**
           * Creates this mode for decryption.
           *
           * @param {Cipher} cipher A block cipher instance.
           * @param {Array} iv The IV words.
           *
           * @static
           *
           * @example
           *
           *     var mode = CryptoJS.mode.CBC.createDecryptor(cipher, iv.words);
           */
          createDecryptor: function(cipher, iv) {
            return this.Decryptor.create(cipher, iv);
          },
          /**
           * Initializes a newly created mode.
           *
           * @param {Cipher} cipher A block cipher instance.
           * @param {Array} iv The IV words.
           *
           * @example
           *
           *     var mode = CryptoJS.mode.CBC.Encryptor.create(cipher, iv.words);
           */
          init: function(cipher, iv) {
            this._cipher = cipher;
            this._iv = iv;
          }
        });
        var CBC = C_mode.CBC = (function() {
          var CBC2 = BlockCipherMode.extend();
          CBC2.Encryptor = CBC2.extend({
            /**
             * Processes the data block at offset.
             *
             * @param {Array} words The data words to operate on.
             * @param {number} offset The offset where the block starts.
             *
             * @example
             *
             *     mode.processBlock(data.words, offset);
             */
            processBlock: function(words, offset) {
              var cipher = this._cipher;
              var blockSize = cipher.blockSize;
              xorBlock.call(this, words, offset, blockSize);
              cipher.encryptBlock(words, offset);
              this._prevBlock = words.slice(offset, offset + blockSize);
            }
          });
          CBC2.Decryptor = CBC2.extend({
            /**
             * Processes the data block at offset.
             *
             * @param {Array} words The data words to operate on.
             * @param {number} offset The offset where the block starts.
             *
             * @example
             *
             *     mode.processBlock(data.words, offset);
             */
            processBlock: function(words, offset) {
              var cipher = this._cipher;
              var blockSize = cipher.blockSize;
              var thisBlock = words.slice(offset, offset + blockSize);
              cipher.decryptBlock(words, offset);
              xorBlock.call(this, words, offset, blockSize);
              this._prevBlock = thisBlock;
            }
          });
          function xorBlock(words, offset, blockSize) {
            var block;
            var iv = this._iv;
            if (iv) {
              block = iv;
              this._iv = undefined2;
            } else {
              block = this._prevBlock;
            }
            for (var i = 0; i < blockSize; i++) {
              words[offset + i] ^= block[i];
            }
          }
          return CBC2;
        })();
        var C_pad = C.pad = {};
        var Pkcs7 = C_pad.Pkcs7 = {
          /**
           * Pads data using the algorithm defined in PKCS #5/7.
           *
           * @param {WordArray} data The data to pad.
           * @param {number} blockSize The multiple that the data should be padded to.
           *
           * @static
           *
           * @example
           *
           *     CryptoJS.pad.Pkcs7.pad(wordArray, 4);
           */
          pad: function(data, blockSize) {
            var blockSizeBytes = blockSize * 4;
            var nPaddingBytes = blockSizeBytes - data.sigBytes % blockSizeBytes;
            var paddingWord = nPaddingBytes << 24 | nPaddingBytes << 16 | nPaddingBytes << 8 | nPaddingBytes;
            var paddingWords = [];
            for (var i = 0; i < nPaddingBytes; i += 4) {
              paddingWords.push(paddingWord);
            }
            var padding = WordArray.create(paddingWords, nPaddingBytes);
            data.concat(padding);
          },
          /**
           * Unpads data that had been padded using the algorithm defined in PKCS #5/7.
           *
           * @param {WordArray} data The data to unpad.
           *
           * @static
           *
           * @example
           *
           *     CryptoJS.pad.Pkcs7.unpad(wordArray);
           */
          unpad: function(data) {
            var nPaddingBytes = data.words[data.sigBytes - 1 >>> 2] & 255;
            data.sigBytes -= nPaddingBytes;
          }
        };
        var BlockCipher = C_lib.BlockCipher = Cipher.extend({
          /**
           * Configuration options.
           *
           * @property {Mode} mode The block mode to use. Default: CBC
           * @property {Padding} padding The padding strategy to use. Default: Pkcs7
           */
          cfg: Cipher.cfg.extend({
            mode: CBC,
            padding: Pkcs7
          }),
          reset: function() {
            var modeCreator;
            Cipher.reset.call(this);
            var cfg = this.cfg;
            var iv = cfg.iv;
            var mode = cfg.mode;
            if (this._xformMode == this._ENC_XFORM_MODE) {
              modeCreator = mode.createEncryptor;
            } else {
              modeCreator = mode.createDecryptor;
              this._minBufferSize = 1;
            }
            if (this._mode && this._mode.__creator == modeCreator) {
              this._mode.init(this, iv && iv.words);
            } else {
              this._mode = modeCreator.call(mode, this, iv && iv.words);
              this._mode.__creator = modeCreator;
            }
          },
          _doProcessBlock: function(words, offset) {
            this._mode.processBlock(words, offset);
          },
          _doFinalize: function() {
            var finalProcessedBlocks;
            var padding = this.cfg.padding;
            if (this._xformMode == this._ENC_XFORM_MODE) {
              padding.pad(this._data, this.blockSize);
              finalProcessedBlocks = this._process(true);
            } else {
              finalProcessedBlocks = this._process(true);
              padding.unpad(finalProcessedBlocks);
            }
            return finalProcessedBlocks;
          },
          blockSize: 128 / 32
        });
        var CipherParams = C_lib.CipherParams = Base.extend({
          /**
           * Initializes a newly created cipher params object.
           *
           * @param {Object} cipherParams An object with any of the possible cipher parameters.
           *
           * @example
           *
           *     var cipherParams = CryptoJS.lib.CipherParams.create({
           *         ciphertext: ciphertextWordArray,
           *         key: keyWordArray,
           *         iv: ivWordArray,
           *         salt: saltWordArray,
           *         algorithm: CryptoJS.algo.AES,
           *         mode: CryptoJS.mode.CBC,
           *         padding: CryptoJS.pad.PKCS7,
           *         blockSize: 4,
           *         formatter: CryptoJS.format.OpenSSL
           *     });
           */
          init: function(cipherParams) {
            this.mixIn(cipherParams);
          },
          /**
           * Converts this cipher params object to a string.
           *
           * @param {Format} formatter (Optional) The formatting strategy to use.
           *
           * @return {string} The stringified cipher params.
           *
           * @throws Error If neither the formatter nor the default formatter is set.
           *
           * @example
           *
           *     var string = cipherParams + '';
           *     var string = cipherParams.toString();
           *     var string = cipherParams.toString(CryptoJS.format.OpenSSL);
           */
          toString: function(formatter) {
            return (formatter || this.formatter).stringify(this);
          }
        });
        var C_format = C.format = {};
        var OpenSSLFormatter = C_format.OpenSSL = {
          /**
           * Converts a cipher params object to an OpenSSL-compatible string.
           *
           * @param {CipherParams} cipherParams The cipher params object.
           *
           * @return {string} The OpenSSL-compatible string.
           *
           * @static
           *
           * @example
           *
           *     var openSSLString = CryptoJS.format.OpenSSL.stringify(cipherParams);
           */
          stringify: function(cipherParams) {
            var wordArray;
            var ciphertext = cipherParams.ciphertext;
            var salt = cipherParams.salt;
            if (salt) {
              wordArray = WordArray.create([1398893684, 1701076831]).concat(salt).concat(ciphertext);
            } else {
              wordArray = ciphertext;
            }
            return wordArray.toString(Base64);
          },
          /**
           * Converts an OpenSSL-compatible string to a cipher params object.
           *
           * @param {string} openSSLStr The OpenSSL-compatible string.
           *
           * @return {CipherParams} The cipher params object.
           *
           * @static
           *
           * @example
           *
           *     var cipherParams = CryptoJS.format.OpenSSL.parse(openSSLString);
           */
          parse: function(openSSLStr) {
            var salt;
            var ciphertext = Base64.parse(openSSLStr);
            var ciphertextWords = ciphertext.words;
            if (ciphertextWords[0] == 1398893684 && ciphertextWords[1] == 1701076831) {
              salt = WordArray.create(ciphertextWords.slice(2, 4));
              ciphertextWords.splice(0, 4);
              ciphertext.sigBytes -= 16;
            }
            return CipherParams.create({ ciphertext, salt });
          }
        };
        var SerializableCipher = C_lib.SerializableCipher = Base.extend({
          /**
           * Configuration options.
           *
           * @property {Formatter} format The formatting strategy to convert cipher param objects to and from a string. Default: OpenSSL
           */
          cfg: Base.extend({
            format: OpenSSLFormatter
          }),
          /**
           * Encrypts a message.
           *
           * @param {Cipher} cipher The cipher algorithm to use.
           * @param {WordArray|string} message The message to encrypt.
           * @param {WordArray} key The key.
           * @param {Object} cfg (Optional) The configuration options to use for this operation.
           *
           * @return {CipherParams} A cipher params object.
           *
           * @static
           *
           * @example
           *
           *     var ciphertextParams = CryptoJS.lib.SerializableCipher.encrypt(CryptoJS.algo.AES, message, key);
           *     var ciphertextParams = CryptoJS.lib.SerializableCipher.encrypt(CryptoJS.algo.AES, message, key, { iv: iv });
           *     var ciphertextParams = CryptoJS.lib.SerializableCipher.encrypt(CryptoJS.algo.AES, message, key, { iv: iv, format: CryptoJS.format.OpenSSL });
           */
          encrypt: function(cipher, message, key, cfg) {
            cfg = this.cfg.extend(cfg);
            var encryptor = cipher.createEncryptor(key, cfg);
            var ciphertext = encryptor.finalize(message);
            var cipherCfg = encryptor.cfg;
            return CipherParams.create({
              ciphertext,
              key,
              iv: cipherCfg.iv,
              algorithm: cipher,
              mode: cipherCfg.mode,
              padding: cipherCfg.padding,
              blockSize: cipher.blockSize,
              formatter: cfg.format
            });
          },
          /**
           * Decrypts serialized ciphertext.
           *
           * @param {Cipher} cipher The cipher algorithm to use.
           * @param {CipherParams|string} ciphertext The ciphertext to decrypt.
           * @param {WordArray} key The key.
           * @param {Object} cfg (Optional) The configuration options to use for this operation.
           *
           * @return {WordArray} The plaintext.
           *
           * @static
           *
           * @example
           *
           *     var plaintext = CryptoJS.lib.SerializableCipher.decrypt(CryptoJS.algo.AES, formattedCiphertext, key, { iv: iv, format: CryptoJS.format.OpenSSL });
           *     var plaintext = CryptoJS.lib.SerializableCipher.decrypt(CryptoJS.algo.AES, ciphertextParams, key, { iv: iv, format: CryptoJS.format.OpenSSL });
           */
          decrypt: function(cipher, ciphertext, key, cfg) {
            cfg = this.cfg.extend(cfg);
            ciphertext = this._parse(ciphertext, cfg.format);
            var plaintext = cipher.createDecryptor(key, cfg).finalize(ciphertext.ciphertext);
            return plaintext;
          },
          /**
           * Converts serialized ciphertext to CipherParams,
           * else assumed CipherParams already and returns ciphertext unchanged.
           *
           * @param {CipherParams|string} ciphertext The ciphertext.
           * @param {Formatter} format The formatting strategy to use to parse serialized ciphertext.
           *
           * @return {CipherParams} The unserialized ciphertext.
           *
           * @static
           *
           * @example
           *
           *     var ciphertextParams = CryptoJS.lib.SerializableCipher._parse(ciphertextStringOrParams, format);
           */
          _parse: function(ciphertext, format) {
            if (typeof ciphertext == "string") {
              return format.parse(ciphertext, this);
            } else {
              return ciphertext;
            }
          }
        });
        var C_kdf = C.kdf = {};
        var OpenSSLKdf = C_kdf.OpenSSL = {
          /**
           * Derives a key and IV from a password.
           *
           * @param {string} password The password to derive from.
           * @param {number} keySize The size in words of the key to generate.
           * @param {number} ivSize The size in words of the IV to generate.
           * @param {WordArray|string} salt (Optional) A 64-bit salt to use. If omitted, a salt will be generated randomly.
           *
           * @return {CipherParams} A cipher params object with the key, IV, and salt.
           *
           * @static
           *
           * @example
           *
           *     var derivedParams = CryptoJS.kdf.OpenSSL.execute('Password', 256/32, 128/32);
           *     var derivedParams = CryptoJS.kdf.OpenSSL.execute('Password', 256/32, 128/32, 'saltsalt');
           */
          execute: function(password, keySize, ivSize, salt, hasher) {
            if (!salt) {
              salt = WordArray.random(64 / 8);
            }
            if (!hasher) {
              var key = EvpKDF.create({ keySize: keySize + ivSize }).compute(password, salt);
            } else {
              var key = EvpKDF.create({ keySize: keySize + ivSize, hasher }).compute(password, salt);
            }
            var iv = WordArray.create(key.words.slice(keySize), ivSize * 4);
            key.sigBytes = keySize * 4;
            return CipherParams.create({ key, iv, salt });
          }
        };
        var PasswordBasedCipher = C_lib.PasswordBasedCipher = SerializableCipher.extend({
          /**
           * Configuration options.
           *
           * @property {KDF} kdf The key derivation function to use to generate a key and IV from a password. Default: OpenSSL
           */
          cfg: SerializableCipher.cfg.extend({
            kdf: OpenSSLKdf
          }),
          /**
           * Encrypts a message using a password.
           *
           * @param {Cipher} cipher The cipher algorithm to use.
           * @param {WordArray|string} message The message to encrypt.
           * @param {string} password The password.
           * @param {Object} cfg (Optional) The configuration options to use for this operation.
           *
           * @return {CipherParams} A cipher params object.
           *
           * @static
           *
           * @example
           *
           *     var ciphertextParams = CryptoJS.lib.PasswordBasedCipher.encrypt(CryptoJS.algo.AES, message, 'password');
           *     var ciphertextParams = CryptoJS.lib.PasswordBasedCipher.encrypt(CryptoJS.algo.AES, message, 'password', { format: CryptoJS.format.OpenSSL });
           */
          encrypt: function(cipher, message, password, cfg) {
            cfg = this.cfg.extend(cfg);
            var derivedParams = cfg.kdf.execute(password, cipher.keySize, cipher.ivSize, cfg.salt, cfg.hasher);
            cfg.iv = derivedParams.iv;
            var ciphertext = SerializableCipher.encrypt.call(this, cipher, message, derivedParams.key, cfg);
            ciphertext.mixIn(derivedParams);
            return ciphertext;
          },
          /**
           * Decrypts serialized ciphertext using a password.
           *
           * @param {Cipher} cipher The cipher algorithm to use.
           * @param {CipherParams|string} ciphertext The ciphertext to decrypt.
           * @param {string} password The password.
           * @param {Object} cfg (Optional) The configuration options to use for this operation.
           *
           * @return {WordArray} The plaintext.
           *
           * @static
           *
           * @example
           *
           *     var plaintext = CryptoJS.lib.PasswordBasedCipher.decrypt(CryptoJS.algo.AES, formattedCiphertext, 'password', { format: CryptoJS.format.OpenSSL });
           *     var plaintext = CryptoJS.lib.PasswordBasedCipher.decrypt(CryptoJS.algo.AES, ciphertextParams, 'password', { format: CryptoJS.format.OpenSSL });
           */
          decrypt: function(cipher, ciphertext, password, cfg) {
            cfg = this.cfg.extend(cfg);
            ciphertext = this._parse(ciphertext, cfg.format);
            var derivedParams = cfg.kdf.execute(password, cipher.keySize, cipher.ivSize, ciphertext.salt, cfg.hasher);
            cfg.iv = derivedParams.iv;
            var plaintext = SerializableCipher.decrypt.call(this, cipher, ciphertext, derivedParams.key, cfg);
            return plaintext;
          }
        });
      })();
    });
  }
});

// node_modules/crypto-js/mode-cfb.js
var require_mode_cfb = __commonJS({
  "node_modules/crypto-js/mode-cfb.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_cipher_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./cipher-core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      CryptoJS2.mode.CFB = (function() {
        var CFB = CryptoJS2.lib.BlockCipherMode.extend();
        CFB.Encryptor = CFB.extend({
          processBlock: function(words, offset) {
            var cipher = this._cipher;
            var blockSize = cipher.blockSize;
            generateKeystreamAndEncrypt.call(this, words, offset, blockSize, cipher);
            this._prevBlock = words.slice(offset, offset + blockSize);
          }
        });
        CFB.Decryptor = CFB.extend({
          processBlock: function(words, offset) {
            var cipher = this._cipher;
            var blockSize = cipher.blockSize;
            var thisBlock = words.slice(offset, offset + blockSize);
            generateKeystreamAndEncrypt.call(this, words, offset, blockSize, cipher);
            this._prevBlock = thisBlock;
          }
        });
        function generateKeystreamAndEncrypt(words, offset, blockSize, cipher) {
          var keystream;
          var iv = this._iv;
          if (iv) {
            keystream = iv.slice(0);
            this._iv = void 0;
          } else {
            keystream = this._prevBlock;
          }
          cipher.encryptBlock(keystream, 0);
          for (var i = 0; i < blockSize; i++) {
            words[offset + i] ^= keystream[i];
          }
        }
        return CFB;
      })();
      return CryptoJS2.mode.CFB;
    });
  }
});

// node_modules/crypto-js/mode-ctr.js
var require_mode_ctr = __commonJS({
  "node_modules/crypto-js/mode-ctr.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_cipher_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./cipher-core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      CryptoJS2.mode.CTR = (function() {
        var CTR = CryptoJS2.lib.BlockCipherMode.extend();
        var Encryptor = CTR.Encryptor = CTR.extend({
          processBlock: function(words, offset) {
            var cipher = this._cipher;
            var blockSize = cipher.blockSize;
            var iv = this._iv;
            var counter = this._counter;
            if (iv) {
              counter = this._counter = iv.slice(0);
              this._iv = void 0;
            }
            var keystream = counter.slice(0);
            cipher.encryptBlock(keystream, 0);
            counter[blockSize - 1] = counter[blockSize - 1] + 1 | 0;
            for (var i = 0; i < blockSize; i++) {
              words[offset + i] ^= keystream[i];
            }
          }
        });
        CTR.Decryptor = Encryptor;
        return CTR;
      })();
      return CryptoJS2.mode.CTR;
    });
  }
});

// node_modules/crypto-js/mode-ctr-gladman.js
var require_mode_ctr_gladman = __commonJS({
  "node_modules/crypto-js/mode-ctr-gladman.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_cipher_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./cipher-core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      CryptoJS2.mode.CTRGladman = (function() {
        var CTRGladman = CryptoJS2.lib.BlockCipherMode.extend();
        function incWord(word) {
          if ((word >> 24 & 255) === 255) {
            var b1 = word >> 16 & 255;
            var b2 = word >> 8 & 255;
            var b3 = word & 255;
            if (b1 === 255) {
              b1 = 0;
              if (b2 === 255) {
                b2 = 0;
                if (b3 === 255) {
                  b3 = 0;
                } else {
                  ++b3;
                }
              } else {
                ++b2;
              }
            } else {
              ++b1;
            }
            word = 0;
            word += b1 << 16;
            word += b2 << 8;
            word += b3;
          } else {
            word += 1 << 24;
          }
          return word;
        }
        function incCounter(counter) {
          if ((counter[0] = incWord(counter[0])) === 0) {
            counter[1] = incWord(counter[1]);
          }
          return counter;
        }
        var Encryptor = CTRGladman.Encryptor = CTRGladman.extend({
          processBlock: function(words, offset) {
            var cipher = this._cipher;
            var blockSize = cipher.blockSize;
            var iv = this._iv;
            var counter = this._counter;
            if (iv) {
              counter = this._counter = iv.slice(0);
              this._iv = void 0;
            }
            incCounter(counter);
            var keystream = counter.slice(0);
            cipher.encryptBlock(keystream, 0);
            for (var i = 0; i < blockSize; i++) {
              words[offset + i] ^= keystream[i];
            }
          }
        });
        CTRGladman.Decryptor = Encryptor;
        return CTRGladman;
      })();
      return CryptoJS2.mode.CTRGladman;
    });
  }
});

// node_modules/crypto-js/mode-ofb.js
var require_mode_ofb = __commonJS({
  "node_modules/crypto-js/mode-ofb.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_cipher_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./cipher-core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      CryptoJS2.mode.OFB = (function() {
        var OFB = CryptoJS2.lib.BlockCipherMode.extend();
        var Encryptor = OFB.Encryptor = OFB.extend({
          processBlock: function(words, offset) {
            var cipher = this._cipher;
            var blockSize = cipher.blockSize;
            var iv = this._iv;
            var keystream = this._keystream;
            if (iv) {
              keystream = this._keystream = iv.slice(0);
              this._iv = void 0;
            }
            cipher.encryptBlock(keystream, 0);
            for (var i = 0; i < blockSize; i++) {
              words[offset + i] ^= keystream[i];
            }
          }
        });
        OFB.Decryptor = Encryptor;
        return OFB;
      })();
      return CryptoJS2.mode.OFB;
    });
  }
});

// node_modules/crypto-js/mode-ecb.js
var require_mode_ecb = __commonJS({
  "node_modules/crypto-js/mode-ecb.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_cipher_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./cipher-core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      CryptoJS2.mode.ECB = (function() {
        var ECB = CryptoJS2.lib.BlockCipherMode.extend();
        ECB.Encryptor = ECB.extend({
          processBlock: function(words, offset) {
            this._cipher.encryptBlock(words, offset);
          }
        });
        ECB.Decryptor = ECB.extend({
          processBlock: function(words, offset) {
            this._cipher.decryptBlock(words, offset);
          }
        });
        return ECB;
      })();
      return CryptoJS2.mode.ECB;
    });
  }
});

// node_modules/crypto-js/pad-ansix923.js
var require_pad_ansix923 = __commonJS({
  "node_modules/crypto-js/pad-ansix923.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_cipher_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./cipher-core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      CryptoJS2.pad.AnsiX923 = {
        pad: function(data, blockSize) {
          var dataSigBytes = data.sigBytes;
          var blockSizeBytes = blockSize * 4;
          var nPaddingBytes = blockSizeBytes - dataSigBytes % blockSizeBytes;
          var lastBytePos = dataSigBytes + nPaddingBytes - 1;
          data.clamp();
          data.words[lastBytePos >>> 2] |= nPaddingBytes << 24 - lastBytePos % 4 * 8;
          data.sigBytes += nPaddingBytes;
        },
        unpad: function(data) {
          var nPaddingBytes = data.words[data.sigBytes - 1 >>> 2] & 255;
          data.sigBytes -= nPaddingBytes;
        }
      };
      return CryptoJS2.pad.Ansix923;
    });
  }
});

// node_modules/crypto-js/pad-iso10126.js
var require_pad_iso10126 = __commonJS({
  "node_modules/crypto-js/pad-iso10126.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_cipher_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./cipher-core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      CryptoJS2.pad.Iso10126 = {
        pad: function(data, blockSize) {
          var blockSizeBytes = blockSize * 4;
          var nPaddingBytes = blockSizeBytes - data.sigBytes % blockSizeBytes;
          data.concat(CryptoJS2.lib.WordArray.random(nPaddingBytes - 1)).concat(CryptoJS2.lib.WordArray.create([nPaddingBytes << 24], 1));
        },
        unpad: function(data) {
          var nPaddingBytes = data.words[data.sigBytes - 1 >>> 2] & 255;
          data.sigBytes -= nPaddingBytes;
        }
      };
      return CryptoJS2.pad.Iso10126;
    });
  }
});

// node_modules/crypto-js/pad-iso97971.js
var require_pad_iso97971 = __commonJS({
  "node_modules/crypto-js/pad-iso97971.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_cipher_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./cipher-core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      CryptoJS2.pad.Iso97971 = {
        pad: function(data, blockSize) {
          data.concat(CryptoJS2.lib.WordArray.create([2147483648], 1));
          CryptoJS2.pad.ZeroPadding.pad(data, blockSize);
        },
        unpad: function(data) {
          CryptoJS2.pad.ZeroPadding.unpad(data);
          data.sigBytes--;
        }
      };
      return CryptoJS2.pad.Iso97971;
    });
  }
});

// node_modules/crypto-js/pad-zeropadding.js
var require_pad_zeropadding = __commonJS({
  "node_modules/crypto-js/pad-zeropadding.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_cipher_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./cipher-core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      CryptoJS2.pad.ZeroPadding = {
        pad: function(data, blockSize) {
          var blockSizeBytes = blockSize * 4;
          data.clamp();
          data.sigBytes += blockSizeBytes - (data.sigBytes % blockSizeBytes || blockSizeBytes);
        },
        unpad: function(data) {
          var dataWords = data.words;
          var i = data.sigBytes - 1;
          for (var i = data.sigBytes - 1; i >= 0; i--) {
            if (dataWords[i >>> 2] >>> 24 - i % 4 * 8 & 255) {
              data.sigBytes = i + 1;
              break;
            }
          }
        }
      };
      return CryptoJS2.pad.ZeroPadding;
    });
  }
});

// node_modules/crypto-js/pad-nopadding.js
var require_pad_nopadding = __commonJS({
  "node_modules/crypto-js/pad-nopadding.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_cipher_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./cipher-core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      CryptoJS2.pad.NoPadding = {
        pad: function() {
        },
        unpad: function() {
        }
      };
      return CryptoJS2.pad.NoPadding;
    });
  }
});

// node_modules/crypto-js/format-hex.js
var require_format_hex = __commonJS({
  "node_modules/crypto-js/format-hex.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_cipher_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./cipher-core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function(undefined2) {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var CipherParams = C_lib.CipherParams;
        var C_enc = C.enc;
        var Hex = C_enc.Hex;
        var C_format = C.format;
        var HexFormatter = C_format.Hex = {
          /**
           * Converts the ciphertext of a cipher params object to a hexadecimally encoded string.
           *
           * @param {CipherParams} cipherParams The cipher params object.
           *
           * @return {string} The hexadecimally encoded string.
           *
           * @static
           *
           * @example
           *
           *     var hexString = CryptoJS.format.Hex.stringify(cipherParams);
           */
          stringify: function(cipherParams) {
            return cipherParams.ciphertext.toString(Hex);
          },
          /**
           * Converts a hexadecimally encoded ciphertext string to a cipher params object.
           *
           * @param {string} input The hexadecimally encoded string.
           *
           * @return {CipherParams} The cipher params object.
           *
           * @static
           *
           * @example
           *
           *     var cipherParams = CryptoJS.format.Hex.parse(hexString);
           */
          parse: function(input) {
            var ciphertext = Hex.parse(input);
            return CipherParams.create({ ciphertext });
          }
        };
      })();
      return CryptoJS2.format.Hex;
    });
  }
});

// node_modules/crypto-js/aes.js
var require_aes = __commonJS({
  "node_modules/crypto-js/aes.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_enc_base64(), require_md5(), require_evpkdf(), require_cipher_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./enc-base64", "./md5", "./evpkdf", "./cipher-core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function() {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var BlockCipher = C_lib.BlockCipher;
        var C_algo = C.algo;
        var SBOX = [];
        var INV_SBOX = [];
        var SUB_MIX_0 = [];
        var SUB_MIX_1 = [];
        var SUB_MIX_2 = [];
        var SUB_MIX_3 = [];
        var INV_SUB_MIX_0 = [];
        var INV_SUB_MIX_1 = [];
        var INV_SUB_MIX_2 = [];
        var INV_SUB_MIX_3 = [];
        (function() {
          var d = [];
          for (var i = 0; i < 256; i++) {
            if (i < 128) {
              d[i] = i << 1;
            } else {
              d[i] = i << 1 ^ 283;
            }
          }
          var x = 0;
          var xi = 0;
          for (var i = 0; i < 256; i++) {
            var sx = xi ^ xi << 1 ^ xi << 2 ^ xi << 3 ^ xi << 4;
            sx = sx >>> 8 ^ sx & 255 ^ 99;
            SBOX[x] = sx;
            INV_SBOX[sx] = x;
            var x2 = d[x];
            var x4 = d[x2];
            var x8 = d[x4];
            var t = d[sx] * 257 ^ sx * 16843008;
            SUB_MIX_0[x] = t << 24 | t >>> 8;
            SUB_MIX_1[x] = t << 16 | t >>> 16;
            SUB_MIX_2[x] = t << 8 | t >>> 24;
            SUB_MIX_3[x] = t;
            var t = x8 * 16843009 ^ x4 * 65537 ^ x2 * 257 ^ x * 16843008;
            INV_SUB_MIX_0[sx] = t << 24 | t >>> 8;
            INV_SUB_MIX_1[sx] = t << 16 | t >>> 16;
            INV_SUB_MIX_2[sx] = t << 8 | t >>> 24;
            INV_SUB_MIX_3[sx] = t;
            if (!x) {
              x = xi = 1;
            } else {
              x = x2 ^ d[d[d[x8 ^ x2]]];
              xi ^= d[d[xi]];
            }
          }
        })();
        var RCON = [0, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54];
        var AES = C_algo.AES = BlockCipher.extend({
          _doReset: function() {
            var t;
            if (this._nRounds && this._keyPriorReset === this._key) {
              return;
            }
            var key = this._keyPriorReset = this._key;
            var keyWords = key.words;
            var keySize = key.sigBytes / 4;
            var nRounds = this._nRounds = keySize + 6;
            var ksRows = (nRounds + 1) * 4;
            var keySchedule = this._keySchedule = [];
            for (var ksRow = 0; ksRow < ksRows; ksRow++) {
              if (ksRow < keySize) {
                keySchedule[ksRow] = keyWords[ksRow];
              } else {
                t = keySchedule[ksRow - 1];
                if (!(ksRow % keySize)) {
                  t = t << 8 | t >>> 24;
                  t = SBOX[t >>> 24] << 24 | SBOX[t >>> 16 & 255] << 16 | SBOX[t >>> 8 & 255] << 8 | SBOX[t & 255];
                  t ^= RCON[ksRow / keySize | 0] << 24;
                } else if (keySize > 6 && ksRow % keySize == 4) {
                  t = SBOX[t >>> 24] << 24 | SBOX[t >>> 16 & 255] << 16 | SBOX[t >>> 8 & 255] << 8 | SBOX[t & 255];
                }
                keySchedule[ksRow] = keySchedule[ksRow - keySize] ^ t;
              }
            }
            var invKeySchedule = this._invKeySchedule = [];
            for (var invKsRow = 0; invKsRow < ksRows; invKsRow++) {
              var ksRow = ksRows - invKsRow;
              if (invKsRow % 4) {
                var t = keySchedule[ksRow];
              } else {
                var t = keySchedule[ksRow - 4];
              }
              if (invKsRow < 4 || ksRow <= 4) {
                invKeySchedule[invKsRow] = t;
              } else {
                invKeySchedule[invKsRow] = INV_SUB_MIX_0[SBOX[t >>> 24]] ^ INV_SUB_MIX_1[SBOX[t >>> 16 & 255]] ^ INV_SUB_MIX_2[SBOX[t >>> 8 & 255]] ^ INV_SUB_MIX_3[SBOX[t & 255]];
              }
            }
          },
          encryptBlock: function(M, offset) {
            this._doCryptBlock(M, offset, this._keySchedule, SUB_MIX_0, SUB_MIX_1, SUB_MIX_2, SUB_MIX_3, SBOX);
          },
          decryptBlock: function(M, offset) {
            var t = M[offset + 1];
            M[offset + 1] = M[offset + 3];
            M[offset + 3] = t;
            this._doCryptBlock(M, offset, this._invKeySchedule, INV_SUB_MIX_0, INV_SUB_MIX_1, INV_SUB_MIX_2, INV_SUB_MIX_3, INV_SBOX);
            var t = M[offset + 1];
            M[offset + 1] = M[offset + 3];
            M[offset + 3] = t;
          },
          _doCryptBlock: function(M, offset, keySchedule, SUB_MIX_02, SUB_MIX_12, SUB_MIX_22, SUB_MIX_32, SBOX2) {
            var nRounds = this._nRounds;
            var s0 = M[offset] ^ keySchedule[0];
            var s1 = M[offset + 1] ^ keySchedule[1];
            var s2 = M[offset + 2] ^ keySchedule[2];
            var s3 = M[offset + 3] ^ keySchedule[3];
            var ksRow = 4;
            for (var round = 1; round < nRounds; round++) {
              var t0 = SUB_MIX_02[s0 >>> 24] ^ SUB_MIX_12[s1 >>> 16 & 255] ^ SUB_MIX_22[s2 >>> 8 & 255] ^ SUB_MIX_32[s3 & 255] ^ keySchedule[ksRow++];
              var t1 = SUB_MIX_02[s1 >>> 24] ^ SUB_MIX_12[s2 >>> 16 & 255] ^ SUB_MIX_22[s3 >>> 8 & 255] ^ SUB_MIX_32[s0 & 255] ^ keySchedule[ksRow++];
              var t2 = SUB_MIX_02[s2 >>> 24] ^ SUB_MIX_12[s3 >>> 16 & 255] ^ SUB_MIX_22[s0 >>> 8 & 255] ^ SUB_MIX_32[s1 & 255] ^ keySchedule[ksRow++];
              var t3 = SUB_MIX_02[s3 >>> 24] ^ SUB_MIX_12[s0 >>> 16 & 255] ^ SUB_MIX_22[s1 >>> 8 & 255] ^ SUB_MIX_32[s2 & 255] ^ keySchedule[ksRow++];
              s0 = t0;
              s1 = t1;
              s2 = t2;
              s3 = t3;
            }
            var t0 = (SBOX2[s0 >>> 24] << 24 | SBOX2[s1 >>> 16 & 255] << 16 | SBOX2[s2 >>> 8 & 255] << 8 | SBOX2[s3 & 255]) ^ keySchedule[ksRow++];
            var t1 = (SBOX2[s1 >>> 24] << 24 | SBOX2[s2 >>> 16 & 255] << 16 | SBOX2[s3 >>> 8 & 255] << 8 | SBOX2[s0 & 255]) ^ keySchedule[ksRow++];
            var t2 = (SBOX2[s2 >>> 24] << 24 | SBOX2[s3 >>> 16 & 255] << 16 | SBOX2[s0 >>> 8 & 255] << 8 | SBOX2[s1 & 255]) ^ keySchedule[ksRow++];
            var t3 = (SBOX2[s3 >>> 24] << 24 | SBOX2[s0 >>> 16 & 255] << 16 | SBOX2[s1 >>> 8 & 255] << 8 | SBOX2[s2 & 255]) ^ keySchedule[ksRow++];
            M[offset] = t0;
            M[offset + 1] = t1;
            M[offset + 2] = t2;
            M[offset + 3] = t3;
          },
          keySize: 256 / 32
        });
        C.AES = BlockCipher._createHelper(AES);
      })();
      return CryptoJS2.AES;
    });
  }
});

// node_modules/crypto-js/tripledes.js
var require_tripledes = __commonJS({
  "node_modules/crypto-js/tripledes.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_enc_base64(), require_md5(), require_evpkdf(), require_cipher_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./enc-base64", "./md5", "./evpkdf", "./cipher-core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function() {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var WordArray = C_lib.WordArray;
        var BlockCipher = C_lib.BlockCipher;
        var C_algo = C.algo;
        var PC1 = [
          57,
          49,
          41,
          33,
          25,
          17,
          9,
          1,
          58,
          50,
          42,
          34,
          26,
          18,
          10,
          2,
          59,
          51,
          43,
          35,
          27,
          19,
          11,
          3,
          60,
          52,
          44,
          36,
          63,
          55,
          47,
          39,
          31,
          23,
          15,
          7,
          62,
          54,
          46,
          38,
          30,
          22,
          14,
          6,
          61,
          53,
          45,
          37,
          29,
          21,
          13,
          5,
          28,
          20,
          12,
          4
        ];
        var PC2 = [
          14,
          17,
          11,
          24,
          1,
          5,
          3,
          28,
          15,
          6,
          21,
          10,
          23,
          19,
          12,
          4,
          26,
          8,
          16,
          7,
          27,
          20,
          13,
          2,
          41,
          52,
          31,
          37,
          47,
          55,
          30,
          40,
          51,
          45,
          33,
          48,
          44,
          49,
          39,
          56,
          34,
          53,
          46,
          42,
          50,
          36,
          29,
          32
        ];
        var BIT_SHIFTS = [1, 2, 4, 6, 8, 10, 12, 14, 15, 17, 19, 21, 23, 25, 27, 28];
        var SBOX_P = [
          {
            0: 8421888,
            268435456: 32768,
            536870912: 8421378,
            805306368: 2,
            1073741824: 512,
            1342177280: 8421890,
            1610612736: 8389122,
            1879048192: 8388608,
            2147483648: 514,
            2415919104: 8389120,
            2684354560: 33280,
            2952790016: 8421376,
            3221225472: 32770,
            3489660928: 8388610,
            3758096384: 0,
            4026531840: 33282,
            134217728: 0,
            402653184: 8421890,
            671088640: 33282,
            939524096: 32768,
            1207959552: 8421888,
            1476395008: 512,
            1744830464: 8421378,
            2013265920: 2,
            2281701376: 8389120,
            2550136832: 33280,
            2818572288: 8421376,
            3087007744: 8389122,
            3355443200: 8388610,
            3623878656: 32770,
            3892314112: 514,
            4160749568: 8388608,
            1: 32768,
            268435457: 2,
            536870913: 8421888,
            805306369: 8388608,
            1073741825: 8421378,
            1342177281: 33280,
            1610612737: 512,
            1879048193: 8389122,
            2147483649: 8421890,
            2415919105: 8421376,
            2684354561: 8388610,
            2952790017: 33282,
            3221225473: 514,
            3489660929: 8389120,
            3758096385: 32770,
            4026531841: 0,
            134217729: 8421890,
            402653185: 8421376,
            671088641: 8388608,
            939524097: 512,
            1207959553: 32768,
            1476395009: 8388610,
            1744830465: 2,
            2013265921: 33282,
            2281701377: 32770,
            2550136833: 8389122,
            2818572289: 514,
            3087007745: 8421888,
            3355443201: 8389120,
            3623878657: 0,
            3892314113: 33280,
            4160749569: 8421378
          },
          {
            0: 1074282512,
            16777216: 16384,
            33554432: 524288,
            50331648: 1074266128,
            67108864: 1073741840,
            83886080: 1074282496,
            100663296: 1073758208,
            117440512: 16,
            134217728: 540672,
            150994944: 1073758224,
            167772160: 1073741824,
            184549376: 540688,
            201326592: 524304,
            218103808: 0,
            234881024: 16400,
            251658240: 1074266112,
            8388608: 1073758208,
            25165824: 540688,
            41943040: 16,
            58720256: 1073758224,
            75497472: 1074282512,
            92274688: 1073741824,
            109051904: 524288,
            125829120: 1074266128,
            142606336: 524304,
            159383552: 0,
            176160768: 16384,
            192937984: 1074266112,
            209715200: 1073741840,
            226492416: 540672,
            243269632: 1074282496,
            260046848: 16400,
            268435456: 0,
            285212672: 1074266128,
            301989888: 1073758224,
            318767104: 1074282496,
            335544320: 1074266112,
            352321536: 16,
            369098752: 540688,
            385875968: 16384,
            402653184: 16400,
            419430400: 524288,
            436207616: 524304,
            452984832: 1073741840,
            469762048: 540672,
            486539264: 1073758208,
            503316480: 1073741824,
            520093696: 1074282512,
            276824064: 540688,
            293601280: 524288,
            310378496: 1074266112,
            327155712: 16384,
            343932928: 1073758208,
            360710144: 1074282512,
            377487360: 16,
            394264576: 1073741824,
            411041792: 1074282496,
            427819008: 1073741840,
            444596224: 1073758224,
            461373440: 524304,
            478150656: 0,
            494927872: 16400,
            511705088: 1074266128,
            528482304: 540672
          },
          {
            0: 260,
            1048576: 0,
            2097152: 67109120,
            3145728: 65796,
            4194304: 65540,
            5242880: 67108868,
            6291456: 67174660,
            7340032: 67174400,
            8388608: 67108864,
            9437184: 67174656,
            10485760: 65792,
            11534336: 67174404,
            12582912: 67109124,
            13631488: 65536,
            14680064: 4,
            15728640: 256,
            524288: 67174656,
            1572864: 67174404,
            2621440: 0,
            3670016: 67109120,
            4718592: 67108868,
            5767168: 65536,
            6815744: 65540,
            7864320: 260,
            8912896: 4,
            9961472: 256,
            11010048: 67174400,
            12058624: 65796,
            13107200: 65792,
            14155776: 67109124,
            15204352: 67174660,
            16252928: 67108864,
            16777216: 67174656,
            17825792: 65540,
            18874368: 65536,
            19922944: 67109120,
            20971520: 256,
            22020096: 67174660,
            23068672: 67108868,
            24117248: 0,
            25165824: 67109124,
            26214400: 67108864,
            27262976: 4,
            28311552: 65792,
            29360128: 67174400,
            30408704: 260,
            31457280: 65796,
            32505856: 67174404,
            17301504: 67108864,
            18350080: 260,
            19398656: 67174656,
            20447232: 0,
            21495808: 65540,
            22544384: 67109120,
            23592960: 256,
            24641536: 67174404,
            25690112: 65536,
            26738688: 67174660,
            27787264: 65796,
            28835840: 67108868,
            29884416: 67109124,
            30932992: 67174400,
            31981568: 4,
            33030144: 65792
          },
          {
            0: 2151682048,
            65536: 2147487808,
            131072: 4198464,
            196608: 2151677952,
            262144: 0,
            327680: 4198400,
            393216: 2147483712,
            458752: 4194368,
            524288: 2147483648,
            589824: 4194304,
            655360: 64,
            720896: 2147487744,
            786432: 2151678016,
            851968: 4160,
            917504: 4096,
            983040: 2151682112,
            32768: 2147487808,
            98304: 64,
            163840: 2151678016,
            229376: 2147487744,
            294912: 4198400,
            360448: 2151682112,
            425984: 0,
            491520: 2151677952,
            557056: 4096,
            622592: 2151682048,
            688128: 4194304,
            753664: 4160,
            819200: 2147483648,
            884736: 4194368,
            950272: 4198464,
            1015808: 2147483712,
            1048576: 4194368,
            1114112: 4198400,
            1179648: 2147483712,
            1245184: 0,
            1310720: 4160,
            1376256: 2151678016,
            1441792: 2151682048,
            1507328: 2147487808,
            1572864: 2151682112,
            1638400: 2147483648,
            1703936: 2151677952,
            1769472: 4198464,
            1835008: 2147487744,
            1900544: 4194304,
            1966080: 64,
            2031616: 4096,
            1081344: 2151677952,
            1146880: 2151682112,
            1212416: 0,
            1277952: 4198400,
            1343488: 4194368,
            1409024: 2147483648,
            1474560: 2147487808,
            1540096: 64,
            1605632: 2147483712,
            1671168: 4096,
            1736704: 2147487744,
            1802240: 2151678016,
            1867776: 4160,
            1933312: 2151682048,
            1998848: 4194304,
            2064384: 4198464
          },
          {
            0: 128,
            4096: 17039360,
            8192: 262144,
            12288: 536870912,
            16384: 537133184,
            20480: 16777344,
            24576: 553648256,
            28672: 262272,
            32768: 16777216,
            36864: 537133056,
            40960: 536871040,
            45056: 553910400,
            49152: 553910272,
            53248: 0,
            57344: 17039488,
            61440: 553648128,
            2048: 17039488,
            6144: 553648256,
            10240: 128,
            14336: 17039360,
            18432: 262144,
            22528: 537133184,
            26624: 553910272,
            30720: 536870912,
            34816: 537133056,
            38912: 0,
            43008: 553910400,
            47104: 16777344,
            51200: 536871040,
            55296: 553648128,
            59392: 16777216,
            63488: 262272,
            65536: 262144,
            69632: 128,
            73728: 536870912,
            77824: 553648256,
            81920: 16777344,
            86016: 553910272,
            90112: 537133184,
            94208: 16777216,
            98304: 553910400,
            102400: 553648128,
            106496: 17039360,
            110592: 537133056,
            114688: 262272,
            118784: 536871040,
            122880: 0,
            126976: 17039488,
            67584: 553648256,
            71680: 16777216,
            75776: 17039360,
            79872: 537133184,
            83968: 536870912,
            88064: 17039488,
            92160: 128,
            96256: 553910272,
            100352: 262272,
            104448: 553910400,
            108544: 0,
            112640: 553648128,
            116736: 16777344,
            120832: 262144,
            124928: 537133056,
            129024: 536871040
          },
          {
            0: 268435464,
            256: 8192,
            512: 270532608,
            768: 270540808,
            1024: 268443648,
            1280: 2097152,
            1536: 2097160,
            1792: 268435456,
            2048: 0,
            2304: 268443656,
            2560: 2105344,
            2816: 8,
            3072: 270532616,
            3328: 2105352,
            3584: 8200,
            3840: 270540800,
            128: 270532608,
            384: 270540808,
            640: 8,
            896: 2097152,
            1152: 2105352,
            1408: 268435464,
            1664: 268443648,
            1920: 8200,
            2176: 2097160,
            2432: 8192,
            2688: 268443656,
            2944: 270532616,
            3200: 0,
            3456: 270540800,
            3712: 2105344,
            3968: 268435456,
            4096: 268443648,
            4352: 270532616,
            4608: 270540808,
            4864: 8200,
            5120: 2097152,
            5376: 268435456,
            5632: 268435464,
            5888: 2105344,
            6144: 2105352,
            6400: 0,
            6656: 8,
            6912: 270532608,
            7168: 8192,
            7424: 268443656,
            7680: 270540800,
            7936: 2097160,
            4224: 8,
            4480: 2105344,
            4736: 2097152,
            4992: 268435464,
            5248: 268443648,
            5504: 8200,
            5760: 270540808,
            6016: 270532608,
            6272: 270540800,
            6528: 270532616,
            6784: 8192,
            7040: 2105352,
            7296: 2097160,
            7552: 0,
            7808: 268435456,
            8064: 268443656
          },
          {
            0: 1048576,
            16: 33555457,
            32: 1024,
            48: 1049601,
            64: 34604033,
            80: 0,
            96: 1,
            112: 34603009,
            128: 33555456,
            144: 1048577,
            160: 33554433,
            176: 34604032,
            192: 34603008,
            208: 1025,
            224: 1049600,
            240: 33554432,
            8: 34603009,
            24: 0,
            40: 33555457,
            56: 34604032,
            72: 1048576,
            88: 33554433,
            104: 33554432,
            120: 1025,
            136: 1049601,
            152: 33555456,
            168: 34603008,
            184: 1048577,
            200: 1024,
            216: 34604033,
            232: 1,
            248: 1049600,
            256: 33554432,
            272: 1048576,
            288: 33555457,
            304: 34603009,
            320: 1048577,
            336: 33555456,
            352: 34604032,
            368: 1049601,
            384: 1025,
            400: 34604033,
            416: 1049600,
            432: 1,
            448: 0,
            464: 34603008,
            480: 33554433,
            496: 1024,
            264: 1049600,
            280: 33555457,
            296: 34603009,
            312: 1,
            328: 33554432,
            344: 1048576,
            360: 1025,
            376: 34604032,
            392: 33554433,
            408: 34603008,
            424: 0,
            440: 34604033,
            456: 1049601,
            472: 1024,
            488: 33555456,
            504: 1048577
          },
          {
            0: 134219808,
            1: 131072,
            2: 134217728,
            3: 32,
            4: 131104,
            5: 134350880,
            6: 134350848,
            7: 2048,
            8: 134348800,
            9: 134219776,
            10: 133120,
            11: 134348832,
            12: 2080,
            13: 0,
            14: 134217760,
            15: 133152,
            2147483648: 2048,
            2147483649: 134350880,
            2147483650: 134219808,
            2147483651: 134217728,
            2147483652: 134348800,
            2147483653: 133120,
            2147483654: 133152,
            2147483655: 32,
            2147483656: 134217760,
            2147483657: 2080,
            2147483658: 131104,
            2147483659: 134350848,
            2147483660: 0,
            2147483661: 134348832,
            2147483662: 134219776,
            2147483663: 131072,
            16: 133152,
            17: 134350848,
            18: 32,
            19: 2048,
            20: 134219776,
            21: 134217760,
            22: 134348832,
            23: 131072,
            24: 0,
            25: 131104,
            26: 134348800,
            27: 134219808,
            28: 134350880,
            29: 133120,
            30: 2080,
            31: 134217728,
            2147483664: 131072,
            2147483665: 2048,
            2147483666: 134348832,
            2147483667: 133152,
            2147483668: 32,
            2147483669: 134348800,
            2147483670: 134217728,
            2147483671: 134219808,
            2147483672: 134350880,
            2147483673: 134217760,
            2147483674: 134219776,
            2147483675: 0,
            2147483676: 133120,
            2147483677: 2080,
            2147483678: 131104,
            2147483679: 134350848
          }
        ];
        var SBOX_MASK = [
          4160749569,
          528482304,
          33030144,
          2064384,
          129024,
          8064,
          504,
          2147483679
        ];
        var DES = C_algo.DES = BlockCipher.extend({
          _doReset: function() {
            var key = this._key;
            var keyWords = key.words;
            var keyBits = [];
            for (var i = 0; i < 56; i++) {
              var keyBitPos = PC1[i] - 1;
              keyBits[i] = keyWords[keyBitPos >>> 5] >>> 31 - keyBitPos % 32 & 1;
            }
            var subKeys = this._subKeys = [];
            for (var nSubKey = 0; nSubKey < 16; nSubKey++) {
              var subKey = subKeys[nSubKey] = [];
              var bitShift = BIT_SHIFTS[nSubKey];
              for (var i = 0; i < 24; i++) {
                subKey[i / 6 | 0] |= keyBits[(PC2[i] - 1 + bitShift) % 28] << 31 - i % 6;
                subKey[4 + (i / 6 | 0)] |= keyBits[28 + (PC2[i + 24] - 1 + bitShift) % 28] << 31 - i % 6;
              }
              subKey[0] = subKey[0] << 1 | subKey[0] >>> 31;
              for (var i = 1; i < 7; i++) {
                subKey[i] = subKey[i] >>> (i - 1) * 4 + 3;
              }
              subKey[7] = subKey[7] << 5 | subKey[7] >>> 27;
            }
            var invSubKeys = this._invSubKeys = [];
            for (var i = 0; i < 16; i++) {
              invSubKeys[i] = subKeys[15 - i];
            }
          },
          encryptBlock: function(M, offset) {
            this._doCryptBlock(M, offset, this._subKeys);
          },
          decryptBlock: function(M, offset) {
            this._doCryptBlock(M, offset, this._invSubKeys);
          },
          _doCryptBlock: function(M, offset, subKeys) {
            this._lBlock = M[offset];
            this._rBlock = M[offset + 1];
            exchangeLR.call(this, 4, 252645135);
            exchangeLR.call(this, 16, 65535);
            exchangeRL.call(this, 2, 858993459);
            exchangeRL.call(this, 8, 16711935);
            exchangeLR.call(this, 1, 1431655765);
            for (var round = 0; round < 16; round++) {
              var subKey = subKeys[round];
              var lBlock = this._lBlock;
              var rBlock = this._rBlock;
              var f = 0;
              for (var i = 0; i < 8; i++) {
                f |= SBOX_P[i][((rBlock ^ subKey[i]) & SBOX_MASK[i]) >>> 0];
              }
              this._lBlock = rBlock;
              this._rBlock = lBlock ^ f;
            }
            var t = this._lBlock;
            this._lBlock = this._rBlock;
            this._rBlock = t;
            exchangeLR.call(this, 1, 1431655765);
            exchangeRL.call(this, 8, 16711935);
            exchangeRL.call(this, 2, 858993459);
            exchangeLR.call(this, 16, 65535);
            exchangeLR.call(this, 4, 252645135);
            M[offset] = this._lBlock;
            M[offset + 1] = this._rBlock;
          },
          keySize: 64 / 32,
          ivSize: 64 / 32,
          blockSize: 64 / 32
        });
        function exchangeLR(offset, mask) {
          var t = (this._lBlock >>> offset ^ this._rBlock) & mask;
          this._rBlock ^= t;
          this._lBlock ^= t << offset;
        }
        function exchangeRL(offset, mask) {
          var t = (this._rBlock >>> offset ^ this._lBlock) & mask;
          this._lBlock ^= t;
          this._rBlock ^= t << offset;
        }
        C.DES = BlockCipher._createHelper(DES);
        var TripleDES = C_algo.TripleDES = BlockCipher.extend({
          _doReset: function() {
            var key = this._key;
            var keyWords = key.words;
            if (keyWords.length !== 2 && keyWords.length !== 4 && keyWords.length < 6) {
              throw new Error("Invalid key length - 3DES requires the key length to be 64, 128, 192 or >192.");
            }
            var key1 = keyWords.slice(0, 2);
            var key2 = keyWords.length < 4 ? keyWords.slice(0, 2) : keyWords.slice(2, 4);
            var key3 = keyWords.length < 6 ? keyWords.slice(0, 2) : keyWords.slice(4, 6);
            this._des1 = DES.createEncryptor(WordArray.create(key1));
            this._des2 = DES.createEncryptor(WordArray.create(key2));
            this._des3 = DES.createEncryptor(WordArray.create(key3));
          },
          encryptBlock: function(M, offset) {
            this._des1.encryptBlock(M, offset);
            this._des2.decryptBlock(M, offset);
            this._des3.encryptBlock(M, offset);
          },
          decryptBlock: function(M, offset) {
            this._des3.decryptBlock(M, offset);
            this._des2.encryptBlock(M, offset);
            this._des1.decryptBlock(M, offset);
          },
          keySize: 192 / 32,
          ivSize: 64 / 32,
          blockSize: 64 / 32
        });
        C.TripleDES = BlockCipher._createHelper(TripleDES);
      })();
      return CryptoJS2.TripleDES;
    });
  }
});

// node_modules/crypto-js/rc4.js
var require_rc4 = __commonJS({
  "node_modules/crypto-js/rc4.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_enc_base64(), require_md5(), require_evpkdf(), require_cipher_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./enc-base64", "./md5", "./evpkdf", "./cipher-core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function() {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var StreamCipher = C_lib.StreamCipher;
        var C_algo = C.algo;
        var RC4 = C_algo.RC4 = StreamCipher.extend({
          _doReset: function() {
            var key = this._key;
            var keyWords = key.words;
            var keySigBytes = key.sigBytes;
            var S = this._S = [];
            for (var i = 0; i < 256; i++) {
              S[i] = i;
            }
            for (var i = 0, j = 0; i < 256; i++) {
              var keyByteIndex = i % keySigBytes;
              var keyByte = keyWords[keyByteIndex >>> 2] >>> 24 - keyByteIndex % 4 * 8 & 255;
              j = (j + S[i] + keyByte) % 256;
              var t = S[i];
              S[i] = S[j];
              S[j] = t;
            }
            this._i = this._j = 0;
          },
          _doProcessBlock: function(M, offset) {
            M[offset] ^= generateKeystreamWord.call(this);
          },
          keySize: 256 / 32,
          ivSize: 0
        });
        function generateKeystreamWord() {
          var S = this._S;
          var i = this._i;
          var j = this._j;
          var keystreamWord = 0;
          for (var n = 0; n < 4; n++) {
            i = (i + 1) % 256;
            j = (j + S[i]) % 256;
            var t = S[i];
            S[i] = S[j];
            S[j] = t;
            keystreamWord |= S[(S[i] + S[j]) % 256] << 24 - n * 8;
          }
          this._i = i;
          this._j = j;
          return keystreamWord;
        }
        C.RC4 = StreamCipher._createHelper(RC4);
        var RC4Drop = C_algo.RC4Drop = RC4.extend({
          /**
           * Configuration options.
           *
           * @property {number} drop The number of keystream words to drop. Default 192
           */
          cfg: RC4.cfg.extend({
            drop: 192
          }),
          _doReset: function() {
            RC4._doReset.call(this);
            for (var i = this.cfg.drop; i > 0; i--) {
              generateKeystreamWord.call(this);
            }
          }
        });
        C.RC4Drop = StreamCipher._createHelper(RC4Drop);
      })();
      return CryptoJS2.RC4;
    });
  }
});

// node_modules/crypto-js/rabbit.js
var require_rabbit = __commonJS({
  "node_modules/crypto-js/rabbit.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_enc_base64(), require_md5(), require_evpkdf(), require_cipher_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./enc-base64", "./md5", "./evpkdf", "./cipher-core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function() {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var StreamCipher = C_lib.StreamCipher;
        var C_algo = C.algo;
        var S = [];
        var C_ = [];
        var G = [];
        var Rabbit = C_algo.Rabbit = StreamCipher.extend({
          _doReset: function() {
            var K = this._key.words;
            var iv = this.cfg.iv;
            for (var i = 0; i < 4; i++) {
              K[i] = (K[i] << 8 | K[i] >>> 24) & 16711935 | (K[i] << 24 | K[i] >>> 8) & 4278255360;
            }
            var X = this._X = [
              K[0],
              K[3] << 16 | K[2] >>> 16,
              K[1],
              K[0] << 16 | K[3] >>> 16,
              K[2],
              K[1] << 16 | K[0] >>> 16,
              K[3],
              K[2] << 16 | K[1] >>> 16
            ];
            var C2 = this._C = [
              K[2] << 16 | K[2] >>> 16,
              K[0] & 4294901760 | K[1] & 65535,
              K[3] << 16 | K[3] >>> 16,
              K[1] & 4294901760 | K[2] & 65535,
              K[0] << 16 | K[0] >>> 16,
              K[2] & 4294901760 | K[3] & 65535,
              K[1] << 16 | K[1] >>> 16,
              K[3] & 4294901760 | K[0] & 65535
            ];
            this._b = 0;
            for (var i = 0; i < 4; i++) {
              nextState.call(this);
            }
            for (var i = 0; i < 8; i++) {
              C2[i] ^= X[i + 4 & 7];
            }
            if (iv) {
              var IV = iv.words;
              var IV_0 = IV[0];
              var IV_1 = IV[1];
              var i0 = (IV_0 << 8 | IV_0 >>> 24) & 16711935 | (IV_0 << 24 | IV_0 >>> 8) & 4278255360;
              var i2 = (IV_1 << 8 | IV_1 >>> 24) & 16711935 | (IV_1 << 24 | IV_1 >>> 8) & 4278255360;
              var i1 = i0 >>> 16 | i2 & 4294901760;
              var i3 = i2 << 16 | i0 & 65535;
              C2[0] ^= i0;
              C2[1] ^= i1;
              C2[2] ^= i2;
              C2[3] ^= i3;
              C2[4] ^= i0;
              C2[5] ^= i1;
              C2[6] ^= i2;
              C2[7] ^= i3;
              for (var i = 0; i < 4; i++) {
                nextState.call(this);
              }
            }
          },
          _doProcessBlock: function(M, offset) {
            var X = this._X;
            nextState.call(this);
            S[0] = X[0] ^ X[5] >>> 16 ^ X[3] << 16;
            S[1] = X[2] ^ X[7] >>> 16 ^ X[5] << 16;
            S[2] = X[4] ^ X[1] >>> 16 ^ X[7] << 16;
            S[3] = X[6] ^ X[3] >>> 16 ^ X[1] << 16;
            for (var i = 0; i < 4; i++) {
              S[i] = (S[i] << 8 | S[i] >>> 24) & 16711935 | (S[i] << 24 | S[i] >>> 8) & 4278255360;
              M[offset + i] ^= S[i];
            }
          },
          blockSize: 128 / 32,
          ivSize: 64 / 32
        });
        function nextState() {
          var X = this._X;
          var C2 = this._C;
          for (var i = 0; i < 8; i++) {
            C_[i] = C2[i];
          }
          C2[0] = C2[0] + 1295307597 + this._b | 0;
          C2[1] = C2[1] + 3545052371 + (C2[0] >>> 0 < C_[0] >>> 0 ? 1 : 0) | 0;
          C2[2] = C2[2] + 886263092 + (C2[1] >>> 0 < C_[1] >>> 0 ? 1 : 0) | 0;
          C2[3] = C2[3] + 1295307597 + (C2[2] >>> 0 < C_[2] >>> 0 ? 1 : 0) | 0;
          C2[4] = C2[4] + 3545052371 + (C2[3] >>> 0 < C_[3] >>> 0 ? 1 : 0) | 0;
          C2[5] = C2[5] + 886263092 + (C2[4] >>> 0 < C_[4] >>> 0 ? 1 : 0) | 0;
          C2[6] = C2[6] + 1295307597 + (C2[5] >>> 0 < C_[5] >>> 0 ? 1 : 0) | 0;
          C2[7] = C2[7] + 3545052371 + (C2[6] >>> 0 < C_[6] >>> 0 ? 1 : 0) | 0;
          this._b = C2[7] >>> 0 < C_[7] >>> 0 ? 1 : 0;
          for (var i = 0; i < 8; i++) {
            var gx = X[i] + C2[i];
            var ga = gx & 65535;
            var gb = gx >>> 16;
            var gh = ((ga * ga >>> 17) + ga * gb >>> 15) + gb * gb;
            var gl = ((gx & 4294901760) * gx | 0) + ((gx & 65535) * gx | 0);
            G[i] = gh ^ gl;
          }
          X[0] = G[0] + (G[7] << 16 | G[7] >>> 16) + (G[6] << 16 | G[6] >>> 16) | 0;
          X[1] = G[1] + (G[0] << 8 | G[0] >>> 24) + G[7] | 0;
          X[2] = G[2] + (G[1] << 16 | G[1] >>> 16) + (G[0] << 16 | G[0] >>> 16) | 0;
          X[3] = G[3] + (G[2] << 8 | G[2] >>> 24) + G[1] | 0;
          X[4] = G[4] + (G[3] << 16 | G[3] >>> 16) + (G[2] << 16 | G[2] >>> 16) | 0;
          X[5] = G[5] + (G[4] << 8 | G[4] >>> 24) + G[3] | 0;
          X[6] = G[6] + (G[5] << 16 | G[5] >>> 16) + (G[4] << 16 | G[4] >>> 16) | 0;
          X[7] = G[7] + (G[6] << 8 | G[6] >>> 24) + G[5] | 0;
        }
        C.Rabbit = StreamCipher._createHelper(Rabbit);
      })();
      return CryptoJS2.Rabbit;
    });
  }
});

// node_modules/crypto-js/rabbit-legacy.js
var require_rabbit_legacy = __commonJS({
  "node_modules/crypto-js/rabbit-legacy.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_enc_base64(), require_md5(), require_evpkdf(), require_cipher_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./enc-base64", "./md5", "./evpkdf", "./cipher-core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function() {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var StreamCipher = C_lib.StreamCipher;
        var C_algo = C.algo;
        var S = [];
        var C_ = [];
        var G = [];
        var RabbitLegacy = C_algo.RabbitLegacy = StreamCipher.extend({
          _doReset: function() {
            var K = this._key.words;
            var iv = this.cfg.iv;
            var X = this._X = [
              K[0],
              K[3] << 16 | K[2] >>> 16,
              K[1],
              K[0] << 16 | K[3] >>> 16,
              K[2],
              K[1] << 16 | K[0] >>> 16,
              K[3],
              K[2] << 16 | K[1] >>> 16
            ];
            var C2 = this._C = [
              K[2] << 16 | K[2] >>> 16,
              K[0] & 4294901760 | K[1] & 65535,
              K[3] << 16 | K[3] >>> 16,
              K[1] & 4294901760 | K[2] & 65535,
              K[0] << 16 | K[0] >>> 16,
              K[2] & 4294901760 | K[3] & 65535,
              K[1] << 16 | K[1] >>> 16,
              K[3] & 4294901760 | K[0] & 65535
            ];
            this._b = 0;
            for (var i = 0; i < 4; i++) {
              nextState.call(this);
            }
            for (var i = 0; i < 8; i++) {
              C2[i] ^= X[i + 4 & 7];
            }
            if (iv) {
              var IV = iv.words;
              var IV_0 = IV[0];
              var IV_1 = IV[1];
              var i0 = (IV_0 << 8 | IV_0 >>> 24) & 16711935 | (IV_0 << 24 | IV_0 >>> 8) & 4278255360;
              var i2 = (IV_1 << 8 | IV_1 >>> 24) & 16711935 | (IV_1 << 24 | IV_1 >>> 8) & 4278255360;
              var i1 = i0 >>> 16 | i2 & 4294901760;
              var i3 = i2 << 16 | i0 & 65535;
              C2[0] ^= i0;
              C2[1] ^= i1;
              C2[2] ^= i2;
              C2[3] ^= i3;
              C2[4] ^= i0;
              C2[5] ^= i1;
              C2[6] ^= i2;
              C2[7] ^= i3;
              for (var i = 0; i < 4; i++) {
                nextState.call(this);
              }
            }
          },
          _doProcessBlock: function(M, offset) {
            var X = this._X;
            nextState.call(this);
            S[0] = X[0] ^ X[5] >>> 16 ^ X[3] << 16;
            S[1] = X[2] ^ X[7] >>> 16 ^ X[5] << 16;
            S[2] = X[4] ^ X[1] >>> 16 ^ X[7] << 16;
            S[3] = X[6] ^ X[3] >>> 16 ^ X[1] << 16;
            for (var i = 0; i < 4; i++) {
              S[i] = (S[i] << 8 | S[i] >>> 24) & 16711935 | (S[i] << 24 | S[i] >>> 8) & 4278255360;
              M[offset + i] ^= S[i];
            }
          },
          blockSize: 128 / 32,
          ivSize: 64 / 32
        });
        function nextState() {
          var X = this._X;
          var C2 = this._C;
          for (var i = 0; i < 8; i++) {
            C_[i] = C2[i];
          }
          C2[0] = C2[0] + 1295307597 + this._b | 0;
          C2[1] = C2[1] + 3545052371 + (C2[0] >>> 0 < C_[0] >>> 0 ? 1 : 0) | 0;
          C2[2] = C2[2] + 886263092 + (C2[1] >>> 0 < C_[1] >>> 0 ? 1 : 0) | 0;
          C2[3] = C2[3] + 1295307597 + (C2[2] >>> 0 < C_[2] >>> 0 ? 1 : 0) | 0;
          C2[4] = C2[4] + 3545052371 + (C2[3] >>> 0 < C_[3] >>> 0 ? 1 : 0) | 0;
          C2[5] = C2[5] + 886263092 + (C2[4] >>> 0 < C_[4] >>> 0 ? 1 : 0) | 0;
          C2[6] = C2[6] + 1295307597 + (C2[5] >>> 0 < C_[5] >>> 0 ? 1 : 0) | 0;
          C2[7] = C2[7] + 3545052371 + (C2[6] >>> 0 < C_[6] >>> 0 ? 1 : 0) | 0;
          this._b = C2[7] >>> 0 < C_[7] >>> 0 ? 1 : 0;
          for (var i = 0; i < 8; i++) {
            var gx = X[i] + C2[i];
            var ga = gx & 65535;
            var gb = gx >>> 16;
            var gh = ((ga * ga >>> 17) + ga * gb >>> 15) + gb * gb;
            var gl = ((gx & 4294901760) * gx | 0) + ((gx & 65535) * gx | 0);
            G[i] = gh ^ gl;
          }
          X[0] = G[0] + (G[7] << 16 | G[7] >>> 16) + (G[6] << 16 | G[6] >>> 16) | 0;
          X[1] = G[1] + (G[0] << 8 | G[0] >>> 24) + G[7] | 0;
          X[2] = G[2] + (G[1] << 16 | G[1] >>> 16) + (G[0] << 16 | G[0] >>> 16) | 0;
          X[3] = G[3] + (G[2] << 8 | G[2] >>> 24) + G[1] | 0;
          X[4] = G[4] + (G[3] << 16 | G[3] >>> 16) + (G[2] << 16 | G[2] >>> 16) | 0;
          X[5] = G[5] + (G[4] << 8 | G[4] >>> 24) + G[3] | 0;
          X[6] = G[6] + (G[5] << 16 | G[5] >>> 16) + (G[4] << 16 | G[4] >>> 16) | 0;
          X[7] = G[7] + (G[6] << 8 | G[6] >>> 24) + G[5] | 0;
        }
        C.RabbitLegacy = StreamCipher._createHelper(RabbitLegacy);
      })();
      return CryptoJS2.RabbitLegacy;
    });
  }
});

// node_modules/crypto-js/blowfish.js
var require_blowfish = __commonJS({
  "node_modules/crypto-js/blowfish.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_enc_base64(), require_md5(), require_evpkdf(), require_cipher_core());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./enc-base64", "./md5", "./evpkdf", "./cipher-core"], factory);
      } else {
        factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      (function() {
        var C = CryptoJS2;
        var C_lib = C.lib;
        var BlockCipher = C_lib.BlockCipher;
        var C_algo = C.algo;
        const N = 16;
        const ORIG_P = [
          608135816,
          2242054355,
          320440878,
          57701188,
          2752067618,
          698298832,
          137296536,
          3964562569,
          1160258022,
          953160567,
          3193202383,
          887688300,
          3232508343,
          3380367581,
          1065670069,
          3041331479,
          2450970073,
          2306472731
        ];
        const ORIG_S = [
          [
            3509652390,
            2564797868,
            805139163,
            3491422135,
            3101798381,
            1780907670,
            3128725573,
            4046225305,
            614570311,
            3012652279,
            134345442,
            2240740374,
            1667834072,
            1901547113,
            2757295779,
            4103290238,
            227898511,
            1921955416,
            1904987480,
            2182433518,
            2069144605,
            3260701109,
            2620446009,
            720527379,
            3318853667,
            677414384,
            3393288472,
            3101374703,
            2390351024,
            1614419982,
            1822297739,
            2954791486,
            3608508353,
            3174124327,
            2024746970,
            1432378464,
            3864339955,
            2857741204,
            1464375394,
            1676153920,
            1439316330,
            715854006,
            3033291828,
            289532110,
            2706671279,
            2087905683,
            3018724369,
            1668267050,
            732546397,
            1947742710,
            3462151702,
            2609353502,
            2950085171,
            1814351708,
            2050118529,
            680887927,
            999245976,
            1800124847,
            3300911131,
            1713906067,
            1641548236,
            4213287313,
            1216130144,
            1575780402,
            4018429277,
            3917837745,
            3693486850,
            3949271944,
            596196993,
            3549867205,
            258830323,
            2213823033,
            772490370,
            2760122372,
            1774776394,
            2652871518,
            566650946,
            4142492826,
            1728879713,
            2882767088,
            1783734482,
            3629395816,
            2517608232,
            2874225571,
            1861159788,
            326777828,
            3124490320,
            2130389656,
            2716951837,
            967770486,
            1724537150,
            2185432712,
            2364442137,
            1164943284,
            2105845187,
            998989502,
            3765401048,
            2244026483,
            1075463327,
            1455516326,
            1322494562,
            910128902,
            469688178,
            1117454909,
            936433444,
            3490320968,
            3675253459,
            1240580251,
            122909385,
            2157517691,
            634681816,
            4142456567,
            3825094682,
            3061402683,
            2540495037,
            79693498,
            3249098678,
            1084186820,
            1583128258,
            426386531,
            1761308591,
            1047286709,
            322548459,
            995290223,
            1845252383,
            2603652396,
            3431023940,
            2942221577,
            3202600964,
            3727903485,
            1712269319,
            422464435,
            3234572375,
            1170764815,
            3523960633,
            3117677531,
            1434042557,
            442511882,
            3600875718,
            1076654713,
            1738483198,
            4213154764,
            2393238008,
            3677496056,
            1014306527,
            4251020053,
            793779912,
            2902807211,
            842905082,
            4246964064,
            1395751752,
            1040244610,
            2656851899,
            3396308128,
            445077038,
            3742853595,
            3577915638,
            679411651,
            2892444358,
            2354009459,
            1767581616,
            3150600392,
            3791627101,
            3102740896,
            284835224,
            4246832056,
            1258075500,
            768725851,
            2589189241,
            3069724005,
            3532540348,
            1274779536,
            3789419226,
            2764799539,
            1660621633,
            3471099624,
            4011903706,
            913787905,
            3497959166,
            737222580,
            2514213453,
            2928710040,
            3937242737,
            1804850592,
            3499020752,
            2949064160,
            2386320175,
            2390070455,
            2415321851,
            4061277028,
            2290661394,
            2416832540,
            1336762016,
            1754252060,
            3520065937,
            3014181293,
            791618072,
            3188594551,
            3933548030,
            2332172193,
            3852520463,
            3043980520,
            413987798,
            3465142937,
            3030929376,
            4245938359,
            2093235073,
            3534596313,
            375366246,
            2157278981,
            2479649556,
            555357303,
            3870105701,
            2008414854,
            3344188149,
            4221384143,
            3956125452,
            2067696032,
            3594591187,
            2921233993,
            2428461,
            544322398,
            577241275,
            1471733935,
            610547355,
            4027169054,
            1432588573,
            1507829418,
            2025931657,
            3646575487,
            545086370,
            48609733,
            2200306550,
            1653985193,
            298326376,
            1316178497,
            3007786442,
            2064951626,
            458293330,
            2589141269,
            3591329599,
            3164325604,
            727753846,
            2179363840,
            146436021,
            1461446943,
            4069977195,
            705550613,
            3059967265,
            3887724982,
            4281599278,
            3313849956,
            1404054877,
            2845806497,
            146425753,
            1854211946
          ],
          [
            1266315497,
            3048417604,
            3681880366,
            3289982499,
            290971e4,
            1235738493,
            2632868024,
            2414719590,
            3970600049,
            1771706367,
            1449415276,
            3266420449,
            422970021,
            1963543593,
            2690192192,
            3826793022,
            1062508698,
            1531092325,
            1804592342,
            2583117782,
            2714934279,
            4024971509,
            1294809318,
            4028980673,
            1289560198,
            2221992742,
            1669523910,
            35572830,
            157838143,
            1052438473,
            1016535060,
            1802137761,
            1753167236,
            1386275462,
            3080475397,
            2857371447,
            1040679964,
            2145300060,
            2390574316,
            1461121720,
            2956646967,
            4031777805,
            4028374788,
            33600511,
            2920084762,
            1018524850,
            629373528,
            3691585981,
            3515945977,
            2091462646,
            2486323059,
            586499841,
            988145025,
            935516892,
            3367335476,
            2599673255,
            2839830854,
            265290510,
            3972581182,
            2759138881,
            3795373465,
            1005194799,
            847297441,
            406762289,
            1314163512,
            1332590856,
            1866599683,
            4127851711,
            750260880,
            613907577,
            1450815602,
            3165620655,
            3734664991,
            3650291728,
            3012275730,
            3704569646,
            1427272223,
            778793252,
            1343938022,
            2676280711,
            2052605720,
            1946737175,
            3164576444,
            3914038668,
            3967478842,
            3682934266,
            1661551462,
            3294938066,
            4011595847,
            840292616,
            3712170807,
            616741398,
            312560963,
            711312465,
            1351876610,
            322626781,
            1910503582,
            271666773,
            2175563734,
            1594956187,
            70604529,
            3617834859,
            1007753275,
            1495573769,
            4069517037,
            2549218298,
            2663038764,
            504708206,
            2263041392,
            3941167025,
            2249088522,
            1514023603,
            1998579484,
            1312622330,
            694541497,
            2582060303,
            2151582166,
            1382467621,
            776784248,
            2618340202,
            3323268794,
            2497899128,
            2784771155,
            503983604,
            4076293799,
            907881277,
            423175695,
            432175456,
            1378068232,
            4145222326,
            3954048622,
            3938656102,
            3820766613,
            2793130115,
            2977904593,
            26017576,
            3274890735,
            3194772133,
            1700274565,
            1756076034,
            4006520079,
            3677328699,
            720338349,
            1533947780,
            354530856,
            688349552,
            3973924725,
            1637815568,
            332179504,
            3949051286,
            53804574,
            2852348879,
            3044236432,
            1282449977,
            3583942155,
            3416972820,
            4006381244,
            1617046695,
            2628476075,
            3002303598,
            1686838959,
            431878346,
            2686675385,
            1700445008,
            1080580658,
            1009431731,
            832498133,
            3223435511,
            2605976345,
            2271191193,
            2516031870,
            1648197032,
            4164389018,
            2548247927,
            300782431,
            375919233,
            238389289,
            3353747414,
            2531188641,
            2019080857,
            1475708069,
            455242339,
            2609103871,
            448939670,
            3451063019,
            1395535956,
            2413381860,
            1841049896,
            1491858159,
            885456874,
            4264095073,
            4001119347,
            1565136089,
            3898914787,
            1108368660,
            540939232,
            1173283510,
            2745871338,
            3681308437,
            4207628240,
            3343053890,
            4016749493,
            1699691293,
            1103962373,
            3625875870,
            2256883143,
            3830138730,
            1031889488,
            3479347698,
            1535977030,
            4236805024,
            3251091107,
            2132092099,
            1774941330,
            1199868427,
            1452454533,
            157007616,
            2904115357,
            342012276,
            595725824,
            1480756522,
            206960106,
            497939518,
            591360097,
            863170706,
            2375253569,
            3596610801,
            1814182875,
            2094937945,
            3421402208,
            1082520231,
            3463918190,
            2785509508,
            435703966,
            3908032597,
            1641649973,
            2842273706,
            3305899714,
            1510255612,
            2148256476,
            2655287854,
            3276092548,
            4258621189,
            236887753,
            3681803219,
            274041037,
            1734335097,
            3815195456,
            3317970021,
            1899903192,
            1026095262,
            4050517792,
            356393447,
            2410691914,
            3873677099,
            3682840055
          ],
          [
            3913112168,
            2491498743,
            4132185628,
            2489919796,
            1091903735,
            1979897079,
            3170134830,
            3567386728,
            3557303409,
            857797738,
            1136121015,
            1342202287,
            507115054,
            2535736646,
            337727348,
            3213592640,
            1301675037,
            2528481711,
            1895095763,
            1721773893,
            3216771564,
            62756741,
            2142006736,
            835421444,
            2531993523,
            1442658625,
            3659876326,
            2882144922,
            676362277,
            1392781812,
            170690266,
            3921047035,
            1759253602,
            3611846912,
            1745797284,
            664899054,
            1329594018,
            3901205900,
            3045908486,
            2062866102,
            2865634940,
            3543621612,
            3464012697,
            1080764994,
            553557557,
            3656615353,
            3996768171,
            991055499,
            499776247,
            1265440854,
            648242737,
            3940784050,
            980351604,
            3713745714,
            1749149687,
            3396870395,
            4211799374,
            3640570775,
            1161844396,
            3125318951,
            1431517754,
            545492359,
            4268468663,
            3499529547,
            1437099964,
            2702547544,
            3433638243,
            2581715763,
            2787789398,
            1060185593,
            1593081372,
            2418618748,
            4260947970,
            69676912,
            2159744348,
            86519011,
            2512459080,
            3838209314,
            1220612927,
            3339683548,
            133810670,
            1090789135,
            1078426020,
            1569222167,
            845107691,
            3583754449,
            4072456591,
            1091646820,
            628848692,
            1613405280,
            3757631651,
            526609435,
            236106946,
            48312990,
            2942717905,
            3402727701,
            1797494240,
            859738849,
            992217954,
            4005476642,
            2243076622,
            3870952857,
            3732016268,
            765654824,
            3490871365,
            2511836413,
            1685915746,
            3888969200,
            1414112111,
            2273134842,
            3281911079,
            4080962846,
            172450625,
            2569994100,
            980381355,
            4109958455,
            2819808352,
            2716589560,
            2568741196,
            3681446669,
            3329971472,
            1835478071,
            660984891,
            3704678404,
            4045999559,
            3422617507,
            3040415634,
            1762651403,
            1719377915,
            3470491036,
            2693910283,
            3642056355,
            3138596744,
            1364962596,
            2073328063,
            1983633131,
            926494387,
            3423689081,
            2150032023,
            4096667949,
            1749200295,
            3328846651,
            309677260,
            2016342300,
            1779581495,
            3079819751,
            111262694,
            1274766160,
            443224088,
            298511866,
            1025883608,
            3806446537,
            1145181785,
            168956806,
            3641502830,
            3584813610,
            1689216846,
            3666258015,
            3200248200,
            1692713982,
            2646376535,
            4042768518,
            1618508792,
            1610833997,
            3523052358,
            4130873264,
            2001055236,
            3610705100,
            2202168115,
            4028541809,
            2961195399,
            1006657119,
            2006996926,
            3186142756,
            1430667929,
            3210227297,
            1314452623,
            4074634658,
            4101304120,
            2273951170,
            1399257539,
            3367210612,
            3027628629,
            1190975929,
            2062231137,
            2333990788,
            2221543033,
            2438960610,
            1181637006,
            548689776,
            2362791313,
            3372408396,
            3104550113,
            3145860560,
            296247880,
            1970579870,
            3078560182,
            3769228297,
            1714227617,
            3291629107,
            3898220290,
            166772364,
            1251581989,
            493813264,
            448347421,
            195405023,
            2709975567,
            677966185,
            3703036547,
            1463355134,
            2715995803,
            1338867538,
            1343315457,
            2802222074,
            2684532164,
            233230375,
            2599980071,
            2000651841,
            3277868038,
            1638401717,
            4028070440,
            3237316320,
            6314154,
            819756386,
            300326615,
            590932579,
            1405279636,
            3267499572,
            3150704214,
            2428286686,
            3959192993,
            3461946742,
            1862657033,
            1266418056,
            963775037,
            2089974820,
            2263052895,
            1917689273,
            448879540,
            3550394620,
            3981727096,
            150775221,
            3627908307,
            1303187396,
            508620638,
            2975983352,
            2726630617,
            1817252668,
            1876281319,
            1457606340,
            908771278,
            3720792119,
            3617206836,
            2455994898,
            1729034894,
            1080033504
          ],
          [
            976866871,
            3556439503,
            2881648439,
            1522871579,
            1555064734,
            1336096578,
            3548522304,
            2579274686,
            3574697629,
            3205460757,
            3593280638,
            3338716283,
            3079412587,
            564236357,
            2993598910,
            1781952180,
            1464380207,
            3163844217,
            3332601554,
            1699332808,
            1393555694,
            1183702653,
            3581086237,
            1288719814,
            691649499,
            2847557200,
            2895455976,
            3193889540,
            2717570544,
            1781354906,
            1676643554,
            2592534050,
            3230253752,
            1126444790,
            2770207658,
            2633158820,
            2210423226,
            2615765581,
            2414155088,
            3127139286,
            673620729,
            2805611233,
            1269405062,
            4015350505,
            3341807571,
            4149409754,
            1057255273,
            2012875353,
            2162469141,
            2276492801,
            2601117357,
            993977747,
            3918593370,
            2654263191,
            753973209,
            36408145,
            2530585658,
            25011837,
            3520020182,
            2088578344,
            530523599,
            2918365339,
            1524020338,
            1518925132,
            3760827505,
            3759777254,
            1202760957,
            3985898139,
            3906192525,
            674977740,
            4174734889,
            2031300136,
            2019492241,
            3983892565,
            4153806404,
            3822280332,
            352677332,
            2297720250,
            60907813,
            90501309,
            3286998549,
            1016092578,
            2535922412,
            2839152426,
            457141659,
            509813237,
            4120667899,
            652014361,
            1966332200,
            2975202805,
            55981186,
            2327461051,
            676427537,
            3255491064,
            2882294119,
            3433927263,
            1307055953,
            942726286,
            933058658,
            2468411793,
            3933900994,
            4215176142,
            1361170020,
            2001714738,
            2830558078,
            3274259782,
            1222529897,
            1679025792,
            2729314320,
            3714953764,
            1770335741,
            151462246,
            3013232138,
            1682292957,
            1483529935,
            471910574,
            1539241949,
            458788160,
            3436315007,
            1807016891,
            3718408830,
            978976581,
            1043663428,
            3165965781,
            1927990952,
            4200891579,
            2372276910,
            3208408903,
            3533431907,
            1412390302,
            2931980059,
            4132332400,
            1947078029,
            3881505623,
            4168226417,
            2941484381,
            1077988104,
            1320477388,
            886195818,
            18198404,
            3786409e3,
            2509781533,
            112762804,
            3463356488,
            1866414978,
            891333506,
            18488651,
            661792760,
            1628790961,
            3885187036,
            3141171499,
            876946877,
            2693282273,
            1372485963,
            791857591,
            2686433993,
            3759982718,
            3167212022,
            3472953795,
            2716379847,
            445679433,
            3561995674,
            3504004811,
            3574258232,
            54117162,
            3331405415,
            2381918588,
            3769707343,
            4154350007,
            1140177722,
            4074052095,
            668550556,
            3214352940,
            367459370,
            261225585,
            2610173221,
            4209349473,
            3468074219,
            3265815641,
            314222801,
            3066103646,
            3808782860,
            282218597,
            3406013506,
            3773591054,
            379116347,
            1285071038,
            846784868,
            2669647154,
            3771962079,
            3550491691,
            2305946142,
            453669953,
            1268987020,
            3317592352,
            3279303384,
            3744833421,
            2610507566,
            3859509063,
            266596637,
            3847019092,
            517658769,
            3462560207,
            3443424879,
            370717030,
            4247526661,
            2224018117,
            4143653529,
            4112773975,
            2788324899,
            2477274417,
            1456262402,
            2901442914,
            1517677493,
            1846949527,
            2295493580,
            3734397586,
            2176403920,
            1280348187,
            1908823572,
            3871786941,
            846861322,
            1172426758,
            3287448474,
            3383383037,
            1655181056,
            3139813346,
            901632758,
            1897031941,
            2986607138,
            3066810236,
            3447102507,
            1393639104,
            373351379,
            950779232,
            625454576,
            3124240540,
            4148612726,
            2007998917,
            544563296,
            2244738638,
            2330496472,
            2058025392,
            1291430526,
            424198748,
            50039436,
            29584100,
            3605783033,
            2429876329,
            2791104160,
            1057563949,
            3255363231,
            3075367218,
            3463963227,
            1469046755,
            985887462
          ]
        ];
        var BLOWFISH_CTX = {
          pbox: [],
          sbox: []
        };
        function F(ctx, x) {
          let a = x >> 24 & 255;
          let b = x >> 16 & 255;
          let c = x >> 8 & 255;
          let d = x & 255;
          let y = ctx.sbox[0][a] + ctx.sbox[1][b];
          y = y ^ ctx.sbox[2][c];
          y = y + ctx.sbox[3][d];
          return y;
        }
        function BlowFish_Encrypt(ctx, left, right) {
          let Xl = left;
          let Xr = right;
          let temp;
          for (let i = 0; i < N; ++i) {
            Xl = Xl ^ ctx.pbox[i];
            Xr = F(ctx, Xl) ^ Xr;
            temp = Xl;
            Xl = Xr;
            Xr = temp;
          }
          temp = Xl;
          Xl = Xr;
          Xr = temp;
          Xr = Xr ^ ctx.pbox[N];
          Xl = Xl ^ ctx.pbox[N + 1];
          return { left: Xl, right: Xr };
        }
        function BlowFish_Decrypt(ctx, left, right) {
          let Xl = left;
          let Xr = right;
          let temp;
          for (let i = N + 1; i > 1; --i) {
            Xl = Xl ^ ctx.pbox[i];
            Xr = F(ctx, Xl) ^ Xr;
            temp = Xl;
            Xl = Xr;
            Xr = temp;
          }
          temp = Xl;
          Xl = Xr;
          Xr = temp;
          Xr = Xr ^ ctx.pbox[1];
          Xl = Xl ^ ctx.pbox[0];
          return { left: Xl, right: Xr };
        }
        function BlowFishInit(ctx, key, keysize) {
          for (let Row = 0; Row < 4; Row++) {
            ctx.sbox[Row] = [];
            for (let Col = 0; Col < 256; Col++) {
              ctx.sbox[Row][Col] = ORIG_S[Row][Col];
            }
          }
          let keyIndex = 0;
          for (let index = 0; index < N + 2; index++) {
            ctx.pbox[index] = ORIG_P[index] ^ key[keyIndex];
            keyIndex++;
            if (keyIndex >= keysize) {
              keyIndex = 0;
            }
          }
          let Data1 = 0;
          let Data2 = 0;
          let res = 0;
          for (let i = 0; i < N + 2; i += 2) {
            res = BlowFish_Encrypt(ctx, Data1, Data2);
            Data1 = res.left;
            Data2 = res.right;
            ctx.pbox[i] = Data1;
            ctx.pbox[i + 1] = Data2;
          }
          for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 256; j += 2) {
              res = BlowFish_Encrypt(ctx, Data1, Data2);
              Data1 = res.left;
              Data2 = res.right;
              ctx.sbox[i][j] = Data1;
              ctx.sbox[i][j + 1] = Data2;
            }
          }
          return true;
        }
        var Blowfish = C_algo.Blowfish = BlockCipher.extend({
          _doReset: function() {
            if (this._keyPriorReset === this._key) {
              return;
            }
            var key = this._keyPriorReset = this._key;
            var keyWords = key.words;
            var keySize = key.sigBytes / 4;
            BlowFishInit(BLOWFISH_CTX, keyWords, keySize);
          },
          encryptBlock: function(M, offset) {
            var res = BlowFish_Encrypt(BLOWFISH_CTX, M[offset], M[offset + 1]);
            M[offset] = res.left;
            M[offset + 1] = res.right;
          },
          decryptBlock: function(M, offset) {
            var res = BlowFish_Decrypt(BLOWFISH_CTX, M[offset], M[offset + 1]);
            M[offset] = res.left;
            M[offset + 1] = res.right;
          },
          blockSize: 64 / 32,
          keySize: 128 / 32,
          ivSize: 64 / 32
        });
        C.Blowfish = BlockCipher._createHelper(Blowfish);
      })();
      return CryptoJS2.Blowfish;
    });
  }
});

// node_modules/crypto-js/index.js
var require_crypto_js = __commonJS({
  "node_modules/crypto-js/index.js"(exports, module) {
    (function(root, factory, undef) {
      if (typeof exports === "object") {
        module.exports = exports = factory(require_core(), require_x64_core(), require_lib_typedarrays(), require_enc_utf16(), require_enc_base64(), require_enc_base64url(), require_md5(), require_sha1(), require_sha256(), require_sha224(), require_sha512(), require_sha384(), require_sha3(), require_ripemd160(), require_hmac(), require_pbkdf2(), require_evpkdf(), require_cipher_core(), require_mode_cfb(), require_mode_ctr(), require_mode_ctr_gladman(), require_mode_ofb(), require_mode_ecb(), require_pad_ansix923(), require_pad_iso10126(), require_pad_iso97971(), require_pad_zeropadding(), require_pad_nopadding(), require_format_hex(), require_aes(), require_tripledes(), require_rc4(), require_rabbit(), require_rabbit_legacy(), require_blowfish());
      } else if (typeof define === "function" && define.amd) {
        define(["./core", "./x64-core", "./lib-typedarrays", "./enc-utf16", "./enc-base64", "./enc-base64url", "./md5", "./sha1", "./sha256", "./sha224", "./sha512", "./sha384", "./sha3", "./ripemd160", "./hmac", "./pbkdf2", "./evpkdf", "./cipher-core", "./mode-cfb", "./mode-ctr", "./mode-ctr-gladman", "./mode-ofb", "./mode-ecb", "./pad-ansix923", "./pad-iso10126", "./pad-iso97971", "./pad-zeropadding", "./pad-nopadding", "./format-hex", "./aes", "./tripledes", "./rc4", "./rabbit", "./rabbit-legacy", "./blowfish"], factory);
      } else {
        root.CryptoJS = factory(root.CryptoJS);
      }
    })(exports, function(CryptoJS2) {
      return CryptoJS2;
    });
  }
});

// src/sdk/bitcodec.ts
function hexToBytes(hex) {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error("Invalid hex character");
    }
    out[i] = byte;
  }
  return out;
}
function bytesToHex(bytes, upper = true) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return upper ? out.toUpperCase() : out;
}
var PackedBitReader = class {
  data;
  offset = 0;
  constructor(data) {
    this.data = data;
  }
  read(count) {
    if (count < 0 || this.offset + count > this.data.length * 8) {
      throw new Error("truncated packed bit field");
    }
    let value = 0;
    for (let i = 0; i < count; i++) {
      const absolute = this.offset;
      this.offset += 1;
      const bit = this.data[Math.floor(absolute / 8)] >> 7 - absolute % 8 & 1;
      value = value * 2 + bit;
    }
    return value;
  }
  readBigInt(count) {
    if (count < 0 || this.offset + count > this.data.length * 8) {
      throw new Error("truncated packed bit field");
    }
    let value = 0n;
    for (let i = 0; i < count; i++) {
      const absolute = this.offset;
      this.offset += 1;
      const bit = BigInt(this.data[Math.floor(absolute / 8)] >> 7 - absolute % 8 & 1);
      value = value << 1n | bit;
    }
    return value;
  }
  readBool() {
    return this.read(1) === 1;
  }
  readString(minimum, maximum) {
    const span = maximum - minimum;
    const lengthBits = span > 0 ? Math.ceil(Math.log2(span + 1)) : 0;
    const length = minimum + (span > 0 ? this.read(lengthBits) : 0);
    let out = "";
    for (let i = 0; i < length; i++) {
      out += String.fromCharCode(this.read(7));
    }
    return out;
  }
  readNumericString(minimum, maximum) {
    const alphabet = " 0123456789";
    const span = maximum - minimum;
    const lengthBits = span > 0 ? Math.ceil(Math.log2(span + 1)) : 0;
    const length = minimum + (span > 0 ? this.read(lengthBits) : 0);
    let out = "";
    for (let i = 0; i < length; i++) {
      const idx = this.read(4);
      if (idx >= alphabet.length) {
        throw new Error("Invalid NumericString character index");
      }
      out += alphabet[idx];
    }
    return out;
  }
  readOctetString(minimum, maximum) {
    const span = maximum - minimum;
    const lengthBits = span > 0 ? Math.ceil(Math.log2(span + 1)) : 0;
    const length = minimum + (span > 0 ? this.read(lengthBits) : 0);
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      out[i] = this.read(8);
    }
    return out;
  }
  readConstrainedInt(min, max) {
    const span = max - min;
    if (span === 0) return min;
    const bits = Math.ceil(Math.log2(span + 1));
    const offsetVal = this.read(bits);
    const result = min + offsetVal;
    if (result > max) {
      throw new Error(`Decoded integer ${result} exceeds max ${max}`);
    }
    return result;
  }
  readConstrainedBigInt(min, max) {
    const span = max - min;
    if (span === 0n) return Number(min);
    let bits = 0;
    let temp = span;
    while (temp > 0n) {
      bits++;
      temp >>= 1n;
    }
    const offsetVal = this.readBigInt(bits);
    const result = min + offsetVal;
    if (result > max) {
      throw new Error(`Decoded bigint ${result} exceeds max ${max}`);
    }
    return Number(result);
  }
};
var PackedBitWriter = class {
  bits = [];
  write(value, count) {
    if (count === 0) return;
    if (value < 0 || count < 31 && value >= 1 << count || count >= 31 && value >= Math.pow(2, count)) {
      throw new Error("bit value out of range");
    }
    for (let shift = count - 1; shift >= 0; shift--) {
      const bit = Math.floor(value / Math.pow(2, shift)) & 1;
      this.bits.push(bit);
    }
  }
  writeBigInt(value, count) {
    if (count === 0) return;
    if (value < 0n || value >= 1n << BigInt(count)) {
      throw new Error("bigint bit value out of range");
    }
    for (let shift = count - 1; shift >= 0; shift--) {
      this.bits.push(Number(value >> BigInt(shift) & 1n));
    }
  }
  writeBool(value) {
    this.bits.push(value ? 1 : 0);
  }
  writeString(value, minimum, maximum) {
    const span = maximum - minimum;
    if (value.length < minimum || value.length > maximum) {
      throw new Error(`string length ${value.length} out of range [${minimum}..${maximum}]`);
    }
    if (span > 0) {
      this.write(value.length - minimum, Math.ceil(Math.log2(span + 1)));
    }
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code > 127) {
        throw new Error("IA5String character out of range");
      }
      this.write(code, 7);
    }
  }
  writeNumericString(value, minimum, maximum) {
    const alphabet = " 0123456789";
    const span = maximum - minimum;
    if (value.length < minimum || value.length > maximum) {
      throw new Error(`numeric string length ${value.length} out of range [${minimum}..${maximum}]`);
    }
    if (span > 0) {
      this.write(value.length - minimum, Math.ceil(Math.log2(span + 1)));
    }
    for (let i = 0; i < value.length; i++) {
      const idx = alphabet.indexOf(value[i]);
      if (idx === -1) {
        throw new Error(`Invalid NumericString char: ${value[i]}`);
      }
      this.write(idx, 4);
    }
  }
  writeOctetString(value, minimum, maximum) {
    const span = maximum - minimum;
    if (value.length < minimum || value.length > maximum) {
      throw new Error(`octet string length ${value.length} out of range [${minimum}..${maximum}]`);
    }
    if (span > 0) {
      this.write(value.length - minimum, Math.ceil(Math.log2(span + 1)));
    }
    for (let i = 0; i < value.length; i++) {
      this.write(value[i], 8);
    }
  }
  writeConstrainedInt(value, min, max) {
    if (value < min || value > max) {
      throw new Error(`Integer ${value} out of constrained range [${min}..${max}]`);
    }
    const span = max - min;
    if (span === 0) return;
    const bits = Math.ceil(Math.log2(span + 1));
    this.write(value - min, bits);
  }
  writeConstrainedBigInt(value, min, max) {
    if (value < min || value > max) {
      throw new Error(`BigInt ${value} out of constrained range [${min}..${max}]`);
    }
    const span = max - min;
    if (span === 0n) return;
    let bits = 0;
    let temp = span;
    while (temp > 0n) {
      bits++;
      temp >>= 1n;
    }
    this.writeBigInt(value - min, bits);
  }
  bytes() {
    const byteCount = Math.ceil(this.bits.length / 8);
    const out = new Uint8Array(byteCount);
    for (let start = 0; start < this.bits.length; start += 8) {
      let val = 0;
      const chunkLen = Math.min(8, this.bits.length - start);
      for (let i = 0; i < chunkLen; i++) {
        val = val << 1 | this.bits[start + i];
      }
      out[start / 8] = val << 8 - chunkLen;
    }
    return out;
  }
};
function setMsbBits(buf, offset, count, value) {
  if (value < 0 || count < 31 && value >= 1 << count || count >= 31 && value >= Math.pow(2, count)) {
    throw new Error("bit value out of range");
  }
  for (let idx = 0; idx < count; idx++) {
    const absolute = offset + idx;
    const mask = 1 << 7 - absolute % 8;
    const shift = count - 1 - idx;
    const bit = Math.floor(value / Math.pow(2, shift)) & 1;
    if (bit === 1) {
      buf[Math.floor(absolute / 8)] |= mask;
    } else {
      buf[Math.floor(absolute / 8)] &= ~mask;
    }
  }
}
function setFixed7Bit(buf, offset, value) {
  for (let idx = 0; idx < value.length; idx++) {
    setMsbBits(buf, offset + idx * 7, 7, value.charCodeAt(idx));
  }
}
function readMsbBits(buf, offset, count) {
  if (offset < 0 || count < 0 || offset + count > buf.length * 8) {
    throw new Error("truncated fixed bit field");
  }
  let value = 0;
  for (let idx = 0; idx < count; idx++) {
    const absolute = offset + idx;
    const bit = buf[Math.floor(absolute / 8)] >> 7 - absolute % 8 & 1;
    value = value * 2 + bit;
  }
  return value;
}
function readFixed7Bit(buf, offset, count) {
  let out = "";
  for (let idx = 0; idx < count; idx++) {
    out += String.fromCharCode(readMsbBits(buf, offset + idx * 7, 7));
  }
  return out;
}

// src/sdk/asn1-uper.ts
function encodeFields(writer, fields, obj) {
  for (const field of fields) {
    if (field.optional) {
      const present = obj[field.name] !== void 0 && obj[field.name] !== null;
      writer.writeBool(present);
    }
  }
  for (const field of fields) {
    const val = obj[field.name];
    if (field.optional && (val === void 0 || val === null)) {
      continue;
    }
    if (val === void 0 || val === null) {
      throw new Error(`Missing mandatory ASN.1 field: ${field.name}`);
    }
    encodeFieldValue(writer, field, val);
  }
}
function encodeFieldValue(writer, field, val) {
  switch (field.type) {
    case "int":
      writer.writeConstrainedInt(Number(val), field.min, field.max);
      break;
    case "bigint":
      writer.writeConstrainedBigInt(BigInt(val), field.min, field.max);
      break;
    case "bool":
      writer.writeBool(Boolean(val));
      break;
    case "ia5":
      writer.writeString(String(val), field.min, field.max);
      break;
    case "numeric":
      writer.writeNumericString(String(val), field.min, field.max);
      break;
    case "octet": {
      const bytes = val instanceof Uint8Array ? val : new Uint8Array(val);
      writer.writeOctetString(bytes, field.min, field.max);
      break;
    }
    case "enum": {
      const idx = typeof val === "number" ? val : field.values.indexOf(String(val));
      if (idx < 0 || idx >= field.values.length) {
        throw new Error(`Invalid enum value ${val} for ${field.name}`);
      }
      writer.writeConstrainedInt(idx, 0, field.values.length - 1);
      break;
    }
    case "seq":
      encodeFields(writer, field.fields, val);
      break;
    case "seqof": {
      if (!Array.isArray(val)) {
        throw new Error(`Expected array for SEQUENCE OF ${field.name}`);
      }
      writer.writeConstrainedInt(val.length, field.min, field.max);
      for (const item of val) {
        encodeFields(writer, field.itemFields, item);
      }
      break;
    }
  }
}
function decodeFields(reader, fields) {
  const presentMap = /* @__PURE__ */ new Map();
  for (const field of fields) {
    if (field.optional) {
      presentMap.set(field.name, reader.readBool());
    }
  }
  const out = {};
  for (const field of fields) {
    if (field.optional && !presentMap.get(field.name)) {
      continue;
    }
    out[field.name] = decodeFieldValue(reader, field);
  }
  return out;
}
function decodeFieldValue(reader, field) {
  switch (field.type) {
    case "int":
      return reader.readConstrainedInt(field.min, field.max);
    case "bigint":
      return reader.readConstrainedBigInt(field.min, field.max);
    case "bool":
      return reader.readBool();
    case "ia5":
      return reader.readString(field.min, field.max);
    case "numeric":
      return reader.readNumericString(field.min, field.max);
    case "octet":
      return reader.readOctetString(field.min, field.max);
    case "enum": {
      const idx = reader.readConstrainedInt(0, field.values.length - 1);
      return field.values[idx];
    }
    case "seq":
      return decodeFields(reader, field.fields);
    case "seqof": {
      const count = reader.readConstrainedInt(field.min, field.max);
      const list = [];
      for (let i = 0; i < count; i++) {
        list.push(decodeFields(reader, field.itemFields));
      }
      return list;
    }
  }
}
var DataEncodingTypeValues = ["perUnaligned", "der", "ber"];
var GPSStatusValues = ["noGpsSignal", "timeFix", "fix2D", "fix3D"];
var LanguageTypeValues = ["simplifiedChinese", "english", "spanish", "arabic", "hindi"];
var MPDispatcherBodySchema = [
  { name: "uid", optional: true, type: "ia5", min: 50, max: 50 },
  { name: "token", optional: true, type: "ia5", min: 40, max: 40 },
  { name: "applicationID", type: "ia5", min: 3, max: 3 },
  { name: "vin", optional: true, type: "ia5", min: 17, max: 17 },
  { name: "messageID", type: "int", min: 0, max: 255 },
  { name: "eventCreationTime", type: "int", min: 0, max: 2147483647 },
  { name: "eventID", optional: true, type: "int", min: 0, max: 2147483647 },
  { name: "ulMessageCounter", optional: true, type: "int", min: 0, max: 65535 },
  { name: "dlMessageCounter", optional: true, type: "int", min: 0, max: 65535 },
  { name: "ackMessageCounter", optional: true, type: "int", min: 0, max: 65535 },
  { name: "ackRequired", optional: true, type: "bool" },
  { name: "applicationDataLength", optional: true, type: "int", min: 0, max: 65535 },
  { name: "applicationDataEncoding", optional: true, type: "enum", values: DataEncodingTypeValues },
  { name: "applicationDataProtocolVersion", optional: true, type: "int", min: 0, max: 65535 },
  { name: "testFlag", optional: true, type: "int", min: 1, max: 3 },
  { name: "result", optional: true, type: "int", min: 0, max: 65535 },
  { name: "errorMessage", optional: true, type: "octet", min: 1, max: 1024 }
];
var OTARVMVehicleStatusReqSchema = [
  { name: "vehStatusReqType", type: "int", min: 0, max: 255 }
];
var RvcReqParamSchema = [
  { name: "paramId", type: "int", min: 0, max: 65535 },
  { name: "paramValue", type: "octet", min: 1, max: 255 }
];
var OTARVCReqSchema = [
  { name: "rvcReqType", type: "octet", min: 1, max: 1 },
  { name: "rvcParams", optional: true, type: "seqof", min: 1, max: 10, itemFields: RvcReqParamSchema }
];
var RvsWGS84PointSchema = [
  { name: "latitude", type: "int", min: -9e7, max: 9e7 },
  { name: "longitude", type: "int", min: -18e7, max: 18e7 },
  { name: "altitude", type: "int", min: -100, max: 8900 }
];
var RvsWayPointSchema = [
  { name: "position", type: "seq", fields: RvsWGS84PointSchema },
  { name: "heading", type: "int", min: 0, max: 359 },
  { name: "speed", type: "int", min: -1e3, max: 4500 },
  { name: "hdop", type: "int", min: 0, max: 1e3 },
  { name: "satellites", type: "int", min: 0, max: 16 }
];
var Timestamp4ShortSchema = [
  { name: "seconds", type: "int", min: 0, max: 2147483647 }
];
var RvsPositionSchema = [
  { name: "wayPoint", type: "seq", fields: RvsWayPointSchema },
  { name: "timestamp4Short", type: "seq", fields: Timestamp4ShortSchema },
  { name: "gpsStatus", type: "enum", values: GPSStatusValues }
];
var RvsBasicStatus513Schema = [
  { name: "driverDoor", type: "bool" },
  { name: "passengerDoor", type: "bool" },
  { name: "rearLeftDoor", type: "bool" },
  { name: "rearRightDoor", type: "bool" },
  { name: "bootStatus", type: "bool" },
  { name: "bonnetStatus", type: "bool" },
  { name: "lockStatus", type: "bool" },
  { name: "driverWindow", optional: true, type: "bool" },
  { name: "passengerWindow", optional: true, type: "bool" },
  { name: "rearLeftWindow", optional: true, type: "bool" },
  { name: "rearRightWindow", optional: true, type: "bool" },
  { name: "sunroofStatus", optional: true, type: "bool" },
  { name: "frontRrightTyrePressure", optional: true, type: "int", min: 0, max: 255 },
  { name: "frontLeftTyrePressure", optional: true, type: "int", min: 0, max: 255 },
  { name: "rearRightTyrePressure", optional: true, type: "int", min: 0, max: 255 },
  { name: "rearLeftTyrePressure", optional: true, type: "int", min: 0, max: 255 },
  { name: "wheelTyreMonitorStatus", optional: true, type: "int", min: 0, max: 255 },
  { name: "sideLightStatus", type: "bool" },
  { name: "dippedBeamStatus", type: "bool" },
  { name: "mainBeamStatus", type: "bool" },
  { name: "vehicleAlarmStatus", optional: true, type: "int", min: 0, max: 255 },
  { name: "engineStatus", type: "int", min: 0, max: 255 },
  { name: "powerMode", type: "int", min: 0, max: 255 },
  { name: "lastKeySeen", type: "int", min: 0, max: 65535 },
  { name: "currentJourneyDistance", type: "int", min: 0, max: 65535 },
  { name: "currentJourneyID", type: "int", min: 0, max: 2147483647 },
  { name: "interiorTemperature", type: "int", min: -128, max: 127 },
  { name: "exteriorTemperature", type: "int", min: -128, max: 127 },
  { name: "fuelLevelPrc", type: "int", min: 0, max: 255 },
  { name: "fuelRange", type: "int", min: 0, max: 65535 },
  { name: "remoteClimateStatus", type: "int", min: 0, max: 255 },
  { name: "frontLeftSeatHeatLevel", optional: true, type: "int", min: 0, max: 255 },
  { name: "frontRightSeatHeatLevel", optional: true, type: "int", min: 0, max: 255 },
  { name: "canBusActive", type: "bool" },
  { name: "timeOfLastCANBUSActivity", type: "int", min: 0, max: 2147483647 },
  { name: "clstrDspdFuelLvlSgmt", type: "int", min: 0, max: 255 },
  { name: "mileage", type: "int", min: 0, max: 2147483647 },
  { name: "batteryVoltage", type: "int", min: 0, max: 65535 },
  { name: "extendedData1", optional: true, type: "int", min: 0, max: 2147483647 },
  { name: "extendedData2", optional: true, type: "int", min: 0, max: 2147483647 },
  { name: "handBrake", type: "bool" }
];
var VehicleAlertInfoSchema = [
  { name: "id", type: "int", min: 0, max: 255 },
  { name: "value", type: "int", min: 0, max: 255 }
];
var RvsExtStatusSchema = [
  { name: "vehicleAlerts", type: "seqof", min: 0, max: 64, itemFields: VehicleAlertInfoSchema }
];
var OTARVMVehicleStatusResp513Schema = [
  { name: "statusTime", type: "int", min: 0, max: 2147483647 },
  { name: "gpsPosition", type: "seq", fields: RvsPositionSchema },
  { name: "basicVehicleStatus", type: "seq", fields: RvsBasicStatus513Schema },
  { name: "extendedVehicleStatus", optional: true, type: "seq", fields: RvsExtStatusSchema }
];
var OTARVCStatus513Schema = [
  { name: "rvcReqType", type: "octet", min: 1, max: 1 },
  { name: "rvcReqSts", type: "octet", min: 1, max: 1 },
  { name: "failureType", optional: true, type: "int", min: 0, max: 255 },
  { name: "gpsPosition", type: "seq", fields: RvsPositionSchema },
  { name: "basicVehicleStatus", type: "seq", fields: RvsBasicStatus513Schema }
];
var RvsChargingStatusSchema = [
  { name: "realtimePower", type: "int", min: 0, max: 65535 },
  { name: "powerLevelPrc", optional: true, type: "int", min: 0, max: 65535 },
  { name: "chargingState", type: "bool" },
  { name: "chargingGunState", type: "bool" },
  { name: "fuelRange", type: "int", min: 0, max: 65535 },
  { name: "chargingType", type: "int", min: 0, max: 255 },
  { name: "chargingTimeLevelPrc", optional: true, type: "int", min: 0, max: 65535 },
  { name: "startTime", optional: true, type: "int", min: 0, max: 2147483647 },
  { name: "endTime", optional: true, type: "int", min: 0, max: 2147483647 },
  { name: "chargingCurrent", type: "int", min: 0, max: 65535 },
  { name: "chargingVoltage", type: "int", min: 0, max: 65535 },
  { name: "chargingPileID", optional: true, type: "ia5", min: 0, max: 64 },
  { name: "chargingPileSupplier", optional: true, type: "ia5", min: 0, max: 64 },
  { name: "workingCurrent", optional: true, type: "int", min: 0, max: 65535 },
  { name: "workingVoltage", optional: true, type: "int", min: 0, max: 65535 },
  { name: "mileageSinceLastCharge", optional: true, type: "int", min: 0, max: 65535 },
  { name: "powerUsageSinceLastCharge", optional: true, type: "int", min: 0, max: 65535 },
  { name: "mileageOfDay", optional: true, type: "int", min: 0, max: 65535 },
  { name: "powerUsageOfDay", optional: true, type: "int", min: 0, max: 65535 },
  { name: "staticEnergyConsumption", optional: true, type: "int", min: 0, max: 65535 },
  { name: "chargingElectricityPhase", optional: true, type: "int", min: 0, max: 255 },
  { name: "chargingDuration", optional: true, type: "int", min: 0, max: 2147483647 },
  { name: "lastChargeEndingPower", optional: true, type: "int", min: 0, max: 65535 },
  { name: "totalBatteryCapacity", optional: true, type: "int", min: 0, max: 65535 },
  { name: "fotaLowestVoltage", optional: true, type: "int", min: 0, max: 255 },
  { name: "mileage", type: "int", min: 0, max: 2147483647 },
  { name: "extendedData1", optional: true, type: "int", min: 0, max: 2147483647 },
  { name: "extendedData2", optional: true, type: "int", min: 0, max: 2147483647 },
  { name: "extendedData3", optional: true, type: "ia5", min: 0, max: 1024 },
  { name: "extendedData4", optional: true, type: "ia5", min: 0, max: 1024 }
];
var OTARVMVehicleChargingStatusRespSchema = [
  { name: "statusTime", type: "int", min: 0, max: 2147483647 },
  { name: "gpsPosition", type: "seq", fields: RvsPositionSchema },
  { name: "vehicleChargingStatus", type: "seq", fields: RvsChargingStatusSchema }
];
var MessageCounterSchema = [
  { name: "uplinkCounter", type: "int", min: 0, max: 255 },
  { name: "downlinkCounter", type: "int", min: 0, max: 255 }
];
var BasicPositionSchema = [
  { name: "latitude", type: "int", min: -9e7, max: 9e7 },
  { name: "longitude", type: "int", min: -18e7, max: 18e7 }
];
var NetworkInfoSchema = [
  { name: "mccNetwork", type: "numeric", min: 3, max: 3 },
  { name: "mncNetwork", type: "numeric", min: 3, max: 3 },
  { name: "mccSim", type: "numeric", min: 3, max: 3 },
  { name: "mncSim", type: "numeric", min: 3, max: 3 },
  { name: "signalStrength", type: "int", min: 0, max: 99 }
];
var MPDispatcherBodyV11Schema = [
  { name: "uid", optional: true, type: "ia5", min: 50, max: 50 },
  { name: "token", optional: true, type: "ia5", min: 40, max: 40 },
  { name: "applicationID", type: "ia5", min: 3, max: 3 },
  { name: "vin", optional: true, type: "ia5", min: 17, max: 17 },
  { name: "eventCreationTime", type: "bigint", min: 0n, max: 4294967295n },
  { name: "eventID", optional: true, type: "bigint", min: 0n, max: 281474976710655n },
  { name: "messageID", type: "int", min: 0, max: 255 },
  { name: "messageCounter", optional: true, type: "seq", fields: MessageCounterSchema },
  { name: "ackRequired", optional: true, type: "bool" },
  { name: "statelessDispatcherMessage", optional: true, type: "bool" },
  { name: "crqmRequest", optional: true, type: "bool" },
  { name: "basicPosition", optional: true, type: "seq", fields: BasicPositionSchema },
  { name: "networkInfo", optional: true, type: "seq", fields: NetworkInfoSchema },
  { name: "simInfo", optional: true, type: "numeric", min: 19, max: 19 },
  { name: "hmiLanguage", optional: true, type: "enum", values: LanguageTypeValues },
  { name: "iccID", type: "numeric", min: 20, max: 20 },
  { name: "applicationDataLength", type: "bigint", min: 0n, max: 4294967295n },
  { name: "applicationDataEncoding", optional: true, type: "enum", values: DataEncodingTypeValues },
  { name: "applicationDataProtocolVersion", type: "int", min: 0, max: 65535 },
  { name: "testFlag", optional: true, type: "int", min: 1, max: 3 },
  { name: "result", optional: true, type: "int", min: 0, max: 65535 },
  { name: "errorMessage", optional: true, type: "octet", min: 1, max: 1024 }
];
var PINVerificationReqSchema = [
  { name: "pin", type: "ia5", min: 32, max: 32 }
];
var V21_TYPES = {
  MPDispatcherBody: MPDispatcherBodySchema,
  OTARVMVehicleStatusReq: OTARVMVehicleStatusReqSchema,
  OTARVCReq: OTARVCReqSchema,
  RvsPosition: RvsPositionSchema,
  OTARVMVehicleStatusResp513: OTARVMVehicleStatusResp513Schema,
  OTARVCStatus513: OTARVCStatus513Schema,
  OTARVMVehicleChargingStatusResp: OTARVMVehicleChargingStatusRespSchema
};
var V11_TYPES = {
  MPDispatcherBodyV11: MPDispatcherBodyV11Schema,
  PINVerificationReq: PINVerificationReqSchema
};
var codec21 = {
  encode(typeName, data) {
    const schema = V21_TYPES[typeName];
    if (!schema) throw new Error(`Unknown V21 ASN.1 type: ${typeName}`);
    const writer = new PackedBitWriter();
    encodeFields(writer, schema, data);
    return writer.bytes();
  },
  decode(typeName, bytes) {
    const schema = V21_TYPES[typeName];
    if (!schema) throw new Error(`Unknown V21 ASN.1 type: ${typeName}`);
    const reader = new PackedBitReader(bytes);
    return decodeFields(reader, schema);
  }
};
var codec11 = {
  encode(typeName, data) {
    const schema = V11_TYPES[typeName];
    if (!schema) throw new Error(`Unknown V11 ASN.1 type: ${typeName}`);
    const writer = new PackedBitWriter();
    encodeFields(writer, schema, data);
    return writer.bytes();
  },
  decode(typeName, bytes) {
    const schema = V11_TYPES[typeName];
    if (!schema) throw new Error(`Unknown V11 ASN.1 type: ${typeName}`);
    const reader = new PackedBitReader(bytes);
    return decodeFields(reader, schema);
  }
};

// src/sdk/crypto.ts
var import_crypto_js = __toESM(require_crypto_js(), 1);
var MgIndiaApiError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "MgIndiaApiError";
  }
};
var ChargingStatusUnavailable = class extends MgIndiaApiError {
  constructor(message = "Charging status was not available after polling") {
    super(message);
    this.name = "ChargingStatusUnavailable";
  }
};
var MgIndiaCommandIndeterminate = class extends MgIndiaApiError {
  constructor(message) {
    super(message);
    this.name = "MgIndiaCommandIndeterminate";
  }
};
var MgIndiaLoginRejected = class extends MgIndiaApiError {
  constructor(message) {
    super(message);
    this.name = "MgIndiaLoginRejected";
  }
};
function normalizePhone(phone) {
  let digits = (phone || "").replace(/\D/g, "");
  if (digits.length >= 10) {
    digits = digits.slice(-10);
  }
  if (digits.length !== 10) {
    throw new MgIndiaApiError("Use the 10 digit India mobile number");
  }
  return digits;
}
function makeDeviceId(phone) {
  const normalized = normalizePhone(phone);
  const seed = import_crypto_js.default.SHA256(`mg-ismart-india:${normalized}`).toString(import_crypto_js.default.enc.Hex);
  return (`haos-mg-ismart-india-${seed}` + "0".repeat(120)).slice(0, 103);
}
function md5Hex(value) {
  return import_crypto_js.default.MD5(value).toString(import_crypto_js.default.enc.Hex);
}
function tapSignature(body) {
  const half = Math.floor(body.length / 2);
  const key = md5Hex(body.slice(1, half));
  return import_crypto_js.default.HmacSHA256(body, key).toString(import_crypto_js.default.enc.Hex);
}
function gatewaySignature(path, timestamp, contentType = "application/json") {
  const part1 = md5Hex(path);
  const part2 = md5Hex(part1 + timestamp + "1" + contentType);
  const key = md5Hex(part2 + timestamp);
  return import_crypto_js.default.HmacSHA256(path + timestamp + "1" + contentType, key).toString(
    import_crypto_js.default.enc.Hex
  );
}
function hashControlPin2(pin) {
  if (!/^\d{4}$/.test(pin || "")) {
    throw new MgIndiaApiError("Control PIN must be exactly 4 digits");
  }
  return md5Hex(`${pin}00`).toUpperCase();
}
function decryptGatewayBody(encryptedHex, headers) {
  const timestamp = headers["APP-SEND-DATE"] || headers["app-send-date"] || "";
  const contentType = headers["ORIGINAL-CONTENT-TYPE"] || headers["original-content-type"] || "application/json";
  const keyHex = md5Hex(timestamp + "1" + contentType);
  const ivHex = md5Hex(timestamp);
  const key = import_crypto_js.default.enc.Hex.parse(keyHex);
  const iv = import_crypto_js.default.enc.Hex.parse(ivHex);
  const ciphertext = import_crypto_js.default.enc.Hex.parse(encryptedHex.trim());
  const cipherParams = import_crypto_js.default.lib.CipherParams.create({ ciphertext });
  const decrypted = import_crypto_js.default.AES.decrypt(cipherParams, key, {
    iv,
    mode: import_crypto_js.default.mode.CBC,
    padding: import_crypto_js.default.pad.Pkcs7
  });
  return decrypted.toString(import_crypto_js.default.enc.Utf8);
}

// src/sdk/tap.ts
var TAP_RESERVED_SIZE = 16;
var TAP_PROTOCOL_VERSION = 33;
var V11_PROTOCOL_VERSION = 17;
var PROTOCOL = 513;
var STATUS_APP_ID = "511";
var CONTROL_APP_ID = "510";
var PIN_APP_ID = "313";
var CHARGE_STATUS_MESSAGE_ID = 8;
var CHARGE_STATUS_APP_LEN = 63;
var SOC_FACTOR = 0.1;
var RANGE_FACTOR = 0.1;
var VOLTAGE_FACTOR = 0.25;
var CURRENT_FACTOR = 0.05;
var CURRENT_ZERO_A = 1e3;
var MILEAGE_FACTOR = 0.1;
var ENERGY_FACTOR = 0.1;
var WORKING_VOLTAGE_FACTOR = 2.5;
var TIME_LEVEL_NA = 65535;
function frameV21(dispatcher, app) {
  const dispatcherLength = dispatcher.length + 3;
  if (dispatcherLength > 255) {
    throw new Error("TAP dispatcher too large");
  }
  const payload = new Uint8Array(3 + TAP_RESERVED_SIZE + dispatcher.length + app.length);
  payload[0] = TAP_PROTOCOL_VERSION;
  payload[1] = dispatcherLength;
  payload[2] = 0;
  payload.set(dispatcher, 3 + TAP_RESERVED_SIZE);
  payload.set(app, 3 + TAP_RESERVED_SIZE + dispatcher.length);
  const lenHex = (payload.length + 3).toString(16).toUpperCase().padStart(4, "0");
  return "1" + lenHex + bytesToHex(payload, true);
}
function buildDispatcher(uid, token, vin, appId, app, eventId, msgId = 1) {
  return codec21.encode("MPDispatcherBody", {
    uid,
    token,
    applicationID: appId,
    vin,
    messageID: msgId,
    eventCreationTime: Math.floor(Date.now() / 1e3),
    eventID: eventId,
    ulMessageCounter: 0,
    dlMessageCounter: 0,
    ackMessageCounter: 0,
    ackRequired: false,
    applicationDataLength: app.length,
    applicationDataEncoding: "perUnaligned",
    applicationDataProtocolVersion: PROTOCOL,
    testFlag: 2,
    result: 0
  });
}
function encodeStatusRequest(uid, token, vin, eventId) {
  const app = codec21.encode("OTARVMVehicleStatusReq", { vehStatusReqType: 2 });
  return frameV21(buildDispatcher(uid, token, vin, STATUS_APP_ID, app, eventId), app);
}
function encodeChargeStatusRequest(uid, token, vin, eventId) {
  const empty = new Uint8Array(0);
  return frameV21(
    buildDispatcher(uid, token, vin, STATUS_APP_ID, empty, eventId, CHARGE_STATUS_MESSAGE_ID),
    empty
  );
}
function encodeControlRequest(uid, token, vin, eventId, typ, params) {
  const request = {
    rvcReqType: new Uint8Array([typ])
  };
  if (params.length > 0) {
    request.rvcParams = params.map(([paramId, paramValue]) => ({
      paramId,
      paramValue
    }));
  }
  const app = codec21.encode("OTARVCReq", request);
  return frameV21(buildDispatcher(uid, token, vin, CONTROL_APP_ID, app, eventId), app);
}
function encodePinRequest(uid, token, vin, _eventId, pinHash) {
  const app = codec11.encode("PINVerificationReq", { pin: pinHash });
  const body = codec11.encode("MPDispatcherBodyV11", {
    uid,
    token,
    applicationID: PIN_APP_ID,
    vin,
    eventCreationTime: Math.floor(Date.now() / 1e3),
    messageID: 1,
    messageCounter: { uplinkCounter: 1, downlinkCounter: 0 },
    simInfo: "1234567890987654321",
    iccID: "12345678901234567890",
    applicationDataLength: app.length,
    applicationDataEncoding: "perUnaligned",
    applicationDataProtocolVersion: PROTOCOL,
    testFlag: 2
  });
  const dispatcherLength = body.length + 4;
  if (dispatcherLength > 255) {
    throw new Error("TAP PIN dispatcher too large");
  }
  const payload = new Uint8Array(4 + body.length + app.length);
  payload[0] = V11_PROTOCOL_VERSION;
  payload[1] = 0;
  payload[2] = dispatcherLength;
  payload[3] = 0;
  payload.set(body, 4);
  payload.set(app, 4 + body.length);
  const lenHex = (payload.length * 2 + 5).toString(16).toUpperCase().padStart(4, "0");
  return `${lenHex}1${bytesToHex(payload, true)}`;
}
function decodeV21(raw) {
  if (raw.length < 5 || raw[0] !== "1") {
    throw new Error("unexpected TAP v2.1 response framing");
  }
  const data = hexToBytes(raw.slice(5));
  if (data.length < 19) {
    throw new Error("short TAP v2.1 response");
  }
  if (data[0] !== TAP_PROTOCOL_VERSION) {
    throw new Error("unsupported TAP response protocol");
  }
  const dispatcherLength = data[1];
  const dispatcherEnd = TAP_RESERVED_SIZE + dispatcherLength;
  if (dispatcherLength < 3 || dispatcherEnd > data.length) {
    throw new Error("invalid TAP dispatcher length");
  }
  let dispatcher;
  try {
    dispatcher = codec21.decode("MPDispatcherBody", data.slice(19, dispatcherEnd));
  } catch (err) {
    throw new Error(`invalid TAP dispatcher: ${err.message}`);
  }
  if (dispatcher.applicationDataEncoding !== void 0 && dispatcher.applicationDataEncoding !== "perUnaligned") {
    throw new Error("unsupported TAP app encoding");
  }
  if (dispatcher.applicationDataProtocolVersion !== void 0 && dispatcher.applicationDataProtocolVersion !== PROTOCOL) {
    throw new Error("unsupported TAP app protocol");
  }
  const result = dispatcher.result ?? 0;
  if (![0, 4, 6].includes(result)) {
    return [dispatcher, null];
  }
  const appLength = dispatcher.applicationDataLength || 0;
  if (!appLength) {
    return [dispatcher, null];
  }
  const app = data.slice(dispatcherEnd, dispatcherEnd + appLength);
  if (app.length !== appLength) {
    throw new Error("truncated TAP app data");
  }
  return [dispatcher, app];
}
function decodeControlResponse(raw) {
  const [disp, app] = decodeV21(raw);
  if (disp.applicationID !== CONTROL_APP_ID) {
    throw new Error("unexpected control application identity");
  }
  try {
    return [disp, app ? codec21.decode("OTARVCStatus513", app) : null];
  } catch (err) {
    throw new Error(`invalid TAP control payload: ${err.message}`);
  }
}
function decodePinResponse(raw) {
  const hexPart = raw.length >= 5 && raw[4] === "1" ? raw.slice(5) : raw;
  const payload = hexToBytes(hexPart);
  if (payload.length < 4) {
    throw new Error("short TAP PIN header");
  }
  const dispatcherLength = payload[2] + (payload[3] << 8);
  if (payload[0] !== V11_PROTOCOL_VERSION || !(dispatcherLength > 4 && dispatcherLength <= payload.length)) {
    throw new Error("invalid TAP PIN dispatcher header");
  }
  let dispatcher;
  try {
    dispatcher = codec11.decode("MPDispatcherBodyV11", payload.slice(4, dispatcherLength));
  } catch (err) {
    throw new Error(`invalid TAP PIN dispatcher: ${err.message}`);
  }
  if (dispatcher.applicationID !== PIN_APP_ID) {
    throw new Error("unexpected PIN application identity");
  }
  if (dispatcher.applicationDataEncoding !== void 0 && dispatcher.applicationDataEncoding !== "perUnaligned") {
    throw new Error("unsupported TAP PIN encoding");
  }
  if (dispatcher.applicationDataProtocolVersion !== void 0 && dispatcher.applicationDataProtocolVersion !== PROTOCOL) {
    throw new Error("unsupported TAP PIN protocol");
  }
  const appLength = dispatcher.applicationDataLength || 0;
  if (dispatcherLength + appLength > payload.length) {
    throw new Error("truncated TAP PIN app data");
  }
  return dispatcher;
}
function amps(raw) {
  if (raw === void 0 || raw === null) return null;
  return Number((CURRENT_ZERO_A - raw * CURRENT_FACTOR).toFixed(4));
}
function scaled(raw, factor) {
  if (raw === void 0 || raw === null) return null;
  return Number((raw * factor).toFixed(4));
}
function decodeChargeApp(app) {
  if (!app || app.length !== CHARGE_STATUS_APP_LEN) {
    return null;
  }
  try {
    const frame = codec21.decode("OTARVMVehicleChargingStatusResp", app);
    const cs = frame.vehicleChargingStatus;
    const soc = cs.powerLevelPrc;
    const timeLevel = cs.chargingTimeLevelPrc;
    return {
      is_charging: Boolean(cs.chargingState),
      is_plugged_in: Boolean(cs.chargingGunState),
      charging_type: cs.chargingType,
      charging_electricity_phase: cs.chargingElectricityPhase ?? null,
      soc: soc !== void 0 && soc !== null && soc >= 0 && soc <= 1e3 ? scaled(soc, SOC_FACTOR) : null,
      range_km: Number((cs.fuelRange * RANGE_FACTOR).toFixed(2)),
      charging_voltage: Number((cs.chargingVoltage * VOLTAGE_FACTOR).toFixed(2)),
      charging_current: amps(cs.chargingCurrent),
      battery_energy_kwh: Number((cs.realtimePower * ENERGY_FACTOR).toFixed(2)),
      working_voltage: scaled(cs.workingVoltage, WORKING_VOLTAGE_FACTOR),
      working_current: amps(cs.workingCurrent),
      charge_time_elapsed_s: cs.chargingDuration ?? null,
      start_time: cs.startTime || null,
      end_time: cs.endTime || null,
      charge_time_remaining_min: timeLevel === void 0 || timeLevel === TIME_LEVEL_NA ? null : timeLevel,
      charging_pile_id: cs.chargingPileID || null,
      charging_pile_supplier: cs.chargingPileSupplier || null,
      odometer_km: Number((cs.mileage * MILEAGE_FACTOR).toFixed(2)),
      distance_since_last_charge_km: scaled(cs.mileageSinceLastCharge, MILEAGE_FACTOR),
      power_usage_since_last_charge_kwh: scaled(cs.powerUsageSinceLastCharge, ENERGY_FACTOR),
      mileage_of_day_raw: cs.mileageOfDay ?? null,
      power_usage_of_day_raw: cs.powerUsageOfDay ?? null,
      static_energy_consumption_raw: cs.staticEnergyConsumption ?? null,
      total_battery_capacity_kwh: scaled(cs.totalBatteryCapacity, ENERGY_FACTOR),
      last_charge_ending_power_kwh: scaled(cs.lastChargeEndingPower, ENERGY_FACTOR),
      fota_lowest_voltage_raw: cs.fotaLowestVoltage ?? null,
      status_time: frame.statusTime,
      extended_data_1: cs.extendedData1 ?? null,
      extended_data_2: cs.extendedData2 ?? null,
      extended_data_3: cs.extendedData3 || null,
      extended_data_4: cs.extendedData4 || null,
      _raw: cs
    };
  } catch {
    return null;
  }
}
function decodeStatusAndCharge(raw) {
  const [dispatcher, app] = decodeV21(raw);
  if (dispatcher.applicationID !== STATUS_APP_ID) {
    throw new Error("unexpected status application identity");
  }
  if (!app) {
    return [dispatcher, null, null];
  }
  const charge = decodeChargeApp(app);
  if (charge !== null) {
    return [dispatcher, null, charge];
  }
  let status = null;
  try {
    status = codec21.decode("OTARVMVehicleStatusResp513", app);
  } catch {
    status = null;
  }
  return [dispatcher, status, charge];
}

// src/sdk/client.ts
var TAP_LOGIN_URL = "https://iov-tap.mgindia.co.in/TAP.Web/ota.mp";
var TAP_STATUS_URL = "https://iov-tap.mgindia.co.in/TAP.Web/ota.mpv21";
var GATEWAY_BASE = "https://iov-gateway.mgindia.co.in/api.app/v1";
var CONTROL_ATTEMPTS = 15;
var CONTROL_DELAY_MS = 2e3;
var LOGIN_ATTEMPTS = 3;
var LOGIN_DELAY_MS = 1500;
var STATUS_ATTEMPTS = 10;
var STATUS_DELAY_MS = 1500;
var STATUS_RESULT_PENDING = [0, 4, 6];
var STATUS_RESULT_SESSION_INVALID = 2;
var CHARGE_RESULT_UNAVAILABLE = [5];
var TYRE_PSI_PER_UNIT = 0.2;
var PASSWORD_MAX_LEN = 16;
var LOGIN_DISPATCHER_TEMPLATE_HEX = "11005600882c60c183060c183060c183060c183060c183060c183060c183060c183060c183060c183060c183060c183060c1ab06200000000020200468acf134468acf1342468acf1342468acf1342000000000100a0";
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function asList(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of ["list", "vehicleList", "vehicles", "vinList", "result"]) {
      if (Array.isArray(data[key])) return data[key];
    }
    const nested = data.data;
    if (nested && typeof nested === "object") {
      return asList(nested);
    }
  }
  return [];
}
function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number" && (v === 0 || v === 1)) return Boolean(v);
  return null;
}
function toInt(v, minv, maxv) {
  if (v === void 0 || v === null || typeof v === "boolean") return null;
  const i = Math.trunc(Number(v));
  if (Number.isNaN(i)) return null;
  if (minv !== void 0 && i < minv) return null;
  if (maxv !== void 0 && i > maxv) return null;
  return i;
}
function toTenths(v) {
  const i = toInt(v);
  return i === null ? null : i / 10;
}
function toTyrePsi(v) {
  const i = toInt(v, 1, 255);
  return i === null ? null : Number((i * TYRE_PSI_PER_UNIT).toFixed(1));
}
var GPS_STATUS_NAMES = {
  noGpsSignal: 0 /* NO_SIGNAL */,
  timeFix: 1 /* TIME_FIX */,
  fix2D: 2 /* FIX_2D */,
  fix3D: 3 /* FIX_3D */
};
function toGpsStatus(v) {
  if (typeof v === "string") {
    return GPS_STATUS_NAMES[v] ?? null;
  }
  const i = toInt(v, 0, 3);
  return i === null ? null : i;
}
function toMicroDegrees(v, limit) {
  const i = toInt(v, -limit, limit);
  return i === null ? null : i / 1e6;
}
function parseGpsPosition(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const wayPoint = raw.wayPoint && typeof raw.wayPoint === "object" ? raw.wayPoint : {};
  const position = wayPoint.position && typeof wayPoint.position === "object" ? wayPoint.position : {};
  const timestamp = raw.timestamp4Short;
  const seconds = timestamp && typeof timestamp === "object" ? timestamp.seconds : timestamp;
  const latitude = toMicroDegrees(position.latitude, 9e7);
  const longitude = toMicroDegrees(position.longitude, 18e7);
  const gpsStatus = toGpsStatus(raw.gpsStatus);
  const hasFix = (gpsStatus === 2 /* FIX_2D */ || gpsStatus === 3 /* FIX_3D */) && latitude !== null && longitude !== null;
  return {
    latitude,
    longitude,
    altitude_m: toInt(position.altitude, -100, 8900),
    heading_deg: toInt(wayPoint.heading, 0, 359),
    speed_kmh: toTenths(toInt(wayPoint.speed, 0, 4500)),
    hdop: toInt(wayPoint.hdop, 0, 1e3),
    satellites: toInt(wayPoint.satellites, 0, 16),
    gps_status: gpsStatus,
    position_time: toInt(seconds),
    has_fix: hasFix,
    raw
  };
}
var SERIES_NAME_MAP = {
  EQ100: "Windsor EV",
  EC32: "Comet EV",
  ZS11: "ZS EV"
};
function parseVehicle(raw) {
  const vin = raw.vin || raw.VIN || raw.vinNo || raw.vehicleVin;
  if (!vin) {
    throw new MgIndiaApiError("Vehicle response did not include a VIN");
  }
  const rawSeries = raw.series ? String(raw.series).trim().toUpperCase() : "";
  const mappedName = SERIES_NAME_MAP[rawSeries];
  const rawModel = raw.modelName ? String(raw.modelName).trim() : "";
  const name = mappedName || (rawModel && rawModel.toUpperCase() === "WINDSOR" ? "Windsor EV" : rawModel) || raw.series || raw.brandName || String(vin).slice(-6);
  return {
    vin: String(vin),
    name: String(name),
    brand: raw.brandName ?? null,
    model: mappedName || rawModel || raw.series || null,
    model_year: raw.modelYear ? String(raw.modelYear) : null,
    color_name: raw.colorName ?? null,
    series: raw.series ?? null,
    raw
  };
}
function parseStatus(raw) {
  const basic = raw.basicVehicleStatus || raw;
  const locked = toBool(basic.lockStatus);
  const driverDoor = toBool(basic.driverDoor);
  const passengerDoor = toBool(basic.passengerDoor);
  const rearLeftDoor = toBool(basic.rearLeftDoor);
  const rearRightDoor = toBool(basic.rearRightDoor);
  const boot = toBool(basic.bootStatus);
  const bonnet = toBool(basic.bonnetStatus);
  let driverWindow = toBool(basic.driverWindow);
  const passengerWindow = toBool(basic.passengerWindow);
  const rearLeftWindow = toBool(basic.rearLeftWindow);
  const rearRightWindow = toBool(basic.rearRightWindow);
  if (driverWindow === true && locked === true && ![
    driverDoor,
    passengerDoor,
    rearLeftDoor,
    rearRightDoor,
    boot,
    bonnet,
    passengerWindow,
    rearLeftWindow,
    rearRightWindow
  ].some(Boolean)) {
    driverWindow = false;
  }
  return {
    status_time: toInt(raw.statusTime),
    locked,
    driver_door_open: driverDoor,
    passenger_door_open: passengerDoor,
    rear_left_door_open: rearLeftDoor,
    rear_right_door_open: rearRightDoor,
    boot_open: boot,
    bonnet_open: bonnet,
    driver_window_open: driverWindow,
    passenger_window_open: passengerWindow,
    rear_left_window_open: rearLeftWindow,
    rear_right_window_open: rearRightWindow,
    sunroof_open: toBool(basic.sunroofStatus),
    climate_running: basic.remoteClimateStatus !== void 0 && basic.remoteClimateStatus !== null ? basic.remoteClimateStatus === 2 || basic.remoteClimateStatus === 3 : null,
    interior_temperature: toInt(basic.interiorTemperature, -60, 90),
    exterior_temperature: toInt(basic.exteriorTemperature, -60, 90),
    fuel_level: toInt(basic.fuelLevelPrc, 0, 100),
    range_km: toTenths(basic.fuelRange),
    odometer_km: toTenths(basic.mileage),
    aux_battery_voltage: toTenths(basic.batteryVoltage),
    front_left_tyre_psi: toTyrePsi(basic.frontLeftTyrePressure),
    front_right_tyre_psi: toTyrePsi(
      basic.frontRrightTyrePressure !== void 0 && basic.frontRrightTyrePressure !== null ? basic.frontRrightTyrePressure : basic.frontRightTyrePressure
    ),
    rear_left_tyre_psi: toTyrePsi(basic.rearLeftTyrePressure),
    rear_right_tyre_psi: toTyrePsi(basic.rearRightTyrePressure),
    tyre_monitor_status: toInt(basic.wheelTyreMonitorStatus, 0, 255),
    can_bus_active: toBool(basic.canBusActive),
    last_can_activity: toInt(basic.timeOfLastCANBUSActivity),
    handbrake: toBool(basic.handBrake),
    gps: parseGpsPosition(raw.gpsPosition),
    charge: null,
    power_mode_raw: toInt(basic.powerMode, 0, 255),
    engine_status_raw: toInt(basic.engineStatus, 0, 255),
    side_lights_on: toBool(basic.sideLightStatus),
    dipped_beam_on: toBool(basic.dippedBeamStatus),
    main_beam_on: toBool(basic.mainBeamStatus),
    front_left_seat_heat_level: toInt(basic.frontLeftSeatHeatLevel, 0, 255),
    front_right_seat_heat_level: toInt(basic.frontRightSeatHeatLevel, 0, 255),
    raw
  };
}
function discoverCapabilities(payloads) {
  const cfg = {};
  const featureIds = /* @__PURE__ */ new Set();
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object") continue;
    for (const block of [payload.configuration, payload.config, payload.modelConfig]) {
      if (block && typeof block === "object") {
        Object.assign(cfg, block);
      }
    }
    for (const item of asList(payload)) {
      if (item && typeof item === "object") {
        const fid = Number(item.featureId ?? item.id);
        if (!Number.isNaN(fid)) {
          featureIds.add(fid);
        }
      }
    }
  }
  const enabled = (val) => ["1", "Y", "YES", "TRUE", "ON", "SUPPORTED"].includes(String(val || "").toUpperCase());
  const remote = enabled(cfg.S61) || featureIds.size > 0;
  const mask = String(cfg.WINDOW || "");
  const windowParamIds = [];
  const pids = [9, 10, 11, 12];
  for (let i = 0; i < Math.min(mask.length, pids.length); i++) {
    if (["1", "Y", "T"].includes(mask[i].toUpperCase())) {
      windowParamIds.push(pids[i]);
    }
  }
  return {
    climate: enabled(cfg.T11) || featureIds.has(2),
    door_lock: remote,
    find_my_car: remote,
    tailgate: remote && enabled(cfg.BOOT),
    sunroof: remote && enabled(cfg.S35),
    heated_seats: remote && enabled(cfg.HeatedSeat),
    window_param_ids: remote ? windowParamIds : []
  };
}
function encodeLoginApp(password, deviceId) {
  const writer = new PackedBitWriter();
  writer.write(1, 1);
  writer.writeString(password.slice(0, PASSWORD_MAX_LEN), 6, 30);
  writer.writeString(deviceId, 1, 200);
  return writer.bytes();
}
function loginErrorFromResponse(payload) {
  if (payload.length < 4) return null;
  const dispatcherEnd = payload[2] + (payload[3] << 8);
  if (!(dispatcherEnd > 4 && dispatcherEnd <= payload.length)) return null;
  try {
    const dispatcher = codec11.decode("MPDispatcherBodyV11", payload.slice(4, dispatcherEnd));
    const result = dispatcher.result;
    if (!result) return null;
    let message = "";
    if (dispatcher.errorMessage instanceof Uint8Array) {
      message = new TextDecoder().decode(dispatcher.errorMessage).trim();
    }
    const detail = message || `result ${result}`;
    return new MgIndiaLoginRejected(`MG India login rejected: ${detail}`);
  } catch {
    return null;
  }
}
function decodeLoginResponse(raw) {
  if (raw.length < 5 || raw[4] !== "1") {
    throw new MgIndiaApiError("Unexpected TAP login response framing");
  }
  let payload;
  try {
    payload = hexToBytes(raw.slice(5));
  } catch {
    throw new MgIndiaApiError("Invalid TAP login response encoding");
  }
  if (payload.length < 4) {
    throw new MgIndiaApiError("TAP login response is too short");
  }
  const dispatcherLen = payload[2] + (payload[3] << 8);
  if (!(dispatcherLen >= 4 && dispatcherLen <= payload.length)) {
    throw new MgIndiaApiError("Invalid TAP login dispatcher length");
  }
  const error = loginErrorFromResponse(payload);
  if (error !== null) {
    throw error;
  }
  const dispatcher = payload.slice(0, dispatcherLen);
  const app = payload.slice(dispatcherLen);
  if (dispatcher.length < 50 || app.length * 8 < 6 + 40 * 7 + 40 * 7) {
    throw new MgIndiaApiError(
      "Login rejected by MG India server (check phone/password, or the account may not be authorized for this app)"
    );
  }
  const uid = readFixed7Bit(dispatcher, 300, 14).padStart(50, "0");
  const reader = new PackedBitReader(app);
  reader.read(6);
  const token = reader.readString(40, 40);
  const refresh = reader.readString(40, 40);
  if (token !== refresh) {
    throw new MgIndiaApiError("Login token and refresh token differ");
  }
  return [uid, token];
}
var MgIndiaClient = class {
  phone;
  password;
  vin;
  pinHash;
  deviceId;
  uid = null;
  token = null;
  vehicle = null;
  onSessionRefreshed;
  capabilities = {
    climate: false,
    door_lock: false,
    find_my_car: false,
    tailgate: false,
    sunroof: false,
    heated_seats: false,
    window_param_ids: []
  };
  proxyBaseUrl;
  _event = 1;
  constructor(options) {
    this.phone = normalizePhone(options.phone);
    this.password = options.password;
    this.vin = options.vin || null;
    this.pinHash = options.pinHash || null;
    this.deviceId = makeDeviceId(this.phone);
    this.onSessionRefreshed = options.onSessionRefreshed;
    const isBrowser = typeof document !== "undefined" && typeof navigator !== "undefined" && navigator.product !== "ReactNative";
    this.proxyBaseUrl = options.proxyBaseUrl || (isBrowser ? "https://mg-windsor-webhook.tonyjoseph456.workers.dev" : null);
  }
  get hasPin() {
    return Boolean(this.pinHash);
  }
  _nextEvent() {
    this._event = this._event + 1 & 2147483647;
    return this._event;
  }
  _resolveUrl(targetUrl) {
    if (!this.proxyBaseUrl) return targetUrl;
    const base = this.proxyBaseUrl.replace(/\/$/, "");
    return `${base}/?url=${encodeURIComponent(targetUrl)}`;
  }
  buildLoginBody() {
    const dispatcher = hexToBytes(LOGIN_DISPATCHER_TEMPLATE_HEX);
    const app = encodeLoginApp(this.password, this.deviceId);
    setFixed7Bit(dispatcher, 48, this.phone.padStart(50, "0"));
    setMsbBits(dispatcher, 419, 32, Math.floor(Date.now() / 1e3));
    const appLenBits = app.length * 2;
    dispatcher[dispatcher.length - 7] = appLenBits >>> 24 & 255;
    dispatcher[dispatcher.length - 6] = appLenBits >>> 16 & 255;
    dispatcher[dispatcher.length - 5] = appLenBits >>> 8 & 255;
    dispatcher[dispatcher.length - 4] = appLenBits & 255;
    dispatcher[dispatcher.length - 3] = 1;
    dispatcher[dispatcher.length - 2] = 0;
    dispatcher[dispatcher.length - 1] = 160;
    const payload = new Uint8Array(dispatcher.length + app.length);
    payload.set(dispatcher, 0);
    payload.set(app, dispatcher.length);
    const rawWithoutLength = "1" + bytesToHex(payload, true);
    const lenHex = (rawWithoutLength.length + 4).toString(16).toUpperCase().padStart(4, "0");
    return `${lenHex}${rawWithoutLength}`;
  }
  async login() {
    let lastError = null;
    for (let attempt = 0; attempt < LOGIN_ATTEMPTS; attempt++) {
      const body = this.buildLoginBody();
      const headers = {
        "Content-Type": "text/plain",
        Accept: "*/*",
        "Accept-Language": "en-US;q=1",
        "APP-SIGNATURE": tapSignature(body),
        SIGNATURE: "1"
      };
      const response = await fetch(this._resolveUrl(TAP_LOGIN_URL), {
        method: "POST",
        headers,
        body
      });
      const text = await response.text();
      if (response.status >= 400) {
        lastError = new MgIndiaApiError(`Login failed: HTTP ${response.status}`);
      } else {
        try {
          const [uid, token] = decodeLoginResponse(text);
          this.uid = uid;
          this.token = token;
          if (this.onSessionRefreshed) {
            try {
              this.onSessionRefreshed({ uid, token, phone: this.phone });
            } catch {
            }
          }
          return;
        } catch (err) {
          if (err instanceof MgIndiaLoginRejected) {
            throw err;
          }
          lastError = err;
        }
      }
      if (attempt < LOGIN_ATTEMPTS - 1) {
        await sleep(LOGIN_DELAY_MS);
      }
    }
    throw new MgIndiaApiError(
      `Login failed after retrying transient TAP response: ${lastError?.message || ""}`
    );
  }
  async gatewayGet(path, params, _sessionRetry = true) {
    if (!this.token || !this.uid) {
      await this.login();
    }
    const cleanPath = "/" + path.replace(/^\/+/, "");
    const searchParams = new URLSearchParams(params || {});
    const query = searchParams.toString();
    const signingPath = cleanPath + (query ? `?${query}` : "");
    const timestamp = String(Date.now());
    const contentType = "application/json";
    const headers = {
      "Content-Type": contentType,
      "APP-CONTENT-ENCRYPTED": "1",
      "APP-LANGUAGE-TYPE": "en-us",
      "APP-LOGIN-TOKEN": this.token || "",
      "APP-USER-ID": this.uid || "",
      "APP-SEND-DATE": timestamp,
      "APP-VERIFICATION-STRING": gatewaySignature(signingPath, timestamp, contentType),
      "ORIGINAL-CONTENT-TYPE": contentType
    };
    const fullUrl = GATEWAY_BASE + signingPath;
    const response = await fetch(this._resolveUrl(fullUrl), {
      method: "GET",
      headers
    });
    const text = await response.text();
    if (response.status >= 400) {
      throw new MgIndiaApiError(`Gateway ${cleanPath} failed: HTTP ${response.status}`);
    }
    const respHeaders = {
      "APP-SEND-DATE": response.headers.get("APP-SEND-DATE") || response.headers.get("app-send-date") || response.headers.get("x-mg-send-date"),
      "ORIGINAL-CONTENT-TYPE": response.headers.get("ORIGINAL-CONTENT-TYPE") || response.headers.get("original-content-type") || "application/json"
    };
    const decrypted = decryptGatewayBody(text, respHeaders);
    const parsed = JSON.parse(decrypted);
    const isSessionInvalid = parsed.code === 7 || parsed.code === 4 || parsed.code === 2 || parsed.code === 401 || typeof parsed.message === "string" && /login|token|session|invalid|expire/i.test(parsed.message);
    if (isSessionInvalid) {
      if (!_sessionRetry) {
        throw new MgIndiaApiError(parsed.message || "Gateway session remains invalid after login");
      }
      await this.login();
      return this.gatewayGet(path, params, false);
    }
    if (parsed.code !== 0 && parsed.code !== void 0 && parsed.code !== null) {
      throw new MgIndiaApiError(parsed.message || `Gateway error code ${parsed.code}`);
    }
    return parsed;
  }
  async vehicles() {
    const operationVin = this.vin;
    const data = await this.gatewayGet("/vehicle/userVinList");
    const list = asList(data).filter((x) => x && typeof x === "object").map((x) => parseVehicle(x));
    if (this.vin !== operationVin) {
      throw new MgIndiaApiError("VIN changed during vehicle discovery");
    }
    if (operationVin) {
      this.vehicle = list.find((v) => v.vin === operationVin) || null;
      if (!this.vehicle) {
        throw new MgIndiaApiError("Configured vehicle is absent from the account");
      }
    } else if (list.length > 0) {
      this.vehicle = list[0];
      this.vin = this.vehicle.vin;
    }
    return list;
  }
  async refreshCapabilities() {
    if (!this.vin) {
      await this.vehicles();
    }
    const operationVin = this.vin || "";
    const payloads = [];
    for (const path of [
      "/vehicle/feature/list",
      "/vehicle/service/subscription",
      "/navi/vehicle/co2info",
      "/navi/vehicle/co2info/supplementInfo"
    ]) {
      try {
        payloads.push(await this.gatewayGet(path, { vin: operationVin }));
      } catch (err) {
        if (err instanceof MgIndiaLoginRejected) throw err;
      }
    }
    this.capabilities = discoverCapabilities(payloads);
    return this.capabilities;
  }
  async _postTapFrame(body, errorLabel) {
    const headers = {
      "Content-Type": "text/plain",
      Accept: "*/*",
      "Accept-Language": "en-US;q=1",
      SIGNATURE: "1",
      "APP-SIGNATURE": tapSignature(body)
    };
    const response = await fetch(this._resolveUrl(TAP_STATUS_URL), {
      method: "POST",
      headers,
      body
    });
    const text = await response.text();
    if (response.status >= 400) {
      throw new MgIndiaApiError(`${errorLabel} failed: HTTP ${response.status}`);
    }
    return text;
  }
  async _postStatusFrame(eventId, errorLabel) {
    const body = encodeStatusRequest(
      this.uid || "0".repeat(50),
      this.token || "0".repeat(40),
      this.vin || "",
      eventId
    );
    return this._postTapFrame(body, errorLabel);
  }
  async _postChargeFrame(eventId, errorLabel) {
    const body = encodeChargeStatusRequest(
      this.uid || "0".repeat(50),
      this.token || "0".repeat(40),
      this.vin || "",
      eventId
    );
    return this._postTapFrame(body, errorLabel);
  }
  async _pollRequest(post, want, label, options = {}) {
    const unavailableResults = options.unavailableResults || [];
    const tolerateFramingErrors = options.tolerateFramingErrors || false;
    const operationVin = options.operationVin ?? null;
    for (let loginAttempt = 0; loginAttempt < 2; loginAttempt++) {
      let eventId = 0;
      let reLoginNeeded = false;
      for (let attempt = 0; attempt < STATUS_ATTEMPTS; attempt++) {
        if (this.vin !== operationVin) {
          throw new MgIndiaApiError("VIN changed during polling");
        }
        const text = await post(eventId, label);
        let dispatcher;
        let statusPayload;
        let charge;
        try {
          [dispatcher, statusPayload, charge] = decodeStatusAndCharge(text);
        } catch (err) {
          if (!tolerateFramingErrors) throw err;
          if (attempt < STATUS_ATTEMPTS - 1) {
            await sleep(STATUS_DELAY_MS);
          }
          continue;
        }
        if (dispatcher.vin !== void 0 && dispatcher.vin !== operationVin) {
          throw new MgIndiaApiError("TAP response vehicle does not match request");
        }
        const result = dispatcher.result ?? 0;
        let errMsg = "";
        if (dispatcher.errorMessage instanceof Uint8Array) {
          try {
            errMsg = new TextDecoder().decode(dispatcher.errorMessage).trim();
          } catch (_) {
          }
        }
        const isSessionInvalid = result === STATUS_RESULT_SESSION_INVALID || result === 3 || /login|token|session|invalid|expire/i.test(errMsg);
        if (isSessionInvalid) {
          if (loginAttempt === 0) {
            await this.login();
            reLoginNeeded = true;
            break;
          }
          throw new MgIndiaApiError(`TAP ${label.toLowerCase()} session is invalid`);
        }
        if (unavailableResults.includes(result)) {
          return null;
        }
        if (!STATUS_RESULT_PENDING.includes(result)) {
          throw new MgIndiaApiError(`${label} failed: result ${result}`);
        }
        const frame = want(statusPayload, charge);
        if (frame !== null) {
          return frame;
        }
        eventId = dispatcher.eventID ?? eventId;
        if (attempt < STATUS_ATTEMPTS - 1) {
          await sleep(STATUS_DELAY_MS);
        }
      }
      if (!reLoginNeeded) {
        return null;
      }
    }
    return null;
  }
  async status(includeCharge = false) {
    if (!this.token) {
      await this.login();
    }
    if (!this.vin) {
      await this.vehicles();
    }
    const operationVin = this.vin;
    const statusPayload = await this._pollRequest(
      (eid, lbl) => this._postStatusFrame(eid, lbl),
      (st, _ch) => st,
      "Status",
      { operationVin }
    );
    if (!statusPayload) {
      throw new MgIndiaApiError("Vehicle status was not ready after polling");
    }
    const statusObj = parseStatus(statusPayload);
    if (includeCharge) {
      const chargeObj = await this._pollRequest(
        (eid, lbl) => this._postChargeFrame(eid, lbl),
        (_st, ch) => ch,
        "Status",
        {
          unavailableResults: CHARGE_RESULT_UNAVAILABLE,
          tolerateFramingErrors: true,
          operationVin
        }
      );
      statusObj.charge = chargeObj;
    }
    return statusObj;
  }
  async chargeStatus() {
    if (!this.token) {
      await this.login();
    }
    if (!this.vin) {
      await this.vehicles();
    }
    const operationVin = this.vin;
    const chargeObj = await this._pollRequest(
      (eid, lbl) => this._postChargeFrame(eid, lbl),
      (_st, ch) => ch,
      "Charge status",
      {
        unavailableResults: CHARGE_RESULT_UNAVAILABLE,
        tolerateFramingErrors: true,
        operationVin
      }
    );
    if (!chargeObj) {
      throw new ChargingStatusUnavailable();
    }
    return chargeObj;
  }
  async snapshot(includeCharge = true) {
    if (!this.vehicle || this.vehicle.vin !== this.vin) {
      await this.vehicles();
    }
    if (!this.vehicle) {
      throw new MgIndiaApiError("No vehicle is available for a snapshot");
    }
    const caps = await this.refreshCapabilities();
    const status = await this.status(includeCharge);
    return {
      vehicle: this.vehicle,
      capabilities: caps,
      status,
      user_info: {}
    };
  }
  async verifyPin() {
    if (!this.pinHash) {
      throw new MgIndiaApiError("Control PIN is not configured");
    }
    let operationVin = this.vin;
    for (let loginAttempt = 0; loginAttempt < 2; loginAttempt++) {
      if (!this.token || !this.uid) {
        await this.login();
      }
      if (!operationVin) {
        await this.vehicles();
        operationVin = this.vin;
      }
      const body = encodePinRequest(
        this.uid || "0".repeat(50),
        this.token || "0".repeat(40),
        operationVin || "",
        this._nextEvent(),
        this.pinHash
      );
      const response = await fetch(this._resolveUrl(TAP_LOGIN_URL), {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Accept: "*/*",
          "Accept-Language": "en-US;q=1",
          "APP-SIGNATURE": tapSignature(body),
          SIGNATURE: "1"
        },
        body
      });
      const text = await response.text();
      if (response.status >= 400) {
        throw new MgIndiaApiError(`PIN verification failed: HTTP ${response.status}`);
      }
      let dispatcher;
      try {
        dispatcher = decodePinResponse(text);
      } catch {
        throw new MgIndiaApiError("PIN response could not be decoded");
      }
      const result = dispatcher.result ?? 0;
      if (result === 0) return;
      if (result === 2 && loginAttempt === 0) {
        await this.login();
        continue;
      }
      throw new MgIndiaApiError(`PIN verification failed: result ${result}`);
    }
    throw new MgIndiaApiError("PIN verification failed after token refresh");
  }
  async _control(name, typ, params) {
    await this.verifyPin();
    const operationVin = this.vin || "";
    let eventId = 0;
    for (let attempt = 0; attempt < CONTROL_ATTEMPTS; attempt++) {
      const body = encodeControlRequest(
        this.uid || "0".repeat(50),
        this.token || "0".repeat(40),
        operationVin,
        eventId,
        typ,
        params
      );
      let text;
      try {
        text = await this._postTapFrame(body, name);
      } catch (err) {
        throw new MgIndiaCommandIndeterminate(`${name} completion is unknown: ${err.message}`);
      }
      let dispatcher;
      let control;
      try {
        [dispatcher, control] = decodeControlResponse(text);
      } catch {
        throw new MgIndiaCommandIndeterminate(`${name} response could not be decoded`);
      }
      const result = dispatcher.result ?? 0;
      if (!STATUS_RESULT_PENDING.includes(result)) {
        throw new MgIndiaCommandIndeterminate(`${name} completion unknown: result ${result}`);
      }
      if (control) {
        const statusBytes = control.rvcReqSts;
        if (statusBytes && statusBytes[0] === 2) {
          return;
        }
        if (statusBytes && statusBytes[0] !== 1) {
          throw new MgIndiaApiError(`${name} failed: status ${statusBytes[0]}`);
        }
      }
      eventId = dispatcher.eventID ?? eventId;
      if (!eventId) {
        throw new MgIndiaCommandIndeterminate(`${name} completion unknown: no polling cursor`);
      }
      if (attempt < CONTROL_ATTEMPTS - 1) {
        await sleep(CONTROL_DELAY_MS);
      }
    }
    throw new MgIndiaCommandIndeterminate(`${name} did not complete`);
  }
  async controlClimate(on) {
    const val = on ? new Uint8Array([3]) : new Uint8Array([0]);
    const params = [
      [19, val],
      [20, val],
      [255, new Uint8Array([0])]
    ];
    await this._control("Climate", 6, params);
  }
  async controlDoorLock(lock) {
    const params = lock ? [] : [
      [4, new Uint8Array([0])],
      [5, new Uint8Array([0])],
      [6, new Uint8Array([0])],
      [7, new Uint8Array([3])],
      [255, new Uint8Array([0])]
    ];
    await this._control("Door lock", lock ? 1 : 2, params);
  }
  async findMyCar() {
    await this._control("Find my car", 0, [
      [1, new Uint8Array([1])],
      [2, new Uint8Array([1])],
      [3, new Uint8Array([1])],
      [255, new Uint8Array([0])]
    ]);
  }
  async releaseTailgate() {
    await this._control("Tailgate", 2, [
      [4, new Uint8Array([0])],
      [5, new Uint8Array([0])],
      [6, new Uint8Array([0])],
      [7, new Uint8Array([2])],
      [255, new Uint8Array([0])]
    ]);
  }
  async controlWindows(openWindows, ids = [9, 10, 11, 12]) {
    const selected = new Set(ids);
    const params = [8, 9, 10, 11, 12].map((paramId) => [
      paramId,
      new Uint8Array([selected.has(paramId) ? 1 : 0])
    ]);
    params.push([13, new Uint8Array([openWindows ? 3 : 0])]);
    await this._control("Windows", 3, params);
  }
  async controlSunroof(openSunroof) {
    await this._control("Sunroof", 3, [
      [8, new Uint8Array([1])],
      [9, new Uint8Array([0])],
      [10, new Uint8Array([0])],
      [11, new Uint8Array([0])],
      [12, new Uint8Array([0])],
      [13, new Uint8Array([openSunroof ? 3 : 0])]
    ]);
  }
  async controlHeatedSeats(driver, passenger) {
    if (driver < 0 || driver > 3 || passenger < 0 || passenger > 3) {
      throw new MgIndiaApiError("Heated-seat levels must be between 0 and 3");
    }
    await this._control("Heated seats", 5, [
      [17, new Uint8Array([driver])],
      [18, new Uint8Array([passenger])],
      [255, new Uint8Array([0])]
    ]);
  }
};

// cloudflare-worker/silent-webhook.ts
var memCache = /* @__PURE__ */ new Map();
async function storageGet(env, key) {
  if (env.TRIP_KV) {
    try {
      return await env.TRIP_KV.get(key, "text");
    } catch (_) {
    }
  }
  return memCache.get(key) ?? null;
}
async function storagePut(env, key, value) {
  memCache.set(key, value);
  if (env.TRIP_KV) {
    try {
      await env.TRIP_KV.put(key, value);
    } catch (_) {
    }
  }
}
var silent_webhook_default = {
  // HTTP Fetch Handler (Called by iOS Shortcuts, cron-job.org, or Phone App/PWA)
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/oauth-callback" || url.searchParams.get("action") === "oauth-callback") {
      const html = `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Connecting to MG Windsor EV...</title>
    <style>
      body { background: #0B132B; color: #38BDF8; font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
      .box { background: #1C2541; padding: 28px; border-radius: 16px; border: 1px solid #3A506B; max-width: 320px; }
      h2 { color: #10B981; margin: 0 0 10px; font-size: 20px; }
      p { color: #94A3B8; font-size: 14px; margin: 0 0 16px; }
      .btn { display: inline-block; padding: 12px 24px; background: #10B981; color: #FFF; border-radius: 10px; text-decoration: none; font-weight: bold; font-size: 14px; }
    </style>
  </head>
  <body>
    <div class="box">
      <h2>\u2705 Google Authentication Successful!</h2>
      <p>Returning you to the MG Windsor EV app...</p>
      <a id="open-app-btn" class="btn" href="mgismart://google-auth">Open MG Windsor EV App</a>
    </div>
    <script>
      (function() {
        var hash = window.location.hash || window.location.search || '';
        var targetUrl = 'mgismart://google-auth' + hash;
        var btn = document.getElementById('open-app-btn');
        if (btn) btn.href = targetUrl;
        
        // Auto-redirect into native app scheme
        window.location.href = targetUrl;
        setTimeout(function() {
          window.location.replace(targetUrl);
        }, 100);
      })();
    <\/script>
  </body>
</html>`;
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
    const secret = url.searchParams.get("key");
    if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized webhook key" }), {
        status: 401,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    const action = url.searchParams.get("action");
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*"
        }
      });
    }
    if (!action) {
      return new Response(JSON.stringify({
        status: "online",
        service: "MG Windsor EV Telematics Cloud Worker",
        actions: [
          "?action=unlock&key=...",
          "?action=lock&key=...",
          "?action=climate-on&key=...",
          "?action=climate-off&key=...",
          "?action=status&key=...",
          "?action=poll-trip&key=... (Triggered every 1-2 min by cron-job.org)",
          "?action=get-trips&key=... (Fetch cloud-logged trips for PWA / Mobile App)",
          "?action=reset-guard&key=... (Reset 12V battery protection lock)"
        ]
      }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    const phone = request.headers.get("x-mg-phone") || url.searchParams.get("phone") || env.MG_PHONE;
    const password = request.headers.get("x-mg-password") || url.searchParams.get("password") || env.MG_PASSWORD;
    const pin = request.headers.get("x-mg-pin") || url.searchParams.get("pin") || env.MG_PIN;
    const vin = request.headers.get("x-mg-vin") || url.searchParams.get("vin") || env.MG_VIN || void 0;
    if (action === "reset-guard") {
      await storagePut(env, "battery_guard_cutoff_until", "0");
      return new Response(JSON.stringify({ success: true, message: "12V Battery Guard reset successfully" }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    if (action === "get-trips") {
      const rawTrips = await storageGet(env, "cloud_trips_history");
      const trips = rawTrips ? JSON.parse(rawTrips) : [];
      const activeRaw = await storageGet(env, "active_trip_state");
      const active = activeRaw ? JSON.parse(activeRaw) : null;
      const rawCharges = await storageGet(env, "cloud_charging_history");
      const charges = rawCharges ? JSON.parse(rawCharges) : [];
      const activeChargeRaw = await storageGet(env, "active_charge_state");
      const activeCharge = activeChargeRaw ? JSON.parse(activeChargeRaw) : null;
      return new Response(JSON.stringify({
        success: true,
        trips,
        activeTrip: active,
        charges,
        activeCharge,
        tripCount: trips.length,
        chargeCount: charges.length
      }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    if (!phone || !password || !pin) {
      return new Response(JSON.stringify({ error: "Missing phone, password, or pin." }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    const nowSec = Math.floor(Date.now() / 1e3);
    const guardUntilStr = await storageGet(env, "battery_guard_cutoff_until");
    const guardUntilSec = guardUntilStr ? parseInt(guardUntilStr, 10) : 0;
    if (action === "poll-trip" && guardUntilSec > nowSec) {
      const remainingMin = Math.ceil((guardUntilSec - nowSec) / 60);
      return new Response(JSON.stringify({
        status: "low_battery_guard_active",
        message: `12V battery guard is active. Polling suspended for ${remainingMin} more minutes to protect vehicle battery. 0 requests sent to car.`,
        remainingMinutes: remainingMin
      }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    try {
      const client = new MgIndiaClient({
        phone,
        password,
        vin,
        pinHash: hashControlPin2(pin)
      });
      await client.login();
      if (!client.vin) {
        await client.vehicles();
      }
      if (action === "unlock") {
        await client.controlDoorLock(false);
        return new Response(JSON.stringify({ success: true, message: "Doors unlocked successfully" }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
      if (action === "lock") {
        await client.controlDoorLock(true);
        return new Response(JSON.stringify({ success: true, message: "Doors locked successfully" }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
      if (action === "climate-on") {
        await client.controlClimate(true);
        return new Response(JSON.stringify({ success: true, message: "Climate AC turned on" }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
      if (action === "climate-off") {
        await client.controlClimate(false);
        return new Response(JSON.stringify({ success: true, message: "Climate AC turned off" }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
      const snap = await client.snapshot(true);
      const st = snap.status;
      const ch = st?.charge;
      const rawBasic = st?.raw?.basicVehicleStatus || st?.raw || {};
      const auxVoltage = typeof rawBasic.batteryVoltage === "number" && rawBasic.batteryVoltage > 0 ? Number((rawBasic.batteryVoltage / 10).toFixed(1)) : 12.6;
      const BATTERY_CUTOFF_THRESHOLD = 12.2;
      if (auxVoltage < BATTERY_CUTOFF_THRESHOLD && !ch?.is_charging) {
        const lockoutDurationSec = 4 * 3600;
        await storagePut(env, "battery_guard_cutoff_until", String(nowSec + lockoutDurationSec));
        return new Response(JSON.stringify({
          status: "low_battery_guard_triggered",
          auxVoltage,
          message: `12V battery voltage dropped to ${auxVoltage}V (below ${BATTERY_CUTOFF_THRESHOLD}V). Polling suspended for 4 hours to prevent battery discharge.`,
          lockoutUntilSec: nowSec + lockoutDurationSec
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
      if (action === "status") {
        const soc = ch?.soc ?? st?.fuel_level ?? 0;
        const range = ch?.range_km ?? st?.range_km ?? 0;
        return new Response(JSON.stringify({
          soc,
          rangeKm: range,
          auxBatteryVoltage: auxVoltage,
          locked: st?.locked,
          climateRunning: st?.climate_running,
          powerMode: st?.power_mode_raw
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
      if (action === "poll-trip") {
        const currentSoc = ch?.soc ?? st?.fuel_level ?? 0;
        const usableCap = ch?.total_battery_capacity_kwh && ch.total_battery_capacity_kwh > 10 ? ch.total_battery_capacity_kwh : 37.3;
        const currentEnergyKwh = ch?.battery_energy_kwh && ch.battery_energy_kwh > 0 ? ch.battery_energy_kwh : Number((currentSoc / 100 * usableCap).toFixed(2));
        const currentOdo = ch?.odometer_km ?? st?.odometer_km ?? 0;
        const currentSpeed = st?.gps?.speed_kmh ?? 0;
        const currentLat = st?.gps?.latitude ?? null;
        const currentLng = st?.gps?.longitude ?? null;
        const isChargingNow = Boolean(ch && ch.is_charging);
        const activeChargeRaw = await storageGet(env, "active_charge_state");
        let activeCharge = activeChargeRaw ? JSON.parse(activeChargeRaw) : null;
        const liveKw = ch?.charging_current && ch?.charging_voltage ? Number((ch.charging_voltage * ch.charging_current / 1e3).toFixed(2)) : 0;
        if (isChargingNow) {
          if (!activeCharge) {
            activeCharge = {
              id: `chg-${nowSec}`,
              startTimestampSec: nowSec,
              startDateTime: new Date(nowSec * 1e3).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
              startSoc: currentSoc,
              endSoc: currentSoc,
              startEnergyKwh: currentEnergyKwh,
              endEnergyKwh: currentEnergyKwh,
              maxKw: liveKw,
              liveKw,
              voltage: ch?.charging_voltage,
              current: ch?.charging_current,
              odometerKm: currentOdo,
              // BMS freezes these at plug-in = the driving cycle that just ended
              cycleDistanceKm: ch?.distance_since_last_charge_km ?? 0,
              cycleEnergyKwh: ch?.power_usage_since_last_charge_kwh ?? 0,
              status: "charging"
            };
          } else {
            activeCharge.notChargingSinceSec = 0;
            activeCharge.endSoc = Math.max(activeCharge.endSoc, currentSoc);
            activeCharge.endEnergyKwh = Math.max(activeCharge.endEnergyKwh, currentEnergyKwh);
            activeCharge.maxKw = Math.max(activeCharge.maxKw || 0, liveKw);
            activeCharge.liveKw = liveKw;
            activeCharge.lastSampleSec = nowSec;
          }
          await storagePut(env, "active_charge_state", JSON.stringify(activeCharge));
        } else if (activeCharge && !activeCharge.notChargingSinceSec) {
          activeCharge.notChargingSinceSec = nowSec;
          await storagePut(env, "active_charge_state", JSON.stringify(activeCharge));
        } else if (activeCharge && nowSec - activeCharge.notChargingSinceSec >= 300) {
          const endSec = activeCharge.notChargingSinceSec;
          const durSec = Math.max(60, endSec - activeCharge.startTimestampSec);
          const durStr = `${Math.floor(durSec / 3600)}h ${Math.floor(durSec % 3600 / 60)}m`;
          const finalSoc = Math.max(activeCharge.endSoc, currentSoc);
          const finalEnergy = Math.max(activeCharge.endEnergyKwh, currentEnergyKwh);
          const addedPackKwh = Math.max(0, Number((finalEnergy - activeCharge.startEnergyKwh).toFixed(2)));
          const maxKw = activeCharge.maxKw || 0;
          const chargerCat = maxKw > 22 ? "DC Fast" : maxKw > 4 ? "7.4 kW AC" : "3.3 kW AC";
          const lossPct = chargerCat === "DC Fast" ? 7 : chargerCat === "7.4 kW AC" ? 10 : 13;
          const consumedWallKwh = Number((addedPackKwh / (1 - lossPct / 100)).toFixed(2));
          const completionStatus = finalSoc >= 99 ? "Full (100% Complete)" : `Stopped at ${finalSoc.toFixed(0)}% (Power Lost / Unplugged)`;
          let cycleKm = Number(activeCharge.cycleDistanceKm || 0);
          let cycleKwh = Number(activeCharge.cycleEnergyKwh || 0);
          const finalRange = ch?.range_km ?? st?.range_km ?? (finalSoc > 0 ? Math.round(finalSoc / 100 * 320) : 320);
          const completedChargeRecord = {
            id: activeCharge.id,
            startTimestampSec: activeCharge.startTimestampSec,
            endTimestampSec: endSec,
            startDateTime: activeCharge.startDateTime,
            endDateTime: new Date(endSec * 1e3).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
            durationSeconds: durSec,
            durationFormatted: durStr,
            startSoc: activeCharge.startSoc,
            endSoc: finalSoc,
            energyAddedToPackKwh: addedPackKwh,
            energyConsumedKwh: consumedWallKwh,
            energyLossPercent: lossPct,
            chargerCategory: chargerCat,
            maxChargingSpeedKw: maxKw,
            completionStatus,
            odometerKm: currentOdo,
            distanceToEmptyAfterKm: finalRange > 0 ? finalRange : Math.round(finalSoc / 100 * 320),
            rangeKm: finalRange > 0 ? finalRange : Math.round(finalSoc / 100 * 320),
            // Driving done BEFORE this charge (since the previous charge)
            distanceTravelledSinceLastChargeKm: cycleKm,
            energyUsedSinceLastChargeKwh: cycleKwh,
            efficiencyKmPerKwh: cycleKm > 0 && cycleKwh > 0 ? Number((cycleKm / cycleKwh).toFixed(2)) : 0,
            status: "completed"
          };
          const rawHistory = await storageGet(env, "cloud_charging_history");
          const chargeHistory = rawHistory ? JSON.parse(rawHistory) : [];
          chargeHistory.unshift(completedChargeRecord);
          if (chargeHistory.length > 200) chargeHistory.length = 200;
          await storagePut(env, "cloud_charging_history", JSON.stringify(chargeHistory));
          await storagePut(env, "active_charge_state", "");
        }
        const isDrivingOrReady = !ch?.is_charging && (st?.engine_status_raw === 1 || (st?.power_mode_raw ?? 0) > 0 || currentSpeed > 0.5);
        const activeTripRaw = await storageGet(env, "active_trip_state");
        let activeTrip = activeTripRaw ? JSON.parse(activeTripRaw) : null;
        if (isDrivingOrReady) {
          if (!activeTrip) {
            activeTrip = {
              id: `trip-${nowSec}`,
              startTimestampSec: nowSec,
              lastSampleTimeSec: nowSec,
              startSoc: currentSoc,
              endSoc: currentSoc,
              startEnergyKwh: currentEnergyKwh,
              endEnergyKwh: currentEnergyKwh,
              startOdometerKm: currentOdo,
              endOdometerKm: currentOdo,
              distanceKm: 0,
              durationSeconds: 0,
              idleDurationSeconds: 0,
              idleEnergyKwh: 0,
              maxSpeedKmh: currentSpeed,
              startLat: currentLat,
              startLng: currentLng,
              endLat: currentLat,
              endLng: currentLng,
              startCabinTempC: st?.interior_temperature ?? null,
              endCabinTempC: st?.interior_temperature ?? null,
              startExteriorTempC: st?.exterior_temperature ?? null,
              endExteriorTempC: st?.exterior_temperature ?? null,
              climateRunning: st?.climate_running ?? false
            };
          } else {
            const dtSec = Math.max(0, nowSec - (activeTrip.lastSampleTimeSec || nowSec));
            const odoDelta = Math.max(0, currentOdo - activeTrip.endOdometerKm);
            const isIdling = currentSpeed < 0.5 && odoDelta < 0.05 && dtSec > 0 && dtSec < 600;
            if (isIdling) {
              activeTrip.idleDurationSeconds += dtSec;
              const idleKw = st?.climate_running ? 0.65 : 0.25;
              activeTrip.idleEnergyKwh = Number(
                (activeTrip.idleEnergyKwh + idleKw * dtSec / 3600).toFixed(3)
              );
            }
            activeTrip.endSoc = currentSoc;
            activeTrip.endEnergyKwh = currentEnergyKwh;
            activeTrip.endOdometerKm = currentOdo;
            activeTrip.distanceKm = Number((currentOdo - activeTrip.startOdometerKm).toFixed(1));
            activeTrip.durationSeconds = Math.max(0, nowSec - activeTrip.startTimestampSec);
            activeTrip.maxSpeedKmh = Math.max(activeTrip.maxSpeedKmh, currentSpeed);
            activeTrip.endLat = currentLat ?? activeTrip.endLat;
            activeTrip.endLng = currentLng ?? activeTrip.endLng;
            activeTrip.endCabinTempC = st?.interior_temperature ?? activeTrip.endCabinTempC;
            activeTrip.endExteriorTempC = st?.exterior_temperature ?? activeTrip.endExteriorTempC;
            activeTrip.lastSampleTimeSec = nowSec;
          }
          await storagePut(env, "active_trip_state", JSON.stringify(activeTrip));
          return new Response(JSON.stringify({
            status: "driving_active",
            activeTrip: {
              durationMin: Math.round(activeTrip.durationSeconds / 60),
              distanceKm: activeTrip.distanceKm,
              idleMinutes: Math.round(activeTrip.idleDurationSeconds / 60),
              idleEnergyKwh: activeTrip.idleEnergyKwh,
              currentSpeed,
              auxVoltage
            }
          }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
        if (activeTrip) {
          const distKm = Number((currentOdo - activeTrip.startOdometerKm).toFixed(1));
          const durSec = Math.max(60, nowSec - activeTrip.startTimestampSec);
          const usedKwh = Math.max(0, Number((activeTrip.startEnergyKwh - currentEnergyKwh).toFixed(2)));
          const eff = usedKwh > 0 && distKm > 0 ? Number((distKm / usedKwh).toFixed(2)) : 0;
          const avgSpd = durSec > 0 && distKm > 0 ? Number((distKm / (durSec / 3600)).toFixed(1)) : 0;
          const completedRecord = {
            id: activeTrip.id,
            startTimestampSec: activeTrip.startTimestampSec,
            endTimestampSec: nowSec,
            startDateTime: new Date(activeTrip.startTimestampSec * 1e3).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
            endDateTime: new Date(nowSec * 1e3).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
            startSoc: activeTrip.startSoc,
            endSoc: currentSoc,
            startEnergyKwh: activeTrip.startEnergyKwh,
            endEnergyKwh: currentEnergyKwh,
            durationSeconds: durSec,
            distanceKm: distKm,
            startOdometerKm: activeTrip.startOdometerKm,
            endOdometerKm: currentOdo,
            energyUsedKwh: usedKwh,
            efficiencyKmPerKwh: eff,
            idleDurationSeconds: activeTrip.idleDurationSeconds,
            idleEnergyKwh: Number(activeTrip.idleEnergyKwh.toFixed(2)),
            maxSpeedKmh: activeTrip.maxSpeedKmh,
            avgSpeedKmh: avgSpd,
            startCabinTempC: activeTrip.startCabinTempC,
            endCabinTempC: st?.interior_temperature ?? activeTrip.endCabinTempC,
            startExteriorTempC: activeTrip.startExteriorTempC,
            endExteriorTempC: st?.exterior_temperature ?? activeTrip.endExteriorTempC,
            startLat: activeTrip.startLat,
            startLng: activeTrip.startLng,
            endLat: currentLat,
            endLng: currentLng,
            status: "completed"
          };
          const historyRaw = await storageGet(env, "cloud_trips_history");
          const history = historyRaw ? JSON.parse(historyRaw) : [];
          if (distKm >= 0.2) {
            history.unshift(completedRecord);
          }
          if (history.length > 200) history.length = 200;
          await storagePut(env, "cloud_trips_history", JSON.stringify(history));
          await storagePut(env, "active_trip_state", "");
          return new Response(JSON.stringify({
            status: "trip_completed_and_saved",
            trip: completedRecord
          }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
        return new Response(JSON.stringify({
          status: "vehicle_parked",
          message: "Vehicle is parked and ignition is OFF. No active trip.",
          auxVoltage,
          soc: currentSoc,
          odometerKm: currentOdo
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
  },
  // Native Cloudflare Cron Trigger (Runs automatically if scheduled in wrangler or dashboard)
  async scheduled(event, env) {
  }
};

// cloudflare-worker/worker.ts
var USER_AGENT = "CER_IKE_01/2.3.0 (iPad; iOS 26.3; Scale/2.00)";
var ALLOWED_HOSTS = /* @__PURE__ */ new Set(["iov-tap.mgindia.co.in", "iov-gateway.mgindia.co.in"]);
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "APP-SEND-DATE, ORIGINAL-CONTENT-TYPE, app-send-date, original-content-type, x-mg-send-date"
};
var worker_default = {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const reqUrl = new URL(request.url);
    const targetUrlStr = reqUrl.searchParams.get("url");
    if (!targetUrlStr) {
      return new Response(
        JSON.stringify({ status: "ok", service: "MG iSMART India Edge Worker" }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
    let targetUrl;
    try {
      targetUrl = new URL(targetUrlStr);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid target URL" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }
    if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
      return new Response(JSON.stringify({ error: "Forbidden target host" }), {
        status: 403,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }
    try {
      const forwardHeaders = new Headers();
      forwardHeaders.set("User-Agent", USER_AGENT);
      for (const [k, v] of request.headers.entries()) {
        const upper = k.toUpperCase();
        if (upper.startsWith("APP-") || upper === "SIGNATURE" || upper === "ORIGINAL-CONTENT-TYPE" || upper === "CONTENT-TYPE" || upper === "ACCEPT" || upper === "ACCEPT-LANGUAGE") {
          forwardHeaders.set(upper, v);
        }
      }
      const upstream = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: forwardHeaders,
        body: request.method !== "GET" && request.method !== "HEAD" ? await request.text() : void 0
      });
      const outHeaders = new Headers(CORS_HEADERS);
      outHeaders.set("Content-Type", upstream.headers.get("Content-Type") || "text/plain");
      const sendDate = upstream.headers.get("APP-SEND-DATE") || upstream.headers.get("app-send-date");
      if (sendDate) {
        outHeaders.set("APP-SEND-DATE", sendDate);
        outHeaders.set("x-mg-send-date", sendDate);
      }
      const origCt = upstream.headers.get("ORIGINAL-CONTENT-TYPE") || upstream.headers.get("original-content-type");
      if (origCt) {
        outHeaders.set("ORIGINAL-CONTENT-TYPE", origCt);
      }
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: outHeaders
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e.message || "Upstream fetch to MG failed" }),
        {
          status: 502,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        }
      );
    }
  }
};

// cloudflare-worker/multi-worker.ts
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "APP-SEND-DATE, ORIGINAL-CONTENT-TYPE, app-send-date, original-content-type, x-mg-send-date"
};
var json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", ...CORS }
});
var TRIP_HEADERS = [
  "Trip ID",
  "Date (IST)",
  "Start Time",
  "End Time",
  "Duration",
  "Distance (km)",
  "Start Odo (km)",
  "End Odo (km)",
  "Start Battery %",
  "End Battery %",
  "Energy Used (kWh)",
  "Efficiency (km/kWh)",
  "Start Location",
  "Destination",
  "Idling Duration",
  "Idling Energy (kWh)",
  "Cabin Temp (\xB0C)",
  "Ambient Temp (\xB0C)",
  "Max Speed (km/h)",
  "Average Speed (km/h)",
  "Data (do not edit)"
];
var CHARGE_HEADERS = [
  "Session ID",
  "Date (IST)",
  "Start Time",
  "End Time",
  "Duration",
  "Start Battery %",
  "End Battery %",
  "Energy Added (kWh)",
  "Wall Energy (kWh)",
  "Loss (%)",
  "Charger Speed Category",
  "Peak Speed (kW)",
  "Completion Status",
  "Odometer (km)",
  "Driving Before This Charge (km)",
  "Energy Used Before This Charge (kWh)",
  "Driving Efficiency Before This Charge (km/kWh)",
  "Data (do not edit)"
];
function kvOrThrow(env) {
  if (!env.TRIP_KV) throw new Error("KV namespace TRIP_KV is not bound to this worker");
  return env.TRIP_KV;
}
async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomHex(bytes = 24) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function loadUser(env, id) {
  const raw = await kvOrThrow(env).get(`u:${id}`, "text");
  return raw ? JSON.parse(raw) : null;
}
async function saveUser(env, u) {
  await kvOrThrow(env).put(`u:${u.id}`, JSON.stringify(u));
}
async function authUser(env, url, body) {
  const id = (url.searchParams.get("userId") || url.searchParams.get("id") || body?.userId || "").trim();
  const key = (url.searchParams.get("userKey") || url.searchParams.get("key") || body?.userKey || "").trim();
  if (!id || !key) return null;
  const u = await loadUser(env, id);
  if (!u) return null;
  const h = await sha256(key);
  if (u.keyHash === h) return u;
  if (Array.isArray(u.keyHashes) && u.keyHashes.includes(h)) return u;
  if (u.userKey === key || u.key === key) return u;
  if (!u.keyHash && (!u.keyHashes || !u.keyHashes.length)) {
    u.keyHash = h;
    u.keyHashes = [h];
    await saveUser(env, u);
    return u;
  }
  return null;
}
var fmtDur = (s) => `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m`;
var VAPID_PUB_B64URL = "BEDIJNL78q2CN6h-Mbf3xfqUKUM5HNR0tjZw4aikdcnztJaOJaP4Xz6ismoVROcaJW760XDrGDUE4byQayacUWE";
var VAPID_JWK_X = "QMgk0vvyrYI3qH4xt_fF-pQpQzkc1HS2NnDhqKR1yfM";
var VAPID_JWK_Y = "tJaOJaP4Xz6ismoVROcaJW760XDrGDUE4byQayacUWE";
var VAPID_JWK_D = "P-IKz-Y1iVBinAM9oqTAuCpDG_7xrV8s1ABy0GjVRnw";
var VAPID_SUBJECT = "mailto:tonyjoseph456@gmail.com";
function bytesToB64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(b64url) {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function createVapidJwt(audience) {
  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1e3);
  const payload = {
    aud: audience,
    exp: now + 86400,
    sub: VAPID_SUBJECT
  };
  const headerB64 = bytesToB64url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = bytesToB64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const privKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: VAPID_JWK_X,
      y: VAPID_JWK_Y,
      d: VAPID_JWK_D
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`;
}
async function encryptWebPushPayload(clientP256dhB64url, clientAuthB64url, payloadStr) {
  const clientPubRaw = b64urlToBytes(clientP256dhB64url);
  const clientAuth = b64urlToBytes(clientAuthB64url);
  const payloadBytes = new TextEncoder().encode(payloadStr);
  const serverEcdh = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", serverEcdh.publicKey));
  const importedClientPub = await crypto.subtle.importKey(
    "raw",
    clientPubRaw,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const ecdhSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: importedClientPub },
    serverEcdh.privateKey,
    256
  );
  const te = new TextEncoder();
  const infoPrefix = te.encode("WebPush: info\0");
  const authInfo = new Uint8Array(infoPrefix.length + clientPubRaw.length + serverPubRaw.length);
  authInfo.set(infoPrefix, 0);
  authInfo.set(clientPubRaw, infoPrefix.length);
  authInfo.set(serverPubRaw, infoPrefix.length + clientPubRaw.length);
  const ikmBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: clientAuth, info: authInfo },
    await crypto.subtle.importKey("raw", ecdhSecret, "HKDF", false, ["deriveBits"]),
    256
  );
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const cekInfo = te.encode("Content-Encoding: aes128gcm\0");
  const ikmKey = await crypto.subtle.importKey("raw", ikmBits, "HKDF", false, ["deriveBits", "deriveKey"]);
  const cek = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: cekInfo },
    ikmKey,
    { name: "AES-GCM", length: 128 },
    false,
    ["encrypt"]
  );
  const nonceInfo = te.encode("Content-Encoding: nonce\0");
  const nonceBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: nonceInfo },
    ikmKey,
    96
  );
  const nonce = new Uint8Array(nonceBits);
  const recordPlaintext = new Uint8Array(payloadBytes.length + 1);
  recordPlaintext.set(payloadBytes, 0);
  recordPlaintext[payloadBytes.length] = 2;
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    cek,
    recordPlaintext
  );
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = 65;
  header.set(serverPubRaw, 21);
  const body = new Uint8Array(header.length + ciphertext.byteLength);
  body.set(header, 0);
  body.set(new Uint8Array(ciphertext), header.length);
  return body;
}
async function sendPushToSubscription(sub, payload) {
  try {
    const pushUrl = new URL(sub.endpoint);
    const audience = `${pushUrl.protocol}//${pushUrl.host}`;
    const jwt = await createVapidJwt(audience);
    const body = await encryptWebPushPayload(sub.keys.p256dh, sub.keys.auth, JSON.stringify(payload));
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        TTL: "86400",
        Urgency: "high",
        Authorization: `vapid t=${jwt}, k=${VAPID_PUB_B64URL}`,
        "Crypto-Key": `p256ecdsa=${VAPID_PUB_B64URL}`
      },
      body
    });
    const isExpired = res.status === 404 || res.status === 410;
    return { ok: res.ok, status: res.status, expired: isExpired };
  } catch (_) {
    return { ok: false, status: 0 };
  }
}
async function notifyUser(env, u, payload) {
  if (!Array.isArray(u.pushSubscriptions) || u.pushSubscriptions.length === 0) return;
  const expiredEndpoints = /* @__PURE__ */ new Set();
  await Promise.allSettled(
    u.pushSubscriptions.map(async (sub) => {
      const res = await sendPushToSubscription(sub, payload);
      if (res.expired) expiredEndpoints.add(sub.endpoint);
    })
  );
  if (expiredEndpoints.size > 0) {
    u.pushSubscriptions = u.pushSubscriptions.filter(
      (s) => !expiredEndpoints.has(s.endpoint)
    );
  }
}
async function exchangeCode(env, code, redirectUri) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID || "",
      client_secret: env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Google token exchange failed: ${d.error_description || d.error}`);
  return d;
}
async function googleAccessToken(env, u) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID || "",
      client_secret: env.GOOGLE_CLIENT_SECRET || "",
      refresh_token: u.googleRefresh,
      grant_type: "refresh_token"
    })
  });
  const d = await r.json();
  if (!r.ok) {
    if (d.error === "invalid_grant") u.googleStatus = "revoked";
    throw new Error(`Google refresh failed: ${d.error}`);
  }
  u.googleStatus = "ok";
  return d.access_token;
}
async function createSheet(token, title, headers) {
  const r = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: "Log", gridProperties: { frozenRowCount: 1 } } }]
    })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Create sheet failed: ${d.error?.message}`);
  await appendRows(token, d.spreadsheetId, [headers]);
  return d.spreadsheetId;
}
async function appendRows(token, sheetId, rows) {
  let r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Log!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: rows })
    }
  );
  if (!r.ok) {
    r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: rows })
      }
    );
  }
  if (!r.ok) throw new Error(`Append failed: HTTP ${r.status}`);
}
function istIso(sec) {
  const safeSec = typeof sec === "number" && !isNaN(sec) ? sec : Math.floor(Date.now() / 1e3);
  const iso = new Date((safeSec + 19800) * 1e3).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
}
var tripRow = (t) => {
  const s = istIso(t.startTimestampSec);
  const e = istIso(t.endTimestampSec || t.startTimestampSec);
  const durSec = t.durationSeconds || (t.endTimestampSec && t.startTimestampSec ? Math.max(0, t.endTimestampSec - t.startTimestampSec) : 0);
  return [
    t.id,
    s.date,
    s.time,
    e.time,
    fmtDur(durSec),
    t.distanceKm ?? 0,
    t.startOdometerKm ?? 0,
    t.endOdometerKm ?? 0,
    Number(Number(t.startSoc ?? 0).toFixed(1)),
    Number(Number(t.endSoc ?? 0).toFixed(1)),
    t.energyUsedKwh ?? 0,
    t.efficiencyKmPerKwh ?? 0,
    t.startLocation || (t.startLat != null ? `${t.startLat},${t.startLng}` : "--"),
    t.endLocation || (t.endLat != null ? `${t.endLat},${t.endLng}` : "--"),
    fmtDur(t.idleDurationSeconds || 0),
    t.idleEnergyKwh ?? 0,
    t.endCabinTempC ?? t.cabinTempC ?? "",
    t.endExteriorTempC ?? t.exteriorTempC ?? "",
    t.maxSpeedKmh ?? 0,
    t.avgSpeedKmh ?? 0,
    JSON.stringify(t)
  ];
};
var chargeRow = (c) => {
  const s = istIso(c.startTimestampSec);
  const e = istIso(c.endTimestampSec || c.startTimestampSec);
  const dur = c.durationFormatted || fmtDur(c.durationSeconds || (c.endTimestampSec && c.startTimestampSec ? Math.max(0, c.endTimestampSec - c.startTimestampSec) : 0));
  return [
    c.id,
    s.date,
    s.time,
    e.time,
    dur,
    Number(Number(c.startSoc ?? 0).toFixed(1)),
    Number(Number(c.endSoc ?? 0).toFixed(1)),
    c.energyAddedToPackKwh ?? 0,
    c.energyConsumedKwh ?? 0,
    c.energyLossPercent ?? 0,
    c.chargerCategory || "3.3 kW AC",
    c.maxChargingSpeedKw ?? 0,
    c.completionStatus || c.status || "completed",
    c.odometerKm ?? 0,
    c.distanceTravelledSinceLastChargeKm ?? 0,
    c.energyUsedSinceLastChargeKwh ?? 0,
    c.efficiencyKmPerKwh ?? 0,
    JSON.stringify(c)
  ];
};
async function clearAndRewriteSheet(token, sheetId, headers, rows) {
  let tabName = "Log";
  let r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Log!A1:Z5000:clear`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    }
  );
  if (!r.ok) {
    tabName = "Sheet1";
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A1:Z5000:clear`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      }
    );
  }
  const allValues = [headers, ...rows];
  const putResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${tabName}!A1?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: allValues })
    }
  );
  if (!putResp.ok) {
    const errText = await putResp.text();
    throw new Error(`Rewrite sheet failed: HTTP ${putResp.status} - ${errText}`);
  }
}
function deduplicateTripList(trips) {
  if (!trips || !trips.length) return [];
  const valid = trips.filter((t) => Number(t?.distanceKm ?? 0) >= 0.2 || t?.status === "driving");
  valid.sort((a, b) => {
    const timeA = a.startTimestampSec || 0;
    const timeB = b.startTimestampSec || 0;
    if (timeA !== timeB) return timeB - timeA;
    return (b.distanceKm || 0) - (a.distanceKm || 0);
  });
  const clean = [];
  for (const t of valid) {
    const tId = String(t.id || "");
    const tJourney = t.journeyId != null ? Number(t.journeyId) : null;
    const tStartSec = Number(t.startTimestampSec || 0);
    const tEndSec = Number(t.endTimestampSec || tStartSec);
    const tStartOdo = Number(t.startOdometerKm || 0);
    const tEndOdo = Number(t.endOdometerKm || 0);
    const tDist = Number(t.distanceKm || 0);
    let isDuplicate = false;
    for (let i = 0; i < clean.length; i++) {
      const c = clean[i];
      const cId = String(c.id || "");
      const cJourney = c.journeyId != null ? Number(c.journeyId) : null;
      const cStartSec = Number(c.startTimestampSec || 0);
      const cEndSec = Number(c.endTimestampSec || cStartSec);
      const cStartOdo = Number(c.startOdometerKm || 0);
      const cEndOdo = Number(c.endOdometerKm || 0);
      const cDist = Number(c.distanceKm || 0);
      if (tId && cId && tId === cId) {
        isDuplicate = true;
        break;
      }
      if (tJourney != null && cJourney != null && tJourney === cJourney) {
        if (tDist > cDist || tStartSec < cStartSec && tEndSec >= cEndSec) {
          clean[i] = t;
        }
        isDuplicate = true;
        break;
      }
      const sameEndOdo = tEndOdo > 0 && cEndOdo > 0 && Math.abs(tEndOdo - cEndOdo) <= 0.25;
      const timeOverlaps = tStartSec <= cEndSec + 90 && tEndSec >= cStartSec - 90;
      if (sameEndOdo && timeOverlaps) {
        if (tDist > cDist || tStartSec < cStartSec && tEndSec >= cEndSec) {
          clean[i] = t;
        }
        isDuplicate = true;
        break;
      }
      const sameStartOdo = tStartOdo > 0 && cStartOdo > 0 && Math.abs(tStartOdo - cStartOdo) <= 0.25;
      const sameStartTime = Math.abs(tStartSec - cStartSec) <= 120;
      if (sameStartOdo && sameStartTime) {
        if (tDist > cDist) {
          clean[i] = t;
        }
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      clean.push(t);
    }
  }
  return clean;
}
function isValidChargeRecord(c) {
  if (!c || typeof c !== "object") return false;
  const id = String(c.id || "");
  if (id === "chg-1793725580" && (!c.startTimestampSec || Number(c.energyAddedToPackKwh || 0) <= 0)) {
    return false;
  }
  const startSec = Number(c.startTimestampSec || 0);
  const startSoc = Number(c.startSoc || 0);
  const endSoc = Number(c.endSoc || 0);
  const energyAdded = Number(c.energyAddedToPackKwh || 0);
  const durSec = Number(c.durationSeconds || 0);
  if (!startSec || startSec < 1704067200) {
    if (!c.startDateTime || c.startDateTime === "--") return false;
  }
  if (endSoc <= 1 && startSoc > 5) return false;
  if (energyAdded <= 0 && endSoc - startSoc <= 0.5 && durSec <= 60) {
    if (c.status !== "charging") return false;
  }
  if (c.endDateTime === "Charging in progress..." && c.status === "completed" && energyAdded <= 0) {
    return false;
  }
  return true;
}
function deduplicateChargeList(charges) {
  if (!charges || !charges.length) return [];
  const valid = charges.filter(isValidChargeRecord);
  valid.sort((a, b) => {
    const timeA = Number(a.startTimestampSec || 0);
    const timeB = Number(b.startTimestampSec || 0);
    if (timeA !== timeB) return timeB - timeA;
    return Number(b.energyAddedToPackKwh || 0) - Number(a.energyAddedToPackKwh || 0);
  });
  const clean = [];
  for (const c of valid) {
    const cId = String(c.id || "");
    const cStartSec = Number(c.startTimestampSec || 0);
    const cEndSec = Number(c.endTimestampSec || cStartSec);
    const cOdo = Number(c.odometerKm || 0);
    const cEndSoc = Number(c.endSoc || 0);
    const cEnergy = Number(c.energyAddedToPackKwh || 0);
    let isDup = false;
    for (let i = 0; i < clean.length; i++) {
      const x = clean[i];
      const xId = String(x.id || "");
      const xStartSec = Number(x.startTimestampSec || 0);
      const xEndSec = Number(x.endTimestampSec || xStartSec);
      const xOdo = Number(x.odometerKm || 0);
      const xEndSoc = Number(x.endSoc || 0);
      const xEnergy = Number(x.energyAddedToPackKwh || 0);
      if (cId && xId && cId === xId) {
        if (cEnergy > xEnergy) clean[i] = c;
        isDup = true;
        break;
      }
      if (cStartSec > 0 && xStartSec > 0 && Math.abs(cStartSec - xStartSec) < 900) {
        if (cEnergy > xEnergy) clean[i] = c;
        isDup = true;
        break;
      }
      if (cOdo > 0 && xOdo > 0 && Math.abs(cOdo - xOdo) <= 0.5) {
        const timeOverlaps = cStartSec <= xEndSec + 1800 && cEndSec >= xStartSec - 1800;
        const socSimilar = Math.abs(cEndSoc - xEndSoc) <= 2;
        if (timeOverlaps || socSimilar) {
          if (cEnergy > xEnergy) clean[i] = c;
          isDup = true;
          break;
        }
      }
    }
    if (!isDup) {
      clean.push(c);
    }
  }
  return clean;
}
async function cleanGoogleSheetTripsAndCharges(token, tripSheetId, chargeSheetId, u) {
  let tripsBefore = 0;
  let tripsAfter = 0;
  let tripsRemoved = 0;
  if (tripSheetId) {
    const existing = await readSheetRecords(token, tripSheetId).catch(() => []);
    tripsBefore = existing.length;
    const cleanTrips = deduplicateTripList(existing);
    tripsAfter = cleanTrips.length;
    tripsRemoved = Math.max(0, tripsBefore - tripsAfter);
    if (tripsRemoved > 0 || tripsBefore !== tripsAfter) {
      cleanTrips.sort((a, b) => (a.startTimestampSec || 0) - (b.startTimestampSec || 0));
      await clearAndRewriteSheet(token, tripSheetId, TRIP_HEADERS, cleanTrips.map(tripRow));
      if (u) {
        u.trips = cleanTrips.slice(0, 60);
        u.pendingTrips = [];
      }
    }
  }
  let chargesBefore = 0;
  let chargesAfter = 0;
  let chargesRemoved = 0;
  if (chargeSheetId) {
    const existing = await readSheetRecords(token, chargeSheetId).catch(() => []);
    chargesBefore = existing.length;
    const cleanCharges = deduplicateChargeList(existing);
    chargesAfter = cleanCharges.length;
    chargesRemoved = Math.max(0, chargesBefore - chargesAfter);
    if (chargesRemoved > 0 || chargesBefore !== chargesAfter) {
      cleanCharges.sort((a, b) => (a.startTimestampSec || 0) - (b.startTimestampSec || 0));
      await clearAndRewriteSheet(token, chargeSheetId, CHARGE_HEADERS, cleanCharges.map(chargeRow));
      if (u) {
        u.charges = cleanCharges.slice(0, 60);
        u.pendingCharges = [];
      }
    }
  }
  return { tripsBefore, tripsAfter, tripsRemoved, chargesBefore, chargesAfter, chargesRemoved };
}
async function readSheetRecords(token, sheetId) {
  let r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Log!A2:Z5000?valueRenderOption=UNFORMATTED_VALUE`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) {
    r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A2:Z5000?valueRenderOption=UNFORMATTED_VALUE`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
  }
  if (!r.ok) {
    r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A2:Z5000?valueRenderOption=UNFORMATTED_VALUE`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
  }
  if (!r.ok) return [];
  const d = await r.json();
  const out = [];
  for (const row of d.values || []) {
    let parsed = null;
    for (let i = row.length - 1; i >= 0; i--) {
      if (typeof row[i] === "string" && row[i].startsWith("{")) {
        try {
          parsed = JSON.parse(row[i]);
          break;
        } catch (_) {
        }
      }
    }
    if (parsed) {
      out.push(parsed);
    } else if (row && row[0]) {
      const isCharge = String(row[0]).startsWith("chg-");
      if (isCharge) {
        out.push({
          id: String(row[0]),
          startSoc: Number(row[5]) || 0,
          endSoc: Number(row[6]) || 0,
          energyAddedToPackKwh: Number(row[7]) || 0,
          energyConsumedKwh: Number(row[8]) || 0,
          energyLossPercent: Number(row[9]) || 0,
          chargerCategory: String(row[10] || "3.3 kW AC"),
          maxChargingSpeedKw: Number(row[11]) || 0,
          status: String(row[12] || "completed"),
          odometerKm: Number(row[13]) || 0,
          distanceTravelledSinceLastChargeKm: Number(row[14]) || 0,
          energyUsedSinceLastChargeKwh: Number(row[15]) || 0,
          efficiencyKmPerKwh: Number(row[16]) || 0
        });
      } else {
        out.push({
          id: String(row[0]),
          distanceKm: Number(row[5]) || 0,
          startOdometerKm: Number(row[6]) || 0,
          endOdometerKm: Number(row[7]) || 0,
          startSoc: Number(row[8]) || 0,
          endSoc: Number(row[9]) || 0,
          energyUsedKwh: Number(row[10]) || 0,
          efficiencyKmPerKwh: Number(row[11]) || 0,
          startLocation: row[12] || "",
          endLocation: row[13] || ""
        });
      }
    }
  }
  return out.sort((a, b) => (b.startTimestampSec || 0) - (a.startTimestampSec || 0));
}
async function runCron(env) {
}
function redirectPage(target, title) {
  const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{background:#0B132B;color:#94A3B8;font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
.b{background:#1C2541;padding:28px;border-radius:16px;border:1px solid #3A506B;max-width:320px}h2{color:#10B981;margin:0 0 10px}
a{display:inline-block;padding:12px 24px;background:#10B981;color:#fff;border-radius:10px;text-decoration:none;font-weight:bold}</style></head>
<body><div class="b"><h2>${title}</h2><p>Returning you to the app...</p><a href="${target}">Open MG Windsor EV App</a></div>
<script>setTimeout(function(){window.location.replace(${JSON.stringify(target)})},50);<\/script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
function finishSignIn(env, url, query, title) {
  const state = (url.searchParams.get("state") || "").trim();
  if (state.startsWith("http://") || state.startsWith("https://")) {
    let targetOrigin = state.replace(/\/$/, "");
    try {
      targetOrigin = new URL(state).origin;
    } catch (_) {
    }
    const allowed = (env.WEB_APP_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/$/, "").toLowerCase()).filter(Boolean);
    const isAllowed = allowed.length === 0 || allowed.includes(targetOrigin.toLowerCase()) || targetOrigin.toLowerCase().endsWith(".pages.dev") || targetOrigin.startsWith("https://") || targetOrigin.includes("localhost") || targetOrigin.includes("127.0.0.1");
    if (!isAllowed) {
      return new Response(
        `Web app origin "${targetOrigin}" is not in the allowed list.

Add it to WEB_APP_ORIGINS in your Cloudflare Worker Settings > Variables.
Allowed list currently: ${allowed.join(", ") || "(none)"}`,
        { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    }
    const targetUrl = `${targetOrigin}/?${query}`;
    const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Returning to MG iSMART...</title>
<style>body{background:#0A0E17;color:#94A3B8;font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
.b{background:#1C2541;padding:28px;border-radius:16px;border:1px solid #3A506B;max-width:320px}h2{color:#10B981;margin:0 0 10px}
a{display:inline-block;padding:12px 24px;background:#10B981;color:#fff;border-radius:10px;text-decoration:none;font-weight:bold}</style></head>
<body><div class="b"><h2>\u2705 Connected to Google!</h2><p>Returning you to the MG Windsor EV app...</p><a href="${targetUrl}">Open MG Windsor EV App</a></div>
<script>window.location.replace(${JSON.stringify(targetUrl)});<\/script></body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  return redirectPage(`mgismart://google-auth?${query}`, title);
}
async function handleGoogleCallback(env, url) {
  const err = url.searchParams.get("error");
  if (err) return finishSignIn(env, url, `error=${encodeURIComponent(err)}`, "Sign-in cancelled");
  const code = url.searchParams.get("code");
  if (!code) return finishSignIn(env, url, "error=no_code", "Sign-in failed");
  try {
    const redirectUri = `${url.origin}/google-callback`;
    const tok = await exchangeCode(env, code, redirectUri);
    const prof = await (await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tok.access_token}` }
    })).json();
    const email = prof.email || "unknown";
    const kv = kvOrThrow(env);
    let id = await kv.get(`e:${email}`, "text");
    let u = id ? await loadUser(env, id) : null;
    const userKey = randomHex(24);
    const newHash = await sha256(userKey);
    if (!u) {
      id = randomHex(8);
      const tripSheetId = await createSheet(tok.access_token, "MG Windsor EV - Trip Logs", TRIP_HEADERS);
      const chargeSheetId = await createSheet(tok.access_token, "MG Windsor EV - Charging Sessions", CHARGE_HEADERS);
      u = {
        id,
        email,
        name: prof.name || email,
        createdSec: Math.floor(Date.now() / 1e3),
        googleRefresh: tok.refresh_token || "",
        googleStatus: "ok",
        tripSheetId,
        chargeSheetId,
        mg: null,
        mgStatus: "none",
        activeTrip: null,
        activeCharge: null,
        trips: [],
        charges: [],
        pendingTrips: [],
        pendingCharges: [],
        keyHash: newHash,
        keyHashes: [newHash]
      };
      const ids = JSON.parse(await kv.get("users", "text") || "[]");
      ids.push(id);
      await kv.put("users", JSON.stringify(ids));
      await kv.put(`e:${email}`, id);
    } else {
      if (tok.refresh_token) {
        u.googleRefresh = tok.refresh_token;
        u.googleStatus = "ok";
      }
      u.keyHash = newHash;
      const existing = Array.isArray(u.keyHashes) ? u.keyHashes : u.keyHash ? [u.keyHash] : [];
      existing.push(newHash);
      u.keyHashes = existing.slice(-10);
    }
    await saveUser(env, u);
    const q = new URLSearchParams({
      userId: u.id,
      userKey,
      email,
      name: u.name,
      tripSheetId: u.tripSheetId,
      chargeSheetId: u.chargeSheetId
    });
    return finishSignIn(env, url, q.toString(), "\u2705 Background tracking connected");
  } catch (e) {
    return finishSignIn(env, url, `error=${encodeURIComponent(e.message)}`, "Sign-in failed");
  }
}
async function initD1(db) {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS trips (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        start_timestamp INTEGER NOT NULL,
        end_timestamp INTEGER,
        duration_seconds INTEGER,
        distance_km REAL,
        start_odometer_km REAL,
        end_odometer_km REAL,
        start_soc INTEGER,
        end_soc INTEGER,
        energy_used_kwh REAL,
        efficiency_km_per_kwh REAL,
        start_location TEXT,
        end_location TEXT,
        avg_speed_kmh REAL,
        max_speed_kmh REAL,
        status TEXT DEFAULT 'completed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(date);
      CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);

      CREATE TABLE IF NOT EXISTS charges (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        start_timestamp INTEGER NOT NULL,
        end_timestamp INTEGER,
        duration_seconds INTEGER,
        start_soc INTEGER,
        end_soc INTEGER,
        energy_added_kwh REAL,
        charger_type TEXT,
        peak_kw REAL,
        odometer_km REAL,
        status TEXT DEFAULT 'completed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_charges_date ON charges(date);

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        date TEXT NOT NULL,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_timestamp ON notifications(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_date ON notifications(date);
    `);
  } catch (err) {
    console.warn("initD1 warning:", err);
  }
}
async function resolveLocation(lat, lng) {
  if (!lat || !lng) return "Unknown Location";
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16`, {
      headers: {
        "User-Agent": "MGWindsorEV-CarPlay/1.0",
        "Accept": "application/json"
      }
    });
    if (res.ok) {
      const data = await res.json();
      const addr = data.address || {};
      const road = addr.road || addr.suburb || addr.neighbourhood || "";
      const city = addr.city || addr.town || addr.village || addr.county || "";
      if (road && city) return `${road}, ${city}`;
      if (city) return city;
      if (data.display_name) return data.display_name.split(",").slice(0, 2).join(",").trim();
    }
  } catch (_) {
  }
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}
function istDateString(sec) {
  const d = new Date((sec + 19800) * 1e3);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function formatDurationSec(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h} hr ${remM} min`;
  }
  return `${m} min ${s} sec`;
}
function formatClockTime(sec) {
  const d = new Date((sec + 19800) * 1e3);
  let h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${String(h).padStart(2, "0")}:${m} ${ampm}`;
}
async function dispatchTripNotification(url, title, bodyText, tags = "car") {
  const ntfyTopic = (url.searchParams.get("ntfy") || url.searchParams.get("topic") || "").trim();
  if (ntfyTopic) {
    try {
      await fetch(`https://ntfy.sh/${encodeURIComponent(ntfyTopic)}`, {
        method: "POST",
        headers: {
          "Title": title,
          "Tags": tags,
          "Priority": "high"
        },
        body: bodyText
      });
    } catch (_) {
    }
  }
}
async function d1InsertTrip(env, trip) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare(`
        INSERT INTO trips (id, date, start_timestamp, end_timestamp, duration_seconds, distance_km, start_odometer_km, end_odometer_km, start_soc, end_soc, energy_used_kwh, efficiency_km_per_kwh, start_location, end_location, avg_speed_kmh, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        trip.id,
        trip.date,
        trip.start_timestamp,
        trip.end_timestamp || null,
        trip.duration_seconds || null,
        trip.distance_km || null,
        trip.start_odometer_km || null,
        trip.end_odometer_km || null,
        trip.start_soc || null,
        trip.end_soc || null,
        trip.energy_used_kwh || null,
        trip.efficiency_km_per_kwh || null,
        trip.start_location || "",
        trip.end_location || "",
        trip.avg_speed_kmh || null,
        trip.status || "ongoing"
      ).run();
    } catch (err) {
      console.warn("d1InsertTrip error:", err);
    }
  }
  if (env.TRIP_KV) {
    try {
      const trips = await env.TRIP_KV.get("d1_fallback:trips", "json") || [];
      trips.unshift(trip);
      await env.TRIP_KV.put("d1_fallback:trips", JSON.stringify(trips.slice(0, 200)));
      if (trip.status === "ongoing") {
        await env.TRIP_KV.put("d1_fallback:active_trip", JSON.stringify(trip));
      }
    } catch (_) {
    }
  }
}
async function d1UpdateTrip(env, tripId, updates) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare(`
        UPDATE trips SET
          end_timestamp = ?,
          duration_seconds = ?,
          distance_km = ?,
          end_odometer_km = ?,
          end_soc = ?,
          energy_used_kwh = ?,
          efficiency_km_per_kwh = ?,
          end_location = ?,
          avg_speed_kmh = ?,
          status = 'completed'
        WHERE id = ?
      `).bind(
        updates.end_timestamp,
        updates.duration_seconds,
        updates.distance_km,
        updates.end_odometer_km,
        updates.end_soc,
        updates.energy_used_kwh,
        updates.efficiency_km_per_kwh,
        updates.end_location,
        updates.avg_speed_kmh,
        tripId
      ).run();
    } catch (err) {
      console.warn("d1UpdateTrip error:", err);
    }
  }
  if (env.TRIP_KV) {
    try {
      const trips = await env.TRIP_KV.get("d1_fallback:trips", "json") || [];
      const idx = trips.findIndex((t) => t.id === tripId);
      if (idx !== -1) {
        trips[idx] = { ...trips[idx], ...updates, status: "completed" };
        await env.TRIP_KV.put("d1_fallback:trips", JSON.stringify(trips.slice(0, 200)));
      }
      await env.TRIP_KV.delete("d1_fallback:active_trip");
    } catch (_) {
    }
  }
}
async function d1GetActiveTrip(env) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      const row = await env.DB.prepare("SELECT * FROM trips WHERE status = 'ongoing' ORDER BY start_timestamp DESC LIMIT 1").first();
      if (row) return row;
    } catch (_) {
    }
  }
  if (env.TRIP_KV) {
    try {
      const active = await env.TRIP_KV.get("d1_fallback:active_trip", "json");
      if (active) return active;
      const trips = await env.TRIP_KV.get("d1_fallback:trips", "json") || [];
      return trips.find((t) => t.status === "ongoing") || null;
    } catch (_) {
    }
  }
  return null;
}
async function d1GetTrips(env, date) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      if (!date || date === "all") {
        const res2 = await env.DB.prepare("SELECT * FROM trips ORDER BY start_timestamp DESC LIMIT 150").all();
        return res2.results || [];
      }
      const res = await env.DB.prepare("SELECT * FROM trips WHERE date = ? ORDER BY start_timestamp DESC").bind(date).all();
      return res.results || [];
    } catch (_) {
    }
  }
  if (env.TRIP_KV) {
    try {
      const trips = await env.TRIP_KV.get("d1_fallback:trips", "json") || [];
      if (!date || date === "all") return trips;
      return trips.filter((t) => t.date === date);
    } catch (_) {
    }
  }
  return [];
}
async function d1GetTripDates(env) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      const res = await env.DB.prepare("SELECT DISTINCT date FROM trips ORDER BY date DESC").all();
      return (res.results || []).map((r) => r.date).filter(Boolean);
    } catch (_) {
    }
  }
  if (env.TRIP_KV) {
    try {
      const trips = await env.TRIP_KV.get("d1_fallback:trips", "json") || [];
      return Array.from(new Set(trips.map((t) => t.date).filter(Boolean)));
    } catch (_) {
    }
  }
  return [];
}
async function d1InsertCharge(env, charge) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare(`
        INSERT INTO charges (id, date, start_timestamp, end_timestamp, duration_seconds, start_soc, end_soc, energy_added_kwh, charger_type, peak_kw, odometer_km, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        charge.id,
        charge.date,
        charge.start_timestamp,
        charge.end_timestamp || null,
        charge.duration_seconds || null,
        charge.start_soc || null,
        charge.end_soc || null,
        charge.energy_added_kwh || null,
        charge.charger_type || "AC 3.3 kW",
        charge.peak_kw || null,
        charge.odometer_km || null,
        charge.status || "charging"
      ).run();
    } catch (err) {
      console.warn("d1InsertCharge error:", err);
    }
  }
  if (env.TRIP_KV) {
    try {
      const charges = await env.TRIP_KV.get("d1_fallback:charges", "json") || [];
      charges.unshift(charge);
      await env.TRIP_KV.put("d1_fallback:charges", JSON.stringify(charges.slice(0, 200)));
      if (charge.status === "charging") {
        await env.TRIP_KV.put("d1_fallback:active_charge", JSON.stringify(charge));
      }
    } catch (_) {
    }
  }
}
async function d1UpdateCharge(env, chargeId, updates) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare(`
        UPDATE charges SET
          end_timestamp = ?,
          duration_seconds = ?,
          end_soc = ?,
          energy_added_kwh = ?,
          peak_kw = ?,
          status = 'completed'
        WHERE id = ?
      `).bind(
        updates.end_timestamp,
        updates.duration_seconds,
        updates.end_soc,
        updates.energy_added_kwh,
        updates.peak_kw,
        chargeId
      ).run();
    } catch (err) {
      console.warn("d1UpdateCharge error:", err);
    }
  }
  if (env.TRIP_KV) {
    try {
      const charges = await env.TRIP_KV.get("d1_fallback:charges", "json") || [];
      const idx = charges.findIndex((c) => c.id === chargeId);
      if (idx !== -1) {
        charges[idx] = { ...charges[idx], ...updates, status: "completed" };
        await env.TRIP_KV.put("d1_fallback:charges", JSON.stringify(charges.slice(0, 200)));
      }
      await env.TRIP_KV.delete("d1_fallback:active_charge");
    } catch (_) {
    }
  }
}
async function d1GetActiveCharge(env) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      const row = await env.DB.prepare("SELECT * FROM charges WHERE status = 'charging' ORDER BY start_timestamp DESC LIMIT 1").first();
      if (row) return row;
    } catch (_) {
    }
  }
  if (env.TRIP_KV) {
    try {
      const active = await env.TRIP_KV.get("d1_fallback:active_charge", "json");
      if (active) return active;
      const charges = await env.TRIP_KV.get("d1_fallback:charges", "json") || [];
      return charges.find((c) => c.status === "charging") || null;
    } catch (_) {
    }
  }
  return null;
}
async function d1GetCharges(env, date) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      if (!date || date === "all") {
        const res2 = await env.DB.prepare("SELECT * FROM charges ORDER BY start_timestamp DESC LIMIT 150").all();
        return res2.results || [];
      }
      const res = await env.DB.prepare("SELECT * FROM charges WHERE date = ? ORDER BY start_timestamp DESC").bind(date).all();
      return res.results || [];
    } catch (_) {
    }
  }
  if (env.TRIP_KV) {
    try {
      const charges = await env.TRIP_KV.get("d1_fallback:charges", "json") || [];
      if (!date || date === "all") return charges;
      return charges.filter((c) => c.date === date);
    } catch (_) {
    }
  }
  return [];
}
async function d1GetChargeDates(env) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      const res = await env.DB.prepare("SELECT DISTINCT date FROM charges ORDER BY date DESC").all();
      return (res.results || []).map((r) => r.date).filter(Boolean);
    } catch (_) {
    }
  }
  if (env.TRIP_KV) {
    try {
      const charges = await env.TRIP_KV.get("d1_fallback:charges", "json") || [];
      return Array.from(new Set(charges.map((c) => c.date).filter(Boolean)));
    } catch (_) {
    }
  }
  return [];
}
async function d1InsertNotification(env, notif) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare(`
        INSERT INTO notifications (id, type, title, message, timestamp, date, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        notif.id,
        notif.type,
        notif.title,
        notif.message,
        notif.timestamp,
        notif.date,
        notif.metadata || ""
      ).run();
    } catch (err) {
      console.warn("d1InsertNotification error:", err);
    }
  }
  if (env.TRIP_KV) {
    try {
      const list = await env.TRIP_KV.get("d1_fallback:notifications", "json") || [];
      list.unshift(notif);
      await env.TRIP_KV.put("d1_fallback:notifications", JSON.stringify(list.slice(0, 100)));
    } catch (_) {
    }
  }
}
async function d1GetNotifications(env, limit = 50) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      const res = await env.DB.prepare("SELECT * FROM notifications ORDER BY timestamp DESC LIMIT ?").bind(limit).all();
      return res.results || [];
    } catch (_) {
    }
  }
  if (env.TRIP_KV) {
    try {
      const list = await env.TRIP_KV.get("d1_fallback:notifications", "json") || [];
      return list.slice(0, limit);
    } catch (_) {
    }
  }
  return [];
}
async function d1ClearNotifications(env) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare("DELETE FROM notifications").run();
    } catch (_) {
    }
  }
  if (env.TRIP_KV) {
    try {
      await env.TRIP_KV.delete("d1_fallback:notifications");
    } catch (_) {
    }
  }
}
async function getMgClientForWebhook(env, url) {
  const token = (url.searchParams.get("token") || url.searchParams.get("key") || "").trim();
  const userId = (url.searchParams.get("userId") || url.searchParams.get("id") || "").trim();
  if (env.TRIP_KV) {
    let targetId = userId;
    if (!targetId && token) {
      const mappedId = await env.TRIP_KV.get(`carplay_token:${token}`, "text");
      if (mappedId) targetId = mappedId;
    }
    if (targetId) {
      const raw = await env.TRIP_KV.get(`u:${targetId}`, "text");
      if (raw) {
        const u = JSON.parse(raw);
        if (u.mg?.token && u.mg?.uid) {
          const client = new MgIndiaClient({ phone: u.mg.phone || "9999999999", password: "", vin: u.mg.vin });
          client.uid = u.mg.uid;
          client.token = u.mg.token;
          return { client, vin: u.mg.vin };
        }
      }
    }
    try {
      const lastSession = await env.TRIP_KV.get("mg_active_session", "json");
      if (lastSession?.token && lastSession?.uid) {
        const client = new MgIndiaClient({ phone: lastSession.phone || "9999999999", password: "", vin: lastSession.vin });
        client.uid = lastSession.uid;
        client.token = lastSession.token;
        return { client, vin: lastSession.vin };
      }
    } catch (_) {
    }
  }
  if (env.MG_PHONE && (env.MG_PASSWORD || env.MG_PIN)) {
    const client = new MgIndiaClient({
      phone: env.MG_PHONE,
      password: env.MG_PASSWORD || "",
      vin: env.MG_VIN,
      pinHash: env.MG_PIN && /^\d{4}$/.test(env.MG_PIN) ? hashControlPin(env.MG_PIN) : void 0
    });
    return { client, vin: env.MG_VIN };
  }
  const qPhone = url.searchParams.get("phone");
  const qPass = url.searchParams.get("password");
  const qVin = url.searchParams.get("vin");
  const qPin = url.searchParams.get("pin");
  if (qPhone && (qPass || qPin)) {
    const client = new MgIndiaClient({
      phone: qPhone,
      password: qPass || "",
      vin: qVin || void 0,
      pinHash: qPin && /^\d{4}$/.test(qPin) ? hashControlPin(qPin) : void 0
    });
    return { client, vin: qVin || void 0 };
  }
  return null;
}
async function fetchCarTelemetry(client, vin) {
  if (vin && !client.vin) client.vin = vin;
  const status = await client.status(true);
  const odometer = Number(status.odometer_km ?? status.charge?.odometer_km) || 0;
  const soc = status.charge?.soc != null ? Number(status.charge.soc) : status.fuel_level != null ? Number(status.fuel_level) : 0;
  const lat = status.gps?.latitude ?? null;
  const lng = status.gps?.longitude ?? null;
  return {
    odometer,
    soc,
    lat,
    lng,
    status
  };
}
async function handleApi(env, request, url) {
  const path = url.pathname;
  if (path.startsWith("/api/push") || path.startsWith("/api/widget")) {
    return json({ success: false, message: "Push notifications and widgets disabled" });
  }
  let body = null;
  if (request.method === "POST") {
    try {
      body = await request.json();
    } catch (_) {
    }
  }
  if (path === "/api/trip/start") {
    const mg = await getMgClientForWebhook(env, url);
    if (!mg) {
      return json({ success: false, error: "MG vehicle session not found. Please log in from the web app first." }, 400);
    }
    try {
      const telem = await fetchCarTelemetry(mg.client, mg.vin);
      const startLocation = await resolveLocation(telem.lat, telem.lng);
      const nowSec = Math.floor(Date.now() / 1e3);
      const tripId = "trip_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6);
      const dateStr = istDateString(nowSec);
      const trip = {
        id: tripId,
        date: dateStr,
        start_timestamp: nowSec,
        start_odometer_km: telem.odometer,
        start_soc: telem.soc,
        start_location: startLocation,
        status: "ongoing"
      };
      await d1InsertTrip(env, trip);
      const title = "\u{1F697} MG Windsor EV \u2022 Trip Started";
      const notificationText = [
        "\u{1F7E2} Trip recording actively started in Cloudflare D1.",
        `\u23F1\uFE0F Started: ${formatClockTime(nowSec)}`,
        `\u{1F50B} Battery: ${trip.start_soc}% SOC`,
        `\u{1F6E3}\uFE0F Start Odometer: ${trip.start_odometer_km.toLocaleString()} km`,
        trip.start_location && trip.start_location !== "Unknown Location" ? `\u{1F4CD} Start: ${trip.start_location}` : null
      ].filter(Boolean).join("\n");
      await dispatchTripNotification(url, title, notificationText, "car,electric_plug");
      await d1InsertNotification(env, {
        id: "notif_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
        type: "trip_start",
        title,
        message: notificationText,
        timestamp: nowSec,
        date: dateStr,
        metadata: JSON.stringify(trip)
      });
      if (url.searchParams.get("format") === "text" || request.headers.get("accept")?.includes("text/plain")) {
        return new Response(`${title}

${notificationText}`, {
          headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS }
        });
      }
      return json({
        success: true,
        title,
        notification: notificationText,
        message: "Trip started successfully via CarPlay connection",
        trip
      });
    } catch (err) {
      return json({ success: false, error: err.message }, 500);
    }
  }
  if (path === "/api/trip/stop") {
    const ongoingTrip = await d1GetActiveTrip(env);
    if (!ongoingTrip) {
      const emptyMsg = "No active ongoing trip found in D1 to stop.";
      if (url.searchParams.get("format") === "text" || request.headers.get("accept")?.includes("text/plain")) {
        return new Response(emptyMsg, { headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS }, status: 404 });
      }
      return json({ success: false, message: emptyMsg }, 404);
    }
    const mg = await getMgClientForWebhook(env, url);
    let telem = null;
    if (mg) {
      telem = await fetchCarTelemetry(mg.client, mg.vin).catch(() => null);
    }
    const startOdo = Number(ongoingTrip.start_odometer_km) || 0;
    let finalOdo = Number(telem?.odometer) || startOdo;
    const startTimestamp = Number(ongoingTrip.start_timestamp) || Math.floor(Date.now() / 1e3);
    const nowSec = Math.floor(Date.now() / 1e3);
    const durationSec = Math.max(0, nowSec - startTimestamp);
    if (mg && (finalOdo < startOdo || finalOdo === startOdo && durationSec > 60)) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const refreshed = await fetchCarTelemetry(mg.client, mg.vin);
        if (refreshed && Number(refreshed.odometer) >= startOdo) {
          telem = refreshed;
          finalOdo = Number(refreshed.odometer);
        }
      } catch (_) {
      }
    }
    if (finalOdo < startOdo) {
      finalOdo = startOdo;
    }
    const distanceKm = Math.max(0, Number((finalOdo - startOdo).toFixed(1)));
    const endSoc = telem?.soc != null ? Number(telem.soc) : Number(ongoingTrip.start_soc) || 0;
    const startSoc = Number(ongoingTrip.start_soc) || endSoc;
    const socDiff = Math.max(0, startSoc - endSoc);
    if (distanceKm < 0.2) {
      if (env.DB) {
        await env.DB.prepare("DELETE FROM trips WHERE id = ?").bind(ongoingTrip.id).run().catch(() => {
        });
      }
      if (env.TRIP_KV) {
        await env.TRIP_KV.delete("d1_fallback:active_trip").catch(() => {
        });
        try {
          const trips = await env.TRIP_KV.get("d1_fallback:trips", "json") || [];
          await env.TRIP_KV.put("d1_fallback:trips", JSON.stringify(trips.filter((t) => t.id !== ongoingTrip.id)));
        } catch (_) {
        }
      }
      const idleTitle = "\u2139\uFE0F MG Windsor EV \u2022 Stationary (No Trip Logged)";
      const idleText = [
        "\u2139\uFE0F Vehicle was stationary (0.0 km driven).",
        `\u23F1\uFE0F Time in car: ${formatDurationSec(durationSec)} (${formatClockTime(startTimestamp)} \u2192 ${formatClockTime(nowSec)})`,
        `\u{1F50B} Battery: ${startSoc}% \u2192 ${endSoc}%`,
        "\u{1F9F9} Cancelled recording to keep your driving history clean."
      ].join("\n");
      await dispatchTripNotification(url, idleTitle, idleText, "information_source");
      await d1InsertNotification(env, {
        id: "notif_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
        type: "trip_idle",
        title: idleTitle,
        message: idleText,
        timestamp: nowSec,
        date: istDateString(nowSec),
        metadata: JSON.stringify({ durationSec, startSoc, endSoc })
      });
      if (url.searchParams.get("format") === "text" || request.headers.get("accept")?.includes("text/plain")) {
        return new Response(`${idleTitle}

${idleText}`, {
          headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS }
        });
      }
      return json({
        success: true,
        title: idleTitle,
        notification: idleText,
        message: "No drive detected (0.0 km). Stationary session cancelled.",
        cancelled: true
      });
    }
    const energyUsedKwh = Number((socDiff / 100 * 38).toFixed(2));
    const efficiencyKmPerKwh = energyUsedKwh > 0 && distanceKm > 0 ? Number((distanceKm / energyUsedKwh).toFixed(2)) : 0;
    const endLocation = await resolveLocation(telem?.lat, telem?.lng);
    const avgSpeedKmh = durationSec > 0 && distanceKm > 0 ? Number((distanceKm / (durationSec / 3600)).toFixed(1)) : 0;
    const updates = {
      end_timestamp: nowSec,
      duration_seconds: durationSec,
      distance_km: distanceKm,
      end_odometer_km: finalOdo,
      end_soc: endSoc,
      energy_used_kwh: energyUsedKwh,
      efficiency_km_per_kwh: efficiencyKmPerKwh,
      end_location: endLocation,
      avg_speed_kmh: avgSpeedKmh,
      status: "completed"
    };
    await d1UpdateTrip(env, ongoingTrip.id, updates);
    const title = "\u2705 MG Windsor EV \u2022 Trip Completed";
    const notificationText = [
      "\u2705 Trip completed & safely logged in Cloudflare D1.",
      "",
      `\u{1F6E3}\uFE0F Distance Travelled: ${distanceKm} km`,
      `\u23F1\uFE0F Time Taken: ${formatDurationSec(durationSec)} (${formatClockTime(startTimestamp)} \u2192 ${formatClockTime(nowSec)})`,
      `\u{1F50B} Battery: ${startSoc}% \u2192 ${endSoc}% (${socDiff > 0 ? `-${socDiff}%` : "0%"})`,
      `\u26A1 Energy Used: ${energyUsedKwh} kWh`,
      `\u{1F331} Efficiency: ${efficiencyKmPerKwh > 0 ? `${efficiencyKmPerKwh} km/kWh` : "N/A"}`,
      ongoingTrip.start_location && endLocation && ongoingTrip.start_location !== "Unknown Location" ? `\u{1F4CD} Route: ${ongoingTrip.start_location} \u2192 ${endLocation}` : endLocation && endLocation !== "Unknown Location" ? `\u{1F4CD} Destination: ${endLocation}` : null,
      `\u{1F3C1} Final Odometer: ${finalOdo.toLocaleString()} km`
    ].filter(Boolean).join("\n");
    await dispatchTripNotification(url, title, notificationText, "white_check_mark,trophy");
    await d1InsertNotification(env, {
      id: "notif_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
      type: "trip_stop",
      title,
      message: notificationText,
      timestamp: nowSec,
      date: istDateString(nowSec),
      metadata: JSON.stringify(updates)
    });
    if (url.searchParams.get("format") === "text" || request.headers.get("accept")?.includes("text/plain")) {
      return new Response(`${title}

${notificationText}`, {
        headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS }
      });
    }
    return json({
      success: true,
      title,
      notification: notificationText,
      message: "Trip stopped and logged into Cloudflare D1",
      trip: { ...ongoingTrip, ...updates }
    });
  }
  if (path === "/api/trips") {
    const date = url.searchParams.get("date");
    const trips = await d1GetTrips(env, date);
    return json({ success: true, trips });
  }
  if (path === "/api/trip/dates") {
    const dates = await d1GetTripDates(env);
    return json({ success: true, dates });
  }
  if (path === "/api/charge/start") {
    const mg = await getMgClientForWebhook(env, url);
    let telem = null;
    if (mg) {
      telem = await fetchCarTelemetry(mg.client, mg.vin).catch(() => null);
    }
    const nowSec = Math.floor(Date.now() / 1e3);
    const chargeId = "chg_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6);
    const dateStr = istDateString(nowSec);
    const charge = {
      id: chargeId,
      date: dateStr,
      start_timestamp: nowSec,
      start_soc: telem?.soc != null ? Number(telem.soc) : 0,
      charger_type: "AC Fast",
      peak_kw: 3.3,
      odometer_km: telem?.odometer || 0,
      status: "charging"
    };
    await d1InsertCharge(env, charge);
    return json({ success: true, message: "Charging session started", charge });
  }
  if (path === "/api/charge/stop") {
    const ongoingCharge = await d1GetActiveCharge(env);
    if (!ongoingCharge) {
      return json({ success: false, message: "No active charging session found to stop" }, 404);
    }
    const mg = await getMgClientForWebhook(env, url);
    let telem = null;
    if (mg) {
      telem = await fetchCarTelemetry(mg.client, mg.vin).catch(() => null);
    }
    const nowSec = Math.floor(Date.now() / 1e3);
    const startTimestamp = Number(ongoingCharge.start_timestamp) || nowSec;
    const durationSec = Math.max(0, nowSec - startTimestamp);
    const endSoc = telem?.soc != null ? Number(telem.soc) : Number(ongoingCharge.start_soc) || 0;
    const startSoc = Number(ongoingCharge.start_soc) || endSoc;
    const addedSoc = Math.max(0, endSoc - startSoc);
    const energyAddedKwh = Number((addedSoc / 100 * 38).toFixed(2));
    const updates = {
      end_timestamp: nowSec,
      duration_seconds: durationSec,
      end_soc: endSoc,
      energy_added_kwh: energyAddedKwh,
      odometer_km: Number(telem?.odometer) || Number(ongoingCharge.odometer_km) || 0,
      status: "completed"
    };
    await d1UpdateCharge(env, ongoingCharge.id, updates);
    return json({ success: true, message: "Charging session completed", charge: { ...ongoingCharge, ...updates } });
  }
  if (path === "/api/notifications") {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const notifs = await d1GetNotifications(env, limit);
    return json({ success: true, notifications: notifs });
  }
  if (path === "/api/notifications/clear") {
    await d1ClearNotifications(env);
    return json({ success: true, message: "Notification history cleared" });
  }
  if (path === "/api/charges") {
    const date = url.searchParams.get("date");
    const charges = await d1GetCharges(env, date);
    return json({ success: true, charges });
  }
  if (path === "/api/charge/dates") {
    const dates = await d1GetChargeDates(env);
    return json({ success: true, dates });
  }
  if (path === "/api/register-car" || path === "/api/update-token") {
    if (!body?.uid || !body?.token) return json({ error: "uid and token required" }, 400);
    if (env.TRIP_KV) {
      await env.TRIP_KV.put("mg_active_session", JSON.stringify({
        uid: body.uid,
        token: body.token,
        vin: body.vin,
        phone: body.phone,
        updatedAt: Math.floor(Date.now() / 1e3)
      }));
      await env.TRIP_KV.put("carplay_token:" + body.token, body.uid || "default");
    }
    const u2 = await authUser(env, url, body);
    if (u2) {
      u2.mg = { uid: body.uid, token: body.token, vin: body.vin || u2.mg?.vin, phone: body.phone || u2.mg?.phone };
      u2.mgStatus = "ok";
      u2.mgFailures = 0;
      u2.guardUntilSec = 0;
      await saveUser(env, u2);
    }
    return json({ success: true, message: "Car registered for CarPlay webhooks & PWA" });
  }
  const u = await authUser(env, url, body);
  if (path === "/api/status" || path === "/api/data") {
    return json({
      success: true,
      email: u.email,
      mgStatus: u.mgStatus,
      googleStatus: u.googleStatus,
      lastPollSec: u.lastPollSec || null,
      lastError: u.lastError || null,
      live: u.live || null,
      tripSheetId: u.tripSheetId,
      chargeSheetId: u.chargeSheetId,
      pushSubscriptionsCount: (u.pushSubscriptions || []).length,
      pushwardKey: u.pushwardKey || "",
      pendingRows: u.pendingTrips.length + u.pendingCharges.length,
      activeTrip: u.activeTrip,
      activeCharge: u.activeCharge,
      trips: u.trips,
      charges: u.charges
    });
  }
  if (path === "/api/live-status" || path === "/api/live-activity") {
    const isTestDriving = url.searchParams.get("test") === "driving" || url.searchParams.get("test") === "1";
    const isTestCharging = url.searchParams.get("test") === "charging";
    const nowSec = Math.floor(Date.now() / 1e3);
    if (isTestDriving) {
      return json({
        success: true,
        state: "Driving",
        title: "MG Windsor EV \u2022 Driving",
        headline: "32.5 km \u2022 9.8 km/kWh",
        battery: "91% SOC",
        range: "291 km",
        duration: "1 hr 8 min",
        speed: "48 km/h",
        efficiency: "9.8 km/kWh",
        odometer: "38,443 km",
        aux: "12.6 V",
        summary: "MG Windsor EV: 32.5 km \u2022 9.8 km/kWh \u2022 91% SOC (291 km)"
      });
    }
    if (isTestCharging) {
      return json({
        success: true,
        state: "Charging",
        title: "MG Windsor EV \u2022 Charging",
        headline: "3.3 kW AC \u2022 91% SOC",
        battery: "91% SOC (+21.9 kWh)",
        range: "291 km",
        duration: "2 hr 15 min",
        speed: "3.3 kW",
        efficiency: "10.4 km/kWh",
        odometer: "38,443 km",
        aux: "12.8 V",
        summary: "MG Windsor EV: Charging at 3.3 kW \u2022 91% SOC (291 km)"
      });
    }
    if (u.activeTrip) {
      const t = u.activeTrip;
      const durSec = Math.max(60, nowSec - t.startTimestampSec);
      const curOdo = u.live?.odometerKm || t.endOdometerKm;
      const dist = Number((curOdo - t.startOdometerKm).toFixed(1));
      const durStr = fmtDur(durSec);
      const usedKwh = Math.max(0, Number((t.startEnergyKwh - (u.live?.soc ? u.live.soc / 100 * 38 : t.endEnergyKwh)).toFixed(2)));
      const eff = dist > 0 && usedKwh > 0 ? `${(dist / usedKwh).toFixed(1)} km/kWh` : "-- km/kWh";
      const curSoc = u.live?.soc ?? t.endSoc;
      const curRange = u.live?.rangeKm ? `${u.live.rangeKm} km` : "-- km";
      const isActuallyMoving = dist >= 0.2 || t.maxSpeedKmh && t.maxSpeedKmh > 5;
      const state = isActuallyMoving ? "Driving" : "Stationary";
      const title = isActuallyMoving ? "MG Windsor EV \u2022 Driving" : "MG Windsor EV \u2022 Ready";
      const headline = isActuallyMoving ? `${dist} km \u2022 ${eff}` : `Parked / Idle \u2022 ${curSoc}% SOC`;
      return json({
        success: true,
        state,
        title,
        headline,
        battery: `${curSoc}% SOC`,
        range: curRange,
        duration: durStr,
        speed: `${t.maxSpeedKmh || 0} km/h`,
        efficiency: eff,
        odometer: `${curOdo} km`,
        aux: u.live?.aux ? `${u.live.aux} V` : "--",
        summary: `MG Windsor EV: ${headline} \u2022 ${curSoc}% SOC (${curRange})`
      });
    }
    if (u.activeCharge || u.live?.charging) {
      const c = u.activeCharge;
      const curSoc = u.live?.soc ?? c?.endSoc ?? 0;
      const curKw = c?.maxKw || 3.3;
      const durSec = c ? Math.max(60, nowSec - c.startTimestampSec) : 0;
      const curRange = u.live?.rangeKm ? `${u.live.rangeKm} km` : "-- km";
      return json({
        success: true,
        state: "Charging",
        title: "MG Windsor EV \u2022 Charging",
        headline: `${curKw} kW AC \u2022 ${curSoc}% SOC`,
        battery: `${curSoc}% SOC`,
        range: curRange,
        duration: fmtDur(durSec),
        speed: `${curKw} kW`,
        efficiency: "--",
        odometer: `${u.live?.odometerKm || "--"} km`,
        aux: u.live?.aux ? `${u.live.aux} V` : "--",
        summary: `MG Windsor EV: Charging at ${curKw} kW \u2022 ${curSoc}% SOC (${curRange})`
      });
    }
    const soc = u.live?.soc ?? (u.trips?.[0]?.endSoc || 100);
    const range = u.live?.rangeKm ? `${u.live.rangeKm} km` : "-- km";
    const odo = u.live?.odometerKm ? `${u.live.odometerKm} km` : u.trips?.[0]?.endOdometerKm ? `${u.trips[0].endOdometerKm} km` : "-- km";
    const aux = u.live?.aux ? `${u.live.aux} V` : "--";
    const lastTrip = u.trips?.[0];
    const lastEff = lastTrip ? `${lastTrip.efficiencyKmPerKwh || lastTrip.efficiency} km/kWh` : "--";
    return json({
      success: true,
      state: "Parked",
      title: "MG Windsor EV \u2022 Parked",
      headline: `${soc}% SOC \u2022 ${range}`,
      battery: `${soc}% SOC`,
      range,
      duration: "Parked",
      speed: "0 km/h",
      efficiency: lastEff,
      odometer: odo,
      aux,
      summary: `MG Windsor EV: Parked \u2022 ${soc}% SOC \u2022 ${range} DTE \u2022 ${odo}`
    });
  }
  if (path === "/api/clean-sheets" || path === "/api/dedup-sheets") {
    if (!u) return json({ error: "unauthorized" }, 401);
    try {
      const token = await googleAccessToken(env, u);
      const res = await cleanGoogleSheetTripsAndCharges(token, u.tripSheetId, u.chargeSheetId, u);
      await saveUser(env, u);
      return json({ success: true, ...res });
    } catch (e) {
      return json({ success: false, error: e.message }, 500);
    }
  }
  if (path === "/api/restore") {
    try {
      const token = await googleAccessToken(env, u);
      await cleanGoogleSheetTripsAndCharges(token, u.tripSheetId, u.chargeSheetId, u).catch(() => {
      });
      const [trips, charges] = await Promise.all([
        readSheetRecords(token, u.tripSheetId),
        readSheetRecords(token, u.chargeSheetId)
      ]);
      const cleanTrips = deduplicateTripList(trips);
      const cleanCharges = deduplicateChargeList(charges);
      u.trips = cleanTrips.slice(0, 60);
      u.charges = cleanCharges.slice(0, 60);
      await saveUser(env, u);
      return json({ success: true, trips: cleanTrips, charges: cleanCharges });
    } catch (e) {
      return json({ success: false, error: e.message, trips: u.trips, charges: u.charges });
    }
  }
  if (path === "/api/sync" || path === "/api/sync-data" || path === "/api/sync-trips") {
    try {
      const token = await googleAccessToken(env, u);
      if (!u.tripSheetId) {
        u.tripSheetId = await createSheet(token, "MG Windsor EV - Trip Logs", TRIP_HEADERS);
        await saveUser(env, u);
      }
      if (!u.chargeSheetId) {
        u.chargeSheetId = await createSheet(token, "MG Windsor EV - Charging Sessions", CHARGE_HEADERS);
        await saveUser(env, u);
      }
      let syncedTrips = 0;
      let syncedCharges = 0;
      if (Array.isArray(body.trips) && body.trips.length > 0) {
        const existingTrips = await readSheetRecords(token, u.tripSheetId).catch(() => []);
        const cleanExisting = deduplicateTripList(existingTrips);
        const incomingClean = deduplicateTripList(body.trips);
        const toAppend = incomingClean.filter((inc) => {
          return !cleanExisting.some((ex) => {
            if (inc.id && ex.id && String(inc.id) === String(ex.id)) return true;
            if (inc.journeyId != null && ex.journeyId != null && Number(inc.journeyId) === Number(ex.journeyId)) return true;
            const sameEndOdo = inc.endOdometerKm && ex.endOdometerKm && Math.abs(Number(inc.endOdometerKm) - Number(ex.endOdometerKm)) <= 0.25;
            const timeOverlaps = (inc.startTimestampSec || 0) <= (ex.endTimestampSec || 0) + 90 && (inc.endTimestampSec || 0) >= (ex.startTimestampSec || 0) - 90;
            if (sameEndOdo && timeOverlaps) return true;
            return false;
          });
        });
        if (toAppend.length > 0) {
          toAppend.sort((a, b) => (a.startTimestampSec || 0) - (b.startTimestampSec || 0));
          await appendRows(token, u.tripSheetId, toAppend.map(tripRow));
          syncedTrips = toAppend.length;
        }
        u.trips = deduplicateTripList([...toAppend, ...cleanExisting]).slice(0, 60);
      }
      if (Array.isArray(body.charges) && body.charges.length > 0) {
        const existingCharges = await readSheetRecords(token, u.chargeSheetId).catch(() => []);
        const cleanExisting = deduplicateChargeList(existingCharges);
        const incomingClean = deduplicateChargeList(body.charges);
        const toAppend = incomingClean.filter((inc) => {
          return !cleanExisting.some((ex) => {
            if (inc.id && ex.id && String(inc.id) === String(ex.id)) return true;
            const sameOdo = inc.odometerKm && ex.odometerKm && Math.abs(Number(inc.odometerKm) - Number(ex.odometerKm)) <= 0.2;
            const sameEndSoc = inc.endSoc != null && ex.endSoc != null && Math.abs(Number(inc.endSoc) - Number(ex.endSoc)) <= 1;
            const closeTime = Math.abs((inc.endTimestampSec || 0) - (ex.endTimestampSec || 0)) < 1800;
            if (sameOdo && sameEndSoc && closeTime) return true;
            return false;
          });
        });
        if (toAppend.length > 0) {
          toAppend.sort((a, b) => (a.startTimestampSec || 0) - (b.startTimestampSec || 0));
          await appendRows(token, u.chargeSheetId, toAppend.map(chargeRow));
          syncedCharges = toAppend.length;
        }
        u.charges = deduplicateChargeList([...toAppend, ...cleanExisting]).slice(0, 60);
      }
      if (syncedTrips > 0 || syncedCharges > 0) {
        await saveUser(env, u);
      }
      return json({ success: true, syncedTrips, syncedCharges });
    } catch (e) {
      return json({ success: false, error: e.message }, 500);
    }
  }
  if (path === "/api/push-subscribe") {
    if (!body.subscription || !body.subscription.endpoint || !body.subscription.keys) {
      return json({ error: "subscription object with endpoint and keys required" }, 400);
    }
    if (!Array.isArray(u.pushSubscriptions)) u.pushSubscriptions = [];
    const endpoint = body.subscription.endpoint;
    u.pushSubscriptions = u.pushSubscriptions.filter((s) => s.endpoint !== endpoint);
    u.pushSubscriptions.push({
      endpoint,
      keys: {
        p256dh: body.subscription.keys.p256dh,
        auth: body.subscription.keys.auth
      },
      userAgent: body.userAgent || "",
      addedSec: Math.floor(Date.now() / 1e3)
    });
    if (u.pushSubscriptions.length > 10) u.pushSubscriptions = u.pushSubscriptions.slice(-10);
    await saveUser(env, u);
    await notifyUser(env, u, {
      title: "\u{1F514} MG Windsor EV Notifications Active",
      body: "Real-time alerts for Trips, Charging, and Low 12V Battery are now active on this device!",
      tag: "windsor-welcome"
    });
    return json({ success: true, count: u.pushSubscriptions.length });
  }
  if (path === "/api/push-unsubscribe") {
    const endpoint = body.endpoint || url.searchParams.get("endpoint");
    if (endpoint && Array.isArray(u.pushSubscriptions)) {
      u.pushSubscriptions = u.pushSubscriptions.filter((s) => s.endpoint !== endpoint);
      await saveUser(env, u);
    }
    return json({ success: true });
  }
  if (path === "/api/push-test") {
    const count = Array.isArray(u.pushSubscriptions) ? u.pushSubscriptions.length : 0;
    if (count === 0) {
      return json({ success: false, error: "No active push subscriptions registered on this account." }, 400);
    }
    await notifyUser(env, u, {
      title: "\u26A1 MG Windsor EV \u2022 Test Alert",
      body: `Push notifications are working! 12V: ${u.live?.aux || "12.6"}V \u2022 SOC: ${u.live?.soc || "91"}% \u2022 Range: ${u.live?.rangeKm || "291"} km`,
      tag: "windsor-test"
    });
    return json({ success: true, count });
  }
  if (path === "/api/delete") {
    const kv = kvOrThrow(env);
    const ids = JSON.parse(await kv.get("users", "text") || "[]");
    await kv.put("users", JSON.stringify(ids.filter((x) => x !== u.id)));
    await kv.delete(`u:${u.id}`);
    await kv.delete(`e:${u.email}`);
    return json({ success: true });
  }
  return json({ error: "Unknown API route" }, 404);
}
var multi_worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      if (url.searchParams.has("url")) return worker_default.fetch(request);
      return new Response(null, { status: 204, headers: CORS });
    }
    const action = url.searchParams.get("action");
    if (action === "poll-trip" || action === "cron") {
      return json({
        success: true,
        message: "24/7 background polling is disabled to protect vehicle 12V battery."
      });
    }
    try {
      if (url.pathname === "/google-callback") return await handleGoogleCallback(env, url);
      if (url.pathname.startsWith("/api/")) return await handleApi(env, request, url);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
    if (url.searchParams.has("url")) {
      try {
        return await worker_default.fetch(request);
      } catch (err) {
        return json({ error: err.message || "Proxy error" }, 502);
      }
    }
    return silent_webhook_default.fetch(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    await runCron(env).catch(() => {
    });
    if (env.MG_PHONE) await silent_webhook_default.scheduled(event, env).catch(() => {
    });
  }
};
export {
  multi_worker_default as default
};
/*! Bundled license information:

crypto-js/ripemd160.js:
  (** @preserve
  	(c) 2012 by Cédric Mesnil. All rights reserved.
  
  	Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
  
  	    - Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
  	    - Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
  
  	THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
  	*)

crypto-js/mode-ctr-gladman.js:
  (** @preserve
   * Counter block mode compatible with  Dr Brian Gladman fileenc.c
   * derived from CryptoJS.mode.CTR
   * Jan Hruby jhruby.web@gmail.com
   *)
*/
