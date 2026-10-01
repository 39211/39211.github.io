import {
  runNamedScenarios,
  runRegressionSuite
} from "./ossReliability.js";

const statusLabel = {
  blocked: "blocked / 已擋住",
  uncertain: "uncertain / 不確定",
  success: "success / 成功",
  skipped: "skipped / 略過",
  failed: "failed / 失敗",
  unmeasured: "unmeasured / 未量測",
  measured: "measured / 已量測"
};

function el(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
}

function renderNamed() {
  const named = runNamedScenarios();
  el("s1-result").innerHTML = row(
    named.unapproved.status === "blocked" && !named.unapproved.remotePostId,
    `status=${named.unapproved.status}`,
    named.unapproved.error ?? ""
  );
  el("s2-result").innerHTML = row(
    named.retry.first.status === "uncertain" &&
      named.retry.second.status === "blocked" &&
      named.retry.remotePosts === 1,
    `first=${named.retry.first.status} second=${named.retry.second.status} remote_posts=${named.retry.remotePosts}`,
    named.retry.second.error ?? ""
  );
  el("s3-result").innerHTML = row(
    named.analytics.status === "unmeasured" && named.analytics.value === undefined,
    `status=${named.analytics.status} value=${named.analytics.value ?? "(absent)"}`,
    named.analytics.dataGaps.join("; ")
  );
  return named;
}

function renderSuite() {
  const suite = runRegressionSuite();
  const list = el("suite-list");
  list.replaceChildren();
  for (const item of suite.results) {
    const li = document.createElement("li");
    li.className = item.ok ? "pass" : "fail";
    li.textContent = `${item.ok ? "通過" : "失敗"} ${item.id} ${item.titleZh} / ${item.title}`;
    if (item.error) li.textContent += ` — ${item.error}`;
    list.append(li);
  }
  el("suite-summary").textContent = `${suite.passed} passed / ${suite.failed} failed / ${suite.results.length} total`;
  el("suite-summary").dataset.ok = suite.failed === 0 ? "true" : "false";
  return suite;
}

function row(ok, title, detail) {
  const klass = ok ? "pass" : "fail";
  const mark = ok ? "通過" : "失敗";
  return `<p class="${klass}"><strong>${mark}</strong> ${escapeHtml(title)}</p><p class="detail">${escapeHtml(detail)}</p>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function bind() {
  el("run-named").addEventListener("click", () => {
    renderNamed();
  });
  el("run-suite").addEventListener("click", () => {
    renderSuite();
  });
  el("run-all").addEventListener("click", () => {
    renderNamed();
    renderSuite();
  });
  renderNamed();
  renderSuite();
}

bind();

export { statusLabel, renderNamed, renderSuite };
