# Relay sign-out fix — October 27, 2026

The logout API revoked the session correctly, but `queryClient.clear()` removed
the session query without replacing the result retained by the mounted
authentication observer. Navigating to `/login` could therefore see the old
signed-in user and redirect straight back to `/messages`.

The frontend now cancels pending requests, explicitly publishes `{ user: null }`
to the session query, and removes other cached queries and mutation results.
The session fetch consumes its AbortSignal so a late response cannot restore
the previous identity. Logout replaces the current history entry with `/login`.
Failures other than an already-ended session still surface as errors rather
than claiming that server-side logout succeeded.

A regression using the real navigation, protected route, and login screen failed
before the fix: a successful HTTP 204 left the private page visible. It now passes.
Additional cases cover an already-expired HTTP 401 session and a session response
that completes after logout. All 21 frontend tests, TypeScript checks, and ESLint
passed. No backend logic, database records, secrets, or existing messages change.

Published and verified on the existing credits-only demo at
<https://3.131.19.155>. The AWS MCP connector was unavailable for this update;
the installed CLI is used with profile `relay`, selected Region `us-east-2`, and
a verified project identity of `806079021406`. After sign-in refresh, the Free
Tier API returned `FREE`, `ACTIVE`, and USD 99.74 remaining credits.

Release `20261027-logout1` uses frontend digest
`sha256:8ce8c805613a5ed0dd70c63979427f1dbb260de9cc3802dfaeede410beb07ae3`.
The basic ECR scan completed with no reported findings. SSM command
`3ae33f57-aa04-4778-84c6-cf00e2885ba4` replaced only the frontend and restarted
the gateway; database, Redis, and both API containers stayed healthy and were
not recreated. The API image digest is unchanged. Temporary registry credentials
were removed after publication and pulling.

The exact production frontend image was extracted to a local fixture with a
synthetic signed-in identity, not real credentials. Clicking Log out navigated
immediately from `/messages` to `/login`, and reloading remained signed out.
The fixture uses only loopback access and does not connect to a real database.
The public site serves `/assets/index-CBSoCEOX.js`, and public readiness is healthy.

Users with an already-open page need one refresh to load the new frontend, then
can use the Log out button normally.

## Follow-up: inbox still visible after logout

The user reported the inbox showing “Conversations are unavailable” after logout
on the public AWS site. Filtered live logs showed a successful logout (204), then
401 responses for session and conversation requests while the inbox remained
visible. This confirms that the server ended the session, but does not establish
which browser-side state or cached release produced that user's screenshot.

The first fixture did not cover a real socket disconnection. A new loopback-only
proxy test uses the actual public HTML/JavaScript, cloud REST API, and cloud
WebSocket with a synthetic user. The current first-fix release passed that test;
the user's exact remaining failure was not reproduced in a fresh document.

Release `20261027-logout2` strengthens the exit path: after successful logout or
an already-ended session, navigation uses `window.location.replace('/login')`.
This discards the whole signed-in document, its socket, and query observers.
The app entry HTML is now served with `Cache-Control: no-store`; content-hashed
assets retain immutable caching. Missing assets are not given immutable headers.

The updated public release passed the real-backend browser sequence: a connected
cloud socket, logout 204, session 401, a new `/login` document request, and another
session 401. Reopening `/messages` returned to the sign-in screen. All 21 frontend
tests, type checks, lint, the image build, Nginx validation, and basic image scan
passed. HTTP checks verified no-store on `/messages`, `/login`, and `/index.html`.

The deployed frontend digest is
`sha256:0369a09ddb3d383756460b9a2123e7dd4a42b839a6447b45247c333bb61521b4`,
serving `/assets/index-v9Uwstbo.js`. SSM command
`4dcc4dda-ce83-4eaa-8a6d-cc2f041e52f1` completed successfully. Only the frontend
was recreated and the gateway restarted; PostgreSQL, Redis, API replicas, and
existing users/messages were preserved. Temporary registry credentials were
removed. The synthetic verification users had their test sessions revoked by
logout; their records were not deleted.

For a tab that still has the earlier JavaScript in memory, open the
[fresh sign-in link](https://3.131.19.155/login?refresh=20261027-logout2) once.
