# Purpose
These examples are intended to visualise combinations of popular tools and `JSON.parseBinary` + `ArrayBuffer.prototype.detach`

They don't handle cases where requests are aborted (apart from uWebSockets.js example) in the middle of the process.

## First glance at body accumulation
Most of NodeJS examples use `req.on('data')` type of handling and not `for await(const chunk of req) + Buffer.concat`, which looks prettier and easier to write. They are presented this way to demonstrate more performant handling of network streaming. 

While `Buffer.allocUnsafeSlow` might seem `Slow`, in fact it is not. It returns memory-mapped virtual memory, which stays unitialised. So when `buffer.set` is called for each new chunk, it gets slowly extended and no visible memory spikes occur, like in case with `Buffer.concat`, where memory consumption doubles.
