# Processing and data lifecycle

Version 0.1 | 25 November 2026 | Status: implementation contract

These decisions govern the first release. They specify required behaviour; they do not assert that workers, tests or purge commands already exist.

## Decision 1 PostgreSQL jobs and transactional outbox

Run the Fastify API and a separate long-lived worker process against the same PostgreSQL database. Redis and BullMQ are not dependencies. The development process command will be `pnpm worker:dev`; production needs an actual worker process, not an API route invoked opportunistically. Deployments must support a long-running process and direct database sessions.

Use three durable records:

| Record | Essential fields and responsibility |
|---|---|
| `inbound_events` | Programme/provider/event key, normalized type, conversation reference, sequence, status and retention expiry. Unique provider event keys prevent duplicate business processing. |
| `jobs` | Kind, referenced entity IDs, expected state version, run-after, status, attempt count, lease owner/token/expiry, error code and retention expiry. Payloads contain references rather than copies of message bodies. |
| `outbox` | Unique logical response key, message kind, conversation reference, expected version, required state, optional action/revision or operator ownership, delivery state and retention expiry. Message bodies remain in the protected message store. |

On a valid webhook, normalize each message/status event in the provider envelope. In a short database transaction persist the event and its processing job. A duplicate is a successful no-op. Acknowledge only after durable commit; database failure returns a retryable failure. Signature or schema errors are rejected rather than enqueued. Do not wait for an LLM or Meta send to acknowledge the webhook.

Poll eligible jobs every 500 ms, selecting a small batch using `FOR UPDATE SKIP LOCKED`. In that transaction mark the claimed jobs running with a fresh lease token and commit. Perform model and other slow work outside this claim transaction. Complete or reschedule only with the matching lease token; a stale worker cannot commit results. Initial lease: 60 seconds, heartbeat every 15 seconds. These are configurable engineering defaults. An expired processing/AI lease may be reclaimed, but outbound sends follow the stricter rules below.

Serialize domain processing per conversation. Assign accepted inbound messages an increasing sequence in a short transaction and process them in that order. Webhook arrival order is the local ordering authority; provider timestamps are metadata, not a guarantee of original user ordering. A later user message invalidates an older generation snapshot. Different conversations can progress concurrently. Status events do not block user-message processing and do not increment conversational context versions.

Domain state changes, confirmed callbacks, result-message records and outbox insertion commit atomically. A unique response key such as `inbound:<event-id>:reply:<ordinal>` prevents duplicate logical replies. Outbox insertion schedules dispatch in the same transaction. A recovery scan detects eligible outbox rows even if a dispatcher crashes. Workers never rely solely on in-memory queues.

For retryable processing failures use bounded exponential backoff with jitter (five attempts; base 1 second, cap 60 seconds). Invalid payloads and permanent authorisation/validation failures do not retry. Exhausted work becomes `dead_letter` and exposes a sanitized error code to operators. Replay preserves original event and logical response keys. Metrics include oldest eligible job age, attempts, dead letters, delivery-unknown sends and suppressed stale replies.

## Decision 2 Conversation versions and the dispatch boundary

`conversations.state_version` starts at 1 and increases transactionally on every state/ownership transition, proposal creation/change/cancellation, and new accepted conversational input that invalidates a pending response. The name covers both workflow state and the context snapshot; a newer question can supersede an old answer without changing `state`. Status receipts and duplicate events do not increment it.

AI jobs capture `expected_state_version` after their initiating input is applied. They run only for `automated` state. On completion, accept the result only if the lease, state version and required state still match and retention has not expired. Otherwise finish as `superseded` without an outbound message. Recheck at dispatch; checking only at model completion leaves a second race.

Different outbound kinds have explicit guards. AI replies require `automated`; confirmation prompts require `awaiting_callback_confirmation` and the exact active action/revision; fixed queue acknowledgments/status require `queued_for_human`; officer replies require `human_active` with the submitting officer still assigned. No generic “allow sends in any state” escape hatch exists.

### Send and claim serialization

Both dispatch and every state/ownership mutation acquire the same per-conversation PostgreSQL session advisory lock on a dedicated checked-out connection. Use a persisted unique numeric conversation lock ID rather than a collision-prone application hash. Session locks require a session-capable connection; transaction-pooling endpoints cannot be used for this path. All application writers follow this protocol. Apply transaction row locks/compare-and-set in addition to the advisory lock for database invariants.

