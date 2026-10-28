import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';

// This deliberately disrupts only this repository's disposable local Compose
// stack. Never aim a failure drill at a shared or production environment.
const workspace = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const base = process.env.BASE_URL || 'http://127.0.0.1:8080';
const origin = new URL(base);
assert(['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname), 'Localhost only');
assert.equal(origin.protocol, 'http:');
const dockerContext =
  process.env.DOCKER_CONTEXT || (process.platform === 'win32' ? 'desktop-linux' : 'default');
const run = promisify(execFile);
const docker = async (...args) =>
  (
    await run('docker', ['--context', dockerContext, ...args], {
      cwd: workspace,
      timeout: 60000,
      maxBuffer: 8 * 1024 * 1024,
    })
  ).stdout;
const compose = (...args) => docker('compose', '--project-directory', workspace, ...args);
const canonical = (value) => value.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
const containerIds = new Map();
for (const service of ['postgres', 'redis', 'backend', 'backend-replica', 'frontend']) {
  const id = (await compose('ps', '-q', service)).trim();
  assert(id, `${service} must be running before the drill`);
  containerIds.set(service, id);
  const [container] = JSON.parse(await docker('inspect', id));
  assert.equal(
    canonical(container.Config.Labels['com.docker.compose.project.working_dir']),
    canonical(workspace),
    'Refusing to touch containers owned by another workspace',
  );
}

async function http(path, cookie, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  return {
    status: response.status,
    body:
      response.status === 204
        ? null
        : response.headers.get('content-type')?.includes('application/json')
          ? await response.json()
          : await response.text(),
    cookie: response.headers.getSetCookie()[0]?.split(';')[0],
  };
}

async function ready() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      if ((await http('/api/health/ready')).status === 200) return;
    } catch {
      /* startup */
    }
    await delay(500);
  }
  throw new Error('Local API did not become ready');
}

function event(socket, name, predicate = () => true, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const listener = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(name, listener);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      socket.off(name, listener);
      reject(new Error(`Timed out waiting for ${name}`));
    }, timeout);
    socket.on(name, listener);
  });
}

const sockets = [];
const cleanups = [];
const stopped = new Set();
async function stop(service) {
  stopped.add(service);
  await compose('stop', service);
  console.log(`${service} stopped for the failure drill`);
}
async function restore(service) {
  // Start the exact validated container, without restarting completed migration
  // dependencies as Compose's service-level start would do.
  await docker('start', containerIds.get(service));
  stopped.delete(service);
}

