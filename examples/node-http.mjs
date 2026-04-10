// node:http
// 
// The built-in HTTP server gives you the request as a Readable stream.
// Accumulate chunks into a Buffer with Buffer.concat, then parse binary.
// Detach immediately after — the raw bytes are no longer needed once
// the object is built.
//
// This example was mostly copied from ArrayBuffer.prototype.detach benchmark,
// but here JSON.parseBinary is alongside.

import http from 'node:http';
import "./polyfill.mjs"

const server = http.createServer(async (req, res) => {
if (req.method !== 'POST') {
    res.writeHead(405).end("not allowed method");
    return;
  }

  // memory-mapped virtual buffer, gets activated incrementally
  // Buffer.allocUnsafe should be avoided for the reasons above
  let data = Buffer.allocUnsafeSlow(Number(req.headers["content-length"]));
  let offset = 0;
  await new Promise((resolve) => {
    req.on("data", (chunk) => {
      // write to memory-mapped data and detach immediately, so "data" + "chunks" don't consume more than "1X + 1 chunk" memory
      data.set(chunk, offset);
      offset += chunk.byteLength;
      chunk.buffer.detach();
    })
    req.once("end", resolve)
  })
  // use final buffer and detach it.
  const result = JSON.parseBinary(body);
  data.buffer.detach();

  // raw bytes no longer needed — release the backing store immediately
  body.detach();

  if (!result.ok) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: result.message }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ received: result.value }));
});

server.listen(3000);
