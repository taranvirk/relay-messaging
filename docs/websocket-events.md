# WebSocket protocol

Socket.IO connects at `/socket.io` using WebSocket-only transport. Browsers send the session cookie automatically; non-browser clients may use `auth.token`. Invalid, revoked, or expired credentials are rejected before connection. Authorized rooms and presence are initialized in middleware before the server acknowledges connection, avoiding lost early events.

Transient session-store failures reject a handshake with `connect_error.data.retryable = true`; the browser retries after three seconds. For an already-connected session, a transient outage closes the transport so Socket.IO can reconnect. Revoked/expired sessions receive a non-retrying authorization rejection or server disconnect. Every reconnect refreshes authorized rooms, presence, and PostgreSQL history.

Every client event that changes state accepts a Socket.IO acknowledgement callback:

```json
{ "ok": false, "error": { "code": "RATE_LIMITED", "message": "Message rate limit exceeded" } }
```

## Messages

| Direction       | Event             | Payload                                                                            |
| --------------- | ----------------- | ---------------------------------------------------------------------------------- |
| client → server | `message:send`    | `conversationId`, `clientMessageId`, `content`, `type`, optional reply/attachments |
| server → room   | `message:new`     | `clientMessageId`, persisted `message`                                             |
| client → server | `message:edit`    | `messageId`, `content`                                                             |
| server → room   | `message:edited`  | persisted message                                                                  |
| client → server | `message:delete`  | `messageId`                                                                        |
| server → room   | `message:deleted` | soft-deleted message                                                               |

The server derives `senderId` from the verified connection; a client cannot supply it. REST/socket sends share 40 messages per ten seconds per user across replicas. Acknowledgements are optional, but clients should use them and reuse the same client ID on retry.

## Receipts

`message:delivered` and `message:read` accept `{ conversationId, messageId }`. Delivered updates the calling user's receipt. Read marks all that user's receipts through the selected message and broadcasts the resulting receipt state.

## Typing

`typing:start` and `typing:stop` accept only `{ conversationId }`. Membership is verified. Broadcast payloads add the authenticated `userId` and username. Clients expire a typing display after six seconds even if a stop event is missed.

## Presence

The server broadcasts:

- `presence:online` — `{ userId }` on a transition from zero to one live connection;
- `presence:offline` — `{ userId, lastSeenAt }` only after the final connection closes.
- `presence:snapshot` — `{ userIds }` on connect, containing online peers in the user's conversations.

Transitions are scoped to authorized conversation peers, not globally broadcast to unrelated users. Failed-process leases expire after 90 seconds and are swept every 15 seconds.

## Conversation membership

New sockets automatically join rooms from database membership. REST group changes use the distributed adapter's room operations to join or evict a user's currently connected sockets across every API task. Clients cannot request arbitrary room names.
