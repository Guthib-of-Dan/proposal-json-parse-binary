// Hono  (Node.js · Bun · Deno · Cloudflare Workers)
//
// Hono's req.arrayBuffer() returns the raw body as an ArrayBuffer on
// every supported runtime — no TextDecoder, no intermediate string.
// The API is identical regardless of whether you run on Node, Bun or Deno.

import { Hono } from 'hono';
import "./polyfill.mjs"

const app = new Hono();

app.post('/data', async (context) => {
  const buf    = await context.req.arrayBuffer();
  const result = JSON.parseBinary(buf);
  buf.detach(); // safe: Hono does not re-read the body after this point

  if (!result.ok) {
    return context.json({ error: result.message }, 400);
  }

  return context.json({ received: result.value.length });
});

export default app;
