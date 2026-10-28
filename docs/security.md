# Security model

## Trust boundaries

The browser is untrusted. User ID, sender ID, membership, roles, receipt ownership, storage keys, and conversation room names are all resolved or verified server-side. Socket authentication runs before handlers are installed, and every sensitive event checks membership again.

Passwords are bcrypt-hashed at cost 12. JWTs are audience/issuer scoped, expire, and are placed in Secure/HttpOnly/SameSite cookies in production. CORS accepts only configured origins. Zod places size and shape bounds on inputs; Prisma uses parameterized queries.

## Abuse controls

HTTP limits distinguish authentication, search, creation, message, and upload paths. REST and socket sends share an atomic Redis counter allowing 40 per ten seconds per user across replicas; opening more tabs does not bypass it. Typing events are also limited. Authentication checks require Redis so logout revocation fails closed during an outage. Add bot controls and AWS WAF before exposing high-risk public registration.

## Data handling

- Secrets live in Secrets Manager and enter ECS as task secrets.
- API and worker task roles are separate: the API can enqueue jobs and access the attachment bucket; the worker can receive/delete jobs but cannot upload/download files or enqueue jobs.
- RDS, Redis, S3, SQS, and ECR encryption is enabled.
- RDS/Redis only accept security-group traffic from ECS.
- Attachment buckets block public access; signed links expire in five minutes.
- Logs redact credentials and message bodies.
- Logout revokes the JWT's unique session ID in Redis through expiration and disconnects that session's sockets across replicas. Sockets also check expiration/revocation on every packet.
- Unsafe REST methods and WebSocket handshakes reject untrusted browser origins.
- CloudFront reaches the ALB over verified HTTPS. ALB accepts only CloudFront's managed network prefix and a generated origin-verification header.
- Terraform state contains generated secrets. Use encrypted remote state, tightly scoped access, locking, and no checked-in state/tfvars.

## Known production hardening items

Before a public launch, add email verification/password reset, refresh rotation, account deletion/export, malware scanning, explicit retention policies, AWS WAF, and an external security review. Optional reactions, pinned messages, search, blocking, email/push notifications, and user-facing custom-domain automation are not implemented.
