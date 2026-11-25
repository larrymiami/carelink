"use client";
import { useCallback, useRef, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  ArrowForwardRounded,
  ChatBubbleOutlineRounded,
  PhoneCallbackRounded,
  RefreshRounded,
  SendRounded,
  ShieldOutlined,
} from "@mui/icons-material";
import {
  Conversation,
  errorLabel,
  request,
  SampleNotice,
  SourcePanel,
  StateChip,
  Transcript,
  usePoll,
} from "./shared";
export default function Simulator() {
  const [conversation, setConversation] = useState<Conversation | null>(null),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const retry = useRef<{ eventId: string; text: string } | null>(null);
  const generation = useRef(0);
  const requests = useRef(0),
    applied = useRef(0);
  const refresh = useCallback(async () => {
    const before = generation.current,
      sequence = ++requests.current;
    try {
      const data = await request("/api/simulator");
      if (before !== generation.current || sequence < applied.current) return;
      applied.current = sequence;
      const next = data.conversation as Conversation | null;
      setConversation((prior) =>
        next &&
        prior &&
        prior.id === next.id &&
        (prior.stateVersion ?? 0) > (next.stateVersion ?? 0)
          ? prior
          : next,
      );
      setError("");
    } catch (e: any) {
      if (before === generation.current && sequence >= applied.current) {
        if ([404, 410].includes(e.status)) setConversation(null);
        setError(errorLabel(e));
      }
      throw e;
    }
  }, []);
  const updated = usePoll(refresh);
  async function send(value = text) {
    if (busy || !value.trim()) return;
    setBusy(true);
    setError("");
    const submission =
      retry.current?.text === value
        ? retry.current
        : { text: value, eventId: crypto.randomUUID() };
    retry.current = submission;
    try {
      const data = await request("/api/simulator", {
        action: "send",
        ...submission,
      });
      retry.current = null;
      setText("");
      await refresh();
    } catch (e) {
      setError(errorLabel(e));
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    if (busy) return;
    setBusy(true);
    try {
      await request("/api/simulator", { action: "reset" });
      generation.current++;
      setConversation(null);
      retry.current = null;
      setText("");
      setError("");
    } catch (e) {
      setError(errorLabel(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SERVICE CONVERSATIONS</div>
          <Typography component="h1" variant="h3">
            A clearer path to care.
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: 13, mt: 1 }}>
            Explore a service question from the first message to human
            follow-up.
          </Typography>
        </div>
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<RefreshRounded />}
          onClick={reset}
          disabled={busy}
        >
          New conversation
        </Button>
      </div>
      <SampleNotice />
      {error && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          role="alert"
          aria-label="Workspace status"
        >
          {error}{" "}
          <Button size="small" onClick={() => void refresh().catch(() => {})}>
            Refresh
          </Button>
        </Alert>
      )}
      <div className="sim-grid">
        <section className="sim-guide">
          <div className="panel panel-pad">
            <div className="small-label">START A CONVERSATION</div>
            <Typography variant="h6" sx={{ mt: 1, mb: 1 }}>
              What would you like to explore?
            </Typography>
            <Typography
              color="text.secondary"
              sx={{ fontSize: 12, lineHeight: 1.8 }}
            >
              Choose a starting point, or type a question in the conversation.
            </Typography>
            {[
              {
                label: "Find maternal care",
                text: "Where can I find maternal care?",
                icon: <ChatBubbleOutlineRounded fontSize="small" />,
              },
              {
                label: "Ask about fees",
                text: "How much does maternal care cost at Sample East Clinic?",
                icon: <ArrowForwardRounded fontSize="small" />,
              },
              {
                label: "Request a callback",
                text: "Request a callback about maternal care fees in East.",
                icon: <PhoneCallbackRounded fontSize="small" />,
              },
            ].map((item) => (
              <Button
                key={item.label}
                fullWidth
                variant="outlined"
                color="inherit"
                sx={{
                  justifyContent: "flex-start",
                  mt: 1.4,
                  fontSize: 12,
                  borderColor: "#dce5da",
                }}
                startIcon={item.icon}
                onClick={() => setText(item.text)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <div
            className="panel panel-pad"
            style={{ marginTop: 18, background: "#edf2e7" }}
          >
            <ShieldOutlined sx={{ color: "#50794f", mb: 1 }} />
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
              Helpful information.
              <br />A person when you need one.
            </Typography>
            <Typography
              color="text.secondary"
              sx={{ fontSize: 12, lineHeight: 1.8, mt: 1 }}
            >
              CareLink answers from published programme information and asks
              before creating a callback request.
            </Typography>
          </div>
        </section>
        <section className="panel conversation-panel" aria-label="Simulator">
          <div className="panel-heading">
            <Stack direction="row" spacing={1.3} sx={{ alignItems: "center" }}>
              <span className="avatar">
                <ChatBubbleOutlineRounded fontSize="small" />
              </span>
              <div>
                <Typography variant="h6">Community Access</Typography>
                <Typography color="text.secondary" sx={{ fontSize: 10 }}>
                  Service information & programme support
                </Typography>
              </div>
            </Stack>
            <span className="status-dot" />
          </div>
          <Transcript
            conversation={conversation}
            onAction={(value) => void send(value)}
          />
          {conversation?.state === "human_active" && (
            <Alert
              severity="success"
              icon={false}
              sx={{ borderRadius: 0, fontSize: 12 }}
            >
              A programme officer is handling this conversation. Automated
              replies are paused.
            </Alert>
          )}
          <div className="composer">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <Stack direction="row" spacing={1}>
                <TextField
                  fullWidth
                  size="small"
                  label="Your message"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={busy || conversation?.state === "resolved"}
                  slotProps={{ htmlInput: { maxLength: 4096 } }}
                />
                <Button
                  type="submit"
                  variant="contained"
                  aria-label="Send message"
                  disabled={
                    busy || !text.trim() || conversation?.state === "resolved"
                  }
                  sx={{ minWidth: 44, px: 1 }}
                >
                  <SendRounded fontSize="small" />
                </Button>
              </Stack>
            </form>
            <Typography color="text.secondary" sx={{ fontSize: 10, mt: 1.2 }}>
              Service information only. Please do not share medical details or
              ID documents.
            </Typography>
          </div>
        </section>
        <aside>
          <div className="panel panel-pad" style={{ marginBottom: 18 }}>
            <div className="small-label">CONVERSATION STATUS</div>
            <Stack direction="row" sx={{ mt: 1.5, mb: 2 }}>
              <StateChip state={conversation?.state ?? "automated"} />
            </Stack>
            <div className="facts-row">
              <span>Channel</span>
              <strong>Local simulator</strong>
            </div>
            <div className="facts-row">
              <span>Programme</span>
              <strong>Community Access</strong>
            </div>
            <div className="facts-row">
              <span>Human follow-up</span>
              <span>
                {conversation?.state === "human_active"
                  ? "Assigned"
                  : conversation?.state === "queued_for_human"
                    ? "Waiting"
                    : "Not requested"}
              </span>
            </div>
            {conversation && (
              <div className="facts-row">
                <span>Reference</span>
                <code data-testid="conversation-reference">
                  {conversation.id.slice(0, 8)}
                </code>
              </div>
            )}
            <Typography color="text.secondary" sx={{ fontSize: 10, mt: 2 }}>
              {updated
                ? "Last refreshed " + updated.toLocaleTimeString("en-GB")
                : "Connecting to workspace…"}
            </Typography>
          </div>
          <SourcePanel conversation={conversation} />
          <p className="bottom-note">
            Published hours do not confirm current opening or appointment
            availability.
          </p>
        </aside>
      </div>
    </>
  );
}
