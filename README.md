# CareLink

CareLink helps community health programmes answer service questions and coordinate human follow-up over WhatsApp.

CareLink includes a conversation simulator and operator inbox backed by administrative service lookup, explicit callback consent and a durable processing worker. It uses PostgreSQL for application data, jobs and the transactional outbox.

## Current capabilities

- Grounded directory lookup using versioned sample clinic data and source-validity checks.
- Strict confirmation/cancellation payloads and deterministic text confirmation.
- Transactional callback creation, event deduplication and per-conversation processing order.
- PostgreSQL `SKIP LOCKED` job claiming, lease tokens, heartbeats and bounded retry/dead-letter handling.
- State-version guards for future async model results and all outbound messages.
- Serialized send initiation and officer claims, with unknown sends quarantined instead of automatically repeated.
- Token-protected sample and operator APIs, incremental inbox changes and explicit resolution/resumption.
- Retention guards, repeatable purge, pseudonymous deduplication tombstones and aggregate audit counts.
- JSON/Markdown verification reports generated from actual automated test results.
- A responsive Next.js and Material UI workspace with source inspection, confirmation buttons and transcript status.
- A two-second polling inbox with officer sign-in, claim conflicts, replies, resolution and explicit return to automation.
- Server-managed signed sessions and same-origin mutation checks; API tokens stay on the server.

**Development status:** Browser workspace, API and worker implementation with a sample transport. Direct Meta integration and LLM retrieval/evaluations remain upcoming work. No real WhatsApp messages are sent. Sample API routes accept only `sample-*` contact references. The workspace requires explicit sample mode.

## Run locally

Use Node.js 22 or newer and npm. The lockfile pins dependencies. Tests and the optional local database use real PostgreSQL binaries supplied by `embedded-postgres`; no Docker is required. On Linux, run as a regular user. The test binary package is pinned to its PostgreSQL 17 release line; the report records the actual server version. The embedded database helper is for development/testing, not an operational deployment recommendation.

```sh
npm ci
npm run setup:local
npm run db:local
```

Keep the database terminal open. In a second terminal:

```sh
npm run db:migrate
npm run dev
```

In a third terminal:

```sh
npm run worker:dev
```

In a fourth terminal:

```sh
npm run web:dev
```

Open `http://127.0.0.1:3000` for the simulator. The operator inbox is at `/inbox`; choose Officer One or Officer Two and use `DEMO_LOGIN_PASSWORD` from your local `.env`. `setup:local` adds missing web settings to an existing configuration without replacing existing secrets. Keep the URL consistent with `WEB_ORIGIN`, including hostname and port.

The API binds to `127.0.0.1:3001`. Setup generates independent local credentials in an ignored `.env`, without printing them. The web server forwards requests using server-only credentials and binds each simulator session to its own synthetic contact. The workspace password is a local sample login mechanism; production organisation login and role administration remain separate work. Set `COOKIE_SECURE=true` when using HTTPS. Alternatively configure your own PostgreSQL instance and use `.env.example` as a reference. Supported commands are package scripts and can also be invoked with `pnpm run <script>`; npm is the locked installation path.

## Verify

```sh
npm run typecheck
npm run test:report
```

Browser verification requires a production web build and a Playwright browser:

```sh
npm run web:build
npx playwright install chromium
npm run test:browser:report
```

Or run `npm run verify:report` after installing the browser. Browser tests start their own temporary PostgreSQL, API, worker and web server; stop existing services on ports 3000 and 3001 first. Both report types separate executed evidence from remaining model/provider work. On Linux, `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an already installed compatible Chromium binary.

Tests create an isolated temporary PostgreSQL cluster and never use `DATABASE_URL`. `test:report` writes timestamped files under `evals/reports/`. Reports show executed checks separately from missing variant coverage. An incomplete gate is expected while browser/model/provider work remains. No model API keys or tokens are used by this increment.

The sample fixture deliberately includes source expiry. Tests inject a fixed clock; the running service uses real time. Maintain sample review/validity dates when using the directory after its current validity interval; the application must not silently promote expired content to current content.

## API walkthrough

The browser workspace is the primary way to exercise the flow. For direct API work, read sample and operator tokens from your local `.env` using your API client and use bearer authentication. These tokens remain server-side in the web application; the browser uses signed HttpOnly session cookies.

| Request | Purpose |
|---|---|
| `GET /health` | Sample-mode health status; does not claim provider connectivity |
| `POST /sample/messages` | Persist a synthetic inbound event and processing job; returns 202 only after commit |
| `GET /sample/conversations/:id?contact=sample-alice` | Inspect a sample contact's state and outbound results |
| `GET /operator/inbox?cursor=0` | Incremental change feed, up to 100 rows with the next cursor |
| `GET /operator/conversations/:id` | Inspect an unassigned or own conversation |
| `POST /operator/conversations/:id/claim` | Claim using a command UUID and expected state version |
| `POST /operator/conversations/:id/reply` | Queue an assigned officer's reply |
| `POST /operator/conversations/:id/resolve` | Resolve without automatically restarting automation |
| `POST /operator/conversations/:id/resume` | Explicitly return a resolved conversation to automation |

Example inbound JSON:

```json
{"contact":"sample-alice","eventId":"client-generated-unique-event","text":"Where can I find maternal care in East?"}
```

To exercise handover, send “Request a callback about maternal care fees in East.” Inspect the returned conversation once the worker processes it. Its pending prompt has `action_id` and `action_revision`. Send a new event with text `cb_confirm:<action_id>:<action_revision>`. Fetch current `state_version` from the operator detail endpoint and claim with:

```json
{"commandId":"a-new-uuid","expectedVersion":7}
```

Use the version returned by your service, not the illustrative value above. A reply body is `{"text":"I am reviewing your request."}`. A callback is a request for an external telephone call; the API does not place calls or infer a completed call from a WhatsApp reply.

The sample transport records API acceptance, not handset delivery. Its IDs begin with `sample:`. Only provider status evidence can establish delivered/read state when the real adapter is added.

## Data lifecycle

```sh
npm run db:purge-expired -- --dry-run
npm run db:purge-expired
```

The worker also schedules purge every 15 minutes. Sample conversations expire after seven days from creation without automatic extension. Reads and sends enforce expiry before purge runs. Purge clears protected content, invalidates pending work and retains bounded keyed event tombstones. Providers, backups and recipient devices have separate retention boundaries.

## Documentation

- [First release](docs/first-release.md): conversation scripts and acceptance criteria.
- [Processing and lifecycle](docs/processing-and-lifecycle.md): normative queue, locking, consent, polling and purge contracts.
- [Implementation status](docs/implementation-status.md): implemented scope and remaining gaps.
- [Acceptance specifications](evals/acceptance-cases.json): required assertions and variants.

The three clinics and ten FAQs in `fixtures/programme.json` are fictional development data. The administrative router is a bounded deterministic baseline, not a clinical triage or comprehensive safety classifier. Operational health use requires content/policy review and production identity, retention and deployment configuration.

## License

A distribution license has not yet been selected. No open-source license grant is implied by this source package.
