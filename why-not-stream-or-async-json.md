# Why not create a streaming parser or an asynchronous non-blocking parser for JSON ?

## Quick links

1) Parsing JSON in separate thread(s) directly into JS structures will not work. V8 has its instances (isolates), unaccessible from other threads [(source)](https://github.com/nodejs/node-v0.x-archive/issues/7543#issuecomment-42557977).
2) Parsing JSON to BSON in separate thread(s), passing back to main thread + materializing is cumbersome and incurs overhead from the context switching [(source)](https://github.com/nodejs/node-v0.x-archive/issues/7543#issuecomment-106088497)
3) JSON payload is usually being acted on as a whole or has interdependent keys, so streaming provides no benefit [(source)](https://github.com/nodejs/node-v0.x-archive/issues/7543#issuecomment-93079273)

## Why not async (`await JSON.parseBinary(buf)`)?

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

### Parsing in parts uses more CPU time
If we have a payload, that requires parsing X amount of time, `parsing it a bit -> yield to next event loop cycle -> parse a bit -> ... -> handle result` does not block less. We still spend X time parsing it. But in case where we do `Parse JSON once; ...all other clients`, we postpone "all other clients" by X time, while dong `Parse a bit ; client 1; parse a bit ; ... ; prefinish client ; finish parsing ; all other clients` we postpone "client 1" by a bit of time, and "prefinish client" is delayed by almost X time with "all other clients" still having X time delay. In the context of busy servers, by "parsing once" we affect less clients , whereas "chunked parsing" has its impact on a plethora of clients.

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

If this payload is huge and contains only one key-value pair, just like in this example, streaming brings more drawbacks because it has not enough context to optimize re-allocations out. Eventually, we end up doing more work, than before.

The memory advantage of `JSON.parseBinary` comes entirely from parsing the full buffer in one pass — extracting only the final key/value strings without a full intermediate copy. Streaming breaks this invariant. The only way to avoid the copy is to parse the entire buffer at once, which is exactly what `JSON.parseBinary` does.

### Memory spike "issue" from parsing all at once

The question concerning balanced memory usage is not about parsing the data, but rather about receiving and handling the data - infrastructure.

If you want to receive 5MB of JSON, parsing it chunk by chunk still leaves you with 5MB+ of parsed JS structures, but including state management and constant reallocations for huge strings. At the first glance, we can improve this pipeline by handling data as soon as it comes. 

Unfortunately, interdependent keys (point 3 above) stand in the way. For such cases, you might want to create a WebSocket connection with several types of "events", holding these key-value pairs. One connection can hold 1 database transaction, so changes are revertable. This way we receive data efficiently and STILL can parse it with JSON.parseBinary.

What is more to it, `ArrayBuffer.prototype.detach` (co-proposal) can immediately clear the initial buffer after parsing, so spike lasts for milliseconds and disappears.
