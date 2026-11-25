CREATE TABLE conversations (
 id uuid PRIMARY KEY, lock_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 contact_key text, contact_ref text,
 state text NOT NULL DEFAULT 'automated' CHECK (state IN ('automated','awaiting_callback_confirmation','queued_for_human','human_active','resolved')),
 state_version integer NOT NULL DEFAULT 1 CHECK(state_version > 0),
 input_seq integer NOT NULL DEFAULT 0, processed_seq integer NOT NULL DEFAULT 0,
 officer_id text, context jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL, retention_expires_at timestamptz NOT NULL,
 purged_at timestamptz
);
CREATE INDEX conversation_contact ON conversations(contact_key, created_at DESC);
CREATE TABLE inbound_events (
 id uuid PRIMARY KEY, event_key text NOT NULL UNIQUE, conversation_id uuid REFERENCES conversations(id),
 sequence integer, body text, status text NOT NULL DEFAULT 'pending',
 created_at timestamptz NOT NULL, retention_expires_at timestamptz NOT NULL,
 tombstone_expires_at timestamptz NOT NULL,
 UNIQUE(conversation_id, sequence)
);
CREATE TABLE jobs (
 id uuid PRIMARY KEY, job_key text UNIQUE NOT NULL, kind text NOT NULL CHECK(kind IN ('process','purge')),
 conversation_id uuid REFERENCES conversations(id), event_id uuid REFERENCES inbound_events(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','dead_letter','expired')),
 attempts integer NOT NULL DEFAULT 0, run_after timestamptz NOT NULL,
 lease_token uuid, lease_until timestamptz, error_code text,
 retention_expires_at timestamptz NOT NULL
);
CREATE INDEX claimable_jobs ON jobs(run_after) WHERE status IN ('pending','running');
CREATE TABLE actions (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id), revision integer NOT NULL CHECK(revision > 0),
 summary text, consent_text text, consent_version text NOT NULL DEFAULT 'callback-v1',
 status text NOT NULL CHECK(status IN ('pending','confirmed','cancelled','expired')),
 expires_at timestamptz NOT NULL, retention_expires_at timestamptz NOT NULL,
 UNIQUE(conversation_id,id,revision)
);
CREATE UNIQUE INDEX one_pending_action ON actions(conversation_id) WHERE status='pending';
CREATE TABLE callbacks (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id), action_id uuid NOT NULL UNIQUE REFERENCES actions(id),
 summary text, consent_text text, consent_version text NOT NULL,
 status text NOT NULL CHECK(status IN ('queued','claimed','resolved','cancelled','expired')),
 confirmed_at timestamptz NOT NULL, retention_expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX one_active_callback ON callbacks(conversation_id) WHERE status IN ('queued','claimed');
CREATE TABLE outbox (
 id uuid PRIMARY KEY, logical_key text UNIQUE NOT NULL, conversation_id uuid NOT NULL REFERENCES conversations(id),
 body text, kind text NOT NULL CHECK(kind IN ('fixed','ai','prompt','queue','officer')),
 expected_version integer NOT NULL, required_state text NOT NULL,
 action_id uuid REFERENCES actions(id), action_revision integer, officer_id text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','dispatching','accepted','delivered','read','failed','delivery_unknown','suppressed','expired')),
 provider_id text UNIQUE, attempt_id uuid, started_at timestamptz, error_code text,
 created_at timestamptz NOT NULL, retention_expires_at timestamptz NOT NULL
);
CREATE INDEX pending_outbox ON outbox(created_at) WHERE status='pending';
CREATE TABLE send_attempts (
 id uuid PRIMARY KEY, outbox_id uuid NOT NULL REFERENCES outbox(id),
 status text NOT NULL, started_at timestamptz NOT NULL, completed_at timestamptz, error_code text
);
CREATE TABLE operator_commands (
 command_id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id),
 officer_id text NOT NULL, kind text NOT NULL, result jsonb NOT NULL
);
CREATE TABLE inbox_changes (
 revision bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 conversation_id uuid NOT NULL REFERENCES conversations(id), changed_at timestamptz NOT NULL,
 tombstone boolean NOT NULL DEFAULT false
);
CREATE TABLE audit_counts (
 day date NOT NULL, category text NOT NULL, outcome text NOT NULL,
 count bigint NOT NULL, PRIMARY KEY(day,category,outcome)
);
