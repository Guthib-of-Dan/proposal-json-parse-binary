# JSON.parseBinary

## Status

Author: Daniel Dyryl \<diril656@gmail.com\>

Stage: 0

## Problem

Every JSON parsing operation in a JavaScript HTTP server / HTTP request (like Fetch API) follows this pipeline:
```
network bytes (ArrayBuffer / Uint8Array)
  → string = TextDecoder.decode()   — allocates a new JS string
  → JSON.parse(string)              — parses, throws SyntaxError on failure
  → object
```
Both steps carry hidden costs that compound at scale.

### SyntaxError

An `Error` instance in JavaScript generates a stack trace with significant overhead — solely for debugging. But in the context of network requests we cannot force the correctness of the payload, so we have nothing to debug. `SyntaxError` provides no advantage over a simple string message, yet consumes more memory and CPU time to generate.

Throwing also forces inconvenient `try-catch` blocks. Nested throwing functionality requires nested `try-catch` blocks to handle multiple failure modes.

Instead we can return an object like `{ok: true, value}` or `{ok: false, message}` and optimise our handler for untrusted inputs.

---

Results of [Errors benchmark](./demo/errors.mjs) — 1M iterations:

```
{ ok: false, message }      ░░░░░░░░░░░░░░░░░░░░░░░░░░░░       3.7 ms
new SyntaxError(message)    ██████████████████████░░░░░░    2206.6 ms
throw new SyntaxError()     ████████████████████████████    2793.4 ms
```

`SyntaxError` construction is ~600× more expensive than a plain object. Throwing adds another ~27% on top of that.

### Intermediate string

When we receive a 1× payload and decode it we have 2× (UTF-8 if Latin chars) to 3× (UTF-16 if any multi-byte chars) of the payload size in memory — held for microseconds with increased GC pressure.

The payload may be malformed, but to discover this we must incrementally parse it — the job of `JSON.parse`. We would rather skip the intermediate string entirely, identify problems early and protect the application under high load.

Even if there is only one UTF-16 char in the string, it becomes twice as large in any case. If strings were parsed only one by one and inserted into the resulting structure, it would have MOST of the data UTF-8 and one 1 string UTF-16. This HUGELY improves performance of i18n services.

---

Results of [Decoding benchmark](./demo/decoding.mjs) — 4 MB symbols, 100 iterations:

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

Results of [Parsing benchmark](./demo/json-parse.mjs):

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
  Iterations:    only 300 — a thousand times less than 'small' case

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

  In the "wasted decode" case: 641.4ms of extra work per 300 iterations —
  more than 2ms per request — with no benefit whatsoever when the payload
  is invalid at byte 0.
```

### Initial buffer stays in memory

We receive 1× payload as binary, convert to string (2–3×), parse to JSON (3–4×+), but the original buffer never gets cleared.

If we receive it as a callback parameter, it cannot even be marked for GC — a live reference outside persists. Under high load memory can reach its ceiling and V8 will "stop the world" to clear all unreferenced memory. To solve this, see the companion proposal — [ArrayBuffer.prototype.detach()](https://github.com/Guthib-of-Dan/proposal-arraybuffer-detach).

### Global TextDecoder / Buffer.from() pollution

To operate on `ArrayBuffer` today we must either pollute the module scope with a `TextDecoder` instance, or create a temporary view like `Buffer.from(buffer)` in Node.js to call `.toString()`. Both patterns add GC pressure.

## Idea

Introduce `JSON.parseBinary` — a new static method that accepts a `Uint8Array` or `ArrayBuffer | SharedArrayBuffer` and returns a result object rather than throwing.

### TypeScript declaration

```typescript
interface JSON {
    stringify( ... ): string;
    parse( ... ): any;
    /**
     * Converts untrusted binary input into a JavaScript value.
     * @param input binary buffer supposedly containing JSON data.
     */
    parseBinary(input: ArrayBufferLike | Uint8Array):
        { ok: true; value: any } |
        { ok: false; message: string }
}
```
`JSON.parseBinary` accepts SharedArrayBuffer and parses it as an ordinary one, without any "copying for the sake of atomicity".

## What changes

### Pipeline of network bytes
![pipeline](./demo/pipeline.svg)

### Fetch API — before

```typescript
var decoder = new TextDecoder(); // pollutes module scope

async function requestEndpointA() {
    let body: ArrayBuffer;
    try {
        body = await fetch(SOME_LINK).then(res => res.arrayBuffer());
    } catch (err) {
        // handle fetch error
    }
    // GC pressure++; wasted if body is invalid
    const intermediateString = decoder.decode(body);
    let result: object;
    try {
        result = JSON.parse(intermediateString);
    } catch (err) {
        const message = (err as SyntaxError).message;
        // log the message
    }
    // process result
}
```

### Fetch API — after

```typescript
async function requestEndpointA() {
    let body: ArrayBuffer;
    try {
        body = await fetch(LINK).then(res => res.arrayBuffer());
    } catch (err) {
        // handle fetch error
    }
    // no TextDecoder, no intermediate string, no try-catch
    const parseResult = JSON.parseBinary(body);
    if (!parseResult.ok) {
        // log parseResult.message and quit
        return;
    }
    const result = parseResult.value;
    // process result
}
```

### node:http — before

```javascript
server.on('request', async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const intermediateString = body.toString(); // wasted memory + CPU
    let result;
    try {
        result = JSON.parse(intermediateString);
    } catch (err) {
        res.writeHead(400).end(err.message);
        return;
    }
    // process result
});
```

### node:http — after

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
    // handle result
});
```

---

## Design decisions ("why not X")

This section addresses specific alternative designs raised during community review. Each alternative was considered carefully; the choices below keep `JSON.parseBinary` a **single-purpose, synchronous, non-destructive** utility.

