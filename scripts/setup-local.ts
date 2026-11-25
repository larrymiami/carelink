import { randomBytes } from "node:crypto";
import { readFile, writeFile, appendFile } from "node:fs/promises";
const secret = () => randomBytes(32).toString("hex");
const content = `DATABASE_URL=postgres://carelink:${secret()}@127.0.0.1:55432/postgres\nAPP_MODE=sample\nPORT=3001\nSAMPLE_API_TOKEN=${secret()}\nOPERATOR_API_TOKEN=${secret()}\nOPERATOR_2_API_TOKEN=${secret()}\nEVENT_HMAC_KEY=${secret()}\nRETENTION_DAYS=7\n`;
try {
  await writeFile(".env", content, { flag: "wx", mode: 0o600 });
  console.log("Local sample configuration created. Secrets were not printed.");
} catch (e) {
  if ((e as NodeJS.ErrnoException).code === "EEXIST")
    console.log("Existing .env retained.");
  else throw e;
}
const existing = await readFile(".env", "utf8");
const additional: Record<string, string> = {
  API_BASE_URL: "http://127.0.0.1:3001",
  WEB_ORIGIN: "http://127.0.0.1:3000",
  SESSION_SECRET: secret(),
  DEMO_LOGIN_PASSWORD: secret(),
  COOKIE_SECURE: "false",
};
const missing = Object.entries(additional).filter(
  ([key]) => !new RegExp("^" + key + "=", "m").test(existing),
);
if (missing.length) {
  await appendFile(
    ".env",
    "\n" + missing.map(([key, value]) => `${key}=${value}`).join("\n") + "\n",
  );
  console.log(
    "Missing local web configuration added; existing settings retained.",
  );
}
