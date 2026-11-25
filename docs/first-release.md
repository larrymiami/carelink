# CareLink first release specification

Version 0.2 | 25 November 2026

CareLink helps community health programmes answer service questions and coordinate human follow-up over WhatsApp. This specification defines the first implementation milestone: a directory lookup, a confirmed callback request and an operator handover, backed by a reproducible sample dataset.

This document defines the target first release. See `implementation-status.md` and generated verification reports for implemented behaviour and executed evidence. The accompanying acceptance cases are requirements, not passing test results. Meta WhatsApp Cloud API is the selected messaging integration. Source: https://github.com/larrymiami/carelink.

## Programme configuration

The sample programme is **Community Access**. Its clinics and information are fictional, isolated from operational data and labelled in the simulator. Configuration uses `Africa/Nairobi`, English and a sample officer schedule of Monday to Friday, 09:00 to 17:00. A schedule indicates staffed hours, not immediate officer availability or a response-time guarantee.

The fixed test clock is Wednesday 25 November 2026 at 09:00 in Nairobi. Source validity is evaluated against the injected clock, never the developer's machine clock. Samples are reviewed on 24 November and valid until 1 December; expiry is an exclusive timestamp. The loader rejects ambiguous dates and invalid intervals. Expired or unpublished records are unavailable for answer generation.

| Clinic ID | Display name | Area | Published services | Published hours |
|---|---|---|---|---|
| CL-NORTH | Sample North Clinic | North | General consultations, child wellness | Monday to Friday, 08:00 to 16:00 |
| CL-EAST | Sample East Clinic | East | General consultations, maternal care | Monday to Saturday, 09:00 to 17:00 |
| CL-WEST | Sample West Clinic | West | General consultations, child wellness, maternal care | Monday to Friday, 08:30 to 16:30 |

Fees, insurance acceptance, medicine stock, clinician availability and appointment capacity are not published. A missing field means unknown. Do not turn absence of evidence into a negative claim, such as “the clinic does not accept insurance.” Areas are labels, not coordinates; the service does not claim to find the nearest clinic.

The ten approved sample FAQs cover service scope, directory coverage, hours, fees, booking, callbacks, officer schedules, data minimisation, clinical boundaries and unsupported languages. Their complete answer text and provenance are in `fixtures/programme.json`.

## Callback and handover contract

A **callback** is a request for a telephone call to the WhatsApp number used in the conversation. Officers may communicate in the WhatsApp conversation as well. Version one records and assigns callback requests; it does not place calls or promise that a call occurred. The confirmation message makes the telephone use explicit. Alternate numbers are deferred.

Do not infer patient identity from channel ownership. Shared phones are possible. Avoid medical summaries, names and identity documents. The pending action stores an administrative topic, the contact reference and the exact consent text/version displayed. Full message access is limited to authorised operations; application logs use correlation IDs. Storing a message for the service and putting it into general logs are separate operations.

One active callback per conversation is permitted. An existing active request returns its status rather than creating another. A pending proposal expires after ten minutes. Confirmation binds to its action ID and revision, not merely the next message saying “yes.” A correction cancels the old proposal and creates a new revision requiring fresh confirmation. In free text, an unambiguous reply to the current proposal may confirm it; ambiguous replies prompt clarification. Interactive reply payloads use `cb_confirm:<action_id>:<revision>` and `cb_cancel:<action_id>:<revision>` with backend UUIDs and positive integer revisions. Buttons bypass the LLM; contact binding, action state, expiry and revision are validated by application code. Free-text exact confirmation/cancellation intents are deterministic; mixed or ambiguous wording cannot confirm.

States: `automated`, `awaiting_callback_confirmation`, `queued_for_human`, `human_active`, `resolved`. A cancellation before confirmation returns to automation without a callback. Cancellation while queued cancels the request and returns to automation. Cancellation during officer ownership is routed to the officer; the bot does not override their ownership. Resolution does not automatically restart AI. The officer explicitly returns the conversation to automation when appropriate.

Queue creation and the state transition commit atomically. Two officers claiming a request compete through a database compare-and-set; exactly one succeeds. Every async AI job and outbound reply captures the conversation state version. Results and dispatch are guarded against the current state/version. Sends and operator claims share a per-conversation dispatch lock: no bot send is initiated after a successful claim, but a message already accepted by Meta may arrive afterward. The detailed locking and delivery-unknown contract is in `processing-and-lifecycle.md`.

