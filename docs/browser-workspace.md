# Browser workspace

The Next.js workspace provides a conversation simulator at `/` and an authenticated operator inbox at `/inbox`. The workspace is intended for the seeded sample programme. It does not send real WhatsApp messages or place telephone calls.

## Server and browser boundary

Browser requests go to Next.js route handlers under `/api`. Those handlers forward only allowlisted requests to the Fastify service using server-only API tokens. Tokens are never returned to the browser or placed in client bundles. The simulator cookie binds its synthetic contact and current conversation; a query parameter cannot select a different contact.

Operator sign-in accepts one of two seeded officer identities and the configured local workspace password. The server issues a signed, HttpOnly, SameSite=Lax cookie with an eight-hour expiry. Use `COOKIE_SECURE=true` with HTTPS. All mutations require the exact configured `WEB_ORIGIN`. The local login attempt limiter is bounded in-process; production identity, role administration, revocation and distributed rate limiting are separate work.

The local setup command adds missing web variables without rotating existing secrets. The web server needs `API_BASE_URL`, `WEB_ORIGIN`, `SESSION_SECRET`, `DEMO_LOGIN_PASSWORD`, and the existing sample/operator API tokens. Secret configuration is excluded from source control.

## Simulator behaviour

- Starting-point buttons populate the composer; they do not send messages without the user's action.
- The transcript separates user messages from channel-accepted service/officer messages. Acceptance by the sample transport is explicitly labelled and is not described as handset delivery.
- Confirmation buttons reference the current pending action and revision. Earlier prompts do not show active confirmation controls after a correction.
- The composer retains an event ID across failed send retries, preventing duplicate business effects after an uncertain HTTP response.
- A new conversation changes the synthetic contact/session context without deleting historical records. Existing records continue through normal retention.
- Source inspection shows source ID, version, reviewed date and validity for a successful directory response.
- The simulator clears cached transcript content after a known expiry response. An ordinary connection failure shows a stale-view notice instead of inventing an empty or current state.
- The mobile layout presents the conversation before optional starting-point guidance and source details.

## Inbox behaviour

The inbox uses incremental cursor polling every two seconds while visible, pauses when hidden, and refreshes on focus. One polling request is active at a time; errors back off to thirty seconds. Updates apply by server revision, and older snapshots cannot overwrite newer conversation state. Tombstones remove records after purge or a change in authorised ownership.

An officer reads the request before claiming it. Claim success is displayed only after the server commits ownership. A competing claim produces a conflict and refreshes the list; it cannot grant both officers a reply composer. Human-active messages appear in the owning officer's transcript, and automatic replies remain paused.

Reply, resolve and resume actions carry stable command IDs across retries. The backend binds each ID to the officer, conversation, action and request fingerprint. Reusing an ID for changed reply text is rejected. Resolution does not silently resume automation; the officer must choose that separately.

The operator sees queued, failed and suppressed officer replies with explicit status labels. Unknown delivery outcomes produce a warning and are not automatically resent. A service seeker does not see an unsent officer reply in their transcript. Known lost authorisation removes the cached operator conversation.

## Verification

`npm run test:browser:report` starts an isolated PostgreSQL cluster, API, worker and production Next.js server. It does not use the developer's database or local credentials. The suite uses an advancing clock based on the fixture date, synthetic contacts and generated ephemeral credentials.

The browser suite covers directory/source inspection, unknown fees, consent and cancellation, officer handover/reply/resolve/resume, competing claims, stale polling and recovery, session isolation, origin checks, known expiry and a mobile viewport. Backend tests separately verify transactional persistence, worker leases, stale reply suppression, idempotent operator commands and purge. Neither suite substitutes for model evaluations or live Meta transport tests.

Generated JSON and Markdown reports retain their execution context and distinguish incomplete release coverage from passing executed checks. GitHub Actions runs backend and browser verification as separate jobs.
