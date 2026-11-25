import { NextRequest } from "next/server";
import {
  backend,
  checkOrigin,
  errorResponse,
  json,
  session,
  WebError,
} from "../../../../lib/server";
type Context = { params: Promise<{ segments: string[] }> };
const id = /^[0-9a-f-]{36}$/i;
async function proxy(request: NextRequest, context: Context) {
  try {
    const current = await session("operator");
    if (!current || current.kind !== "operator")
      throw new WebError(401, "unauthorized");
    const { segments } = await context.params;
    const isGet = request.method === "GET";
    if (!isGet) checkOrigin(request);
    let path: string, body: unknown;
    if (isGet && segments.length === 1 && segments[0] === "inbox") {
      const cursor = request.nextUrl.searchParams.get("cursor") ?? "0";
      if (!/^\d{1,15}$/.test(cursor)) throw new WebError(400, "invalid_input");
      path = "/operator/inbox?cursor=" + cursor;
    } else if (
      segments[0] === "conversations" &&
      id.test(segments[1] ?? "") &&
      ((isGet && segments.length === 2) ||
        (!isGet &&
          segments.length === 3 &&
          ["claim", "reply", "resolve", "resume"].includes(segments[2])))
    ) {
      path = "/operator/" + segments.join("/");
      if (!isGet) body = await request.json();
    } else throw new WebError(404, "not_found");
    return json(await backend(path, "operator", current.officer, body));
  } catch (error) {
    return errorResponse(error);
  }
}
export const GET = proxy;
export const POST = proxy;
