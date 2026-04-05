// gc-strings.mjs — GC pressure from TextDecoder intermediate strings
//
// Mirrors gc-pressure from arraybuffer-detach but targets the string lifecycle,
// not the buffer lifecycle. Demonstrates that the decode → string → parse
// pipeline retains heap memory proportional to payload size until an explicit
// GC cycle — which never happens in a real server under load.
//
// Run A (unconstrained heap):
//   node --expose-gc demo/gc-strings.mjs
//
// Run B (constrained heap — forces mid-loop GC, shows survival cost):
//   node --max-old-space-size=30 --expose-gc demo/gc-strings.mjs

import { performance } from 'node:perf_hooks';
import { section, stat, note, divider, renderBar, dim } from './helpers.mjs';

// ─── config ────────────────────────────────────────────────────────────────

const ITERATIONS  = 2_000;
const PAYLOAD_MB  = 5;
const PAYLOAD_LEN = PAYLOAD_MB * 1024 * 1024;

// ASCII payload — V8 stores as Latin-1 (1 byte/char), cheap to allocate.
const asciiPayload = Buffer.allocUnsafe(PAYLOAD_LEN).fill(65); // 'A'

// Mixed payload — pure ASCII body with one emoji appended near the end.
// When TextDecoder hits it, V8 must re-encode the entire already-decoded
// Latin-1 string as UTF-16 (2 bytes/char), allocating a second full-size
// buffer before freeing the first. Peak memory spikes mid-decode.
const mixedPayload = Buffer.concat([
  Buffer.allocUnsafe(PAYLOAD_LEN).fill(65),
  Buffer.from('\uD83D\uDC4E', 'utf16le'), // 👎 — forces UTF-16 upgrade
]);

const decoder = new TextDecoder();

// ─── helpers ───────────────────────────────────────────────────────────────

function mbN(bytes) {
  return Math.round(bytes / 1024 / 1024 * 10) / 10;
}

// ─── run ───────────────────────────────────────────────────────────────────

function runLoop(payload) {
  if (global.gc) global.gc(); // start from a clean heap
  const before = process.memoryUsage().heapUsed;

  const t0 = performance.now();
  var str;

  for (let i = 0; i < ITERATIONS; i++) {
    // Simulate: receive buffer, decode to string, hand off to JSON.parse.
    // The buffer is reused across iterations — all heap growth here comes
    // from string allocation alone. A real server also allocates a fresh
    // buffer per request, so this understates the true pressure.
    str = decoder.decode(payload);
    if (str.length === 0) throw new Error('impossible'); // prevent DCE
  }

  const wall = performance.now() - t0;

  // Sample heap with the last decoded string still live — this represents
  // the moment a request handler returns. In a busy server the next request
  // arrives before GC runs, so this string is never promptly collected.
  const peak = process.memoryUsage().heapUsed;

  if (global.gc) global.gc();
  const recovered = process.memoryUsage().heapUsed;

  return {
    wall,
    beforeMB:    mbN(before),
    peakMB:      mbN(peak),
    recoveredMB: mbN(recovered),
    retainedMB:  mbN(peak - before),
    freedMB:     mbN(peak - recovered),
  };
}

// ─── detect heap cap ───────────────────────────────────────────────────────

const heapArg = process.execArgv.find(a => a.startsWith('--max-old-space-size='));
const heapCap = heapArg ? heapArg.split('=')[1] + ' MB cap' : 'unconstrained';

// ─── main ──────────────────────────────────────────────────────────────────

section('gc-strings', `TextDecoder string GC pressure · heap: ${heapCap}`);
console.log('');
stat('Payload size', `${PAYLOAD_MB} MB`);
stat('Iterations',   ITERATIONS.toLocaleString());
console.log('');

process.stdout.write(dim('  running ASCII payload...\r'));
const ascii = runLoop(asciiPayload);
process.stdout.write('                              \r');

process.stdout.write(dim('  running mixed payload (emoji near end)...\r'));
const mixed = runLoop(mixedPayload);
process.stdout.write('                                              \r');

