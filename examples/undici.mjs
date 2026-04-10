// Undici  (Node.js built-in HTTP client, also used internally by fetch)
//
// undici.request() with responseType: 'arrayBuffer' is equivalent to
// fetch + response.arrayBuffer() but avoids the Fetch overhead when you
// are already in a Node.js context and want lower-level control.
//
// Same detach strategy as the Fetch example: detach on success,
// hold on failure in case the caller wants to inspect the raw bytes.

import { request } from 'undici';
import "./polyfill.mjs"

async function getJson(url) {
  const { body } = await request(url);

  // Collect the response body as an ArrayBuffer.
  // undici's body is a Readable, arrayBuffer() drains and concatenates.
  const buf    = await body.arrayBuffer();
  const result = JSON.parseBinary(buf);

  if (result.ok) {
    buf.detach();
  }

  return result;
}

// ── usage ─────────────────────────────────────────────────────────────────

const result = await getJson('https://jsonplaceholder.typicode.com/todos/1');

if (!result.ok) {
  console.error('parse failed:', result.message);
} else {
  console.log('data:', result.value);
}
