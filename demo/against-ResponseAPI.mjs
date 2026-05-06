var payload1 = '{"key":"value", "key2": 123123}';
console.info("Payload to be tested: ", payload1)
var buffer1 = Buffer.from(payload1)
console.time("JSON.parse")
for (var i = 0; i < 1_000_000; i++) {
  JSON.parse(buffer1.toString());
}
console.timeEnd("JSON.parse")
console.time("await Response.json()")
for (var i = 0; i < 1_000_000; i++) {
  await new Response(buffer1).json()
}
console.timeEnd("await Response.json()")


var payload2 = JSON.stringify(
  new Array(100).fill({"key":"value", "key2": 123123})
);
console.info("Payload - an array of " + payload1, "; Length in js characters:", payload2.length)
var buffer2 = Buffer.from(payload2)
console.time("JSON.parse")
for (var i = 0; i < 1_000_00; i++) {
  JSON.parse(buffer2.toString());
}
console.timeEnd("JSON.parse")
console.time("await Response.json()")
for (var i = 0; i < 1_000_00; i++) {
  await new Response(buffer2).json()
}
console.timeEnd("await Response.json()")
