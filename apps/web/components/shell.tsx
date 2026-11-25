"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Chip, Stack } from "@mui/material";
import {
  ChatBubbleOutlineRounded,
  InboxOutlined,
  HubRounded,
  OpenInNewRounded,
} from "@mui/icons-material";
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <HubRounded fontSize="small" />
          </span>
          carelink<span style={{ color: "#d6eb8d" }}>·</span>
        </Link>
        <div>
          <p className="sidebar-label">WORKSPACE</p>
          <nav>
            <Link
              href="/"
              className={"nav-link " + (path === "/" ? "active" : "")}
            >
              <ChatBubbleOutlineRounded fontSize="small" />
              Simulator
            </Link>
            <Link
              href="/inbox"
              className={"nav-link " + (path === "/inbox" ? "active" : "")}
            >
              <InboxOutlined fontSize="small" />
              Operator inbox
            </Link>
          </nav>
          <div className="secondary-nav" style={{ marginTop: 30 }}>
            <p className="sidebar-label">RESOURCES</p>
            <a
              className="nav-link"
              href="https://github.com/larrymiami/carelink"
              target="_blank"
              rel="noreferrer"
            >
              <OpenInNewRounded fontSize="small" />
              Documentation
            </a>
          </div>
        </div>
        <div className="sidebar-foot">
          <span className="avatar">CA</span>
          <span style={{ lineHeight: 1.65, color: "#e7eee7" }}>
            Community Access
            <br />
            <span style={{ fontSize: 10, color: "#b3c6ba" }}>
              Sample programme
            </span>
          </span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            Workspace{" "}
            <span style={{ margin: "0 12px", color: "#bbc5bd" }}>/</span>{" "}
            {path === "/inbox"
              ? "Operator inbox"
              : path === "/login"
                ? "Operator access"
                : "Conversation simulator"}
          </span>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <span>
              <i className="status-dot" />
              Local channel
            </span>
            <Chip label="Sample data" size="small" variant="outlined" />
          </Stack>
        </header>
        <main className="page">{children}</main>
      </div>
    </div>
  );
}
