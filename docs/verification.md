# Executed verification

Updated on 2026-10-09. This is implementation/test evidence, not a claim of AWS deployment, exactly-once delivery, production readiness, or comprehensive security assurance. Browser checks were performed on October 6; performance follow-up was performed on October 8–9.

## Application checks

| Check                                                                 | Observed result                                                                                      |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Backend unit, REST, queue, and real Redis/Socket.IO integration tests | 30 passed across six files                                                                           |
| Frontend React Testing Library tests                                  | 18 passed across five files                                                                          |
| Load-summary verifier tests                                           | 4 passed; rejects incomplete recovery even when latency passes                                       |
| TypeScript checks                                                     | Backend application/tests and frontend passed                                                        |
| ESLint                                                                | Both workspaces passed with zero warnings                                                            |
| Production builds                                                     | Backend and frontend Docker images built successfully                                                |
| Dependency audit                                                      | `npm audit` reported zero known vulnerabilities, including development dependencies                  |
| Terraform                                                             | Format and validation passed; no plan/apply against an AWS account was performed                     |
| Real browser                                                          | Login, persisted send/edit, conversation/member controls, and responsive chat checked                |
| Mobile viewport                                                       | 390 × 844; page width matched the viewport without horizontal overflow                               |
| Local topology                                                        | Two API replicas, Nginx frontend, PostgreSQL 16, Redis 7.4; PostgreSQL/Redis ports bound to loopback |

The socket integration suite places different users on separate actual HTTP/Socket.IO servers and propagates events using the real Redis adapter. It verifies messages, typing, delivery/read receipts, multi-tab presence, reconnection/missed history, authorization, and malformed acknowledgement arguments. REST tests cover registration/login/logout revocation, user search/profile, membership/role boundaries, pagination, concurrent idempotent retries, author-only edits/soft deletion, attachment-key ownership, untrusted origins, and monotonic read pointers. A history regression test verifies fresh public sender/reply data, edited and soft-deleted replies, receipts, attachments, and exclusion of password hashes after batch hydration. Queue tests use PostgreSQL for transactional outbox creation and duplicate audit consumption; they do not connect to AWS SQS.

Integration tests used the dedicated `relay_test` database and Redis DB 1, not the local demo database. No coverage percentage has been measured.

