import { performance } from 'node:perf_hooks'
import { section, renderBar, note, dim } from './helpers.mjs'

const ITERS = 1_000_000
const message = "THERE IS AN ERROR HERE!!! YOU HAVE TO LOOK!!!"

section('error-handling', 'return {ok} vs new SyntaxError vs throw SyntaxError')
console.log(`\n  ${'Iterations:'.padEnd(22)} ${ITERS.toLocaleString()}`)
console.log(`  ${'Message length:'.padEnd(22)} ${message.length} chars`)

var before, after, a, b, c

before = performance.now()
for (var i = 0; i < ITERS; i++) { a = { ok: false, message } }
after = performance.now()
var r1 = after - before

before = performance.now()
for (var i = 0; i < ITERS; i++) { b = new SyntaxError(message) }
after = performance.now()
var r2 = after - before

before = performance.now()
for (var i = 0; i < ITERS; i++) { try { throw new SyntaxError(message) } catch (err) { c = err } }
after = performance.now()
var r3 = after - before

console.log('')
const max = Math.max(r1, r2, r3)
renderBar({ label: '{ok: false, message}',    value: r1, max, unit: 'ms', good: true  })
renderBar({ label: 'new SyntaxError(message)', value: r2, max, unit: 'ms', good: false })
renderBar({ label: 'throw new SyntaxError()',  value: r3, max, unit: 'ms', good: false })

console.log('')
console.log(dim(`  {ok} vs new SyntaxError:   ${(r2 / r1).toFixed(0)}× faster  (${r1.toFixed(1)} ms vs ${r2.toFixed(1)} ms)`))
console.log(dim(`  {ok} vs throw SyntaxError:  ${(r3 / r1).toFixed(0)}× faster  (${r1.toFixed(1)} ms vs ${r3.toFixed(1)} ms)`))
console.log(dim(`  new vs throw overhead:      +${((r3 / r2 - 1) * 100).toFixed(1)}%  (stack trace capture cost)`))

note('{ok, message} return is the proposed JSON.parseBinary failure path — no SyntaxError allocation, no stack trace, no throwing.')
