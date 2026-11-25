import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";
const password = () =>
  JSON.parse(readFileSync(".tmp/browser-credentials.json", "utf8")).password;
async function send(page: Page, text: string) {
  await page.getByLabel("Your message", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
}
async function login(page: Page, officer = "Officer One") {
  await page.goto("/login");
  await page.getByLabel("Officer", { exact: true }).click();
  await page.getByRole("option", { name: officer, exact: true }).click();
  await page.getByLabel("Workspace password").fill(password());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/inbox$/);
}
async function queue(page: Page) {
  await page.goto("/");
  await send(page, "Request a callback about maternal care fees in East.");
  await page
    .getByRole("button", { name: "Confirm callback", exact: true })
    .click();
  await expect(
    page.getByText("Queued for an officer", { exact: true }),
  ).toBeVisible();
  return await page.getByTestId("conversation-reference").innerText();
}
test("AC-01/base service lookup clarifies and exposes source provenance", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Find maternal care", exact: true })
    .click();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("North, East or West");
  await send(page, "East");
  await expect(page.getByRole("log")).toContainText(
    "Sample East Clinic lists maternal care",
  );
  await expect(
    page.getByText("directory:CL-EAST", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".tmp/ui/simulator-desktop.png",
    fullPage: true,
  });
});
test("AC-02/missing_fee honest fallback does not create a request", async ({
  page,
}) => {
  await page.goto("/");
  await send(page, "How much does maternal care cost in East?");
  await expect(page.getByRole("log")).toContainText(
    "don't have published fees",
  );
  await expect(page.getByText("Automated", { exact: true })).toBeVisible();
});
test("AC-03/base callback confirmation, officer handover, reply and resolution", async ({
  page,
  browser,
}) => {
  const reference = await queue(page);
  const context = await browser.newContext();
  const operator = await context.newPage();
  try {
    await login(operator);
    await operator
      .getByRole("button", {
        name: "Open conversation " + reference,
        exact: true,
      })
      .click();
    await operator
      .getByRole("button", { name: "Claim conversation", exact: true })
      .click();
    await expect(operator.getByLabel("Reply to service seeker")).toBeVisible();
    await operator.screenshot({
      path: ".tmp/ui/operator-desktop.png",
      fullPage: true,
    });
    await page.bringToFront();
    await expect(
      page.getByText("Officer active", { exact: true }),
    ).toBeVisible();
    await send(page, "Thank you, I will wait for the officer.");
    await operator.bringToFront();
    await expect(operator.getByRole("log")).toContainText(
      "Thank you, I will wait for the officer.",
    );
    await operator
      .getByLabel("Reply to service seeker")
      .fill("I am checking the published fee information.");
    await operator
      .getByRole("button", { name: "Send reply", exact: true })
      .click();
    await page.bringToFront();
    await expect(page.getByRole("log")).toContainText(
      "I am checking the published fee information.",
    );
    await operator.bringToFront();
    await operator
      .getByRole("button", { name: "Resolve", exact: true })
      .click();
    await expect(
      operator.getByRole("button", {
        name: "Return to automation",
        exact: true,
      }),
    ).toBeVisible();
    await page.bringToFront();
    await expect(page.getByLabel("Your message")).toBeDisabled();
    await operator.bringToFront();
    await operator
      .getByRole("button", { name: "Return to automation", exact: true })
      .click();
    await page.bringToFront();
    await expect(page.getByText("Automated", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
test("AC-04/cancel_pending cancel creates no queued request", async ({
  page,
}) => {
  await page.goto("/");
  await send(page, "Request a callback");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("log")).toContainText(
    "No callback request has been created.",
  );
  await expect(page.getByText("Automated", { exact: true })).toBeVisible();
});
test("AC-06/two_operator_claims competing sessions yield one owner", async ({
  page,
  browser,
}) => {
  const reference = await queue(page);
  const contexts: BrowserContext[] = [
    await browser.newContext(),
    await browser.newContext(),
  ];
  const operators = await Promise.all(contexts.map((c) => c.newPage()));
  try {
    await login(operators[0], "Officer One");
    await login(operators[1], "Officer Two");
    for (const p of operators) {
      await p
        .getByRole("button", {
          name: "Open conversation " + reference,
          exact: true,
        })
        .click();
      await expect(
        p.getByRole("button", { name: "Claim conversation", exact: true }),
      ).toBeVisible();
    }
    await Promise.all(
      operators.map((p) =>
        p
          .getByRole("button", { name: "Claim conversation", exact: true })
          .click(),
      ),
    );
    await expect
      .poll(async () => {
        const values = await Promise.all(
          operators.map((p) => p.getByLabel("Reply to service seeker").count()),
        );
        return values.reduce((a, b) => a + b, 0);
      })
      .toBe(1);
    const loser = (await operators[0]
      .getByLabel("Reply to service seeker")
      .count())
      ? operators[1]
      : operators[0];
    await expect(
      loser.getByRole("alert", { name: "Workspace status" }),
    ).toBeVisible();
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
test("AC-06/poll_error_and_refocus inbox exposes stale state and recovers", async ({
  page,
}) => {
  await login(page);
  await page.route("**/api/operator/inbox?*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "service_unavailable" }),
    }),
  );
  await page
    .getByRole("button", { name: "Refresh inbox", exact: true })
    .click();
  await expect(
    page.getByRole("alert", { name: "Workspace status" }),
  ).toContainText("out of date");
  await page.unroute("**/api/operator/inbox?*");
  await page
    .getByRole("button", { name: "Refresh inbox", exact: true })
    .click();
  await expect(
    page.getByRole("alert", { name: "Workspace status" }),
  ).toHaveCount(0);
});
test("AC-07/contact_B_guesses_contact_A_request sessions isolate contacts and keep API tokens server-side", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await send(page, "maternal care in East");
  await expect(page.getByRole("log")).toContainText("Sample East Clinic");
  const state = await (await page.request.get("/api/simulator")).json();
  const context = await browser.newContext();
  try {
    const other = await context.request.get("/api/simulator");
    expect((await other.json()).conversation).toBeNull();
    const denied = await context.request.get(
      `/api/operator/conversations/${state.conversation.id}`,
    );
    expect(denied.status()).toBe(401);
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "carelink_simulator")?.httpOnly).toBe(
      true,
    );
    expect(cookies.some((c) => /token/i.test(c.name))).toBe(false);
    const csrf = await page.request.post("/api/simulator", {
      headers: { Origin: "https://untrusted.invalid" },
      data: { action: "reset" },
    });
    expect(csrf.status()).toBe(403);
  } finally {
    await context.close();
  }
});
test("mobile simulator remains within viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByLabel("Your message")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".tmp/ui/simulator-mobile.png",
    fullPage: true,
  });
});
test("AC-07/expired_content_cleared simulator removes cached transcript on expiry", async ({
  page,
}) => {
  await page.goto("/");
  await send(page, "maternal care in East");
  await expect(page.getByRole("log")).toContainText("Sample East Clinic");
  await page.route("**/api/simulator", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status: 410,
          contentType: "application/json",
          body: JSON.stringify({ error: "content_expired" }),
        })
      : route.continue(),
  );
  await expect(
    page.getByRole("alert", { name: "Workspace status" }),
  ).toContainText("expired");
  await expect(page.getByRole("log")).not.toContainText("Sample East Clinic");
});
