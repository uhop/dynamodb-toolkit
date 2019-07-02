'use strict';

const Koa = require('koa');
// const conditionalGet = require('koa-conditional-get');
// const etag = require('koa-etag');
const body = require('koa-body');
// const compress = require('koa-compress');
// const cacheControl = require('koa-ctx-cache-control');
// const cors = require('@koa/cors');

// routes
const main = require('./routes');

// The APP

const app = new Koa();

app.use(async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    ctx.status = error.status || 500;
    ctx.body = {code: error.code, message: error.message};
    ctx.app.emit('error', error, ctx);
  }
});

app.on('error', (error, ctx) => {
  console.error('ERROR:', error, ctx);
});

app
  .use(body({formLimit: '10mb', multipart: true}))
//   .use(compress())
//   .use(conditionalGet())
//   .use(etag())
//   .use(cors());
// cacheControl(app);

// x-response-time
app.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  ctx.set('X-Response-Time', `${ms}ms`);
});

// plug-in the router
app.use(main.routes()).use(main.allowedMethods());

// The SERVER

const http = require('http');
const colors = require('colors/safe');

const normalizePort = val => {
  const port = +val;
  return isNaN(port) ? val : port >= 0 ? port : false;
};

const host = process.env.HOST || 'localhost',
  port = normalizePort(process.env.PORT || '3000'),
  server = http.createServer(app.callback());

const portToString = port => (typeof port === 'string' ? 'pipe ' + port : 'port ' + port);

const onError = error => {
  if (error.syscall !== 'listen') {
    throw error;
  }

  // handle specific listen errors with friendly messages
  const bind = portToString(port);
  switch (error.code) {
    case 'EACCES':
      console.error('Error: ' + bind + ' requires elevated privileges');
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error('Error: ' + bind + ' is already in use');
      process.exit(1);
      break;
    default:
      throw error;
  }
};

const onListening = () => {
  //const addr = server.address();
  const bind = portToString(port);
  console.log('Listening on ' + (host || 'all network interfaces') + ' ' + bind);
  if (host && /^port\b/.test(bind)) {
    console.log(colors.cyan('http://' + host + ':' + port + '/'));
  }
};

server.listen(port, host);
server.on('error', onError);
server.on('listening', onListening);
