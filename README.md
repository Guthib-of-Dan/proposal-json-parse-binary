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
When we receive 1X payload size and decode it — we have 2X (UTF8 if Latin chars) to 3X (UTF16 if has spec. chars) of payload in memory used for microseconds + increased Garbage Collector pressure. (See decoding speed in "Decoding benchmark")
Payload can be malformed, but to find this out we need to incrementally check it — job for JSON.parse, so we would rather skip the string completely, identify problems early and contribute to application's endurance under high load. (See "Parsing" benchmark)

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
---

Results of [Parsing benchmark](./demo/json-parse.mjs) 

```
────────────────────────────────────────────────────────────────────
  json-parse  small payload · 512 B
────────────────────────────────────────────────────────────────────

  Payload size:  0.5 KB
  Iterations:    300,000

  valid  (no try-catch)       ███████████░░░░░░░░░░░░░░░░░     777.0 ms
  invalid, error@start        ████████████████████████████    1983.1 ms  2.55× slower than valid

  SyntaxError cost:     155%  over valid parse

────────────────────────────────────────────────────────────────────
  json-parse  large payload · 4 MB
────────────────────────────────────────────────────────────────────

  Payload size:  4.0 MB
  Iterations:    only 300 - thousand times less than 'small' case

  valid  (string)             ████████████████████████░░░░    7539.8 ms
  invalid, error@start        ░░░░░░░░░░░░░░░░░░░░░░░░░░░░       3.6 ms  O(1) abort — 0.05% of valid parse time
  invalid, error@end          ████████████████████████████    8765.8 ms  16% slower than valid
  + TextDecoder               ████████████████████████████    8737.0 ms  +15.9% over string parse
  wasted decode, err@start    ██░░░░░░░░░░░░░░░░░░░░░░░░░░     645.0 ms  +15.9% over string parse
  + Buffer.str()              ████████████████████████████    8725.3 ms  +15.7% over string parse

  large error@start ~ small error@start = 0.04% of error@end time
  Full-walk penalty:    error@end   = 16% over valid parse
  TextDecoder cost:     decode+parse = 15.9% over string parse
  Buffer cost:          str+parse    = 15.7% over string parse

  
  These benchmarks demonstate that throwing SyntaxError slows down the application up to 3 times.
  In "wasted decode" case we spent 641.4ms (>2ms for each iteration) more compared to "error@start" with literally no benefit.
  It would be better to validate binary payload and parse incrementally.
```

### Initial buffer stays in memory
We receive 1X payload as binary, convert to string (2-3X), parse to JSON (3-4X+), but don't clear initial buffer.  
If we receive this buffer as a param in a callback, it can't even get marked for Garbage Collection - live reference outside persists.  
Even if callback was called like `callback(returnMemory())` without any references, Garbage Collection might happen after a while.  
Under load memory can reach its top levels and V8 will "stop the world" to clear all unreferenced memory and keep application from collapsing.  
To solve this issue was created another TC39 proposal — [ArrayBuffer.prototype.detach()](https://github.com/Guthib-of-Dan/proposal-arraybuffer-detach)

### Global "TextDecoder" or "Buffer.from() in NodeJS"
To operate on ArrayBuffer we currently need to decode it into operable string. For this we either pollute global scope with "TextDecoder" (export/import or create a lot in many modules), or constantly create a view on top like "Buffer.from(buffer)" in NodeJS to call "view.toString()" — again increase GC pressure.

## Idea

Introduce `JSON.parseBinary` — a new static method that accepts a `Uint8Array` or `ArrayBuffer | SharedArrayBuffer` and returns a result object rather than throwing.

### TypeScript declaration
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
        { ok: false; message: string }
}
```

## What changes
These examples don't deal with initial buffer unused, look at another proposal
### Fetch API before
> Using "Response.json()" in a try catch block is inconvenient because it incurres additional headache. Error from aborted request or from invalid JSON.parse (inside) go to the same "catch" block - need to figure out the source inside that block. 
```typescript
var decoder = new TextDecoder(); // pollute global scope
async function requestEndpointA() {
    let body: ArrayBuffer;
    try {
        body = await fetch(SOME_LINK).then(res=>res.arrayBuffer())
    } catch (err) {
        // handle fetch error
    }
    // GC pressure++, wasted time, if body is invalid - complete waste
    const intermediateString = decoder.decode(body);
    let result: object;
    // again try-catch
    try {
        result = JSON.parse(intermediateString)
    } catch (err) {
        const message = (err as SyntaxError).message
        // log the message
    }
    // process result
}
```
That code tries to replicate the result below.

### Fetch API after

```typescript
async function requestEndpointA() {
    // no need for global TextDecoder
    let body: ArrayBuffer;
    try {
        body = await fetch(LINK).then(res=>res.arrayBuffer())
    } catch (err) {
        // handle fetch error
    }
    // one single line; weighs a little - GC doesn't collapse without scoped blocks (like above)
    const parseResult = JSON.parseBinary(body)
    if (!parseResult.ok) {
        const message: string = parseResult.message;
        // log message and quit
        return;
    }
    const result = parseResult.value;
    // process result
}
```
### node:http before (light example)

```javascript
server.on('request', async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks); 
  // wasted memory + CPU time
  const intermediateString = body.toString(); 
  // in a web server this overhead matters
  let result;
  try {
    result = JSON.parse(body); 
  } catch (err) {
    res.writeHead(400).end(err.message);
    return;
  }
  // process result
});
```

### node:http after (light example)

```javascript
server.on('request', async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks); 
  const parseResult = JSON.parseBinary(body);
  if (!parseResult.ok) {
    res.writeHead(400).end(parseResult.message);
    return;
  } 
  const result = parseResult.value;
  // handle result;
});
```
