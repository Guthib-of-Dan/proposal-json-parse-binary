import { performance } from 'node:perf_hooks'
import { section, renderBar, divider, note, dim, bold } from './helpers.mjs'

const LARGE_SIZE = 4 * 1024 * 1024
const ITERS      = 100

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Four payloads covering the full UTF-8 byte-width spectrum
const oneByteStr        = 'A'.repeat(LARGE_SIZE)               // ASCII — 1 byte/char in UTF-8, 1 byte/char Latin-1 in V8
const oneByteMixedStr   = 'A'.repeat(LARGE_SIZE) + '👎🏿'      // ASCII + one 4-byte emoji — forces V8 to UTF-16
const threeByteStr      = '☺️'.repeat(LARGE_SIZE)             // 3-byte UTF-8 chars — 2 chars/codepoint in JS (☺ + VS16)
const fourByteStr       = '👎🏿'.repeat(LARGE_SIZE)           // 4-byte UTF-8 sequences — 4 JS chars per emoji (2 surrogates × 2 codepoints)

const oneByteUtf8       = encoder.encode(oneByteStr)
const oneByteMixedUtf8  = encoder.encode(oneByteMixedStr)
const threeByteUtf8     = encoder.encode(threeByteStr)
const fourByteUtf8      = encoder.encode(fourByteStr)

section('decoding', 'TextDecoder cost by UTF-8 byte width · 4 MB inputs · 100 iters')

// Size table — shows the JS string / UTF-8 buffer relationship
console.log('')
console.log(`  ${'input'.padEnd(16)}  ${'JS chars'.padStart(12)}  ${'UTF-8 bytes'.padStart(12)}  ${'ratio'.padStart(8)}  V8 string encoding`)
console.log(`  ${'─'.repeat(68)}`)

function sizeRow(label, jsStr, utf8Buf, encoding) {
  const ratio = (utf8Buf.length / jsStr.length).toFixed(2)
  console.log(
    `  ${label.padEnd(16)}  ${jsStr.length.toLocaleString().padStart(12)}  ${utf8Buf.length.toLocaleString().padStart(12)}  ${(ratio + '×').padStart(8)}  ${dim(encoding)}`
  )
}

sizeRow('A (ascii)',      oneByteStr,       oneByteUtf8,      'Latin-1  (1 byte/char)')
sizeRow('A…👎🏿 (mixed)', oneByteMixedStr,  oneByteMixedUtf8, 'UTF-16   (2 bytes/char) — one emoji forces full upgrade')
sizeRow('☺️ (3-byte)',   threeByteStr,     threeByteUtf8,    'UTF-16   (2 bytes/char)')
sizeRow('👎🏿 (4-byte)',  fourByteStr,      fourByteUtf8,     'UTF-16   (4 bytes/char, 2 surrogates)')

// Timing
var before, after

before = performance.now()
for (var i = 0; i < ITERS; i++) { decoder.decode(oneByteUtf8) }
after = performance.now()
var r1 = after - before

before = performance.now()
for (var i = 0; i < ITERS; i++) { decoder.decode(oneByteMixedUtf8) }
after = performance.now()
var r1m = after - before

before = performance.now()
for (var i = 0; i < ITERS; i++) { decoder.decode(threeByteUtf8) }
after = performance.now()
var r3 = after - before

before = performance.now()
for (var i = 0; i < ITERS; i++) { decoder.decode(fourByteUtf8) }
after = performance.now()
var r4 = after - before

console.log('')
const max = Math.max(r1, r1m, r3, r4)
renderBar({ label: 'A          (1-byte UTF-8)', value: r1,  max, unit: 'ms', good: true })
renderBar({ label: 'A…👎🏿    (1-byte + emoji)', value: r1m, max, unit: 'ms', good: false,
  badge: `${(r1m / r1).toFixed(1)}× slower — UTF-16 upgrade` })
renderBar({ label: '☺️         (3-byte UTF-8)', value: r3,  max, unit: 'ms', good: undefined,
  badge: `UTF-8 buf ${(threeByteUtf8.length / oneByteUtf8.length).toFixed(1)}× larger than ASCII buf` })
renderBar({ label: '👎🏿        (4-byte UTF-8)', value: r4,  max, unit: 'ms', good: false,
  badge: `${(r4 / r1).toFixed(1)}× slower than ASCII` })

console.log('')
console.log(dim(`  ASCII Latin-1 path:    ${r1.toFixed(1)} ms  — V8 stores as 1 byte/char, decode is a memcopy`))
console.log(dim(`  Mixed UTF-16 upgrade:  ${r1m.toFixed(1)} ms  — one non-ASCII char forces full 2 byte/char reallocation`))
console.log(dim(`  3-byte chars:          ${r3.toFixed(1)} ms  — UTF-8 buf is ${(threeByteUtf8.length / oneByteUtf8.length).toFixed(0)}× the ASCII buf size, JS string is ${(threeByteStr.length / oneByteStr.length).toFixed(0)}× JS chars`))
console.log(dim(`  4-byte chars:          ${r4.toFixed(1)} ms  — UTF-8 buf is ${(fourByteUtf8.length / oneByteUtf8.length).toFixed(0)}× the ASCII buf size, JS string is ${(fourByteStr.length / oneByteStr.length).toFixed(0)}× JS chars`))

note('JSON.parseBinary(buf) reads UTF-8 bytes directly — no intermediate JS string, no encoding upgrade penalty.')
note('For ASCII-only JSON (the common server case) the intermediate string is a pure copy with no benefit.')
