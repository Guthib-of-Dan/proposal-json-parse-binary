// Fetch API  (browser · Node 18+ · Deno · Bun)
//
// On the client side, response.arrayBuffer() gives you the raw bytes
// directly. This avoids the response.json() path which internally does
// TextDecoder.decode() + JSON.parse() and throws on invalid payloads.
//
// Detach only once you are certain the buffer is no longer needed.

import "./polyfill.mjs"
async function fetchJson(url, options = {}) {
  var response;
  var body;
  try {
    response = await fetch(url, options);
    body = await response.arrayBuffer();
  } catch (networkError) {
    // network failure — no buffer to detach
    return { ok: false, message: networkError.message };
  }

  const result = JSON.parseBinary(body);

  if (result.ok) {
    body.detach(); // parsed successfully — raw bytes no longer needed
  }
  // on failure: caller can still inspect buf if needed before detaching

  return result;
}

// ── usage ─────────────────────────────────────────────────────────────────

const result = await fetchJson('https://jsonplaceholder.typicode.com/todos/1');

if (!result.ok) {
  console.error('parse failed:', result.message);
} else {
  console.log('data:', result.value);
}
