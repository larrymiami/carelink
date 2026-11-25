# Implementation status

This document distinguishes implemented behaviour from the first-release contracts. The API, worker and browser workspace are implemented; the full release gate remains incomplete.

| Area | Implemented | Remaining |
|---|---|---|
| Directory | Versioned sample records, source expiry, allowlisted administrative lookup and missing-fee response | Conflict detection between current sources, database-managed knowledge publishing, retrieval model |
| Callback | Bound action UUID/revision, text/button confirmation, consent snapshot, cancellation and correction, atomic persistence, browser confirmation controls | Broader language coverage |
| Jobs | Persisted inbound jobs, leases, SKIP LOCKED, per-conversation sequencing, recovery, heartbeat and dead letters | Load testing, recovery metrics dashboard and operational replay tooling |
| Outbound | Transactional outbox, sample transport, state/version/expiry checks, advisory send lock and unknown-send quarantine | Meta HTTP adapter, signed webhook verification, message windows/templates, proven provider receipt correlation and explicit operator retry UX |
| Ownership | Competing claims, idempotent claim/reply/resolve/resume commands, two-second inbox polling, assigned officer replies, resolve/resume and stale-reply suppression | Production organisation login and full role administration |
| Retention | Immediate expiry checks, scheduled/CLI purge, body/contact/summary redaction, protected late-write guards and bounded deduplication tombstones | Backup restore drill, third-party retention settings, production policy and purge monitoring |
| Evidence | PostgreSQL/domain/API tests, Playwright browser journeys, responsive-layout checks and timestamped Markdown/JSON reports | Full variant coverage, model evaluations and live WhatsApp checks |

The service runs in a single seeded programme. The Next.js server keeps API tokens server-side and forwards only allowlisted routes. Signed HttpOnly cookies bind simulator contacts and officer sessions; mutation endpoints enforce the configured web origin. Operator login uses a generated local sample password and seeded officer identities, with a bounded in-process login attempt limit. This is not a replacement for production organisation identity and access management. General request logging is disabled; failures return sanitized codes.

The simulator displays only messages accepted by the sample transport and identifies that status explicitly. Inbox polling pauses while hidden, refreshes on focus and backs off on errors. A stale/offline notice preserves the last known view; known expiry or lost authorisation clears protected content. Buttons bind to the current action/revision. Sample messages and officer replies retain command identifiers across retries.

Raw webhook envelopes and LLM traces are not stored because those adapters do not exist yet. Future adapters must participate in retention; adding them without expiry coverage would violate the release contract. The outbox schema has state guards for later AI replies, but no LLM provider calls are made.

An officer claim that commits before dispatch suppresses the bot send. A send accepted before the claim can still arrive afterward. An uncertain provider outcome is never treated as proof of failed delivery, and database locks cannot recall external messages.

Source is published at https://github.com/larrymiami/carelink. A distribution license remains pending. Local tests do not establish production readiness or a complete AC-01 through AC-10 pass; consult the generated coverage report for the exact evidence.
