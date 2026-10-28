// Local-only browser fixture for the built frontend. No real credentials,
// database, cloud access, or user messages are used.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'frontend/dist');
let signedOut = false;
const user = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'logout_check',
  displayName: 'Logout check',
  avatarUrl: null,
};
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1:4179').pathname;
  res.setHeader('Cache-Control', 'no-store');
  function json(status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
  if (path === '/api/auth/logout' && req.method === 'POST') {
    signedOut = true;
    console.log('Fixture logout received');
    res.writeHead(204).end();
  } else if (path === '/api/auth/me') {
    json(
      signedOut ? 401 : 200,
      signedOut ? { error: { code: 'INVALID_TOKEN', message: 'Signed out' } } : { user },
    );
  } else if (path === '/api/conversations') {
    json(200, { conversations: [] });
  } else if (path === '/api/config') {
    json(200, { attachmentsEnabled: false });
  } else if (path.startsWith('/api/')) {
    json(404, { error: { code: 'NOT_FOUND', message: 'Unknown fixture request' } });
  } else {
    const file = resolve(root, path.startsWith('/assets/') ? '.' + path : 'index.html');
    if (!file.startsWith(root + sep)) return res.writeHead(403).end();
    try {
      const content = await readFile(file);
      res.setHeader(
        'Content-Type',
        file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html',
      );
      res.end(content);
    } catch {
      res.writeHead(404).end();
    }
  }
});
server.on('upgrade', (_req, socket) => socket.destroy());
server.listen(4179, '127.0.0.1', () =>
  console.log('Logout fixture: http://127.0.0.1:4179/messages'),
);
