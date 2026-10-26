import type { CoverageStatus, RunReport } from "@/server/services/reports";

/** Every value from the database or the app under test is escaped: it is untrusted text. */
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CAUSE: Record<string, string> = {
  APP_BUG: "app bug",
  SCRIPT_ISSUE: "script issue",
  ENVIRONMENT: "environment",
  UNKNOWN: "unclear",
};

const COVERAGE: Record<CoverageStatus, { label: string; bg: string; fg: string }> = {
  PASSING: { label: "Passing", bg: "#E3F3EA", fg: "#1A6B43" },
  FAILING: { label: "Failing", bg: "#FDECE2", fg: "#A3400A" },
  NOT_RUN: { label: "Not run yet", bg: "#FFF4DB", fg: "#7A5300" },
  MANUAL: { label: "Manual", bg: "#EAEFFE", fg: "#1C318F" },
  NOT_COVERED: { label: "Not covered", bg: "#EDEFF4", fg: "#3D4456" },
};

function duration(ms: number | null): string {
  if (ms === null) return "—";
  const min = Math.round(ms / 60000);
  return min < 1 ? `${Math.round(ms / 1000)} s` : `${min} min`;
}

/**
 * FR-9.4: the run report as one self-contained HTML page (no scripts, no external requests;
 * screenshots embedded as data: URLs). Used for the HTML download and printed to PDF.
 */
export function renderReportHtml(report: RunReport, screenshots: Map<string, string>): string {
  const { run, totals } = report;
  const total = Math.max(1, totals.passed + totals.failed + totals.errors);
  const bar = (n: number, color: string) =>
    n > 0 ? `<div style="flex:${n} 1 0;background:${color}"></div>` : "";
  const failures = report.failures
    .map((f) => {
      const shot = screenshots.get(f.runTestId);
      return `<article class="card fail">
  ${shot ? `<img src="${shot}" alt="Screenshot at failure">` : `<div class="noshot">No screenshot</div>`}
  <div class="body">
    <div><span class="chip ${f.status === "ERROR" ? "err" : "failed"}">${f.status === "ERROR" ? "Error" : "Failed"}</span>
    <span class="mono muted">${esc(f.key)} · ${esc(f.requirementKeys.join(", ") || "—")}</span></div>
    <h3>${esc(f.title)}</h3>
    <pre>${esc(f.error ?? "No error message.")}</pre>
    ${f.likelyCause ? `<p class="cause"><b>Likely cause:</b> ${esc(CAUSE[f.likelyCause] ?? f.likelyCause)} — ${esc(f.causeExplanation ?? "")}</p>` : ""}
    ${f.defect ? `<p class="muted">Defect ${esc(f.defect.key)} (${esc(f.defect.status.toLowerCase())})</p>` : ""}
  </div>
</article>`;
    })
    .join("\n");
  const coverageRows = report.coverage.rows
    .map((r) => {
      const c = COVERAGE[r.status];
      return `<tr><td class="mono">${esc(r.key)}</td><td>${esc(r.text)}</td><td><span class="chip" style="background:${c.bg};color:${c.fg}">${c.label}</span></td></tr>`;
    })
    .join("\n");
  const manual = report.manualCases
    .map(
      (m) =>
        `<li><span class="mono">${esc(m.key)}</span> ${esc(m.title)}<span class="muted"> — ${esc(m.automatableReason ?? "")}</span></li>`,
    )
    .join("\n");
  const passed = report.passedCases
    .map(
      (p) =>
        `<li><span class="mono">${esc(p.key)}</span> ${esc(p.title)}${p.status === "SKIPPED" ? ' <span class="muted">(skipped)</span>' : ""}</li>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${esc(report.project.name)} — Run #${run.number} report</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:32px;font-family:"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",sans-serif;color:#1B1F2A;background:#F5F6FA;font-size:14px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 12px}h3{font-size:15px;margin:6px 0}
.muted{color:#5A6275}.mono{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12.5px}
.card{background:#fff;border:1px solid #E3E6EE;border-radius:14px;padding:18px;margin-bottom:12px;break-inside:avoid}
.big{font-size:40px;font-weight:700}.bar{display:flex;height:12px;border-radius:999px;overflow:hidden;gap:2px;margin:12px 0}
.legend span{margin-right:18px}.chip{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700}
.failed{background:#FDECE2;color:#A3400A}.err{background:#F1ECFD;color:#5236B0}
.fail{display:flex;gap:16px}.fail img,.noshot{width:220px;height:140px;object-fit:cover;object-position:top;border-radius:10px;border:1px solid #E3E6EE;flex-shrink:0}
.noshot{display:flex;align-items:center;justify-content:center;background:#F1F3F8;color:#5A6275;font-size:12px}
.body{min-width:0;flex:1}pre{white-space:pre-wrap;word-break:break-word;background:#F5F6FA;border-radius:8px;padding:10px;font-size:12px;margin:6px 0}
.cause{color:#1C318F;margin:6px 0}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #E3E6EE;border-radius:14px;overflow:hidden}
td,th{text-align:left;padding:8px 12px;border-top:1px solid #EDEFF4;vertical-align:top}th{font-size:12px;color:#5A6275;text-transform:uppercase;border-top:0}
ul{padding-left:18px;margin:0}li{margin:3px 0}footer{margin-top:28px;font-size:12px;color:#5A6275}
@media print{body{background:#fff;padding:0}}
</style></head><body>
<p class="muted">${esc(report.project.name)}</p>
<h1>Run #${run.number} report</h1>
<p class="muted">${esc(run.environment)} · Chromium · started by ${esc(run.triggeredBy)} · took ${duration(run.durationMs)}${run.finishedAt ? ` · finished ${esc(run.finishedAt.toISOString().slice(0, 16).replace("T", " "))} UTC` : ""}</p>
${run.error ? `<p class="cause">${esc(run.error)}</p>` : ""}
<section class="card">
<div><span class="big">${totals.passRate === null ? "—" : `${totals.passRate}%`}</span>
<span class="muted"> of ${totals.automated} automated tests passed · ${totals.manual} cases need manual checks</span></div>
<div class="bar">${bar(totals.passed, "#2E9A62")}${bar(totals.failed, "#D9691F")}${bar(totals.errors, "#6B4BD8")}${total === 1 && totals.passed + totals.failed + totals.errors === 0 ? '<div style="flex:1;background:#EDEFF4"></div>' : ""}</div>
<div class="legend"><span><b>${totals.passed}</b> passed</span><span><b>${totals.failed}</b> failed</span><span><b>${totals.errors}</b> errors</span>${totals.skipped ? `<span><b>${totals.skipped}</b> skipped</span>` : ""}<span><b>${totals.manual}</b> manual</span></div>
</section>
<h2>What needs your attention (${report.failures.length})</h2>
${failures || '<p class="muted">Nothing failed.</p>'}
<h2>Requirement coverage — ${report.coverage.covered} / ${report.coverage.total} covered</h2>
<table><thead><tr><th>ID</th><th>Requirement</th><th>Status</th></tr></thead><tbody>
${coverageRows}
</tbody></table>
<h2>Manual checks (${report.manualCases.length})</h2>
${manual ? `<ul>${manual}</ul>` : '<p class="muted">None.</p>'}
<h2>Passed (${report.passedCases.length})</h2>
${passed ? `<ul>${passed}</ul>` : '<p class="muted">None.</p>'}
<footer>Generated by Traxion QA.</footer>
</body></html>`;
}