Dispatch acquires the lock, rechecks expiry, lease and guards, and commits a `dispatching` attempt before issuing the HTTP request. It retains the session lock through a bounded provider request (initial timeout 5 seconds), but does not keep a database transaction open during network I/O. Record accepted/failed/unknown outcome in a short transaction, then unlock and release the connection. Use `try/finally`; never return a session with an advisory lock to the pool. If connection health is lost, stop new dispatch and abort the in-flight request where possible.

An officer claim tries the same lock. If dispatch is active, return a retryable `409 dispatch_in_progress` without claiming; the UI can retry with the same command ID. Once acquired, compare the queue state/version, assign one officer, increment version and invalidate unsent bot outbox rows atomically. Competing claims return `409 already_claimed`. A successful claim response is issued only after commit.

The enforceable application guarantee is: **a bot send is not initiated after a completed officer claim, and unsent stale responses are suppressed**. A message accepted by Meta before claim can arrive on the phone afterward. A timeout or process/network failure can leave the provider outcome unknown. PostgreSQL cannot atomically commit with Meta or fence an already-running provider request. Tests must assert send initiation ordering and stale-row suppression, not an impossible guarantee about handset arrival time.

## Decision 3 Outbound uncertainty

Use delivery states `pending`, `dispatching`, `accepted`, `delivered`, `read`, `failed`, `delivery_unknown`, `suppressed` and `expired`. Track attempts separately. HTTP acceptance with a provider message ID is not delivery. A worker dying after `dispatching` is persisted must be recovered to `delivery_unknown`, not automatically resent after its lease expires.

When acceptance is ambiguous, quarantine the send and show an operator warning. Correlate authenticated status notifications with the persisted provider ID or a supported opaque client reference if Meta documentation and integration tests establish that capability. Do not assume that Graph API offers an arbitrary message-history lookup or an idempotency key. Without trustworthy correlation, the result stays unknown. A lack of webhook evidence is not evidence of non-delivery. Operators may explicitly create a new send attempt after reviewing duplication risk; original attempts remain recorded.

Definite pre-send failures and provider responses documented to mean non-acceptance may retry within policy. Ambiguous network timeouts may not. Accepted/delivered/read progression is monotonic for a particular provider message ID; stale receipts cannot downgrade it. Record contradictory receipts for investigation. Event deduplication keys include receipt type/status so delivered and read notifications are not collapsed as duplicates. A pending unknown bot message remains visible when an officer claims; claim cannot recall it.

## Decision 4 Confirmation buttons and text

The domain payload schemas are:

```text
cb_confirm:<action_id>:<revision>
cb_cancel:<action_id>:<revision>
```

`action_id` is a UUID allocated by the backend. `revision` is a positive decimal integer without leading zeros. Parse the complete string strictly; reject unknown prefixes, extra segments and invalid identifiers. Render labels “Confirm” and “Cancel”. Validate Meta's current interactive-message constraints when building the transport adapter.

Button input bypasses the LLM and goes to the domain command handler. A payload is a reference, not an authentication or consent credential: verify the authenticated inbound origin, programme/contact/conversation binding, current action and revision, state, expiration and consumption status. A forged or cross-contact reference is a no-op with a generic response. A repeated confirmation returns the same committed result; a cancelled or stale action cannot create a new callback.

V1 free-text confirmation uses deterministic normalized exact intents: `yes`/`confirm`, `no`/`cancel`, case-insensitive after trimming surrounding whitespace and terminal punctuation. They are meaningful only against a single current proposal and its prompt. Mixed messages such as “yes, but change it to North” do not confirm. Other wording asks the person to use the buttons or clarify. A requested correction invalidates the current proposal; present and confirm a new proposal before any write. Structured interpretation may later suggest a correction, but cannot authorise a callback. To cancel an already queued request, the original cancellation action may cancel its associated still-active callback; after claim it becomes an officer-inbox request instead of a bot ownership override.

## Decision 5 Operator inbox polling

Use authenticated short polling every 2 seconds while the inbox tab is visible; pause when hidden and refetch immediately on focus. Allow at most one outstanding poll. Back off on transport errors up to 30 seconds, display the last successful refresh time and show an offline/stale status rather than implying a current empty queue. Fetch immediately after commands. No WebSockets or SSE in V1.

Use a revision/cursor-based incremental endpoint with a stable ordering, pagination and tombstones for removed/resolved/purged items. The client applies updates by server revision and ignores older snapshots. Poll responses are authorization-scoped and contain only the selected inbox/conversation data needed by the operator. Purged conversation detail returns `410 content_expired` without a retained body.

