# Relay demo launch report

Prepared October 27, 2026. The user approved this credits-only configuration
before launch. The demo is running and verified, including public HTTPS and
recovery of sessions, messages, and WebSockets after a full server reboot.

## Access and destination

- Application: <https://3.131.19.155>.
- AWS project: **Whimsical Whiteboard**, `806079021406`.
- Selected Region: `us-east-2`; CLI profile: `relay`.
- [EC2 instance console](https://us-east-2.console.aws.amazon.com/ec2/home?region=us-east-2#InstanceDetails:instanceId=i-08282151248d58a3e).
- Register a new user on the application. No public demo passwords were seeded.
  Three synthetic deployment-check users and their private verification messages
  were created for validation; local users and messages were not uploaded.

## Created infrastructure

| Setting                | Deployed value                                                                 |
| ---------------------- | ------------------------------------------------------------------------------ |
| Instance               | `i-08282151248d58a3e`, name `relay-demo`, launched `2026-10-27T05:32:04Z`      |
| Compute                | One on-demand `t3.small`, shared tenancy, 2 vCPU, 2 GiB RAM                    |
| CPU credits            | `standard`; no surplus-credit billing enabled                                  |
| OS                     | Amazon Linux 2023.12.20261026.1, x86_64, kernel 6.18                           |
| AMI                    | `ami-052b3645c2c811821`, owner Amazon                                          |
| AZ / subnet            | `us-east-2a` / `subnet-0ffe8ec1397b25244`                                      |
| Existing VPC           | `vpc-01ce469c737457e9b`; existing Internet Gateway route                       |
| Private IP / interface | `172.31.10.231` / `eni-0ee994627f0f91a3d`                                      |
| Stable public IPv4     | `3.131.19.155`, allocation `eipalloc-06b7279558d662647`                        |
| IPv4 association       | `eipassoc-06a0244667618747b`                                                   |
| Root disk              | `vol-05f234fea6efc33d9`, encrypted 20 GiB gp3, 3000 IOPS / 125 MiB/s           |
| Disk retention         | `DeleteOnTermination=false`; data remains on a retained disk after termination |
| Security group         | `sg-0894bde3ad0f80609`, `relay-demo-web-sg`                                    |
| Instance role/profile  | `RelayDemoEc2Role`, path `/relay-demo/`                                        |
| Monitoring             | Basic EC2 monitoring; bounded local logs                                       |
| Termination protection | Disabled as approved                                                           |
| Runtime                | Docker 25.0.18, Compose 5.6.1, SSM agent; 1 GiB swap                           |

Supported resources carry `Project=Relay`, `Environment=demo`, `Name=relay-demo`,
`Owner=Taranvir`, `ManagedBy=Codex`, `CostCenter=Personal`,
`CreatedDate=2026-10-27`, and `WorkloadType=web-server`.

## Application release and security

Current release `20261027-logout2` uses immutable private ECR references:

| Image            | Digest                                                                    |
| ---------------- | ------------------------------------------------------------------------- |
| `relay-demo-api` | `sha256:2b062b5b201cedaf84939d8255dd2b11ed3d5f29735f3eaad666e25aa8d365bf` |
| `relay-demo-web` | `sha256:0369a09ddb3d383756460b9a2123e7dd4a42b839a6447b45247c333bb61521b4` |

Both repositories belong to project `806079021406` in `us-east-2`, with encrypted
storage, immutable tags, and basic scanning. API compressed image size is
146,098,377 bytes; the current frontend is 27,221,527 bytes. The first frontend
scan found Brotli and curl issues. Updating Alpine runtime packages to
`brotli-libs 1.2.1-r0` and `curl/libcurl 8.23.0-r0` produced a completed scan
with no reported findings. The API scan also completed with no reported findings.
Image scans do not establish comprehensive application security.

Only TCP 80/443 are allowed inbound. TCP 80 redirects to HTTPS and supports ACME
validation. SSH is disabled, no key pair exists for this instance, and SSM is the
administrative path. PostgreSQL, Redis, both API replicas, and Nginx are on an
internal Docker network. Only Caddy publishes host ports. Its administrative
API is disabled. IMDSv2 is required with hop limit 1.

The host role has SSM core access plus three ECR pull/read actions scoped to the
two demo repositories; `GetAuthorizationToken` requires wildcard scope. The
baseline policy was generated with IAM Policy Autopilot, then unused
pull-through-cache write permissions were removed. IAM simulation with the
Ohio requested-Region context confirmed allowed demo pulls, denied unrelated
repository access, and denied repository creation. Temporary local push
credentials were cleared; host pull credentials use an ephemeral `/run` folder.

New PostgreSQL, Redis, and JWT secrets were generated on the encrypted instance
disk, stored in root-only files under `/opt/relay`, and never included in user
data, this repository, or chat. API containers run as a non-root user with a
read-only root filesystem, dropped capabilities, and memory/CPU limits.
Database and Redis data use persistent Docker volumes. Automatic OS security
updates and bounded container log rotation are enabled.

The public IP certificate was issued by Let's Encrypt YE2, valid from
`2026-10-27T04:39:04Z` until `2026-11-02T20:39:03Z`, with the IP SAN
`3.131.19.155`. Caddy persists its certificate storage and handles renewal.
An explicit default SNI setting selects this certificate for clients connecting
to the IP address. Certificate verification remains enabled in all client tests.
See [Caddy's default SNI documentation](https://caddyserver.com/docs/caddyfile/options#default-sni)
and [Let's Encrypt IP certificate support](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability).

## Validation evidence

The public smoke check in `infrastructure/demo/smoke.mjs` passed readiness,
registration, sign-in, Secure/HttpOnly/SameSite cookies, unauthenticated denial,
private-conversation authorization, untrusted-origin rejection, WebSocket
connections, typing events, two-way messages, read receipts, retry deduplication,
and persisted history. After the recovery checks, logout revoked all three
retained test sessions, authenticated requests with those cookies returned 401,
and the temporary session file was removed. The saved
`infrastructure/demo/verification.json` contains no credentials.

Both EC2 reachability checks and the attached EBS check passed. Root encryption,
retained-volume behavior, standard CPU credits, required IMDSv2, correct project,
and TCP 80/443-only ingress were read back through AWS APIs. All six application
containers were running; PostgreSQL, Redis, both APIs, and Nginx reported healthy.

The reboot completed with OS boot time `2026-10-27T05:39:49Z`. A second public
smoke check verified readiness, the existing authenticated sessions, both saved
messages, and WebSocket reconnection. A public TCP probe reached only ports
80/443; ports 22, 3000, 5432, 6379, and 2019 were filtered. The OS reactivated
SSHD during reboot despite the initial disable; it was subsequently confirmed
masked and inactive so future systemd activation is blocked. The security group never
permitted public SSH.

Before publication, backend application/test and frontend type checks, ESLint,
18 frontend tests, and the full dependency audit passed. The isolated backend
rerun passed all 30 tests across six files. An earlier concurrent-build run had
one Socket.IO acknowledgement timeout and Redis teardown errors; its failure
was not hidden or resolved by weakening test thresholds. Final images built
successfully. Zod, Vite, and the Express body-parser override were updated to
patched releases. No full AWS capacity/load test was performed.

## Costs and boundaries

The Free Tier API reported plan type `FREE`, status `ACTIVE`, USD 100 remaining
credits at launch and after the reboot, and expiration `2027-04-26T21:17:15.181Z`. Credit figures can
lag metered usage. No paid upgrade or advanced-feature activation occurred.

| Component                       | Metered estimate at 730 hours/month |
| ------------------------------- | ----------------------------------- |
| t3.small Linux, USD 0.0208/hour | USD 15.18                           |
| 20 GiB gp3, USD 0.08/GB-month   | USD 1.60                            |
| Public IPv4, USD 0.005/hour     | USD 3.65                            |
| Base total                      | **USD 20.43/month**                 |

Private image storage, requests, traffic, future backups, and other usage are
additional. This is an estimate, not a billing cap. USD 100 covers approximately
148.9 days at the base rate alone; additional usage shortens that time. Monitor
credits and plan status in [AWS Settings > Billing](https://settings.aws.com/billing/credits).
No out-of-pocket spending or paid upgrade is authorized.

This is a single-host demo with no high availability, off-host backups, or
production throughput guarantee. S3 attachments and SQS workers remain disabled.
No NAT gateway, ALB, RDS, ElastiCache, managed container service, or production
Terraform stack was deployed. `AWS_DEPLOYMENT_ENABLED` remains unchanged.
Existing local application containers, database volumes, and messages remain
in place. Production deployment and feature claims in older documents should
be read separately from this limited demo.

## Operations

Use the `relay` profile and always verify the project before resource changes:

```powershell
aws sts get-caller-identity --profile relay --region us-east-2
aws configure get region --profile relay
aws ssm start-session --target i-08282151248d58a3e --profile relay --region us-east-2
```

The local Session Manager plugin is needed for interactive CLI sessions; the
AWS Console Session Manager and SSM Run Command also provide administration.
On the instance, `/opt/relay` contains deployment files and root-only secrets:

```bash
sudo systemctl status relay-demo.service --no-pager
sudo journalctl -u relay-demo.service --no-pager -n 50
cd /opt/relay
sudo docker compose ps
sudo docker compose logs --tail 50 gateway
sudo systemctl restart relay-demo.service
```

Avoid printing `.env`, `app.env`, `postgres.env`, `redis.env`, Docker registry
tokens, or full container environment inspection. Do not run `docker compose
down -v`, wipe volumes, or regenerate existing secrets during recovery.

Stop/start commands, when requested:

```powershell
aws ec2 stop-instances --instance-ids i-08282151248d58a3e --profile relay --region us-east-2
aws ec2 start-instances --instance-ids i-08282151248d58a3e --profile relay --region us-east-2
```

Stopping preserves data and avoids compute usage, but disk, retained IPv4, and
registry storage continue to be metered. Keep the Elastic IP to preserve this
URL. The systemd service starts the application after a normal boot.

No off-host backup was created. Before deleting resources that hold data, decide
whether to export PostgreSQL and preserve configuration/secrets securely or
take an approved backup. A disk retained on termination is not an independent
backup. Permanent cleanup requires a separate request covering data retention,
instance termination, retained disk removal, IPv4 release, private images, and
the demo role/security group. No automatic cleanup is scheduled.

Deployment files, release digests, resource IDs, and verification evidence are
saved in `infrastructure/demo/`. These files are separate from production IaC;
do not run the `iam-context.tf` policy-resolution stub as a deployment.
