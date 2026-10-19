import { runNamedScenarios, runRegressionSuite } from "./ossReliability.js";

const named = runNamedScenarios();
const suite = runRegressionSuite();

const lines = [
  "laundry-social-auto-poster credential-free reliability demo",
  "merchant=示例洗衣店  platforms=mock  live_publish=never",
  "",
  "Scenario 1 — unapproved cannot publish",
  `  status=${named.unapproved.status} calls=0 error=${named.unapproved.error ?? ""}`,
  "",
  "Scenario 2 — retry cannot duplicate after an uncertain commit",
  `  first=${named.retry.first.status} second=${named.retry.second.status} remote_posts=${named.retry.remotePosts}`,
  "",
  "Scenario 3 — missing analytics is unmeasured, not zero",
  `  status=${named.analytics.status} value=${named.analytics.value ?? "(absent)"} gaps=${named.analytics.dataGaps.join("; ")}`,
  "",
  `Regression suite: ${suite.passed} passed / ${suite.failed} failed / ${suite.results.length} total`
];

for (const row of suite.results) {
  const mark = row.ok ? "ok" : "FAIL";
  const error = row.error ? ` — ${row.error}` : "";
  lines.push(`  [${mark}] ${row.id} ${row.titleZh} / ${row.title}${error}`);
}

console.log(lines.join("\n"));

if (suite.failed > 0) process.exitCode = 1;
