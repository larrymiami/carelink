"use client";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  CheckCircleOutlineRounded,
  InboxOutlined,
  LogoutRounded,
  RefreshRounded,
  SendRounded,
} from "@mui/icons-material";
import {
  Conversation,
  errorLabel,
  request,
  SampleNotice,
  StateChip,
  Transcript,
  usePoll,
} from "./shared";
type Item = {
  revision: string;
  conversation_id: string;
  state: string;
  state_version: number;
  officer_id: string | null;
  summary: string | null;
  tombstone?: boolean;
};
export default function Inbox({ officer }: { officer: string }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<Conversation | null>(null),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("all");
  const records = useRef(new Map<string, Item>()),
    cursor = useRef("0"),
    selection = useRef<string | null>(null),
    epoch = useRef(0),
    commands = useRef(new Map<string, string>()),
    refreshing = useRef(false);
  const select = useCallback((id: string | null) => {
    epoch.current++;
    selection.current = id;
    setSelected(id);
    setDetail(null);
    setText("");
  }, []);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      for (let page = 0; page < 10; page++) {
        const data = await request(
          "/api/operator/inbox?cursor=" + cursor.current,
        );
        for (const item of data.items as Item[]) {
          const prior = records.current.get(item.conversation_id);
          if (prior && BigInt(prior.revision) >= BigInt(item.revision))
            continue;
          if (item.tombstone) {
            records.current.delete(item.conversation_id);
            if (selection.current === item.conversation_id) {
              select(null);
            }
          } else records.current.set(item.conversation_id, item);
        }
        if (BigInt(data.cursor) > BigInt(cursor.current))
          cursor.current = data.cursor;
        if (data.items.length < 100) break;
      }
      setItems(
        [...records.current.values()].sort((a, b) =>
          BigInt(a.revision) > BigInt(b.revision) ? -1 : 1,
        ),
      );
      const id = selection.current,
        version = epoch.current;
      if (id) {
        try {
          const data = await request("/api/operator/conversations/" + id);
          if (id === selection.current && version === epoch.current)
            setDetail((prior) =>
              prior &&
              prior.id === data.id &&
              (prior.state_version ?? 0) > data.state_version
                ? prior
                : data,
            );
        } catch (e: any) {
          if ([404, 410].includes(e.status)) {
            records.current.delete(id);
            select(null);
            setItems([...records.current.values()]);
          }
          throw e;
        }
      }
      setError("");
    } catch (e: any) {
      if (e.status === 401) {
        records.current.clear();
        cursor.current = "0";
        setItems([]);
        select(null);
      }
      setError(errorLabel(e));
      throw e;
    } finally {
      refreshing.current = false;
    }
  }, [select]);
  const updated = usePoll(refresh);
  async function command(action: "claim" | "reply" | "resolve" | "resume") {
    if (!detail || busy) return;
    setBusy(true);
    const id = detail.id,
      key = id + ":" + action + (action === "reply" ? ":" + text : "");
    const commandId = commands.current.get(key) ?? crypto.randomUUID();
    commands.current.set(key, commandId);
    try {
      await request(
        `/api/operator/conversations/${id}/${action}`,
        action === "claim"
          ? { commandId, expectedVersion: detail.state_version }
          : action === "reply"
            ? { commandId, text }
            : { commandId },
      );
      commands.current.delete(key);
      if (action === "reply") setText("");
      await refresh();
      setError("");
    } catch (e) {
      await refresh().catch(() => {});
      setError(errorLabel(e));
    } finally {
      setBusy(false);
    }
  }
  const visible = items
    .filter(
      (item) =>
        item.state === "queued_for_human" || item.officer_id === officer,
    )
    .filter(
      (item) =>
        filter === "all" ||
        (filter === "queued"
          ? item.state === "queued_for_human"
          : item.officer_id === officer),
    );
  const queued = items.filter((i) => i.state === "queued_for_human").length,
    mine = items.filter(
      (i) => i.officer_id === officer && i.state === "human_active",
    ).length;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PROGRAMME OPERATIONS</div>
          <Typography component="h1" variant="h3">
            Every request, a next step.
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: 13, mt: 1 }}>
            Pick up a conversation and help someone move forward.
          </Typography>
        </div>
        <Stack direction="row" spacing={1}>
          <Chip
            label={officer === "officer-one" ? "Officer One" : "Officer Two"}
            variant="outlined"
          />
          <Button
            size="small"
            color="inherit"
            startIcon={<LogoutRounded />}
            onClick={async () => {
              try {
                await request("/api/session", undefined, "DELETE");
                router.push("/login");
                router.refresh();
              } catch (e) {
                setError(errorLabel(e));
              }
            }}
          >
            Sign out
          </Button>
        </Stack>
      </div>
      <SampleNotice />
      {error && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          role="alert"
          aria-label="Workspace status"
        >
          {error} Your last view may be out of date.
        </Alert>
      )}
      <Stack direction="row" spacing={2} sx={{ mb: 2.5 }}>
        <div className="panel" style={{ padding: "12px 20px", minWidth: 140 }}>
          <Typography color="text.secondary" sx={{ fontSize: 10 }}>
            WAITING FOR AN OFFICER
          </Typography>
          <Typography variant="h5" sx={{ mt: 0.5 }}>
            {queued}
          </Typography>
        </div>
        <div className="panel" style={{ padding: "12px 20px", minWidth: 140 }}>
          <Typography color="text.secondary" sx={{ fontSize: 10 }}>
            YOUR ACTIVE CONVERSATIONS
          </Typography>
          <Typography variant="h5" sx={{ mt: 0.5 }}>
            {mine}
          </Typography>
        </div>
      </Stack>
      <div className="inbox-grid">
        <section className="panel">
          <div className="panel-heading">
            <Typography variant="h6">Conversations</Typography>
            <Button
              size="small"
              aria-label="Refresh inbox"
              startIcon={<RefreshRounded />}
              onClick={() => void refresh().catch(() => {})}
            >
              Refresh
            </Button>
          </div>
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ p: 1.5, borderBottom: "1px solid #e6eae4" }}
          >
            {[
              ["all", "All"],
              ["queued", "Waiting"],
              ["mine", "Yours"],
            ].map(([key, label]) => (
              <Button
                key={key}
                size="small"
                variant={filter === key ? "contained" : "text"}
                sx={{ minWidth: 60, fontSize: 11, minHeight: 30 }}
                onClick={() => setFilter(key)}
              >
                {label}
              </Button>
            ))}
          </Stack>
          <div className="queue-list">
            {!visible.length ? (
              <div
                style={{
                  padding: "35px 22px",
                  color: "#6d7c72",
                  fontSize: 12,
                  lineHeight: 1.8,
                }}
              >
                No requests here yet. Start a callback request in the simulator
                to see the handover.
              </div>
            ) : (
              visible.map((item) => (
                <button
                  key={item.conversation_id}
                  className={
                    "queue-item " +
                    (selected === item.conversation_id ? "selected" : "")
                  }
                  onClick={() => {
                    select(item.conversation_id);
                    void refresh().catch(() => {});
                  }}
                  aria-label={
                    "Open conversation " + item.conversation_id.slice(0, 8)
                  }
                >
                  <Stack
                    direction="row"
                    sx={{
                      alignItems: "center",
                      justifyContent: "space-between",
                      mb: 1,
                    }}
                  >
                    <strong style={{ fontSize: 12 }}>
                      Request {item.conversation_id.slice(0, 8)}
                    </strong>
                    <span style={{ fontSize: 9, color: "#768371" }}>
                      {item.officer_id ? "Yours" : "Waiting"}
                    </span>
                  </Stack>
                  <Typography
                    color="text.secondary"
                    sx={{ fontSize: 12, lineHeight: 1.7 }}
                  >
                    {item.summary ?? "Programme support conversation"}
                  </Typography>
                  <div style={{ marginTop: 12 }}>
                    <StateChip state={item.state} />
                  </div>
                </button>
              ))
            )}
          </div>
          <div
            style={{
              padding: 15,
              borderTop: "1px solid #e6eae4",
              fontSize: 10,
              color: "#71816f",
            }}
          >
            <span className="status-dot" />
            {updated
              ? "Last refreshed " + updated.toLocaleTimeString("en-GB")
              : "Connecting…"}
          </div>
        </section>
        <section className="panel conversation-panel">
          {!detail ? (
            <div className="empty-state">
              <div>
                <div className="empty-icon">
                  <InboxOutlined />
                </div>
                <Typography variant="h6">
                  A little context goes a long way.
                </Typography>
                <Typography
                  color="text.secondary"
                  sx={{ fontSize: 13, mt: 1, maxWidth: 340, lineHeight: 1.8 }}
                >
                  Select a request to read the conversation, check its status
                  and take over when you&apos;re ready.
                </Typography>
              </div>
            </div>
          ) : (
            <>
              <div className="panel-heading">
                <div>
                  <Typography variant="h6">
                    Request {detail.id.slice(0, 8)}
                  </Typography>
                  <Typography
                    color="text.secondary"
                    sx={{ fontSize: 11, mt: 0.5 }}
                  >
                    Community Access · English
                  </Typography>
                </div>
                <StateChip state={detail.state} />
              </div>
              {detail.state === "queued_for_human" && (
                <div
                  style={{
                    padding: "14px 20px",
                    background: "#fffaf0",
                    borderBottom: "1px solid #eee6d2",
                  }}
                >
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={2}
                    sx={{
                      alignItems: { xs: "flex-start", sm: "center" },
                      justifyContent: "space-between",
                    }}
                  >
                    <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                      Read the context, then claim this conversation to respond.
                    </Typography>
                    <Button
                      variant="contained"
                      size="small"
                      disabled={busy}
                      onClick={() => void command("claim")}
                    >
                      Claim conversation
                    </Button>
                  </Stack>
                </div>
              )}
              <Transcript conversation={detail} showUnsentOfficerReplies />
              {detail.outbound.some((m) => m.status === "delivery_unknown") && (
                <Alert severity="warning" sx={{ borderRadius: 0 }}>
                  A previous send has an unknown delivery outcome. It has not
                  been automatically resent.
                </Alert>
              )}
              {detail.outbound.some(
                (m) =>
                  m.kind === "officer" &&
                  ["pending", "suppressed", "failed"].includes(m.status ?? ""),
              ) && (
                <Alert severity="info" sx={{ borderRadius: 0, fontSize: 12 }}>
                  Review reply status before continuing. Queued replies may
                  still be waiting; a reply marked suppressed or failed was not
                  sent.
                </Alert>
              )}
              <div className="composer">
                {detail.state === "human_active" ? (
                  <>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void command("reply");
                      }}
                    >
                      <Stack direction="row" spacing={1}>
                        <TextField
                          fullWidth
                          size="small"
                          label="Reply to service seeker"
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          disabled={busy}
                          slotProps={{ htmlInput: { maxLength: 4096 } }}
                        />
                        <Button
                          variant="contained"
                          type="submit"
                          aria-label="Send reply"
                          disabled={!text.trim() || busy}
                          sx={{ minWidth: 44, px: 1 }}
                        >
                          <SendRounded fontSize="small" />
                        </Button>
                      </Stack>
                    </form>
                    <Stack
                      direction="row"
                      sx={{
                        justifyContent: "space-between",
                        alignItems: "center",
                        mt: 1.7,
                      }}
                    >
                      <Typography color="text.secondary" sx={{ fontSize: 10 }}>
                        You own this conversation. Automated replies are paused.
                      </Typography>
                      <Button
                        size="small"
                        color="inherit"
                        startIcon={<CheckCircleOutlineRounded />}
                        disabled={busy}
                        onClick={() => void command("resolve")}
                      >
                        Resolve
                      </Button>
                    </Stack>
                  </>
                ) : detail.state === "resolved" ? (
                  <Stack
                    direction="row"
                    sx={{
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                      Resolved. Automation remains paused.
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => void command("resume")}
                      disabled={busy}
                    >
                      Return to automation
                    </Button>
                  </Stack>
                ) : (
                  <Typography color="text.secondary" sx={{ fontSize: 11 }}>
                    Claim this request before sending a reply.
                  </Typography>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
