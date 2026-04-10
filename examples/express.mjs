// Express
//
// express.raw() is the built-in middleware that accumulates the request
// body as a Buffer. Use it instead of express.json() — that way Express
// never attempts its own TextDecoder + JSON.parse pipeline.
//
// Detach after parse. Express does not re-read req.body after the
// middleware chain, so releasing the backing store here is safe.

import express from 'express';
import "./polyfill.mjs"

const app = express();


app.post('/', async (req, res) => {
  // not allocUnsafe
  var body = Buffer.allocUnsafeSlow(Number(req.headers["content-length"]));
  var offset = 0;
  await new Promise((resolve)=>{
    req.on("data", (chunk)=>{
      body.set(chunk, offset);
      offset+=chunk.byteLength;
      // co-proposal, clear memory immediately
      chunk.buffer.detach();
    })
    req.once("end", resolve)
  })

  const result = JSON.parseBinary(body);
  body.buffer.detach();

  if (!result.ok) {
    res.status(400).json({ error: result.message });
    return;
  }

  res.json({ received: result.value.length });
});

app.listen(3000);
