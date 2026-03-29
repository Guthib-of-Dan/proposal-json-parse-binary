import { performance } from 'node:perf_hooks'
import { section, renderBar, divider, note, dim, bold } from './helpers.mjs'

const SMALL_SIZE = 512
const LARGE_SIZE = 4 * 1024 * 1024

function makeSmallValid() {
  const obj = {}
  for (let i = 0; i < 20; i++) obj[`key${i}`] = i * 1.5
  let s = JSON.stringify(obj), n = 20
  while (s.length < SMALL_SIZE) { obj[`key${n++}`] = n; s = JSON.stringify(obj) }
  return s
}
function makeLargeValid() {
  const items = []
  let total = 2, i = 0
  while (total < LARGE_SIZE) {
    const e = JSON.stringify({ id: i, name: `item${i}`, value: i * 0.1, active: i % 2 === 0 })
    items.push(e); total += e.length + 1; i++
  }
  return '[' + items.join(',') + ']'
}

const smallValid        = makeSmallValid()
const largeValid        = makeLargeValid()
const smallInvalid      = 'X' + smallValid.slice(1)
const largeInvalidStart = 'X' + largeValid.slice(1)
const largeInvalidEnd   = largeValid + '!!'
const decoder           = new TextDecoder()
const largeValidBuffer  = Buffer.from(new TextEncoder().encode(largeValid))
const largeInvalidBuffer = Buffer.from(new TextEncoder().encode(largeInvalidStart))

const ITERS_SMALL = 300_000
const ITERS_LARGE = 300

// ─── small ─────────────────────────────────────────────────────────────────

section('json-parse', 'small payload · 512 B')
console.log(`\n  ${'Payload size:'.padEnd(14)} ${(smallValid.length / 1024).toFixed(1)} KB`)
console.log(`  ${'Iterations:'.padEnd(14)} ${ITERS_SMALL.toLocaleString()}`)

// warmup
for (var i = 0; i < ITERS_SMALL*2; i++) { try { JSON.parse(smallValid) } catch (_) {} }

var before, after

before = performance.now()
for (var i = 0; i < ITERS_SMALL; i++) { JSON.parse(smallValid) }
after = performance.now()
var r1 = after - before

before = performance.now()
for (var i = 0; i < ITERS_SMALL; i++) { try { JSON.parse(smallInvalid) } catch (_) {} }
after = performance.now()
var r2 = after - before

console.log('')
const smallMax = Math.max(r1, r2)
renderBar({ label: 'valid  (no try-catch)',  value: r1, max: smallMax, unit: 'ms', good: true })
renderBar({ label: 'invalid, error@start',   value: r2,  max: smallMax, unit: 'ms', good: false,
  badge: `${(r2 / r1).toFixed(2)}× slower than valid` })

console.log('')
console.log(dim(`  SyntaxError cost:     ${((r2 / r1 - 1) * 100).toFixed(0)}%  over valid parse`))

// ─── large ─────────────────────────────────────────────────────────────────

section('json-parse', 'large payload · 4 MB')
console.log(`\n  ${'Payload size:'.padEnd(14)} ${(largeValid.length / 1024 / 1024).toFixed(1)} MB`)
console.log(`  ${'Iterations:'.padEnd(14)} only ${ITERS_LARGE.toLocaleString()} - thousand times less than 'small' case`)

// warmup
before = performance.now()
for (var i = 0; i < ITERS_LARGE; i++) { try { JSON.parse(decoder.decode(largeValidBuffer)) } catch (_) {} }
after = performance.now()
var r5a = after - before

before = performance.now()
for (var i = 0; i < ITERS_LARGE; i++) { try { JSON.parse(decoder.decode(largeValidBuffer)) } catch (_) {} }
after = performance.now()
var r5a = after - before

before = performance.now()
for (var i = 0; i < ITERS_LARGE; i++) { try { JSON.parse(largeValidBuffer.toString()) } catch (_) {} }
after = performance.now()
var r5b = after - before

before = performance.now()
// waste time decoding string
for (var i = 0; i < ITERS_LARGE; i++) { try { JSON.parse(decoder.decode(largeInvalidBuffer)) } catch (_) {} }
after = performance.now()
var r5c = after - before

before = performance.now()
for (var i = 0; i < ITERS_LARGE; i++) { JSON.parse(largeValid) }
after = performance.now()
var r3 = after - before

before = performance.now()
for (var i = 0; i < ITERS_LARGE; i++) { try { JSON.parse(largeInvalidStart) } catch (_) {} }
after = performance.now()
var r4a = after - before

before = performance.now()
for (var i = 0; i < ITERS_LARGE; i++) { try { JSON.parse(largeInvalidEnd) } catch (_) {} }
after = performance.now()
var r4b = after - before


console.log('')
const largeMax = Math.max(r3, r4a, r4b, r5a, r5b)
renderBar({ label: 'valid  (string)',           value: r3,  max: largeMax, unit: 'ms', good: true })
renderBar({ label: 'invalid, error@start',      value: r4a, max: largeMax, unit: 'ms', good: true,
  badge: `O(1) abort — ${(r4a / r3 * 100).toFixed(2)}% of valid parse time` })
renderBar({ label: 'invalid, error@end',        value: r4b, max: largeMax, unit: 'ms', good: false,
  badge: `${((r4b / r3 - 1) * 100).toFixed(0)}% slower than valid` })
renderBar({ label: '+ TextDecoder', value: r5a, max: largeMax, unit: 'ms', good: undefined,
  badge: `+${((r5a / r3 - 1) * 100).toFixed(1)}% over string parse` })
renderBar({ label: 'wasted decode, err@start', value: r5c, max: largeMax, unit: 'ms', good: undefined,
  badge: `+${((r5a / r3 - 1) * 100).toFixed(1)}% over string parse` })
renderBar({ label: '+ Buffer.str()', value: r5b, max: largeMax, unit: 'ms', good: undefined,
  badge: `+${((r5b / r3 - 1) * 100).toFixed(1)}% over string parse` })

console.log('')
console.log(dim(`  large error@start ~ small error@start = ${(r4a / r4b * 100).toFixed(2)}% of error@end time`))
console.log(dim(`  Full-walk penalty:    error@end   = ${((r4b / r3 - 1) * 100).toFixed(0)}% over valid parse`))
console.log(dim(`  TextDecoder cost:     decode+parse = ${((r5a / r3 - 1) * 100).toFixed(1)}% over string parse`))
console.log(dim(`  Buffer cost:          str+parse    = ${((r5b / r3 - 1) * 100).toFixed(1)}% over string parse`))

note(`
  These benchmarks demonstate that throwing SyntaxError slows down the application up to 3 times.
  Data from the clients has to be decoded into intermediate string, which creates more GC pressure.
  Furthermore, if payload is invalid that copying becomes a waste.
  ---
  JSON.parseBinary(buf) would not throw or require intermediate strings and would decode data incrementally, introducing us better handling of unsanitized inputs
`)