try {
  await ready();
  const senderLogin = await http('/api/auth/login', null, 'POST', {
    email: 'maya@relay.local',
    password: 'RelayDemo123!',
  });
  const recipientLogin = await http('/api/auth/login', null, 'POST', {
    email: 'theo@relay.local',
    password: 'RelayDemo123!',
  });
  assert.equal(senderLogin.status, 200, 'Seed the local demo users first');
  assert.equal(recipientLogin.status, 200);
  const created = await http('/api/conversations', senderLogin.cookie, 'POST', {
    type: 'DIRECT',
    memberIds: [recipientLogin.body.user.id],
  });
  assert.equal(created.status, 201);
  const conversationId = created.body.conversation.id;
  const connect = async (cookie) => {
    const socket = io(base, {
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie },
      autoConnect: false,
      forceNew: true,
      reconnectionDelay: 250,
    });
    sockets.push(socket);
    let retry;
    cleanups.push(() => clearTimeout(retry));
    socket.on('connect_error', (error) => {
      if (error.data?.retryable && !retry)
        retry = setTimeout(() => {
          retry = undefined;
          socket.connect();
        }, 1000);
    });
    socket.on('connect', () => {
      clearTimeout(retry);
      retry = undefined;
    });
    const connected = event(socket, 'connect');
    socket.connect();
    await connected;
    return socket;
  };
  const sender = await connect(senderLogin.cookie);
  const recipient = await connect(recipientLogin.cookie);
  const send = async (clientMessageId, content) => {
    const delivered = event(
      recipient,
      'message:new',
      (payload) => payload.clientMessageId === clientMessageId,
    );
    const ack = await sender
      .timeout(15000)
      .emitWithAck('message:send', { conversationId, clientMessageId, content });
    assert.equal(ack.ok, true);
    assert.equal((await delivered).message.id, ack.message.id);
    return ack.message;
  };
  const baseline = await send(`drill-${randomUUID()}`, 'Failure drill: durable baseline');
  console.log('Baseline message persisted and reached the other user');

  await stop('postgres');
  assert.equal((await http('/api/health/ready')).status, 503);
  const retryId = `drill-${randomUUID()}`;
  const rejected = await sender.timeout(15000).emitWithAck('message:send', {
    conversationId,
    clientMessageId: retryId,
    content: 'Failure drill: retry after database recovery',
  });
  assert.equal(rejected.ok, false, 'Never acknowledge success without persistence');
  await restore('postgres');
  await ready();
  const recovered = await send(retryId, 'Failure drill: retry after database recovery');
  // Other replicas may still be recycling connections closed by PostgreSQL.
  // Retry only transient server errors with the exact same idempotency key.
  let duplicate;
  let retryAttempts = 0;
  do {
    duplicate = await http(
      `/api/conversations/${conversationId}/messages`,
      senderLogin.cookie,
      'POST',
      { clientMessageId: retryId, content: recovered.content },
    );
    retryAttempts += 1;
    if (duplicate.status >= 500) await delay(500);
  } while (duplicate.status >= 500 && retryAttempts < 10);
  if (retryAttempts > 1)
    console.log(`Database recovery needed ${retryAttempts} HTTP attempts with the same client ID`);
  assert.equal(
    duplicate.status,
    201,
    `Idempotency retry status ${duplicate.status}: ${JSON.stringify(duplicate.body?.error ?? duplicate.body)}`,
  );
  assert.equal(duplicate.body.message.id, recovered.id);
  console.log('PostgreSQL outage failed safely; retry persisted one message after recovery');

  await stop('redis');
  console.log('Checking readiness while Redis is unavailable');
  assert.equal((await http('/api/health/ready')).status, 503);
  console.log('Checking authentication fails closed while Redis is unavailable');
  assert.equal((await http('/api/auth/me', senderLogin.cookie)).status, 503);
  const disconnected = event(sender, 'disconnect');
  sender.emit('typing:stop', { conversationId });
  await disconnected;
  const senderReconnected = event(sender, 'connect');
  await restore('redis');
  await ready();
  await senderReconnected;
  if (!recipient.connected) await event(recipient, 'connect');
  await send(`drill-${randomUUID()}`, 'Failure drill: Redis coordination recovered');
  console.log('Redis outage failed closed; the session reconnected and delivery recovered');

  const senderId = sender.id;
  let owner;
  for (let attempt = 0; attempt < 10 && !owner; attempt++) {
    for (const service of ['backend', 'backend-replica']) {
      const logs = await compose('logs', '--no-log-prefix', '--since', '5m', service);
      if (logs.includes(`"socketId":"${senderId}"`)) owner = service;
    }
    if (!owner) await delay(500);
  }
  assert(owner, 'Identify the exact API replica holding the sender socket');
  const migrated = event(sender, 'connect');
  await stop(owner);
  await migrated;
  if (!recipient.connected) await event(recipient, 'connect');
  await send(`drill-${randomUUID()}`, 'Failure drill: API replica failover recovered');
  console.log('Socket reconnected and delivered through the surviving API replica');
  const history = await http(`/api/conversations/${conversationId}/messages`, senderLogin.cookie);
  assert.equal(history.status, 200);
  assert(history.body.messages.some((message) => message.id === baseline.id));
  assert.equal(
    history.body.messages.filter((message) => message.clientMessageId === retryId).length,
    1,
  );
  console.log('API replica termination reconnected through Nginx; history remained durable');
  await restore(owner);
  await ready();
  console.log('PASS: local PostgreSQL, Redis, and API replica recovery drills');
} finally {
  cleanups.forEach((cleanup) => cleanup());
  for (const socket of sockets) socket.disconnect();
  for (const service of stopped) await docker('start', containerIds.get(service));
}
