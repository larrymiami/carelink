import { NextRequest } from "next/server";
import { z } from "zod";
import {
  backend,
  checkOrigin,
  errorResponse,
  json,
  newSimulator,
  session,
  withCookie,
  WebError,
} from "../../../lib/server";
export async function GET() {
  try {
    const current = await session("simulator");
    if (!current || current.kind !== "simulator" || !current.conversationId)
      return json({ conversation: null });
    return json({
      conversation: await backend(
        `/sample/conversations/${current.conversationId}?contact=${current.contact}`,
        "sample",
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new WebError(400, "invalid_input");
    }
    const parsed = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("reset") }),
        z.object({
          action: z.literal("send"),
          text: z.string().min(1).max(4096),
          eventId: z.uuid(),
        }),
      ])
      .safeParse(body);
    if (!parsed.success) throw new WebError(400, "invalid_input");
    const existing = await session("simulator"),
      current = existing?.kind === "simulator" ? existing : newSimulator();
    if (parsed.data.action === "reset")
      return withCookie(json({ conversation: null }), newSimulator());
    const result = await backend("/sample/messages", "sample", undefined, {
      contact: current.contact,
      eventId: parsed.data.eventId,
      text: parsed.data.text,
    });
    return withCookie(json({ conversationId: result.conversationId }, 202), {
      ...current,
      conversationId: result.conversationId,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
