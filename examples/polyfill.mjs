// cross-platform polyfill for co-proposal
ArrayBuffer.prototype.detach = function() {this.transfer(0);}

var decoder = new TextDecoder();
/*Just a polyfill. Real implementation would have no try-catch, no TextDecoder and would be on the JS engine side, not JS code itself*/
JSON.parseBinary = function(input) {
  try {
    return {
      ok: true,
      value: JSON.parse(decoder.decode(input))
    }
  } catch (err) {
    return {ok:false, message: err.message}
  }
}
