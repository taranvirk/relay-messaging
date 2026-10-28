# Testing and failure drills

## Automated layers

- Unit tests cover token integrity and validation boundaries.
- Supertest exercises registration/session restoration, idempotent direct messaging, private-conversation isolation, author-only edits/deletes, soft deletion, and group role hierarchy.
- Socket tests connect different users to two separate servers using the real Redis adapter: typing/message fan-out, receipts, multi-tab presence, reconnect/history recovery, and authorization.
- React Testing Library covers login/registration, conversation previews/unread badges, live-message deduplication, typing, failed-send retries, socket-timeout REST fallback, cursor history, presence, and conversation details.
- Redis/session unit tests cover fail-closed outages, connection sharing, bounded reconnect attempts, revocation, and transient socket-rejection recovery.
- Queue tests cover idempotent persistent audits and transactional outbox creation.

Integration suites are skipped without `RUN_INTEGRATION_TESTS=true` so a contributor can run fast unit tests without accidentally targeting a database. CI always enables them against disposable PostgreSQL and Redis services.

Tests refuse to clear a database whose name does not end in `_test`. Local PowerShell setup:

```powershell
docker compose exec postgres psql -U relay -d postgres -c "CREATE DATABASE relay_test"
$env:DATABASE_URL='postgresql://relay:relay@127.0.0.1:5432/relay_test?schema=public'
$env:REDIS_URL='redis://127.0.0.1:6379/1'
$env:RUN_INTEGRATION_TESTS='true'
npm run prisma:migrate -w backend
npm test
```

On Windows, run Prisma generation and tests sequentially: a running test's native Prisma DLL cannot be replaced by generation.

## Multi-instance exercise

`docker compose up --build` launches `backend` and `backend-replica` behind Nginx `least_conn` balancing. To verify cross-instance behavior:

1. Register user A in a normal window and user B in a private window.
2. Start a direct conversation and keep both browser consoles open.
3. Inspect backend logs to confirm the sockets landed on different containers; reconnect one if necessary.
4. Send from A and confirm B receives `message:new` immediately.
5. Stop the container holding A's socket: `docker compose stop backend` (or the replica shown in logs).
6. Confirm A reconnects, history refetches, and no message disappears or duplicates.

Redis adapter logs on both containers demonstrate distributed room propagation. PostgreSQL is inspected independently to demonstrate durable storage.

## Failure drills

| Failure                | Expected behavior                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| Stop Redis             | readiness fails; existing DB records remain; clients recover through HTTP history after recovery |
| Stop PostgreSQL        | readiness fails; send acknowledgement fails; no unpersisted success appears                      |
| Kill one API replica   | ALB/Nginx routes elsewhere; sockets reconnect and refetch                                        |
| Disable client network | pending send fails visibly; same client ID can be retried safely                                 |
| Kill the worker        | SQS visibility timeout retries; five failures move to DLQ                                        |

Run these in a non-production environment and capture timestamps, logs, and recovery times. Do not infer reliability from unit tests alone.

The executable local drill verifies persistence through PostgreSQL interruption, Redis fail-closed behavior and recovery, and reconnection after the actual API replica hosting a socket stops. Stale database pool connections can briefly return a server error after restart; the drill retries those responses with the same client ID and asserts one durable record:

```bash
node scripts/verify-failures.mjs
```

Seed demo users first. The script accepts localhost only, checks the Compose containers' workspace labels before stopping anything, adds identifiable `drill-` messages, and restores stopped services in `finally`. On Windows it uses Docker Desktop's `desktop-linux` context; elsewhere the default context is used. Override with `DOCKER_CONTEXT` if needed. This disrupts the local app briefly; do not run it against shared data or while someone is using the demo. Worker/SQS failure drills still require an AWS test environment.

## k6

HTTP test:

```bash
k6 run -e BASE_URL=http://localhost:8080 -e RELAY_EMAIL=maya@relay.local -e RELAY_PASSWORD=RelayDemo123! load-tests/k6/http.js
```

WebSocket tests need a separate recipient account and create their direct conversation in setup. Each VU makes one connection, using the [per-VU iterations executor](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/per-vu-iterations/). One VU sends once per second; all other VUs are recipient connections. Each acknowledgement has its own correlation ID/timer. Recipient arrival and persistence-ack latency are separate metrics. Thresholds require all VUs to complete and nonzero acknowledgements/deliveries:

```bash
k6 run -e BASE_URL=http://localhost:8080 -e RELAY_EMAIL=maya@relay.local \
  -e RELAY_PASSWORD=RelayDemo123! -e RECIPIENT_EMAIL=theo@relay.local \
  -e RECIPIENT_PASSWORD=RelayDemo123! -e CONNECTIONS=100 load-tests/k6/websocket.js
```

Repeat with `CONNECTIONS=500` and `1000` only if the prior run stays healthy. These are connection/fan-out probes, not independently authenticated users or simultaneous senders. Record hardware, k6 version, task count, duration, latency, errors, and throughput. Local results do not establish AWS capacity. Run benchmarks separately from builds, tests, and other load generators; record results even when a target fails.

Each recipient verifies cursor-paginated PostgreSQL history after its socket session. The run records unique live arrivals, messages recovered from history, and any message missed after that recipient authenticated. A run-specific client-ID prefix isolates its records from other probes. Keep enough drain time for the last acknowledgement. The summary verifier additionally requires all VUs to finish and every acknowledged message to be confirmed in every recipient's history; latency alone is insufficient:

```bash
k6 run --summary-export=load-tests/results/ws-100.json --summary-trend-stats 'min,med,avg,max,p(95),p(99)' \
  -e BASE_URL=http://localhost:8080 -e RELAY_EMAIL=maya@relay.local \
  -e RELAY_PASSWORD=RelayDemo123! -e RECIPIENT_EMAIL=theo@relay.local \
  -e RECIPIENT_PASSWORD=RelayDemo123! -e CONNECTIONS=100 \
  -e DURATION=90s -e SESSION_MS=60000 load-tests/k6/websocket.js
node load-tests/verify-summary.mjs load-tests/results/ws-100.json 100
node --test load-tests/verify-summary.test.mjs
```

Use a new result filename per run to retain failures for comparison. This history-recovery phase does not measure a full browser workload, delivery/read-receipt writes, many independent identities, multiple senders, or sustained message throughput. Do not label it a concurrent-user capacity test.

`CONNECT_RAMP_MS=10000` optionally paces initial connections across ten seconds. The default `0` remains a simultaneous burst. A ramped run is not proof of burst-admission capacity; state the ramp explicitly. For the 1,000-connection local profile, run native k6 outside the Docker VM, keep the original one-second latency targets and ten-second history deadline, and use `SESSION_MS=60000 DURATION=90s`. With successful connections and no premature disconnects, the ten-second ramp plus sixty-second sessions gives approximately fifty seconds of full overlap. Retain the failed co-located/burst probes as well as successful ramped probes.

For a short smoke probe, use `DURATION=60s SESSION_MS=25000`. `DURATION` is the maximum scenario time; `SESSION_MS` controls the socket lifetime. Export a raw summary with `--summary-export=load-tests/results/<run>.json --summary-trend-stats 'min,med,avg,max,p(95),p(99)'`. See [executed evidence](verification.md).
