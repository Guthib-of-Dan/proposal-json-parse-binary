# JSON.parseBinary
The JSON.parseBinary proposal introduces a new static method to the global JSON object. It allows developers to parse JSON directly from binary data (Uint8Array, ArrayBuffer) without first converting it into a JavaScript string. It decodes only "value" strings from "key-value" pairs incrementally, what lets parse JSON and validate simultaneously. Unlike the traditional JSON.parse, this method returns a **result object** instead of throwing an exception, significantly improving performance and memory efficiency in high-load environments like HTTP servers.

The main use-case is handling data, that comes to JS application from the outer world, like network communication or filesystem.
## The Core Problems

The current workflow for parsing network data in JavaScript is:
```
Network Bytes → TextDecoder.decode() (String) → JSON.parse(String) → Object
```

This pipeline suffers from three major "hidden" costs:

1. The Intermediate String Penalty: Converting binary data to a string creates a massive temporary copy in memory. If a single multi-byte character (like an emoji) is present, V8 may upgrade the entire string to UTF-16, doubling its memory footprint. This increases Garbage Collection (GC) pressure and can lead to "stop-the-world" pauses.

2. The SyntaxError Overhead: JSON.parse is "throw-heavy." When it encounters invalid JSON, it generates a SyntaxError with a full stack trace. Benchmarks show that creating and throwing an Error is roughly 500x more expensive than returning a plain object. In network scenarios, invalid payloads are common and shouldn't require the overhead of a debugging stack trace.

3. Memory Pollution: Current methods often leave the original binary buffer and the intermediate string in memory longer than necessary, causing the heap to swell and slowing down the entire system.

## Proposed Solution: `JSON.parseBinary`

The proposal suggests a synchronous, single-pass parser with the following TypeScript signature:
TypeScript
```typescript
JSON.parseBinary(input: ArrayBufferLike | Uint8Array): 
  { ok: true; value: any } | 
  { ok: false; message: string };
```

How the Pipeline Changes:
## Key Advantages
|Feature|JSON.parse|JSON.parseBinary|
|---|---|---|
|Memory|Allocates 2x-3x payload size for strings|Zero intermediate string allocation|
|Error Handling|Uses try-catch (slow, blocks inlining)|Returns a result object (fast, ergonomic)|
|Performance|Significant GC overhead and stack trace costs|Optimized for "untrusted" network input|
|Simplicity|Requires TextDecoder and global pollution|Clean, self-contained API|

Other points:
1. Early Abort: If the first byte is invalid, JSON.parseBinary returns immediately without wasting any time decoding the rest of the buffer.

2. Selective Encoding: It only creates strings for the actual keys and values it extracts, keeping the rest of the data in its compact binary form during the walk.

3. Developer Experience: Eliminates nested try-catch blocks, allowing for cleaner code when handling potentially malformed API responses.

## Synergy with ArrayBuffer.prototype.detach()

This proposal is designed to work alongside the detach() proposal. Together, they allow a server to:

1. Receive a binary chunk.

2. Parse it directly into an object.

3. Manually release the binary memory immediately after parsing, ensuring the memory footprint never stays higher than necessary.
