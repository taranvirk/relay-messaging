import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyWebsocketSummary } from './verify-summary.mjs';

function fixture() {
  return {
    metrics: {
      iterations: { count: 100 },
      ws_connection_errors: { value: 0 },
      message_errors: { value: 0 },
      message_recovery_errors: { value: 0 },
      message_missed_while_connected: { value: 0 },
      message_ack_latency: { 'p(95)': 40 },
      message_delivery_latency: { 'p(95)': 44 },
      message_acks: { count: 10 },
      message_deliveries: { count: 980 },
      message_recovered_from_history: { count: 10 },
      message_confirmations: { count: 990 },
    },
  };
}
test('accepts complete live plus history recovery', () => {
  assert.equal(verifyWebsocketSummary(fixture(), 100).confirmed, 990);
});
test('rejects partial recovery even when latency passes', () => {
  const summary = fixture();
  summary.metrics.message_confirmations.count = 989;
  assert.throws(() => verifyWebsocketSummary(summary, 100), /recipient history/);
});
test('rejects missing VUs and high latency', () => {
  const summary = fixture();
  summary.metrics.iterations.count = 99;
  assert.throws(() => verifyWebsocketSummary(summary, 100), /Every VU/);
  summary.metrics.iterations.count = 100;
  summary.metrics.message_ack_latency['p(95)'] = 1001;
  assert.throws(() => verifyWebsocketSummary(summary, 100), /original/);
});

test('accepts the modern k6 values/rate summary shape', () => {
  const summary = fixture();
  summary.metrics = Object.fromEntries(
    Object.entries(summary.metrics).map(([name, metric]) => [
      name,
      { values: 'value' in metric ? { rate: metric.value } : metric },
    ]),
  );
  assert.equal(verifyWebsocketSummary(summary, 100).confirmed, 990);
});
