// A loopback-only browser test against the actual cloud release and backend.
// Creates one synthetic user; its random password and cookie stay in memory.
// No real credentials, existing users, or message contents are read or changed.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';

const base = 'https://3.131.19.155';
const suffix = randomBytes(6).toString('hex');
const registered = await fetch(base + '/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base },
  body: JSON.stringify({
    username: 'logout_' + suffix,
    displayName: 'Logout verification',
    email: `logout_${suffix}@example.invalid`,
    password: 'Aa9_' + randomBytes(24).toString('hex'),
  }),
  signal: AbortSignal.timeout(20_000),
});
if (registered.status !== 201)
  throw new Error('Synthetic registration failed: ' + registered.status);
let cookie = registered.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw new Error('Test session was not created');
const allowed = new Set(['/api/auth/me', '/api/auth/logout', '/api/conversations', '/api/config']);
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://127.0.0.1:4180').pathname;
    if (path === '/login' || path === '/messages') console.log(JSON.stringify({ document: path }));
    if (path.startsWith('/api/') && !allowed.has(path)) return res.writeHead(403).end();
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await fetch(base + req.url, {
      method: req.method,
      headers: {
        Origin: base,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}),
      },
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    if (path.startsWith('/api/'))
      console.log(JSON.stringify({ method: req.method, path, status: response.status }));
    res.writeHead(response.status, {
      'Content-Type': response.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(Buffer.from(await response.arrayBuffer()));
    if (path === '/api/auth/logout' && response.status === 204) cookie = undefined;
  } catch {
    res.writeHead(502).end('Test proxy failed');
  }
});
const sockets = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/socket.io/')) return socket.destroy();
  sockets.handleUpgrade(req, socket, head, (client) => {
    const remote = new WebSocket('wss://3.131.19.155' + req.url, {
      headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
    });
    const queue = [];
    client.on('message', (data, binary) => {
      if (remote.readyState === WebSocket.OPEN) remote.send(data, { binary });
      else queue.push([data, binary]);
    });
    remote.on('open', () => {
      console.log('Cloud WebSocket connected');
      for (const [data, binary] of queue) remote.send(data, { binary });
    });
    remote.on('message', (data, binary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
    });
    client.on('close', () => remote.close());
    client.on('error', () => remote.close());
    remote.on('close', () => client.close());
    remote.on('error', () => client.close());
  });
});
server.listen(4180, '127.0.0.1', () =>
  console.log('Live logout test: http://127.0.0.1:4180/messages'),
);
