import ws from 'k6/ws';
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const WS_URL = BASE_URL.replace(/^http/, 'ws');
const connectionErrors = new Rate('ws_connection_errors');
const deliveryLatency = new Trend('message_delivery_latency', true);
const ackLatency = new Trend('message_ack_latency', true);
const protocolErrors = new Rate('message_errors');
const acknowledgements = new Counter('message_acks');
const deliveries = new Counter('message_deliveries');
const confirmations = new Counter('message_confirmations');
const recoveredMessages = new Counter('message_recovered_from_history');
const recoveryErrors = new Rate('message_recovery_errors');
const missedWhileConnected = new Rate('message_missed_while_connected');
const connections = Number(__ENV.CONNECTIONS || 100);
const sessionMs = Number(__ENV.SESSION_MS || 115000);
const connectRampMs = Number(__ENV.CONNECT_RAMP_MS || 0);

export const options = {
  scenarios: {
    sockets: {
      executor: 'per-vu-iterations',
      vus: connections,
      iterations: 1,
      maxDuration: __ENV.DURATION || '3m',
    },
  },
  thresholds: {
    ws_connection_errors: ['rate<0.01'],
    message_errors: ['rate<0.01'],
    message_delivery_latency: ['p(95)<1000'],
    message_ack_latency: ['p(95)<1000'],
    iterations: [`count>=${connections}`],
    message_acks: ['count>0'],
    message_deliveries: ['count>0'],
    message_confirmations: ['count>0'],
    message_recovery_errors: ['rate<0.01'],
    message_missed_while_connected: ['rate<0.01'],
  },
};

export function setup() {
  if (!__ENV.RECIPIENT_EMAIL || !__ENV.RECIPIENT_PASSWORD)
    throw new Error('A separate RECIPIENT_EMAIL / RECIPIENT_PASSWORD is required');
  const response = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: __ENV.RELAY_EMAIL, password: __ENV.RELAY_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (response.status !== 200) throw new Error('Load-test login failed');
  const recipient = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: __ENV.RECIPIENT_EMAIL, password: __ENV.RECIPIENT_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (recipient.status !== 200) throw new Error('Recipient login failed');
  const senderCookie = response.headers['Set-Cookie'].split(';')[0];
  const recipientCookie = recipient.headers['Set-Cookie'].split(';')[0];
  http.cookieJar().clear(BASE_URL);
  const conversation = http.post(
    `${BASE_URL}/api/conversations`,
    JSON.stringify({ type: 'DIRECT', memberIds: [recipient.json('user.id')] }),
    { headers: { 'Content-Type': 'application/json', Cookie: senderCookie } },
  );
  if (conversation.status !== 201) throw new Error('Conversation setup failed');
  return {
    senderCookie,
    recipientCookie,
    conversationId: conversation.json('conversation.id'),
    runId: `${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
    startedAt: Date.now(),
  };
}

export default function (data) {
  // Optional paced admission tests sustained connections separately from a
  // sudden TCP connection burst. The default remains the original burst probe.
  if (connectRampMs > 0) sleep(((__VU - 1) * connectRampMs) / connections / 1000);
  let sequence = 0;
  const outstanding = new Map();
  let authenticated = false;
  let authenticatedAt = 0;
  const received = new Set();
  let expectedClose = false;
  let transportError = false;
  const response = ws.connect(
    `${WS_URL}/socket.io/?EIO=4&transport=websocket`,
    { headers: { Cookie: __VU === 1 ? data.senderCookie : data.recipientCookie } },
    (socket) => {
      const started = Date.now();
      socket.on('error', () => {
        transportError = true;
      });
      socket.on('message', (message) => {
        if (message === '2') socket.send('3');
        if (message.startsWith('0')) socket.send('40');
        if (message.startsWith('40')) {
          authenticated = true;
          authenticatedAt = Date.now();
          if (__VU === 1)
            socket.setInterval(() => {
              // Leave time for the final persistence acknowledgement before closing.
              if (Date.now() - started > sessionMs - 2000) return;
              const sentAt = Date.now();
              const ackId = ++sequence;
              outstanding.set(ackId, sentAt);
              socket.send(
                `42${ackId}["message:send",${JSON.stringify({ conversationId: data.conversationId, clientMessageId: `k6-${data.runId}-${ackId}`, content: `k6probe|${sentAt}`, type: 'TEXT', attachments: [] })}]`,
              );
            }, 1000);
        }
        const ackPacket = /^43(\d+)(\[.*\])$/.exec(message);
        if (ackPacket) {
          const ackId = Number(ackPacket[1]);
          const sentAt = outstanding.get(ackId);
          const acknowledged = JSON.parse(ackPacket[2]);
          protocolErrors.add(!acknowledged[0]?.ok);
          if (acknowledged[0]?.ok && sentAt !== undefined) {
            ackLatency.add(Date.now() - sentAt);
            acknowledgements.add(1);
          }
          outstanding.delete(ackId);
        }
        if (message.startsWith('42[') && __VU !== 1) {
          const event = JSON.parse(message.slice(2));
          if (
            event[0] === 'message:new' &&
            event[1].message.clientMessageId?.startsWith(`k6-${data.runId}-`) &&
            !received.has(event[1].message.id)
          ) {
            received.add(event[1].message.id);
            deliveryLatency.add(Date.now() - Number(event[1].message.content.split('|')[1]));
            deliveries.add(1);
          }
        }
        if (message.startsWith('44')) {
          protocolErrors.add(true);
          socket.close();
        }
      });
      socket.setTimeout(() => {
        expectedClose = true;
        socket.close();
      }, sessionMs);
    },
  );
  const connected = check(response, { 'websocket upgraded': (r) => r && r.status === 101 });
  check(authenticated, { 'socket authenticated': (value) => value });
  connectionErrors.add(!connected || !authenticated || !expectedClose || transportError);
  for (const _entry of outstanding) protocolErrors.add(true);
  if (__VU !== 1) {
    const historyIds = new Set();
    let cursor = '';
    let finished = false;
    try {
      for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
        const response = http.get(
          `${BASE_URL}/api/conversations/${data.conversationId}/messages?limit=100${cursor ? `&cursor=${cursor}` : ''}`,
          {
            headers: { Cookie: data.recipientCookie },
            timeout: '10s',
          },
        );
        if (response.status !== 200) throw new Error('History recovery failed');
        const page = response.json();
        for (const message of page.messages) {
          if (
            !message.clientMessageId?.startsWith(`k6-${data.runId}-`) ||
            historyIds.has(message.id)
          )
            continue;
          historyIds.add(message.id);
          const missed = !received.has(message.id);
          missedWhileConnected.add(
            missed && Number(message.content.split('|')[1]) >= authenticatedAt,
          );
          if (missed) recoveredMessages.add(1);
        }
        if (!page.nextCursor || Date.parse(page.messages[0]?.createdAt) < data.startedAt) {
          finished = true;
          break;
        }
        cursor = page.nextCursor;
      }
      if (!finished || historyIds.size === 0 || [...received].some((id) => !historyIds.has(id)))
        throw new Error('Incomplete persisted history');
      confirmations.add(historyIds.size);
      recoveryErrors.add(false);
    } catch {
      recoveryErrors.add(true);
    }
  }
}
