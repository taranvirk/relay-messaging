import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const errors = new Rate('relay_errors');
const latency = new Trend('relay_api_latency', true);

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP || '30s', target: Number(__ENV.CONNECTIONS || 100) },
        { duration: __ENV.DURATION || '2m', target: Number(__ENV.CONNECTIONS || 100) },
        { duration: __ENV.RAMP || '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
    relay_errors: ['rate<0.01'],
  },
};

export function setup() {
  if (!__ENV.RELAY_EMAIL || !__ENV.RELAY_PASSWORD)
    throw new Error('RELAY_EMAIL and RELAY_PASSWORD are required');
  const response = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: __ENV.RELAY_EMAIL, password: __ENV.RELAY_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(response, { 'setup login succeeds': (r) => r.status === 200 });
  if (response.status !== 200) throw new Error('Load-test login failed');
  return { cookie: response.headers['Set-Cookie'].split(';')[0] };
}

export default function (data) {
  const started = Date.now();
  const response = http.get(`${BASE_URL}/api/conversations`, { headers: { Cookie: data.cookie } });
  latency.add(Date.now() - started);
  const ok = check(response, { 'conversation list is 200': (r) => r.status === 200 });
  errors.add(!ok);
  sleep(Math.random() * 2 + 1);
}
