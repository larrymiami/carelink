import { spawnSync, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
await mkdir(".tmp", { recursive: true });
await mkdir("evals/reports", { recursive: true });
const run = spawnSync(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test"],
  {
    encoding: "utf8",
    timeout: 300000,
    env: process.env,
  },
);
process.stdout.write(run.stdout ?? "");
process.stderr.write(run.stderr ?? "");
let result: any;
try {
  result = JSON.parse(await readFile(".tmp/browser-results.json", "utf8"));
} catch {
  console.error("No browser result was produced; no passing report generated.");
  process.exit(1);
}
const checks: any[] = [];
function walk(suite: any) {
  for (const spec of suite.specs ?? [])
    for (const test of spec.tests ?? []) {
      const last = test.results?.at(-1);
      checks.push({
        name: spec.title,
        case: spec.title.match(/AC-\d+/)?.[0] ?? null,
        variant: spec.title.match(/AC-\d+\/([^ ]+)/)?.[1] ?? null,
        status: last?.status ?? "not_run",
        duration_ms: last?.duration ?? null,
        attempts: test.results?.length ?? 0,
      });
    }
  for (const child of suite.suites ?? []) walk(child);
}
for (const suite of result.suites ?? []) walk(suite);
let commit: string | null = null,
  dirty = true;
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  dirty = Boolean(
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
  );
} catch {}
const report = {
  schema_version: "0.1",
  run_id: new Date().toISOString().replaceAll(":", "-"),
  evidence_type: "browser",
  commit,
  dirty_tree: dirty,
  fixture_clock: "2026-11-25T09:00:00+03:00 plus elapsed time",
  runner_exit_code: run.status,
  overall_gate: "incomplete",
  model_eval: "not_run",
  live_meta: "not_run",
  totals: {
    passed: checks.filter((c) => c.status === "passed").length,
    failed: checks.filter((c) =>
      ["failed", "timedOut", "interrupted"].includes(c.status),
    ).length,
    skipped: checks.filter((c) => c.status === "skipped").length,
  },
  checks,
};
const file = "evals/reports/" + report.run_id + "-browser";
await writeFile(file + ".json", JSON.stringify(report, null, 2) + "\n");
await writeFile(
  file + ".md",
  `# CareLink browser verification\n\nRun: ${report.run_id}\n\nCommit: ${commit}; dirty tree: ${dirty}. Runner exit: ${run.status}.\n\n${report.totals.passed} passed, ${report.totals.failed} failed, ${report.totals.skipped} skipped.\n\nOverall release gate: **incomplete**. This report covers the browser workspace against a real isolated PostgreSQL database and sample transport. Model evaluations and live Meta integration have not run. It does not establish complete acceptance-variant coverage.\n\n| Browser check | Result | Duration ms |\n|---|---|---:|\n${checks.map((c) => `| ${c.name} | ${c.status} | ${c.duration_ms} |`).join("\n")}\n`,
);
console.log("Browser reports written:", file + ".json", file + ".md");
process.exitCode =
  run.status === 0 && report.totals.failed === 0 && report.totals.passed > 0
    ? 0
    : 1;