// ─── wall time ─────────────────────────────────────────────────────────────

section('Wall time', `${ITERATIONS.toLocaleString()} decode iterations`);

const maxWall = Math.max(ascii.wall, mixed.wall);
renderBar({
  label: 'ASCII (Latin-1 path)',
  value: ascii.wall,
  max:   maxWall,
  good:  true,
});
renderBar({
  label: 'Mixed (UTF-16 upgrade)',
  value: mixed.wall,
  max:   maxWall,
  good:  false,
  badge: `${(mixed.wall / ascii.wall).toFixed(2)}× slower`,
});

note(`One emoji near the end forces V8 to re-encode the entire string mid-decode.`);

// ─── heap at handler exit ──────────────────────────────────────────────────

section('Heap retained at handler exit', 'last string still live, no GC yet');
console.log('');

// ASCII retained may be negative: global.gc() runs just before sampling
// "before", so the baseline is already clean and minor nursery activity
// during the loop can cause heapUsed to fluctuate slightly below baseline.
// Clamp to 0 for display — the meaningful signal is that it is near-zero.
const asciiRetainedDisplay = Math.max(ascii.retainedMB, 0);

stat('ASCII  heap before',     `${ascii.beforeMB} MB`);
stat('ASCII  heap at exit',    `${ascii.peakMB} MB`);
stat('ASCII  string retained', `~${asciiRetainedDisplay} MB`, { color: 'green' });
console.log('');
stat('Mixed  heap before',     `${mixed.beforeMB} MB`);
stat('Mixed  heap at exit',    `${mixed.peakMB} MB`,          { color: 'red' });
stat('Mixed  string retained', `${mixed.retainedMB} MB`,      { color: 'red' });

divider();

const maxPeak = Math.max(ascii.peakMB, mixed.peakMB, 1);
renderBar({
  label: 'ASCII  peak heap',
  value: ascii.peakMB,
  max:   maxPeak,
  unit:  'MB total',
  good:  true,
});
renderBar({
  label: 'Mixed  peak heap',
  value: mixed.peakMB,
  max:   maxPeak,
  unit:  'MB total',
  good:  false,
});

note(`Bar lengths show relative heap size. Numeric value is MB, not ms.`);

// ─── recovery ──────────────────────────────────────────────────────────────

section('After explicit GC');
console.log('');

stat('ASCII  heap after GC', `${ascii.recoveredMB} MB`);
stat('ASCII  freed by GC',   `${ascii.freedMB} MB`);
console.log('');
stat('Mixed  heap after GC', `${mixed.recoveredMB} MB`);
stat('Mixed  freed by GC',   `${mixed.freedMB} MB`, { color: 'green' });

note(`global.gc() is never called in a production server.`);
note(`Under sustained load the ${mixed.retainedMB} MB retained per request`);
note(`accumulates until V8 is forced into a stop-the-world collection.`);

// ─── summary ───────────────────────────────────────────────────────────────

section('Summary');
console.log('');

const heapRatio = mixed.peakMB / Math.max(ascii.peakMB, 0.1);
const wallRatio = mixed.wall   / ascii.wall;

stat('ASCII retained/request', `~${asciiRetainedDisplay} MB  — nursery-collected, negligible`);
stat('Mixed retained/request', `${mixed.retainedMB} MB  — old-gen, survives to stop-the-world`);
stat('Peak heap ratio',        `${heapRatio.toFixed(1)}×  (mixed vs ASCII)`);
stat('Wall time ratio',        `${wallRatio.toFixed(2)}×  (mixed vs ASCII)`);

console.log('');
note(`A ${PAYLOAD_MB} MB payload with one emoji forces a UTF-16 string that retains`);
note(`~${mixed.retainedMB} MB at handler exit — ${heapRatio.toFixed(0)}× the ASCII baseline.`);
note(`JSON.parseBinary avoids this: no intermediate string is allocated.`);

if (!global.gc) {
  console.log('');
  note(`Run with --expose-gc for accurate heap recovery measurements.`);
}

console.log('');
