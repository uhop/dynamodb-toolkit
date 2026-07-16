// Boot a real Koa app with the adapter mounted, bind an ephemeral port, run
// the callback, tear down. Mirrors dynamodb-toolkit/tests/helpers/withServer.js
// but uses Koa as the top-level server.

import {once} from 'node:events';
import Koa from 'koa';

export const withKoaServer = async (middleware, fn, {before} = {}) => {
  const app = new Koa();
  // Suppress Koa's default error-log during tests — ctx.onerror still runs
  // but we don't pollute test output with noisy stack traces for deliberate
  // error paths.
  app.silent = true;
  if (before) before(app);
  app.use(middleware);

  const server = app.listen(0);
  await once(server, 'listening');
  const {port} = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
};