The October 9 audit initially flagged the development launcher `concurrently@9.2.4` and its pinned `shell-quote@1.9.0` dependency. Updating the launcher to 9.2.5 installed `shell-quote@1.12.0`; the subsequent full audit reported zero known vulnerabilities. The lockfile records that targeted two-package update. The dependency's patched range is documented in the [maintainer's command-injection advisory](https://github.com/ljharb/shell-quote/security/advisories/GHSA-pqg4-j6r4-53mv). A clean audit is not proof that the application has no security defects.

## Load measurements

Environment: Windows host; Docker Desktop Linux VM with eight CPUs and a reported 3.675 GiB memory limit; two API containers, PostgreSQL 16, Redis 7.4, and Nginx. Builds, unit/integration tests, and other load generators were not run concurrently with the October 8–9 probes. Docker k6 shared the application's VM; native Windows k6 ran outside it against the host-forwarded `127.0.0.1:8080` endpoint. Both reported k6 v2.3.0. The Docker image digest was `sha256:e66db15b860113878fa74670e31f5e274830b7b6e42c8bff28b2f2d86a257603`; the native release archive was checked against its official GitHub release asset SHA-256 digest.

The strengthened probe uses distinct acknowledgement IDs, one iteration per VU, a unique run prefix, and a two-second acknowledgement drain. After closing its socket, each recipient checks cursor-paginated PostgreSQL history with an unchanged ten-second request deadline. A separate summary verifier requires exactly every VU to finish, all acknowledged messages in every recipient's history, and live plus recovered messages to match that total. The original WebSocket p95 targets remain below 1,000 ms; error-rate limits remain below 1%.

All rows below use sixty-second socket sessions and a ninety-second scenario limit. One sender sends once per second (57 acknowledged messages per run). All other sockets belong to one second account. **These measure connection/fan-out and history recovery, not independent users, simultaneous senders, receipt-write traffic, or full-browser capacity.** Paced admission spans ten seconds, giving approximately fifty seconds with all 1,000 connections overlapping; it is not a simultaneous burst test.

| Raw probe                                                                             | Generator / admission    | Ack / delivery p95                     | Persisted recipient confirmations      | Result                                              |
| ------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------- | -------------------------------------- | --------------------------------------------------- |
| [100, Oct 8](../load-tests/results/ws-100-recovery-2026-10-08.json)                   | Docker / burst           | 45.2 / 50 ms                           | 5,643 live + 0 recovered = 5,643       | Qualified pass; no errors                           |
| [500, Oct 8](../load-tests/results/ws-500-recovery-2026-10-08.json)                   | Docker / burst           | 76.4 / 85 ms                           | 28,240 live + 203 recovered = 28,443   | Qualified pass; no errors                           |
| [1,000, Oct 8](../load-tests/results/ws-1000-recovery-2026-10-08.json)                | Docker / burst           | 1,133.8 / 1,219 ms                     | 56,442 live + 501 recovered = 56,943   | Failed both latency targets                         |
| [1,000 native burst, Oct 8](../load-tests/results/ws-1000-native-2026-10-08.json)     | Native / burst           | 219.8 / 230 ms, successful subset only | 14,142; incomplete                     | Failed: 751 connection refusals; 745 history errors |
| [1,000 paced, Oct 8](../load-tests/results/ws-1000-native-ramped-2026-10-08.json)     | Native / ten-second ramp | 108.8 / 149 ms                         | 54,549; incomplete                     | Failed: 42 history timeouts                         |
| [Batched history, Oct 8](../load-tests/results/ws-1000-batched-2026-10-08.json)       | Native / ten-second ramp | 167 / 145 ms                           | 52,583 live + 4,360 recovered = 56,943 | Qualified pass                                      |
| [Batched repeat, Oct 8](../load-tests/results/ws-1000-batched-repeat-2026-10-08.json) | Native / ten-second ramp | 120.8 / 142 ms                         | 48,507; incomplete                     | Failed: 148 history errors / proxy 502s             |
| [Proxy fix, Oct 9](../load-tests/results/ws-1000-proxy-2026-10-09.json)               | Native / ten-second ramp | 108.4 / 153 ms                         | 52,559 live + 4,384 recovered = 56,943 | Qualified pass; no errors                           |
| [Proxy fix repeat, Oct 9](../load-tests/results/ws-1000-proxy-repeat-2026-10-09.json) | Native / ten-second ramp | 115.2 / 148 ms                         | 52,482 live + 4,461 recovered = 56,943 | Qualified pass; no errors                           |

Both October 9 runs completed 1,000 authenticated connections, 57 successful persistence acknowledgements, and all `57 × 999 = 56,943` recipient history confirmations. They reported zero connection, message, recovery, and missed-while-authenticated errors. Recovered records were sent before those recipients authenticated during the admission ramp. The summary verifier passed for both runs. No frontend Nginx error entries appeared during these two runs. HTTP p95 (999 history requests plus three setup requests) was 627.08 ms in the first run and 5,243.28 ms in the repeat, with a repeat maximum of 6.46 seconds: **the repeat still demonstrates multi-second HTTP tail latency, not a general sub-500 ms HTTP SLO at this load.**

The history timeout failures prompted indexed batch hydration of only the returned page's public users, receipts, attachments, and reply targets. The subsequent failed repeat's Nginx logs showed upstream TCP resets followed by `no live upstreams` while both APIs remained healthy. The proxy now retires cached idle connections before Node's idle timeout, explicitly enables HTTP/1.1 upstream reuse, and requires three transport failures before quarantining a replica. These changes address the observed amplification; the underlying reset and host burst-refusal causes were not conclusively isolated. Shared-VM contention is a hypothesis for the Docker 1,000 latency failure, not a demonstrated single root cause. See [architecture](architecture.md).

Historical evidence is retained, not replaced: [October 6 HTTP 100](../load-tests/results/http-100.json) made 1,499 conversation-list requests plus login with zero errors, p95 41.84 ms and p99 2,570.51 ms (10-second ramp, 20-second hold, 10-second drain; 34.23 requests/second). [October 6 corrected WebSocket 100](../load-tests/results/ws-100-verified.json) confirmed all 22 messages live on 99 recipients but failed the ack/delivery p95 targets (1,018.10 / 1,251.15 ms). October 8 [baseline 100](../load-tests/results/ws-100-baseline-2026-10-08.json) and [baseline 500](../load-tests/results/ws-500-isolated-2026-10-08.json) passed their live-latency thresholds but preceded history qualification; the filename “isolated” means no concurrent builds/tests, not a separate application VM.

The earliest [exploratory 100](../load-tests/results/ws-100.json) and [500](../load-tests/results/ws-500.json) used a reused acknowledgement timer and repeat/interrupted sessions; their latency/success denominator is unsuitable as capacity evidence. All failed runs remain available. These short local measurements do not establish AWS capacity or a sustained throughput/availability SLO; independent-user, multi-sender, receipt-write, burst-admission, and longer soak tests remain necessary.

## Failure drills

The October 9 `node scripts/verify-failures.mjs` run exited successfully after exercising actual service interruption with the updated Nginx configuration:

- PostgreSQL stopped: readiness returned 503, a socket send failed without a success acknowledgement, and retry after restart persisted one message. Retrying the same client ID returned the same database ID; history contained one copy.
- Redis stopped: readiness and authenticated HTTP requests returned 503, session checks failed closed, and the socket reconnected after restart. Live delivery resumed.
- The exact API replica hosting the sender stopped: the socket reconnected through Nginx to the surviving replica, another live message arrived, and history still contained the durable baseline and a single retry record.
- Stopped containers were restored. No volumes or demo messages were deleted.

Earlier drill attempts exposed queued Redis checks, Nginx's long upstream connection timeout, shared application 503s being hidden behind proxy errors, and stale PostgreSQL pool connections immediately after restart. Fixes disable offline Redis command queueing, bound/share connection attempts, distinguish transient socket failures from revoked credentials, share/bound Nginx failover, and preserve application 503 JSON. The drill retries transient post-restart HTTP errors with the same client ID, up to ten attempts; it does not claim instant or error-free recovery. Regression tests pass. Initial session restoration also retries temporary failures without treating them as invalid credentials.

Drill messages remain identifiable by `drill-` client IDs; load messages use `k6-` client IDs. The worker/SQS outage scenario was not executed because no AWS test environment was configured.

## Not verified or deployed as of October 9

- No AWS resources, ECR pushes, ECS releases, DNS/certificates, CloudFront site, live CloudWatch dashboard, or SNS alarm delivery were created or exercised.
- GitHub workflows were authored, but no hosted GitHub Actions execution has occurred in this workspace.
- S3 attachment upload/download and SQS dispatch/worker/DLQ recovery require an AWS test environment and remain unverified end to end. Local attachments are correctly disabled without a bucket.
- Public-launch hardening in [security](security.md) remains necessary. Optional reactions, pinned messages, message search, blocking, and email/push services are not implemented.
- The local 1,000-connection paced profile passed twice after the proxy fix, but the 1,000 burst profile remains unqualified. Longer, isolated, independent-user/multi-sender tests and investigation of HTTP tail latency are needed before making a production capacity or SLO claim.

As of October 9, AWS deployment was disabled under the $0 cloud budget and AWS access was not configured locally. All four production cloud workflow jobs still require repository variable `AWS_DEPLOYMENT_ENABLED=true`; that opt-in is not a billing cap. See [the local $0-budget runbook](zero-budget.md) and [deployment prerequisites](deployment.md) for the production workflow prerequisites. Do not paste access keys into chat.

## October 27: approved credits-only AWS demo

The user approved the limited single-host demo in project `806079021406`, selected
Region `us-east-2`, using eligible credits on the Free plan. The demo is live at
<https://3.131.19.155>. The production Terraform and workflow opt-in remain unchanged.

Public tests passed trusted HTTPS, registration/sign-in, secure cookies,
authorization/origin rejection, two-way Socket.IO delivery, typing, read receipts,
retry deduplication, and persisted history. After a full EC2 reboot, the same
sessions and messages persisted and WebSockets reconnected. Public TCP ports
80/443 were reachable; 22/3000/5432/6379/2019 were filtered. Both private application
images completed basic ECR scans with no reported findings after the frontend's
Alpine security patches. Local dependency audit, type checks, lint, 18 frontend
tests, and an isolated 30-test backend rerun passed; an earlier run during image
builds had one acknowledgement timeout and teardown errors.

The single-host demo has no off-host backups, high availability, or measured AWS
capacity. S3 attachments, SQS workers, CloudFront, and the production deployment
remain outside this scope. See [the full launch report](demo-launch-report.md)
and [saved evidence](../infrastructure/demo/verification.json).
