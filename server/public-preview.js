// Optional local gateway for a demo tunnel. Only audience pages and the relay
// are reachable through this port; the creator desk stays on the main server.
import http from 'node:http';
import { pathToFileURL } from 'node:url';

export function createPublicPreview({ appPort = 4188 } = {}) {
  function allowed(req, upgrade = false) {
    const pathname = new URL(req.url, 'http://internal').pathname;
    return upgrade ? pathname === '/ws' : ['GET', 'HEAD'].includes(req.method)
      && (pathname === '/' || /^\/(station|display|shared)(\/|$)/.test(pathname));
  }
  function forward(req) {
    const headers = { ...req.headers, host: `127.0.0.1:${appPort}` };
    delete headers.cookie;
    delete headers.authorization;
    return http.request({ hostname: '127.0.0.1', port: appPort, path: req.url, method: req.method, headers });
  }
  const server = http.createServer((req, res) => {
    if (!allowed(req)) { res.writeHead(404); res.end('Audience preview only.'); return; }
    const upstream = forward(req);
    upstream.on('response', (response) => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('The canvas server is reconnecting.'); });
    req.pipe(upstream);
  });
  server.on('upgrade', (req, socket, head) => {
    if (!allowed(req, true)) { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
    const upstream = forward(req);
    upstream.on('upgrade', (response, peer, upstreamHead) => {
      const headers = response.rawHeaders.reduce((lines, value, i, all) => i % 2 ? lines : `${lines}${value}: ${all[i + 1]}\r\n`, '');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n`);
      if (head.length) peer.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      socket.pipe(peer).pipe(socket);
      socket.on('error', () => peer.destroy());
      peer.on('error', () => socket.destroy());
      socket.on('close', () => peer.destroy());
      peer.on('close', () => socket.destroy());
    });
    upstream.on('error', () => socket.destroy());
    upstream.on('response', () => socket.destroy());
    upstream.end();
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PUBLIC_PREVIEW_PORT || 4189);
  createPublicPreview({ appPort: Number(process.env.PORT || 4188) }).listen(port, '127.0.0.1', () => {
    console.log(`Audience gateway: http://127.0.0.1:${port}/station/ (admin routes excluded)`);
  });
}
