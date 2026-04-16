// Ephemeral node:http server lifecycle for testing.
// Binds to port 0 (OS-assigned), runs the callback, tears down.

import {createServer} from 'node:http';
import {once} from 'node:events';

export async function withServer(handler, fn) {
  const server = createServer(handler);
  server.listen(0);
  await once(server, 'listening');
  const {port} = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}
