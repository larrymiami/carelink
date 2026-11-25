import "server-only";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type Session =
  | { kind: "operator"; officer: "officer-one" | "officer-two"; exp: number }
  | {
      kind: "simulator";
      contact: string;
      conversationId?: string;
      exp: number;
    };
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function key() {
  const secret = process.env.SESSION_SECRET;
  if (process.env.APP_MODE !== "sample" || !secret || secret.length < 32)
    throw new Error("Sample web session configuration required");
  return secret;
}
function signature(body: string) {
  return createHmac("sha256", key()).update(body).digest("base64url");
}
export function sign(session: Session) {
  const body = Buffer.from(JSON.stringify(session)).toString("base64url");
  return body + "." + signature(body);
}
export async function session(kind: Session["kind"]): Promise<Session | null> {
  const value = (await cookies()).get(
    kind === "operator" ? "carelink_operator" : "carelink_simulator",
  )?.value;
  if (!value) return null;
  const pieces = value.split(".");
  if (pieces.length !== 2 || !safeEqual(signature(pieces[0]), pieces[1]))
    return null;
  try {
    const data = JSON.parse(Buffer.from(pieces[0], "base64url").toString());
    if (
      data.kind !== kind ||
      !Number.isFinite(data.exp) ||
      data.exp <= Date.now()
    )
      return null;
    if (
      kind === "operator" &&
      !["officer-one", "officer-two"].includes(data.officer)
    )
      return null;
    if (kind === "simulator" && !/^sample-[a-z0-9-]{1,60}$/.test(data.contact))
      return null;
    return data;
  } catch {
    return null;
  }
}
export function newSimulator(): Extract<Session, { kind: "simulator" }> {
  return {
    kind: "simulator",
    contact: "sample-" + randomUUID(),
    exp: Date.now() + 8 * 3600000,
  };
}
export function withCookie(response: NextResponse, data: Session) {
  response.cookies.set(
    data.kind === "operator" ? "carelink_operator" : "carelink_simulator",
    sign(data),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      path: "/",
      maxAge: Math.max(0, Math.floor((data.exp - Date.now()) / 1000)),
    },
  );
  return response;
}
export function json(value: unknown, status = 200) {
  const r = NextResponse.json(value, { status });
  r.headers.set("Cache-Control", "no-store");
  return r;
}
export function checkOrigin(request: NextRequest) {
  if (
    !process.env.WEB_ORIGIN ||
    request.headers.get("origin") !== process.env.WEB_ORIGIN
  )
    throw new WebError(403, "origin_rejected");
}
export class WebError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function errorResponse(error: unknown) {
  if (error instanceof WebError)
    return json({ error: error.code }, error.status);
  return json({ error: "service_unavailable" }, 503);
}
export async function backend(
  path: string,
  mode: "sample" | "operator",
  officer?: string,
  body?: unknown,
) {
  if (process.env.APP_MODE !== "sample")
    throw new WebError(403, "sample_mode_required");
  const token =
    mode === "sample"
      ? process.env.SAMPLE_API_TOKEN
      : officer === "officer-two"
        ? process.env.OPERATOR_2_API_TOKEN
        : process.env.OPERATOR_API_TOKEN;
  if (!token) throw new WebError(503, "service_unavailable");
  const response = await fetch(
    (process.env.API_BASE_URL ?? "http://127.0.0.1:3001") + path,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    },
  );
  const value = await response.json();
  if (!response.ok)
    throw new WebError(response.status, value.error ?? "request_failed");
  return value;
}
