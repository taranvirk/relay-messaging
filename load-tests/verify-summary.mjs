import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

function value(summary, name, key) {
  const metric = summary.metrics?.[name];
  const values = metric?.values ?? metric;
  const result = values?.[key] ?? (key === 'value' ? values?.rate : undefined);
  assert(Number.isFinite(result), `Missing numeric ${name}.${key}`);
  return result;
}

export function verifyWebsocketSummary(summary, connections) {
  assert(Number.isInteger(connections) && connections > 1, 'Provide the expected connection count');
  assert.equal(value(summary, 'iterations', 'count'), connections, 'Every VU must finish');
  for (const name of [
    'ws_connection_errors',
    'message_errors',
    'message_recovery_errors',
    'message_missed_while_connected',
  ]) {
    assert(value(summary, name, 'value') < 0.01, `${name} crossed the error threshold`);
  }
  const ackP95 = value(summary, 'message_ack_latency', 'p(95)');
  const deliveryP95 = value(summary, 'message_delivery_latency', 'p(95)');
  assert(ackP95 < 1000 && deliveryP95 < 1000, 'The original 1,000 ms p95 targets must pass');
  const acks = value(summary, 'message_acks', 'count');
  const live = value(summary, 'message_deliveries', 'count');
  const confirmed = value(summary, 'message_confirmations', 'count');
  const recovered = summary.metrics?.message_recovered_from_history
    ? value(summary, 'message_recovered_from_history', 'count')
    : 0;
  assert(acks > 0 && live > 0, 'The test must exercise persistence and live delivery');
  assert.equal(
    confirmed,
    acks * (connections - 1),
    'Every acknowledged message must be present in every recipient history',
  );
  assert.equal(
    live + recovered,
    confirmed,
    'Live and recovered messages must account for every confirmation',
  );
  return { connections, acks, live, recovered, confirmed, ackP95, deliveryP95 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const summary = JSON.parse(await readFile(process.argv[2], 'utf8'));
  console.log(JSON.stringify(verifyWebsocketSummary(summary, Number(process.argv[3])), null, 2));
}
