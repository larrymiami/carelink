"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { LockOutlined } from "@mui/icons-material";
import { errorLabel, request } from "./shared";
export default function Login() {
  const [officer, setOfficer] = useState("officer-one"),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <div className="login-wrap">
      <div className="eyebrow">PROGRAMME OPERATIONS</div>
      <div className="login-card">
        <div className="empty-icon" style={{ margin: "0 0 20px" }}>
          <LockOutlined />
        </div>
        <Typography variant="h5" component="h1">
          Your team's inbox.
        </Typography>
        <Typography
          color="text.secondary"
          sx={{ fontSize: 13, lineHeight: 1.8, mt: 1, mb: 3 }}
        >
          Sign in to pick up requests, speak with service seekers and coordinate
          follow-up.
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await request("/api/session", { officer, password });
              setPassword("");
              router.push("/inbox");
              router.refresh();
            } catch (e) {
              setError(errorLabel(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Stack spacing={2}>
            <TextField
              select
              label="Officer"
              value={officer}
              onChange={(e) => setOfficer(e.target.value)}
            >
              <MenuItem value="officer-one">Officer One</MenuItem>
              <MenuItem value="officer-two">Officer Two</MenuItem>
            </TextField>
            <TextField
              label="Workspace password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Button
              type="submit"
              variant="contained"
              disabled={busy || !password}
            >
              Sign in
            </Button>
          </Stack>
        </form>
        <Typography
          color="text.secondary"
          sx={{ fontSize: 11, mt: 2.5, lineHeight: 1.8 }}
        >
          Local sample access uses the workspace password configured by the
          maintainer. API credentials stay on the server.
        </Typography>
      </div>
    </div>
  );
}
