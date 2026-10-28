# HTTP API

Additional management routes:

- `POST /api/conversations/:id/owner`, body `{ "userId": "<member UUID>" }`: the owner transfers ownership to another member.
- `POST /api/conversations/:id/read`, body `{ "messageId": "<UUID>" }`: REST read fallback; pointers never move backwards.
- `GET /api/config`: returns `{ "attachmentsEnabled": boolean }`.

Leaving a group deletes your own membership. Owners must transfer before leaving. Direct members cannot be added/removed. Deleting a direct conversation deletes it for both users; the UI confirms that scope.

All JSON endpoints use `/api`. Authenticated browser calls use the HTTP-only `relay_session` cookie; automation may supply the same JWT as `Authorization: Bearer <token>`. Error responses use:

```json
{ "error": { "code": "NOT_A_MEMBER", "message": "You are not a member of this conversation" } }
```

## Authentication

### `POST /auth/register`

```json
{
  "username": "maya",
  "displayName": "Maya Chen",
  "email": "maya@example.com",
  "password": "StrongPass123"
}
```

Creates a session and returns `{ "user": … }`. Username/email conflicts return `409`.

### `POST /auth/login`

Accepts `{ "email", "password" }`, rotates the session cookie, and returns the safe user.

### `POST /auth/logout`

Clears the session cookie. Returns `204`.

### `GET /auth/me`

Returns the current safe user. Password hashes are never selected or serialized.

## Users

- `GET /users/search?q=ma` — minimum two useful characters; returns at most 20 users.
- `GET /users/:id` — public profile fields.
- `PATCH /users/me` — accepts optional `displayName`, `username`, and HTTPS `avatarUrl`/`null`.

## Conversations

### `POST /conversations`

Direct:

```json
{ "type": "DIRECT", "memberIds": ["user-uuid"] }
```

Group:

```json
{ "type": "GROUP", "name": "Platform crew", "memberIds": ["user-uuid"] }
```

Direct conversations are reused for the same pair. Group creators become `OWNER`.

- `GET /conversations` — memberships, most recent message, and receipt-backed unread counts.
- `GET /conversations/:id` — full membership after authorization.
- `PATCH /conversations/:id` — owner/admin group rename.
- `DELETE /conversations/:id` — owner-only group deletion.
- `POST /conversations/:id/members` — `{ "userId", "role": "MEMBER" | "ADMIN" }`.
- `DELETE /conversations/:id/members/:userId` — self-leave or authorized removal; role hierarchy applies.

## Messages

### `GET /conversations/:id/messages?cursor=<messageId>&limit=50`

Returns oldest-to-newest messages in the page plus `nextCursor`. Limits are 1–100. The cursor identifies the oldest message already loaded.

### `POST /conversations/:id/messages`

```json
{
  "clientMessageId": "f9fe29b9-6534-489c-b503-cb06e09465ff",
  "content": "Deploy is healthy",
  "type": "TEXT",
  "replyToMessageId": null,
  "attachments": []
}
```

The client ID is unique per sender. Retrying it returns the original persisted message.

- `PATCH /messages/:id` — `{ "content": "corrected" }`; sender only, within 15 minutes.
- `DELETE /messages/:id` — sender-only soft deletion; content and attachments are removed.

## Attachments

- `POST /attachments/presign` — `{ "fileName", "mimeType", "fileSize" }`; returns a five-minute PUT URL and `storageKey`.
- `GET /attachments/:id/url` — membership-authorized five-minute download URL.

Allowed types are JPEG, PNG, WebP, PDF, and plain text; maximum size is 10 MiB.

## Health

- `/health` is a process liveness check.
- `/health/ready` verifies PostgreSQL and Redis without returning connection details.
