// Fastify
//
// Detach after parse. Fastify does not re-read req.body after the
// middleware chain, so releasing the backing store here is safe.

import fastify from 'fastify';
import "./polyfill.mjs"


const app = fastify();


app.post('/', async (req, res) => {
  // not allocUnsafe
  var body = Buffer.allocUnsafeSlow(Number(req.headers["content-length"]));
  var offset = 0;
  // here it is faster than "await new Promise" style
  for await (var chunk of req) {
    body.set(chunk, offset);
    offset+=chunk.byteLength;
    // co-proposal, clear memory immediately
    chunk.buffer.detach();
  }
  const result = JSON.parseBinary(body);
  body.buffer.detach();

  if (!result.ok) {
    res.status(400).send({ error: result.message });
    return;
  }

  res.send({received: result.value.length });
});

app.listen({port: 3000});
