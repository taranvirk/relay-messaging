// Public deployment smoke check. Session material is kept only in the supplied
// local temporary file and never printed. No existing users or messages change.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { io } from 'socket.io-client';

const [mode, stateFile] = process.argv.slice(2);
if (!['create', 'verify'].includes(mode) || !stateFile)
  throw new Error('Usage: node smoke.mjs create|verify TEMP_STATE_FILE');
const base = 'https://3.131.19.155';
async function request(path, { cookie, method = 'GET', body, origin = base } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}
function event(socket, name, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, listener);
      reject(new Error('Timed out waiting for ' + name));
    }, 15_000);
    const listener = (value) => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      socket.off(name, listener);
      resolve(value);
    };
    socket.on(name, listener);
  });
}
async function connect(cookie) {
  const socket = io(base, {
    extraHeaders: { Cookie: cookie, Origin: base },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    autoConnect: false,
    timeout: 15_000,
  });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    socket.connect();
  });
  return socket;
}
const ready = await request('/api/health/ready');
assert.equal(ready.response.status, 200);
assert.equal(ready.body.status, 'ready');
assert.equal((await request('/api/auth/me')).response.status, 401);
let state;
const sockets = [];
try {
  if (mode === 'create') {
    const suffix = randomBytes(5).toString('hex');
    const users = [];
    for (const name of ['alice', 'bob', 'outsider']) {
      const email = `deploy_${name}_${suffix}@example.invalid`;
      const password = 'Aa9_' + randomBytes(20).toString('hex');
      const registered = await request('/api/auth/register', {
        method: 'POST',
        body: {
          username: `deploy_${name}_${suffix}`,
          displayName: `Deployment check ${name}`,
          email,
          password,
        },
      });
      assert.equal(registered.response.status, 201);
      const cookieHeader = registered.response.headers.get('set-cookie');
      assert.match(cookieHeader, /HttpOnly/i);
      assert.match(cookieHeader, /Secure/i);
      assert.match(cookieHeader, /SameSite=Lax/i);
      users.push({ id: registered.body.user.id, cookie: cookieHeader.split(';')[0] });
      if (name === 'alice') {
        const login = await request('/api/auth/login', {
          method: 'POST',
          body: { email, password },
        });
        assert.equal(login.response.status, 200);
        users[0].cookie = login.response.headers.get('set-cookie').split(';')[0];
      }
    }
    const [alice, bob, outsider] = users;
    const created = await request('/api/conversations', {
      cookie: alice.cookie,
      method: 'POST',
      body: { type: 'DIRECT', memberIds: [bob.id] },
    });
    assert.equal(created.response.status, 201);
    const conversationId = created.body.conversation.id;
    assert.equal(
      (await request(`/api/conversations/${conversationId}/messages`, { cookie: outsider.cookie }))
        .response.status,
      403,
    );
    assert.equal(
      (
        await request('/api/users/me', {
          cookie: alice.cookie,
          method: 'PATCH',
          origin: 'https://untrusted.invalid',
          body: { displayName: 'Should not change' },
        })
      ).response.status,
      403,
    );
    const a = await connect(alice.cookie);
    sockets.push(a);
    const b = await connect(bob.cookie);
    sockets.push(b);
    const typing = event(b, 'typing:start', (v) => v.conversationId === conversationId);
    a.emit('typing:start', { conversationId });
    await typing;
    const clientMessageId = randomUUID();
    const content = 'Deployment check: secure live messaging ' + suffix;
    const incoming = event(b, 'message:new', (v) => v.message.content === content);
    a.emit('message:send', {
      conversationId,
      clientMessageId,
      content,
      type: 'TEXT',
      attachments: [],
    });
    const { message } = await incoming;
    const retry = await request(`/api/conversations/${conversationId}/messages`, {
      cookie: alice.cookie,
      method: 'POST',
      body: { clientMessageId, content },
    });
    assert.equal(retry.body.message.id, message.id);
    const receipt = event(a, 'message:read', (v) => v.messageId === message.id);
    b.emit('message:read', { conversationId, messageId: message.id });
    await receipt;
    const replyContent = 'Deployment check: reply received ' + suffix;
    const replyReceived = event(a, 'message:new', (v) => v.message.content === replyContent);
    b.emit('message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      content: replyContent,
      type: 'TEXT',
      attachments: [],
    });
    const reply = await replyReceived;
    state = {
      base,
      alice,
      bob,
      outsider,
      conversationId,
      messages: [
        { id: message.id, content },
        { id: reply.message.id, content: replyContent },
      ],
    };
    writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
  } else {
    state = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.equal(state.base, base);
    const socket = await connect(state.bob.cookie);
    sockets.push(socket);
  }
  const history = await request(`/api/conversations/${state.conversationId}/messages`, {
    cookie: state.bob.cookie,
  });
  assert.equal(history.response.status, 200);
  for (const expected of state.messages) {
    assert.equal(history.body.messages.filter((m) => m.id === expected.id).length, 1);
    assert.equal(history.body.messages.find((m) => m.id === expected.id).content, expected.content);
  }
  assert.equal(
    (await request('/api/auth/me', { cookie: state.alice.cookie })).response.status,
    200,
  );
  console.log(
    JSON.stringify({
      mode,
      passed: true,
      httpsTrusted: true,
      persistedMessageIds: state.messages.map((m) => m.id),
      conversationId: state.conversationId,
      checks:
        mode === 'create'
          ? [
              'readiness',
              'unauthenticated denial',
              'registration',
              'sign-in',
              'secure cookies',
              'private conversation',
              'origin rejection',
              'WebSocket connect',
              'typing',
              'two-way message delivery',
              'read receipt',
              'idempotent retry',
              'persisted history',
            ]
          : ['readiness', 'persisted sessions', 'persisted history', 'WebSocket reconnect'],
    }),
  );
} finally {
  for (const socket of sockets) socket.disconnect();
}
