# Operations

## Signals

Pino writes JSON logs with service, environment, request ID, method, route, status, duration, user/socket identifiers where safe, and event type. Authorization headers, cookies, tokens, passwords, hashes, and message content are redacted.

The Terraform dashboard shows:

- ALB request count, target latency, 5xx responses, and target health;
- ECS API CPU/memory and Container Insights task metrics;
- RDS CPU, connections, and free storage;
- Redis engine CPU and connection count;
- SQS visible backlog and DLQ state.

SNS alarms are created for high target 5xx, unhealthy ALB targets, insufficient running API tasks, ECS CPU/memory, RDS CPU/low storage, Redis node CPU, and queue backlog. Confirm the SNS email subscription after apply; Terraform cannot confirm it for you. The connection metric is a per-process gauge, not a claimed count of distinct users across the cluster.

## Triage order

1. Check ALB target health and `/api/health/ready`.
2. Correlate the request ID through ECS JSON logs.
3. Compare ECS task churn, CPU, and memory with request/connection changes.
4. Check RDS connections/storage and Redis connections/CPU.
5. Inspect SQS age/backlog and DLQ messages for worker failures.

Do not log private message bodies to simplify debugging. Reproduce with IDs and timestamps in a non-production environment.

## Backup and recovery

RDS automated backup retention is 14 days in production and storage auto-scales to the configured maximum. Terraform enables deletion protection and requires a final snapshot in production. Test point-in-time restoration quarterly into an isolated VPC, run Prisma compatibility checks, and record RTO/RPO evidence.

S3 attachments should receive lifecycle/versioning rules appropriate to the product's retention policy before accepting regulated data. Queue DLQ redrive must be reviewed before replay because jobs can be side-effecting.
