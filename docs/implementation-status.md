# Implementation status

This document distinguishes implemented behaviour from the first-release contracts. This is the first backend increment; the full release gate remains incomplete.

| Area | Implemented | Remaining |
|---|---|---|
| Directory | Versioned sample records, source expiry, allowlisted administrative lookup and missing-fee response | Conflict detection between current sources, database-managed knowledge publishing, retrieval model |
| Callback | Bound action UUID/revision, text/button confirmation, consent snapshot, cancellation and correction, atomic persistence | Browser confirmation UX and broader language coverage |
| Jobs | Persisted inbound jobs, leases, SKIP LOCKED, per-conversation sequencing, recovery, heartbeat and dead letters | Load testing, recovery metrics dashboard and operational replay tooling |
| Outbound | Transactional outbox, sample transport, state/version/expiry checks, advisory send lock and unknown-send quarantine | Meta HTTP adapter, signed webhook verification, message windows/templates, proven provider receipt correlation and explicit operator retry UX |
| Ownership | Competing claims, idempotent claim commands, assigned officer replies, resolve/resume and stale-reply suppression | Browser inbox, two-second polling client, idempotent reply commands and complete operator login/roles |
| Retention | Immediate expiry checks, scheduled/CLI purge, body/contact/summary redaction, protected late-write guards and bounded deduplication tombstones | Backup restore drill, third-party retention settings, production policy and purge monitoring |
| Evidence | Actual PostgreSQL/domain/API tests and timestamped Markdown/JSON reports | Full variant coverage, Playwright browser evidence, model evaluations and live WhatsApp checks |

The service currently runs in a single seeded programme and uses server-side sample/operator API tokens. It must not be exposed as an operational patient service. General request logging is disabled; failures return sanitized codes. A complete production identity and authorisation model is a later increment.

Raw webhook envelopes and LLM traces are not stored because those adapters do not exist yet. Future adapters must participate in retention; adding them without expiry coverage would violate the release contract. The outbox schema has state guards for later AI replies, but no LLM provider calls are made.

An officer claim that commits before dispatch suppresses the bot send. A send accepted before the claim can still arrive afterward. An uncertain provider outcome is never treated as proof of failed delivery, and database locks cannot recall external messages.

Source is published at https://github.com/larrymiami/carelink. A distribution license remains pending. Local tests do not establish production readiness or a complete AC-01 through AC-10 pass; consult the generated coverage report for the exact evidence.
