// Deno.serve
//
// Deno's built-in server exposes req.arrayBuffer() on the Request object,
// matching the Fetch API surface. Same pattern as the browser Fetch example.
import "./polyfill.mjs"
Deno.serve({ port: 3000 }, async (req) => {
  console.log("HERE")
  if (req.method !== 'POST') {
    return new Response(null, { status: 405 });
  }

  const buf    = await req.arrayBuffer();
  const result = JSON.parseBinary(buf);
  // co-proposal - manually clear memory
  buf.detach();

  if (!result.ok) {
    return Response.json({ error: result.message }, { status: 400 });
  }

  return Response.json({ received: result.value.length })
})
