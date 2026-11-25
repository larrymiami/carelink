import { NextRequest } from "next/server";
import {
  checkOrigin,
  errorResponse,
  json,
  safeEqual,
  withCookie,
  WebError,
} from "../../../lib/server";
const attempts = new Map<string, { count: number; until: number }>();
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    if (process.env.APP_MODE !== "sample")
      throw new WebError(403, "sample_mode_required");
    const limit = attempts.get("local") ?? {
      count: 0,
      until: Date.now() + 60000,
    };
    if (limit.until < Date.now()) {
      limit.count = 0;
      limit.until = Date.now() + 60000;
    }
    limit.count++;
    attempts.set("local", limit);
    if (limit.count > 15) throw new WebError(429, "try_again_later");
    const { officer, password } = await request.json();
    const expected = process.env.DEMO_LOGIN_PASSWORD;
    if (
      !expected ||
      expected.length < 16 ||
      typeof password !== "string" ||
      !safeEqual(password, expected) ||
      !["officer-one", "officer-two"].includes(officer)
    )
      throw new WebError(401, "invalid_credentials");
    if (officer === "officer-two" && !process.env.OPERATOR_2_API_TOKEN)
      throw new WebError(401, "invalid_credentials");
    return withCookie(json({ officer }), {
      kind: "operator",
      officer,
      exp: Date.now() + 8 * 3600000,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(request: NextRequest) {
  try {
    checkOrigin(request);
    const r = json({ signedOut: true });
    r.cookies.set("carelink_operator", "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return r;
  } catch (error) {
    return errorResponse(error);
  }
}