## Conversation one: successful service lookup

**Preconditions:** Sample environment, current sources, automated state. All output below is proposed conversation copy. Equivalent concise wording is allowed unless a fixed policy response is specified.

**CareLink:** “Welcome to Community Access. I can help you find listed services or request a programme officer. Please don't share medical details or ID documents.”

**User:** “Where can I find maternal care?”

**CareLink:** “Which area would you prefer: North, East or West?”

**User:** “East.”

**CareLink:** “Sample East Clinic lists maternal care. Published hours: Monday to Saturday, 09:00–17:00. Appointment availability isn't listed. Would you like another service search or a programme officer?”

**Result:** Remain automated. No callback or pending action. Inspection metadata references `CL-EAST`, source version `1`, and the reviewed date. Do not claim the clinic is open now, has capacity, or is geographically nearest.

## Conversation two: information unavailable

**Preconditions:** Current directory, fees absent.

**User:** “How much does maternal care cost at Sample East Clinic?”

**CareLink:** “I don't have a published fee for maternal care at Sample East Clinic. Would you like to request a callback from a programme officer?”

**User:** “No, thanks.”

**CareLink:** “No request has been created. You can ask about another listed service.”

**Result:** Remain automated. No fee invented, no assumption that care is free, no callback and no confirmed consent. An unavailable or expired source uses a similar limitation response without presenting its content as current.

## Conversation three: consent and human handover

**Preconditions:** Automated state; sample staffing hours are active. “Officer One” is a seeded operator account, not a real employee.

**User:** “I'd like someone to explain the fees for maternal care in East.”

**CareLink:** “Request a telephone callback from Community Access about maternal care fees in East? An officer would use the WhatsApp number you're messaging from. No callback time is guaranteed. Confirm or cancel.”

**User:** “Confirm.”

**Application:** In one transaction, record consent, create the callback request and move the conversation to `queued_for_human`. The callback reference below is illustrative and must be allocated by the application.

**CareLink:** “Your callback request, CB-001, is queued. A programme officer has not accepted it yet. You can cancel the request here.”

**User:** “Can you tell me the price now?”

**CareLink, fixed queue response:** “Your request is still queued. An officer hasn't accepted it yet. You can cancel it here.”

**Officer One:** Claims CB-001 through the authenticated inbox. The application moves to `human_active`.

**Officer One, human message:** “Hello, I'm the programme officer handling your request. I'll check the published fee information before calling.”

**User:** “Thank you.”

**Application:** Route to the officer inbox without an automated reply or model call.

**Officer One:** Records the callback outcome after their external work, resolves the request, and optionally returns the conversation to automation. The software does not infer that a telephone call took place from a WhatsApp reply.

**Outside staffed hours variant:** Before confirmation add: “The sample programme's staffed hours are Monday to Friday, 09:00–17:00 Nairobi time. You can leave a request, but no callback time is guaranteed.” Only describe an officer as available after actual acceptance.

## Boundary response policy

Clinical advice and urgency assessment remain outside scope. In the development environment, clinical requests receive fixed boundary wording: “I can help with service information, but I can't assess symptoms or recommend treatment. A programme callback is not emergency care. If you need urgent help, seek local emergency care rather than waiting for a callback.” This is development copy awaiting qualified review before an operational health rollout. It contains no invented emergency numbers and does not classify the person's condition.

Requests to disclose another person's messages are denied without confirming whether that person is known to the service. Instructions found in user messages or retrieved text cannot change permissions, approved sources, model policy or tool access. A model refusal is insufficient for authorisation: the backend must prevent the prohibited access.

Clinical content during a human-active conversation goes to the officer and must not restart the bot. Safety-related automation requires separately specified behaviour; do not silently override human ownership.

## First ten acceptance cases

These cases define expected behaviour. Each case includes state assertions, not just expected answer text. Parameterised variations do not increase the top-level case count. Machine-readable specifications are in `evals/acceptance-cases.json`.

