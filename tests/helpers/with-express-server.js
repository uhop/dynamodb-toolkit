// Boot a real Express app with the adapter mounted, bind an ephemeral port,
// run the callback, tear down. Mirrors dynamodb-toolkit/tests/helpers/withServer.js
// but uses Express as the top-level server.

import {once} from 'node:events';
import express from 'express';

export const withExpressServer = async (middleware, fn, {before} = {}) => {
  const app = express();
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
