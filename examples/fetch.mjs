// Fetch API  (browser · Node 18+ · Deno · Bun)
//
// On the client side, response.arrayBuffer() gives you the raw bytes
// directly. This avoids the response.json() path which internally does
// TextDecoder.decode() + JSON.parse() and throws on invalid payloads.
//
// Detach is intentionally omitted on the error path: if the server
// returned a non-JSON body you may still want to inspect the raw bytes
// for debugging (e.g. log them or display an error message). Detach only
// once you are certain the buffer is no longer needed.

import "./polyfill.mjs"
async function fetchJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (networkError) {
    // network failure — no buffer to detach
    return { ok: false, message: networkError.message };
  }

  const buf    = await response.arrayBuffer();
  const result = JSON.parseBinary(buf);

  if (result.ok) {
    buf.detach(); // parsed successfully — raw bytes no longer needed
  }
  // on failure: caller can still inspect buf if needed before detaching

  return result;
}

// ── usage ─────────────────────────────────────────────────────────────────

const result = await fetchJson('https://api.example.com/data');

if (!result.ok) {
  console.error('parse failed:', result.message);
} else {
  console.log('data:', result.value);
}