---

### Why not detach the buffer internally?

Short answer: because it makes `JSON.parseBinary` a framework, not a utility.

If the method detached the buffer on your behalf, it would silently take ownership of your memory — tying the caller's architecture to a specific ownership model with no opt-out. A developer who still needs the buffer after parsing (to log it, inspect it, pass it elsewhere) would have no recourse.

The proposals are intentionally separated. `JSON.parseBinary` parses. `ArrayBuffer.prototype.detach()` releases memory. You compose them as your application requires:

```javascript
// parse first, detach when you know you're done
const result = JSON.parseBinary(buffer);
if (!result.ok) {
    console.error('bad payload', buffer.byteLength); // buffer still accessible
    buffer.detach();
    return;
}
buffer.detach(); // done with raw bytes
// process result.value
```

If you want a one-liner that does both, write a local wrapper. Proposing that wrapper as a global is what gets proposals cancelled.

---

### Why not an explicit transfer list like `postMessage`?

Suggested shape: `JSON.parseBinary(buffer, [buffer])` — parse and detach in one atomic call, similar to `postMessage(data, [transfer])`.

This creates a dilemma on failure. After a transfer, the buffer is detached regardless of outcome. There are only two paths:

- **Don't detach on error** — confuses developers, since the transfer list implies detachment.
- **Detach on error and return `input` in the result** — creates another view on that memory chunk (avoid initial detached buffer), adds more GC pressure, and returns that buffer as an object property. So if initial buffer gets cleared by JSON.parseBinary, who clears "input" buffer then? Back to square one.

```javascript
// with transfer list — who clears result.input?
const result = JSON.parseBinary(buffer, [buffer]);
if (!result.ok) {
    console.log('bad', result.input.buffer.byteLength);
    result.input.buffer.detach(); // back to square one
    return;
}
// handle result.value

//----------------------------//

// without transfer list — you have full control
const result = JSON.parseBinary(buffer);
if (!result.ok) {
    console.log('bad', buffer.byteLength); // buffer still yours
    buffer.detach();
    return;
}
buffer.detach();
// handle result.value
```

The second form is strictly cleaner. Adding a transfer list gives the illusion of convenience while removing developer freedom.

---

### Why not async (`await JSON.parseBinary(buf)`)?

For browser use-cases — avoiding blocking the main thread on a large JSON payload — an async variant seems appealing. In practice it creates more problems than it solves.

**Option A — chunked parsing on the main thread.** This requires saving incremental parser state between ticks. But JSON string values can span chunk boundaries; partial multi-byte UTF-8 sequences (e.g. a 4-byte emoji split across chunks) require buffering and re-encoding. Parsing half the buffer does not allow detaching the first half — the entire buffer remains referenced until `done`. Memory pressure increases, not decreases.

**Option B — offload to a Worker.** This requires copying or transferring the buffer, serialising the result back across the thread boundary. In C++ addons no one touches JS part when operating inside `libuv` worker threads due to V8 likely moving JS heap structures for different reason (likely reduce fragmentation). Any intrusion into V8 heap from another thread results in undefined behaviour. If we use node:worker\_threads and transfer/copy data to other thread, we can parse json there BUT, when returning it back - copy again. V8 heap of js 2 js threads don't overlap. For most payloads under ~50 MB (or even more), synchronous parsing is faster end-to-end.

**Why it's not needed in practice.** Even a 4 MB JSON payload parses in ~25 ms on a mid-range device. The web's rendering frame is 16 ms; long-running parses already block regardless of async API shape. The alternative to making this function async is making your environment multithreaded using a Worker with `postMessage(buffer, [buffer])` — explicit, composable, and already available.

```javascript
// what the async case actually looks like today — already ergonomic
const worker = new Worker('parse-worker.js');
worker.postMessage(buffer, [buffer]); // transfers ownership
// but actually sending that parsed JSON back means copying - benefit vanishes
worker.onmessage = ({ data }) => {
    if (!data.ok) { /* handle */ }
    // process data.value
};
```

`JSON.parseBinary` is synchronous. If you need async, transfer buffer to a Worker, parse there and use there.

---

### Why not a streaming chunk parser (`JSON.binaryParser()`)?

A factory-based API — `const parse = JSON.binaryParser(); parse(chunk1); parse(chunk2); ...` — appears to solve large payloads. It does not work without sacrificing the memory advantage.

Consider chunks that split in the middle of a string value:

```
chunk 1: { "key": "value that is not fu
chunk 2: ll yet, and contains 😀 here
chunk 3: , finally done" }
```

To reconstruct the key and value correctly, the parser must buffer partial strings across chunks — copying bytes into internal state. If chunk 2 introduces a multi-byte character (the emoji), the already-buffered Latin-1 string from chunk 1 must be re-encoded as UTF-16 and concatenated. By the time chunk 3 arrives, the intermediate state may be larger than the original buffer.

The memory advantage of `JSON.parseBinary` comes entirely from parsing the full buffer in one pass — extracting only the final key/value strings without a full intermediate copy. Streaming breaks this invariant. The only way to avoid the copy is to parse the entire buffer at once, which is exactly what `JSON.parseBinary` does.

---

## Relation to `ArrayBuffer.prototype.detach()`

`JSON.parseBinary` does not detach any buffer. If you want immediate release of the backing store after parsing, call `.detach()` yourself:

```javascript
const result = JSON.parseBinary(buffer);
buffer.detach(); // backing store released, buffer is now zero-length
if (!result.ok) return;
// process result.value — the parsed object has no reference to the buffer
```

See [proposal-arraybuffer-detach](https://github.com/Guthib-of-Dan/proposal-arraybuffer-detach) for the companion proposal.