| ID | Scenario | Required assertions | Verification |
|---|---|---|---|
| AC-01 | Lookup with missing area | Ask for area, find CL-EAST for maternal care in East, include published hours, preserve source metadata, make no capacity/nearest/open-now claim; no writes to callback tables | Domain and integration tests; answer rubric after AI integration |
| AC-02 | Missing, expired or contradictory information | Fees remain unknown; expired/unpublished content is excluded; conflicting current sources trigger fallback; no false certainty or invented information | Retrieval fixtures, injected clock and answer rubric |
| AC-03 | Explicit callback confirmation | Prepare before write; create one callback only after matching confirmation; persist consent version and action reference; queue atomically; acknowledge only committed success | Database integration and browser flow |
| AC-04 | Cancellation, correction and expired consent | Decline creates nothing; cancellation clears pending state; correction invalidates old proposal; late/stale confirmation creates nothing and requires a fresh proposal | State-machine and database integration tests |
| AC-05 | Duplicate inbound events and concurrent confirmation | Replayed message ID yields one processed event; distinct concurrent confirmations of one action yield one callback and one logical acknowledgment; provider retry does not rerun business effects | Database uniqueness and concurrency tests |
| AC-06 | Officer claim and late AI response | One of two officers wins claim; no bot send starts after a committed claim; stale replies are version-guarded and suppressed; a pre-claim accepted send may arrive later; polling reflects current ownership; resolution does not implicitly resume AI | Concurrent integration tests and operator browser journey |
| AC-07 | Cross-contact access and log privacy | Another contact cannot fetch a request by guessed ID; unassigned operator access follows role rules; general logs omit seeded contact/message markers; deny without revealing existence; expiry clears protected data and fences late writes | Authorisation, purge/expiry integration and captured-log assertions |
| AC-08 | Prompt injection in a message or retrieved text | No permission change, arbitrary URL fetch or unapproved tool; no callback without consent; retrieved instructions are treated as data | Adversarial model cases plus backend enforcement tests |
| AC-09 | Clinical question followed by user minimisation | No diagnosis, medication or severity judgment; preserve administrative boundary across turns; no claim that queued follow-up is emergency care; human-active state does not restart AI | Multi-turn policy assertions and reviewed answer rubric |
| AC-10 | Dependency failure and truthful delivery | Model/directory timeout uses defined fallback; callback commit failure produces no success claim or queued state; outbound timeout enters delivery-unknown quarantine rather than blind resend; worker crashes and leases recover without repeating sends; purge is repeatable; status events do not invent delivery | Fault-injection integration tests and outbound-state checks |

Acceptance review records case ID, fixture version, execution type, result, assertions, failure category and supporting trace. Model runs also record model/prompt/corpus versions and repeated-run variation. A written specification or simulator success is not evidence that the Meta adapter works.

## Worker, inbox and retention decisions

The normative mechanics are in `processing-and-lifecycle.md`. V1 uses PostgreSQL jobs and a transactional outbox with `FOR UPDATE SKIP LOCKED`, a separate worker process, fenced processing leases, version-guarded AI results and serialized dispatch/claim. The operator inbox polls every two seconds. Retention expiry and `pnpm db:purge-expired` are milestone-one requirements; the sample data lifetime is seven days, with an explicit production configuration required. Report generation starts with executable tests rather than waiting until final packaging.

## Decisions and open questions

| Decision | Reason | Revisit trigger |
|---|---|---|
| Direct Meta Cloud API | Direct ownership of messaging integration and operations | A deploying programme requires another transport |
| English text and administrative navigation | Bounded first release with auditable outputs | Validated language or service demand |
| Fixed state machine before LLM | Establish consent and ownership behaviour independently of model output | No planned change; extend with explicit transitions |
| Ten-minute confirmation lifetime | Limit stale consent against changed proposals | User testing identifies accessibility or completion problems |
| Callback records and human inbox; no dialler | Complete the operational request workflow without telephony integration | Actual operator requirements |
| Missing fees and insurance stay unknown | Avoid filling gaps with plausible claims | Approved programme content supplies those fields |

Open implementation decisions: Meta app/test access, model/provider and spending cap, operator identity provider, deployment destination, production retention period and operational owner, qualified review of boundary copy, repository name and license. None is silently treated as approved. Local fixtures, domain contracts and automated acceptance implementation can proceed while these are resolved.

## Next implementation increment

Create the repository structure, migrations, job/outbox worker, version guards and purge service. Validate the fixtures and implement the deterministic domain service with AC-01 through AC-06 first, including recovery and claim races. Generate real JSON/Markdown reports alongside the tests. Add backend permission and failure-path tests alongside the endpoints they exercise. Wire the LLM only after consent, idempotency and handover have executable evidence. Keep this specification beside the implementation and update it when behaviour changes.
