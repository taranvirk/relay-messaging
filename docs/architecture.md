# Architecture decisions

## Delivery contract

Relay's critical path is:

1. authenticate the socket or HTTP session;
2. validate the event;
3. authorize current conversation membership;
4. insert the message and recipient receipt rows in PostgreSQL;
5. publish to the Socket.IO conversation room through Redis;
6. acknowledge the sender after persistence;
7. recover any missed events from cursor-paginated PostgreSQL history.

This ordering prefers durable acceptance over low but misleading apparent latency. Redis is a coordination layer, never the durable message store.

## Horizontal scale

Each authenticated socket joins `user:<userId>` and every authorized `conversation:<conversationId>` room. The Socket.IO Redis adapter publishes room operations to every API task. Adding a group member also asks every task to join that user's active sockets to the new room. Removing a member evicts those sockets.

ALB stickiness is intentionally disabled. Relay uses **WebSocket-only** Socket.IO transport: one TCP connection stays with one task, while Redis coordinates different tasks. HTTP long-polling would require sticky sessions even with Redis and is deliberately disabled. When WebSockets cannot connect, the UI sends through REST and polls history. The client reconnects with backoff and refetches history.

The local Nginx upstream shares passive failure state across workers and limits connection attempts to two seconds, so a stopped replica cannot hold a history request behind the default long timeout. Retries are bounded to two upstream attempts; non-idempotent requests are not blindly replayed after being sent. See [Nginx proxy timeouts](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_connect_timeout).

API requests explicitly use HTTP/1.1 upstream keepalive, with at most 32 idle connections per Nginx worker. The proxy retires idle upstream connections after four seconds, before Node's default five-second idle timeout (plus its Node 24 buffer). Three transport failures within five seconds quarantine a replica; a single transient reset still retries the other replica but does not immediately remove an otherwise healthy server. Application 503 responses are preserved, not interpreted as both replicas failing. This addresses observed reset amplification during local history catch-up; it is not proof of the original reset's cause or an AWS ALB setting. See [Nginx upstream keepalive and passive failures](https://nginx.org/en/docs/http/ngx_http_upstream_module.html) and [Node HTTP idle timeouts](https://nodejs.org/docs/latest-v24.x/api/http.html#serverkeepalivetimeout).

## Persistence and idempotency

PostgreSQL stores accounts, memberships, messages, attachments, and per-recipient receipts. A composite unique constraint on `(senderId, clientMessageId)` turns a retry into a read of the already-persisted record. The API returns the original record only when the conversation also matches, preventing reuse across conversations.

Message history uses an indexed `(conversationId, createdAt, id)` ordering and opaque message ID cursors. The client sorts server timestamps plus IDs to render a deterministic order even when live events arrive out of order.

History hydrates only the returned page, not its look-ahead pagination sentinel. Public sender records, receipts, and attachments are fetched in indexed batches; repeated sender objects are shared within that response. Reply targets are restricted to the same conversation. This reduces query-engine materialization/serialization work during catch-up without caching authorization or profiles across requests. Every page still checks current membership.

## Presence and typing

Each user has a Redis sorted set `presence:user:<userId>` of socket leases, refreshed every 30 seconds and valid for 90 seconds. Atomic Lua scripts decide first/last connection transitions. A 15-second sweeper cleans crashed-process leases, updates durable `lastSeenAt`, and broadcasts offline state. Presence snapshots and transitions are limited to shared conversation peers. Redis is required for authentication revocation and distributed presence; there is no process-local substitute claiming distributed correctness.

Typing uses six-second Redis keys and explicit stop events. It never enters PostgreSQL.

## Reads and unread counts

When a message is created, Relay creates one pending `MessageReceipt` per other member. Conversation-list unread counts group indexed, unread receipt rows instead of counting the entire message table. A read event updates all receipts through the viewed message and advances `ConversationMember.lastReadMessageId` transactionally.

## Background work

A message transaction also inserts an `OutboxJob` when SQS is configured. A background dispatcher retries pending outbox rows and sends a compact `MESSAGE_CREATED` job to SQS. A separate Fargate worker long-polls and upserts a persistent `AuditEvent` using the stable job ID, then acknowledges SQS. Duplicate dispatch/receive is safe. After five failed receives a job moves to the DLQ. This is at-least-once delivery with an idempotent consumer, not exactly-once delivery. No message body enters the audit.

## Attachments

The API validates file metadata and issues a five-minute pre-signed S3 PUT URL. Browsers upload directly to a private bucket. Before committing attachment metadata, the API verifies the authenticated owner's key prefix and actual S3 object size/type using HeadObject. Download URLs require current conversation membership, force attachment disposition, and expire after five minutes. The local UI disables attachments without a configured S3 bucket.

## Failure boundaries

- **Redis unavailable:** readiness fails and session checks fail closed. Durable messages remain in PostgreSQL; clients recover missed history after Redis returns. This favors session-revocation correctness over availability during a total Redis outage.
- Session checks disable Redis's offline command queue and use a bounded connection attempt shared by concurrent requests. Later requests can reconnect; adapter clients retry independently. Transient socket middleware failures are marked retryable, unlike invalid/revoked credentials. See [Socket.IO's reconnection distinction](https://socket.io/docs/v4/client-socket-instance/#connect_error).
- **PostgreSQL unavailable:** readiness fails and the API never acknowledges unpersisted messages.
- **API task termination:** ALB drains the target; sockets reconnect to another task and refetch.
- **Worker crash:** SQS visibility timeout returns the job for retry.
- **Client timeout after persistence:** retrying the same client ID returns the original message.