Claim commands include an idempotent command ID and expected state version. Server state decides ownership; an optimistic UI must not report a successful claim before the server accepts it. A conflict refetches the item and displays the current result. Playwright tests advance controlled time or trigger the documented refresh action and wait for observable state, rather than arbitrary sleeps. Cover the two-browser competing-claim case and messages arriving during human ownership.

## Decision 6 Retention and purge

Make expiry executable in milestone one. The planned commands are `pnpm db:purge-expired --dry-run` and `pnpm db:purge-expired`; they are requirements, not existing scripts. Also schedule the same purge service as a PostgreSQL job every 15 minutes. Dry-run reports counts by record type, never raw identifiers or content.

`retention_expires_at` is an absolute timestamp on each conversation and its protected content. Development defaults to seven days from conversation creation, using the injected clock in tests. All child message bodies, prompts, generated answers, administrative summaries, pending/confirmed action payloads, inbox notes and outbox content inherit that deadline. New messages and retries do not extend it. Production requires an explicitly configured retention period and operational owner; seven days is an engineering sample default, not an asserted health-data retention requirement.

At expiry, reads stop returning content immediately, generation/dispatch guards reject new work, and pending actions expire. The purge transaction cancels jobs and unsent outbox work, increments the version, invalidates stale results and clears/deletes protected fields including raw provider payloads, summaries, prompt traces and contact references. An active or unresolved request is not an indefinite exemption; expire it visibly and count it as uncompleted. A contact reference is deleted when no unexpired conversation requires it. Expiry and purge obey the same per-conversation lock ordering as sends and claims. Already accepted external messages cannot be recalled by database purge.

Retain only operational deduplication tombstones for a separately configured bounded interval (development default 14 days from event receipt). Use keyed hashes of event identifiers, not raw numbers, bodies or provider identifiers; bound the interval to the chosen retry/replay policy. Tombstones remain pseudonymous operational data, not anonymous analytics. Replayed expired events within that interval cannot recreate purged conversations. Beyond it, do not claim indefinite replay protection. A new message after expiry begins a fresh conversation without restoring old content.

Aggregate audit counts by day, event category and outcome before removing per-conversation identifiers. Do not call UUID-linked audit rows anonymous; counts kept long-term contain no contact, conversation, message, action or request IDs and no free text. Purge is batched and idempotent, with sanitized counts and last-success metrics. Test expiry during AI generation, job lease recovery, officer ownership and outbound dispatch; unfinished work cannot resurrect purged content.

V1 has no persistent application cache containing message bodies. Operator cache is invalidated by polling tombstones, conversation access checks and refetch on focus. Providers and backups have separate retention: document their configured limits and ensure a restore runs expiry reconciliation before serving traffic. Database redaction does not promise immediate deletion from third-party providers, existing backups or recipients' devices.

## Evaluation report and demonstration

Build report generation alongside the first executable acceptance tests. Produce `evals/reports/<run-id>.json` and `.md` from actual runner output, with commit, dirty-tree state, fixture/case versions, clock/seed, execution modes, model/prompt/corpus versions where used, case and variant totals, repeats, assertions, failures, skipped/not-run cases, latency and measured model cost.

The initial specification has ten top-level cases. Add worker lease/fencing/recovery variants to AC-05 and AC-10; stale-generation/send-before-claim variants to AC-06; button/correction variants to AC-03/04; polling/claim-conflict variants to AC-06; and retention/late-write/privacy variants to AC-07/10. These are test mappings, not evidence that a model runner verifies database concurrency. Report deterministic integration, browser and model-evaluation evidence separately.

Show `critical_failures: 0` only when actual executed assertions support it. Also show critical coverage and skipped/not-run counts prominently. Overall gate stays `incomplete` unless all required variants have required evidence, even when no executed test has failed. Disabled model tests must not appear as a full AI pass. Public reports use synthetic inputs only and contain no credentials, raw contact references or operational conversations.

Plan a two-minute recording: directory lookup with source inspection, missing fee with honest fallback, explicit callback confirmation, operator takeover side by side, and the generated report showing what actually ran. Use a scripted sequence and link the tested commit. Keep queue status, claim state and send acceptance/delivery visibly distinct. Complete the recording after those features work.

## References

- PostgreSQL SELECT and SKIP LOCKED: https://www.postgresql.org/docs/current/sql-select.html
- PostgreSQL advisory locks: https://www.postgresql.org/docs/current/explicit-locking.html

SKIP LOCKED is for competing queue consumers, not a general consistent read of application state. Session advisory locks persist across transaction boundaries and must be explicitly released on healthy pooled sessions. Confirm these properties against the pinned database version during implementation.
