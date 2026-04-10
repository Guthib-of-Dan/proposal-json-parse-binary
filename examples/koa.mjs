// Koa
//
// Koa has no built-in body parser. koa-body (or the raw ctx.req stream)
// is the typical approach. Here we skip koa-body entirely and accumulate
// the raw stream ourselves — the same cost as node:http but within the
// Koa middleware model.
//
// The alternative would be koa-body with { encoding: false }, but that
// API is not stable across versions, so reading ctx.req directly is
// the most reliable pattern.

import Koa from 'koa';
import Router from '@koa/router';

const app    = new Koa();
const router = new Router();

router.post('/data', async (ctx) => {
  var body = Buffer.allocUnsafeSlow(Number(ctx.req.headers["content-length"]));
  await new Promise((resolve)=>{
    ctx.req.on("data", (chunk)=>{
      body.set(chunk, offset);
      offset += chunk.byteLength;
      // clear memory immediately
      chunk.buffer.detach();
    })
    ctx.req.once("end", resolve);
  })

  const result = JSON.parseBinary(body);

  body.detach();

  if (!result.ok) {
    ctx.status = 400;
    ctx.body   = { error: result.message };
    return;
  }

  ctx.body = { received: result.value.length };
});

app.use(router.routes()).use(router.allowedMethods());
app.listen(3000);
