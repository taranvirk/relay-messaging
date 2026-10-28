# Relay credits-only demo deployment plan

Prepared on October 27, 2026. The user explicitly approved this configuration
on October 27, 2026. Deployment is complete and verified at
<https://3.131.19.155>. See [the launch report](demo-launch-report.md) for actual
resource IDs, checks, and operations. This is the approved smaller demo;
the production Terraform stack remains disabled.

## Destination and spending constraints

- AWS project: Whimsical Whiteboard, `806079021406`.
- AWS CLI profile: `relay`; selected Region: `us-east-2`.
- STS identity verified through CLI and AWS MCP before planning.
- Free Tier API: `FREE`, `ACTIVE`, USD 100 remaining; expiration
  `2027-04-26T21:17:15.181Z`.
- No paid-plan upgrade, advanced-feature activation, purchase commitment,
  NAT gateway, load balancer, managed database, or paid enhanced image scanning.
- Leave the production Terraform and `AWS_DEPLOYMENT_ENABLED` unchanged.
- Use the current AWS MCP `run_script` API runner; the launch skill's legacy
  `call_aws` tool is unavailable.

## Proposed resources

| Setting                    | Proposed value                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Workload / environment     | Public web-server / demo-development                                                                                               |
| Instance name              | `relay-demo`                                                                                                                       |
| Instance type              | One `t3.small`, shared tenancy, on-demand; 2 vCPU, 2 GiB RAM                                                                       |
| CPU credits                | `standard`; throttles at sustained baseline rather than billing surplus CPU credits                                                |
| AMI                        | `ami-052b3645c2c811821`                                                                                                            |
| AMI description            | Amazon Linux 2023 AMI 2023.12.20261026.1 x86_64 HVM kernel-6.18                                                                    |
| AMI / instance eligibility | Both report `FreeTierEligible: true`; usage is still metered                                                                       |
| Network performance        | Up to 5 Gbit/s; not a throughput guarantee                                                                                         |
| VPC                        | Existing default `vpc-01ce469c737457e9b`                                                                                           |
| Subnet / AZ                | Public `subnet-0ffe8ec1397b25244`, `us-east-2a`; existing route to Internet Gateway verified                                       |
| Public address             | One Elastic IPv4 address, for a stable demo URL                                                                                    |
| Root volume                | 20 GiB encrypted gp3, default encryption key, baseline IOPS/throughput                                                             |
| Volume retention           | Preserve root volume on termination; stopping also preserves data. Retained storage and IPv4 continue to incur usage until removed |
| Extra volumes              | None proposed; request changes before launch if needed                                                                             |
| Security group             | New `relay-demo-web-sg`; public TCP 80 for ACME/HTTPS redirects and TCP 443 for HTTPS only; default outbound access                |
| Administrative access      | SSM only; no SSH key, no inbound port 22                                                                                           |
| Metadata                   | IMDSv2 required, hop limit 1; application containers do not need instance credentials                                              |
| IAM                        | `RelayDemoEc2Role` and instance profile; SSM core permissions and pull-only access to the two demo ECR repositories                |
| Container registry         | Private, encrypted, immutable-tag `relay-demo-api` and `relay-demo-web` repositories in us-east-2; basic scanning only             |
| Monitoring                 | Basic EC2 monitoring; rotated, bounded local container logs; no paid detailed monitoring                                           |
| Termination protection     | Disabled for the demo; teardown still requires explicit confirmation of data deletion                                              |
| Initialization             | Install Docker/Compose and security updates; generate secrets on the encrypted instance disk, never in user data or chat           |

Tags on supported resources: `Name=relay-demo`, `Project=Relay`,
`Environment=demo`, `WorkloadType=web-server`, `ManagedBy=Codex`,
`CreatedDate=2026-10-27`, `Owner=Taranvir`, `CostCenter=Personal`.
No additional organization-specific tags are proposed; these may be changed
before launch.

## Application and HTTPS

- Keep PostgreSQL, Redis, API replicas, and frontend on private Docker networks.
  Publish only the HTTPS reverse proxy's ports. No public database, Redis,
  application-debug, or Docker-management ports.
- Generate new database and JWT secrets. Start a fresh cloud database; do not
  upload the local database, local messages, environment files, or demo accounts.
- Run schema migrations but do not run the public demo seeder.
- Use secure production cookies, an explicit HTTPS origin, and an empty AWS
  attachments/queue configuration until those features are separately deployed.
- Use Caddy with an explicitly configured Let's Encrypt ACME `shortlived`
  issuer for the public IPv4 address. Persist certificate storage and automated
  renewal. Verify a publicly trusted HTTPS certificate before handing over a URL.
- Verify registration/sign-in, persisted messages across two users, WebSocket
  delivery, restart health, and that internal service ports are not exposed.
- This single host has no high availability, managed backups, or production
  capacity guarantee. No existing local data is changed.

## Metered cost estimate

The AWS Price List API was queried for Ohio on October 27, 2026. Python Decimal
calculations used 730 hours/month, without assuming free usage allowances.

| Component       | Unit rate         | Monthly estimate |
| --------------- | ----------------- | ---------------- |
| t3.small Linux  | USD 0.0208/hour   | USD 15.18        |
| 20 GiB gp3      | USD 0.08/GB-month | USD 1.60         |
| One in-use IPv4 | USD 0.005/hour    | USD 3.65         |
| Base total      |                   | **USD 20.43**    |

Private image storage, requests, traffic, optional future snapshots, taxes, and
other usage are additional. ECR's published private-storage example uses
USD 0.10/GB-month. Actual image size will be measured after build. This estimate
is not a billing cap. USD 100 would cover about 148.9 days at the base rate alone,
not the full remaining Free-plan term; additional usage shortens that period.
No out-of-pocket spending or automatic paid upgrade is authorized.

References: [ECR pricing](https://aws.amazon.com/ecr/pricing/),
[IPv4 pricing](https://aws.amazon.com/vpc/pricing/),
[EC2 on-demand pricing](https://aws.amazon.com/ec2/pricing/on-demand/),
[Let's Encrypt IP certificates](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability),
[Caddy ACME configuration](https://caddyserver.com/docs/caddyfile/directives/tls).

## Approval

Do you want to proceed with launching this EC2 instance? (yes/no)
Approval includes using the available AWS MCP API runner in place of the legacy
tool, the initialization script, private image publication, and the defaults
above. Reply with any requested configuration changes instead of yes.
