"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Chip, Stack, Typography } from "@mui/material";
import { ScienceOutlined } from "@mui/icons-material";
export type Message = {
  id: string;
  body: string | null;
  created_at: string;
  kind?: string;
  status?: string;
  action_id?: string;
  action_revision?: number;
};
export type Conversation = {
  id: string;
  state: string;
  stateVersion?: number;
  state_version?: number;
  officer_id?: string;
  activeAction?: { id: string; revision: number } | null;
  context?: any;
  messages: Message[];
  outbound: Message[];
  retention_expires_at?: string;
};
export const labels: Record<string, string> = {
  automated: "Automated",
  awaiting_callback_confirmation: "Awaiting confirmation",
  queued_for_human: "Queued for an officer",
  human_active: "Officer active",
  resolved: "Resolved",
};
export function StateChip({ state }: { state: string }) {
  return (
    <Chip
      label={labels[state] ?? state}
      size="small"
      sx={{
        bgcolor:
          state === "human_active"
            ? "#deecdc"
            : state === "queued_for_human"
              ? "#fff0d6"
              : "#edf1ec",
        color: state === "queued_for_human" ? "#8d641f" : "#426547",
      }}
    />
  );
}
export function SampleNotice() {
  return (
    <div className="sample-notice">
      <ScienceOutlined fontSize="small" />
      <span>
        Sample workspace. Clinic information is fictional; no real WhatsApp
        messages or calls are sent.
      </span>
    </div>
  );
}
export async function request(path: string, body?: unknown, method?: string) {
  const r = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(data.error ?? "request_failed"), {
      status: r.status,
    });
  return data;
}
export function errorLabel(error: any) {
  return (
    (
      {
        dispatch_in_progress:
          "A message is being sent. Refresh and try the claim again.",
        already_claimed:
          "Another officer has already claimed this conversation.",
        version_conflict:
          "This conversation changed. Refresh before trying again.",
        content_expired:
          "This conversation has expired and its content is unavailable.",
        unauthorized: "Your session has ended. Sign in again.",
        service_unavailable:
          "The service is unavailable. Your last view may be out of date.",
        origin_rejected:
          "This workspace URL does not match its configured origin.",
        invalid_credentials:
          "The workspace password or officer selection is incorrect.",
      } as Record<string, string>
    )[error.message] ?? "The request could not be completed. Please try again."
  );
}
export function usePoll(run: () => Promise<void>, enabled = true) {
  const runRef = useRef(run);
  runRef.current = run;
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true,
      timer: ReturnType<typeof setTimeout>,
      delay = 2000,
      immediate = false;
    const schedule = (wait: number) => {
      clearTimeout(timer);
      if (active) timer = setTimeout(poll, wait);
    };
    const poll = async () => {
      if (!active) return;
      if (document.hidden) {
        schedule(2000);
        return;
      }
      if (busy.current) {
        immediate = true;
        return;
      }
      busy.current = true;
      try {
        await runRef.current();
        if (active) setLastUpdated(new Date());
        delay = 2000;
      } catch {
        delay = Math.min(delay * 2, 30000);
      } finally {
        busy.current = false;
        schedule(immediate ? 0 : delay);
        immediate = false;
      }
    };
    const focus = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        if (busy.current) immediate = true;
        else void poll();
      }
    };
    void poll();
    document.addEventListener("visibilitychange", focus);
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", focus);
      window.removeEventListener("focus", focus);
    };
  }, [enabled]);
  return lastUpdated;
}
function displayText(text: string | null) {
  if (!text) return "";
  if (text.startsWith("cb_confirm:")) return "Confirm callback";
  if (text.startsWith("cb_cancel:")) return "Cancel callback";
  return text;
}
export function Transcript({
  conversation,
  onAction,
  showUnsentOfficerReplies = false,
}: {
  conversation: Conversation | null;
  onAction?: (text: string) => void;
  showUnsentOfficerReplies?: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);
  const messages = [
    ...(conversation?.messages ?? []).map((m) => ({ ...m, direction: "user" })),
    ...(conversation?.outbound ?? [])
      .filter(
        (m) =>
          ["accepted", "delivered", "read"].includes(m.status ?? "") ||
          (showUnsentOfficerReplies &&
            m.kind === "officer" &&
            ["pending", "suppressed", "failed"].includes(m.status ?? "")),
      )
      .map((m) => ({ ...m, direction: "service" })),
  ].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages.length]);
  return (
    <div
      className="chat-surface"
      aria-label="Conversation transcript"
      role="log"
      aria-live="polite"
    >
      <div
        style={{
          textAlign: "center",
          fontSize: 9,
          color: "#73816f",
          letterSpacing: 1,
          marginBottom: 2,
        }}
      >
        COMMUNITY ACCESS · SAMPLE CONVERSATION
      </div>
      {!messages.length && (
        <div className="bubble service">
          Welcome to Community Access. I can help you find listed services or
          request a programme officer. Please don&apos;t share medical details
          or ID documents.<div className="bubble-meta">CARELINK</div>
        </div>
      )}
      {messages.map((m) => (
        <div
          key={m.id}
          className={"bubble " + m.direction}
          data-testid={"message-" + m.id}
        >
          {displayText(m.body)}
          <div className="bubble-meta">
            {m.direction === "user"
              ? "YOU"
              : m.kind === "officer"
                ? "PROGRAMME OFFICER"
                : "CARELINK"}
            {m.direction === "service"
              ? " · " +
                (m.status === "accepted"
                  ? "ACCEPTED BY SAMPLE CHANNEL"
                  : m.status === "pending"
                    ? "QUEUED FOR SEND"
                    : m.status === "suppressed"
                      ? "NOT SENT · CONVERSATION CHANGED"
                      : m.status?.toUpperCase())
              : ""}
          </div>
          {onAction &&
            m.kind === "prompt" &&
            m.action_id === conversation?.activeAction?.id &&
            m.action_revision === conversation?.activeAction?.revision &&
            conversation?.state === "awaiting_callback_confirmation" && (
              <div className="message-actions">
                <Button
                  size="small"
                  variant="contained"
                  onClick={() =>
                    onAction(`cb_confirm:${m.action_id}:${m.action_revision}`)
                  }
                >
                  Confirm callback
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() =>
                    onAction(`cb_cancel:${m.action_id}:${m.action_revision}`)
                  }
                >
                  Cancel
                </Button>
              </div>
            )}
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}
export function SourcePanel({
  conversation,
}: {
  conversation: Conversation | null;
}) {
  const sources = conversation?.context?.sources ?? [];
  return (
    <div className="panel panel-pad">
      <Typography variant="h6" sx={{ mb: 0.6 }}>
        Information sources
      </Typography>
      <Typography color="text.secondary" sx={{ fontSize: 12, lineHeight: 1.7 }}>
        See which published record supports the latest service answer.
      </Typography>
      {!sources.length ? (
        <Typography
          color="text.secondary"
          sx={{ fontSize: 12, ...{ mt: 3, mb: 1 } }}
        >
          Sources appear after a successful service lookup.
        </Typography>
      ) : (
        sources.map((s: any) => (
          <div className="source-card" key={s.id}>
            <strong>{s.id}</strong>
            <div style={{ marginTop: 8, lineHeight: 1.8 }}>
              Version {s.version}
              <br />
              Reviewed {new Date(s.reviewed_at).toLocaleDateString("en-GB")}
              <br />
              Valid until {new Date(s.valid_until).toLocaleDateString("en-GB")}
            </div>
          </div>
        ))
      )}
      <Stack direction="row" spacing={0.7} sx={{ mt: 2 }}>
        <Chip label="Published records" variant="outlined" />
        <Chip label="No live capacity" variant="outlined" />
      </Stack>
    </div>
  );
}
