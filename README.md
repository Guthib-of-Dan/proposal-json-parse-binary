> README is in progress. Go look at GitHub Action CI "demonstration" run for now.
# JSON.parseBinary

## Status

Author: Daniel Dyryl \<diril656@gmail.com\>

Stage: 0

## Problem

Every JSON parsing operation in a JavaScript HTTP server / HTTP request (like Fetch API) follows this pipeline:

```
network bytes (ArrayBuffer / Uint8Array)
  → string = TextDecoder.decode()   — allocates a new js string
  → JSON.parse(string)     — parses, throws SyntaxError on failure
  → object
```

Both steps carry hidden costs that compound at scale:

### SyntaxError

`Error` instance in JavaScript generates stack trace with a ton of overhead solely for debugging. But in the context of network requests we can't force the correctness of the payload, hence we needn't debug anything - `Error` instances (currently `SyntaxError`) provide no advantage over simple string messages + consume more memory and CPU time to generate.  
`Throwing` errors requires us to put inconvenient "try-catch" blocks and, if we nest "throwing" functionality, it requires nesting "try-catch" blocks to handle multiple cases.  
Instead we can just return an object like {ok: true, value} or {ok: false, message} to optimize our handler for untrusted inputs.

---
Results of [Errors benchmark](./demo/errors.mjs) for 1mil iterations (available in GitHub Actions run)
```
{ ok: false, message }      ░░░░░░░░░░░░░░░░░░░░░░░░░░░░       3.7 ms
new SyntaxError(message)    ██████████████████████░░░░░░    2206.6 ms
throw new SyntaxError()     ████████████████████████████    2793.4 ms
```

### Intermediate string
, but if only Latin — UTF-8.   
When we receive 1X payload size and decode it — we have 2X (UTF8 if Latin chars) to 3X (UTF16 if has spec. chars) of payload in memory used for microseconds + increased Garbage Collector pressure.  
Payload can be malformed, but to find this out we need incrementally check it — job for JSON.parse, so we would rather skip the string completely, identify problems early and contribute application's endurance under high load.

---
> 4MB here mean that certain symbol was repeated 4\*1024\*1024 times

Results of [Decoding benchmark](./demo/decoding.mjs) for 4MB symbols  100 iterations:

```
input                 JS chars   UTF-8 bytes   ratio  V8 string encoding
────────────────────────────────────────────────────────────────────────────
A (ascii)          4,194,304     4,194,304     1.00×  Latin-1  (1 byte/char)
A…👎🏿 (mixed)       4,194,308     4,194,312     1.00×  UTF-16   (2 bytes/char) — one emoji forces full upgrade
☺️ (3-byte)        8,388,608    25,165,824     3.00×  UTF-16   (2 bytes/char)
👎🏿 (4-byte)       16,777,216    33,554,432     2.00×  UTF-16   (4 bytes/char, 2 surrogates)

A        (1-byte UTF-8)   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░     187.1 ms
A…👎🏿    (1-byte + emoji)  █░░░░░░░░░░░░░░░░░░░░░░░░░░░     303.2 ms  1.6× slower — UTF-16 upgrade
☺️       (3-byte UTF-8)   █████████████████████░░░░░░░   11143.3 ms  UTF-8 buf 6.0× larger than ASCII buf
👎🏿       (4-byte UTF-8)   ████████████████████████████   14703.5 ms  78.6× slower than ASCII
```

### Initial buffer stays in memory
We receive 1X payload as binary, convert to string (2-3X), parse to JSON (3-4X+), but don't clear initial buffer.  
If we receive this buffer as a param in a callback it can't even get marked for Garbage Collection - live reference outside persists.  
Even if callback was called like `callback(returnMemory())` without any references, Garbage Collection might happen after a while.  
Under load memory can reach its top levels and V8 will "stop the world" to clear all unreferenced memory and keep application from collapsing.  
To solve this issue was created another TC39 proposal — [ArrayBuffer.prototype.detach()](https://github.com/Guthib-of-Dan/proposal-arraybuffer-detach)

### Global "TextDecoder" or "Buffer.from() in NodeJS"
To operate on ArrayBuffer we currently need to decode it into operable string. For this we either pollute global scope with "TextDecoder" (export/import or create a lot in many modules), or constantly create a view on top like "Buffer.from(buffer)" in NodeJS to call "view.toString()" — again increase GC pressure.

## Idea

Introduce `JSON.parseBinary` — a new static method that accepts a `Uint8Array` or `ArrayBuffer | SharedArrayBuffer` and returns a result object rather than throwing.

### TypeScript documentation
```typescript
interface JSON {
    stringify( ... ): string;
    parse( ... ): any;
    /**
     * Converts untrusted inputs into JSON (JavaScript Object Notation) object.
     * @param input binary buffer supposedly containing JSON data.
     */
    parseBinary(input: ArrayBufferLike | Uint8Array):
        { ok: true; value: any } |
        { ok: false, message: string }
}
```
### Before vs After
<!-- 
```javascript
// node:http handler — runs on every request. This example doesn't show error handling - see "Cost 2"
server.on('request', async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const utf8 = Buffer.concat(chunks); // Uint8Array
  const str  = utf8.toString('utf8'); // ← string allocated here
  const body = JSON.parse(body);     // ← string consumed and discarded
});
```


On failure, `message` is a human-readable description of the parse error — the same text that `SyntaxError.message` would contain, but **no `SyntaxError` object is constructed and no stack trace is captured**.
-->

## Q&A
