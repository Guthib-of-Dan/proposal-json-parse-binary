// Bun.serve
//
// Bun's built-in server is identical to Deno's in surface area —
// req.arrayBuffer() gives you the raw body. Bun runs on JavaScriptCore,
// not V8, but the Latin-1 / UTF-16 dual-representation and the same
// intermediate-string allocation cost apply equally (see gc-strings benchmark).
import Bun from "bun"
import "./polyfill.mjs"
Bun.serve({
  port: 3000,

  async fetch(req) {
    if (req.method !== 'POST') {
      return new Response(null, { status: 405 });
    }
    const buf = await req.arrayBuffer();

    const result = JSON.parseBinary(buf);

    // this is a co-proposal - manually clear memory
    buf.detach();

    if (!result.ok) {
      return Response.json({ error: result.message }, { status: 400 });
    }

    return Response.json({ received: result.value });
  },
});
