import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createTcpServer } from 'node:net';

export function developmentServer(handler, environment = process.env) {
  const cert = environment.DEV_TLS_CERT_FILE, key = environment.DEV_TLS_KEY_FILE;
  if (!!cert !== !!key) throw new Error('Configure both DEV_TLS_CERT_FILE and DEV_TLS_KEY_FILE');
  if (!cert) return createHttpServer(handler);
  const secure = createHttpsServer({cert:readFileSync(cert), key:readFileSync(key)}, handler);
  const redirect = createHttpServer((request, response) => {
    try {
      const origin = new URL(`https://${request.headers.host}`);
      if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
          !request.url.startsWith('/') || request.url.startsWith('//')) throw new Error();
      response.writeHead(307, {Location:origin.origin + request.url, Connection:'close'}).end();
    } catch { response.writeHead(400, {Connection:'close'}).end(); }
  });
  // Serve TLS and redirect ordinary HTTP on the same development port.
  const server = createTcpServer(socket => {
    socket.once('readable', () => {
      const bytes = socket.read(1);
      if (!bytes) { socket.destroy(); return; }
      socket.unshift(bytes);
      (bytes[0] === 22 ? secure : redirect).emit('connection', socket);
    });
  });
  secure.on('upgrade', (...args) => server.emit('upgrade', ...args));
  const close = server.close.bind(server);
  server.close = (...args) => {
    secure.closeIdleConnections();
    redirect.closeIdleConnections();
    return close(...args);
  };
  return server;
}
