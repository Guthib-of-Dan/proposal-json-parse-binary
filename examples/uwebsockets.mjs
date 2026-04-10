// uWebSockets.js  (HTTP + WebSocket)
//
// HTTP: collectBody() pre-allocates a single buffer for the full body and
// calls the handler once with a complete ArrayBuffer. This is exactly the
// shape JSON.parseBinary expects — no manual chunk accumulation needed.
//
// IMPORTANT: uWS detaches the ArrayBuffer passed to onData chunks
// on return from each callback, so currently manually detaching buffers 
// is not allowed.
//
// WebSocket: the message handler receives an ArrayBuffer, which is 
// also detached in C++ after handler. Copy or parse it before yielding.

import uWS from 'uWebSockets.js';

const MAX_BODY = 4 * 1024 * 1024; // 4 MB

uWS.App()
  .post('/data', (res, _req) => {
    res.onAborted(() => { res.aborted = true; });

    res.collectBody(MAX_BODY, (body) => {
      if (res.aborted) return;

      // body is null when the payload exceeded MAX_BODY
      if (body === null) {
        res.writeStatus('413 Payload Too Large').end();
        return;
      }

      const result = JSON.parseBinary(body);
      
      // uWS automatically detaches buffer inside, but 
      // as was mentioned in ArrayBuffer.prototype.detach
      // proposal, detaching buffer in C++ is slower than in JS,
      // so when this idea works out, I believe that this 
      // functionality will be promoted
      
      // body.detach()
      
      res.cork(() => {
        if (!result.ok) 
          return res.writeStatus('400 Bad Request')
             .writeHeader('Content-Type', 'application/json')
             .end(JSON.stringify({ error: result.message }));

        res.writeHeader('Content-Type', 'application/json')
           .end(JSON.stringify({ received: result.value }));
      });
    });
  })
  // WebSockets
  .ws('/stream', {
    // uWS handles small payloads for websockets much better,
    // so MAX_BODY (4MB) are not suitable for this communication.
    maxPayloadLength: 64 * 1024,

    message(ws, message, _isBinary) {
      const result = JSON.parseBinary(message);

      // As mentioned in HTTP example, buffer is detached 
      // after callback by C++, but after ArrayBuffer.prototype.detach
      // works out, it might be implemented directly here, or with
      // special API
      
      // message.detach();

      if (!result.ok) {
        ws.send(JSON.stringify({ error: result.message }), false);
        return;
      }

      // echo the parsed value back as confirmation
      ws.send(JSON.stringify({ echo: result.value }), false);
    },
  })

  .listen(3000, (token) => {
    if (token) console.log('listening on port 3000');
  });
