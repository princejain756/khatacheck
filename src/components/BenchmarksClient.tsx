"use client";

import React, { useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock,
  Download,
  Lock,
  Mic,
  Play,
  ScanText,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import {
  ATTACK_FAMILY_LABELS,
  FAULT_TYPE_LABELS,
  MERCHANDISE_LABELS,
  SUBGROUP_LABELS,
  labelFor,
} from "@/lib/display-labels";
import type { BenchmarkReport, E2eOcrAsrReport, ExternalHfReport } from "@/lib/types";

interface Props {
  initialReport: BenchmarkReport;
  initialV2Report?: BenchmarkReport | null;
  initialE2eReport: E2eOcrAsrReport | null;
  initialE2eV2Report?: E2eOcrAsrReport | null;
  initialExternalHfReport?: ExternalHfReport | null;
  initialExternalHfHeldout?: ExternalHfReport | null;
  initialExternalHfDevRerun?: ExternalHfReport | null;
}

const RED_TEAM_FAMILY_ORDER = [
  "A_policy_override",
  "B_boundary_escape",
  "C_encoded_payload",
  "D_unicode_numeric",
  "E_pii_exfil",
  "F_multilingual_override",
] as const;

function selectRepresentativeRedTeamLogs(
  logs: BenchmarkReport["redTeam"]["sampleLogs"],
  familyFilter: string
) {
  if (familyFilter !== "all") {
    return logs.filter((item) => item.family === familyFilter);
  }
  const picked: BenchmarkReport["redTeam"]["sampleLogs"] = [];
  for (const family of RED_TEAM_FAMILY_ORDER) {
    const matches = logs.filter((item) => item.family === family).slice(0, 2);
    picked.push(...matches);
  }
  if (picked.length > 0) return picked;
  return logs.slice(0, 12);
}

export function BenchmarksClient({
  initialReport,
  initialV2Report = null,
  initialE2eReport,
  initialE2eV2Report = null,
  initialExternalHfReport = null,
  initialExternalHfHeldout = null,
  initialExternalHfDevRerun = null,
}: Props) {
  const [report, setReport] = useState<BenchmarkReport>(initialReport);
  const [v2Report, setV2Report] = useState<BenchmarkReport | null>(initialV2Report);
  const [e2eReport, setE2eReport] = useState<E2eOcrAsrReport | null>(initialE2eReport);
  const [e2eV2Report, setE2eV2Report] = useState<E2eOcrAsrReport | null>(initialE2eV2Report);
  const [externalHfReport, setExternalHfReport] = useState<ExternalHfReport | null>(
    initialExternalHfReport
  );
  const [externalHfHeldout, setExternalHfHeldout] = useState<ExternalHfReport | null>(
    initialExternalHfHeldout
  );
  const [externalHfDevRerun, setExternalHfDevRerun] = useState<ExternalHfReport | null>(
    initialExternalHfDevRerun
  );
  const [running, setRunning] = useState(false);
  const [lastElapsedMs, setLastElapsedMs] = useState<number | null>(null);
  const [cachedNote, setCachedNote] = useState<string | null>(null);
  const [familyFilter, setFamilyFilter] = useState<string>("all");
  const [e2eTab, setE2eTab] = useState<"images" | "audio">("images");
  const [extTabs, setExtTabs] = useState<Record<string, "breakdown" | "cases">>({});
  const [runError, setRunError] = useState<string | null>(null);

  const rerunSuite = async () => {
    setRunning(true);
    setRunError(null);
    setCachedNote(null);
    try {
      const resp = await fetch("/api/benchmarks", {
        method: "POST",
        cache: "no-store",
      });
      const data = await resp.json();
      if (!resp.ok) {
        setRunError(data.error || "Failed to load benchmark suite");
        return;
      }
      if (data.report) setReport(data.report);
      if (data.v2Report) setV2Report(data.v2Report);
      if (data.e2eOcrAsr) setE2eReport(data.e2eOcrAsr);
      if (data.e2eOcrAsrV2) setE2eV2Report(data.e2eOcrAsrV2);
      if (data.externalHf) setExternalHfReport(data.externalHf);
      if (data.externalHfHeldout) setExternalHfHeldout(data.externalHfHeldout);
      if (data.externalHfDevRerun) setExternalHfDevRerun(data.externalHfDevRerun);
      setLastElapsedMs(typeof data.totalElapsedMs === "number" ? data.totalElapsedMs : 0);
      if (data.cached) {
        setCachedNote("Served pinned immutable benchmark artifacts (cached: true).");
      }
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Network error while loading suite");
    } finally {
      setRunning(false);
    }
  };

  const downloadReport = () => {
    const payload = {
      ...report,
      ...(v2Report ? { v2Report } : {}),
      ...(e2eReport ? { e2eOcrAsr: e2eReport } : {}),
      ...(e2eV2Report ? { e2eOcrAsrV2: e2eV2Report } : {}),
      ...(externalHfReport ? { externalHf: externalHfReport } : {}),
      ...(externalHfHeldout ? { externalHfHeldout } : {}),
      ...(externalHfDevRerun ? { externalHfDevRerun } : {}),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `khatacheck_benchmark_${report.runId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const pilotBadgeLabel = report.latency.pilotStatus.startsWith("NOT_RUN")
    ? `Pilot: Not Run (${report.latency.pilotProtocolStoreCount}-Store Protocol Ready)`
    : report.latency.pilotStatus;

  const redTeamSource =
    v2Report && new Set(v2Report.redTeam.sampleLogs.map((l) => l.family)).size >= 6
      ? v2Report
      : report;

  const representativeLogs = selectRepresentativeRedTeamLogs(redTeamSource.redTeam.sampleLogs, "all");
  const filteredLogs = selectRepresentativeRedTeamLogs(redTeamSource.redTeam.sampleLogs, familyFilter);

  const sharpImageRows = e2eReport
    ? e2eReport.imageResults.filter((r) => r.expectedClarityPass)
    : [];
  const crispImageRows = sharpImageRows.filter((r) => r.kind === "crisp_generated");
  const photoImageRows = sharpImageRows.filter((r) => r.kind === "real_photo");
  const crispLinesExpected = crispImageRows.reduce((acc, r) => acc + r.expectedLineCount, 0);
  const crispLinesExtracted = crispImageRows.reduce(
    (acc, r) => acc + Math.min(r.extractedLineCount, r.expectedLineCount),
    0
  );
  const photoLinesExpected = photoImageRows.reduce((acc, r) => acc + r.expectedLineCount, 0);
  const photoLinesExtracted = photoImageRows.reduce(
    (acc, r) => acc + Math.min(r.extractedLineCount, r.expectedLineCount),
    0
  );
  const expectedLinesCount = sharpImageRows.reduce((acc, r) => acc + r.expectedLineCount, 0);
  const extractedLinesCount = sharpImageRows.reduce(
    (acc, r) => acc + Math.min(r.extractedLineCount, r.expectedLineCount),
    0
  );
  const declaredGrandTotalMatchCount = sharpImageRows.filter((r) => r.grandTotalMatched).length;
  const exactCategorySetMatchCount = e2eReport
    ? e2eReport.imageResults.filter((r) => {
        const exp = [...new Set(r.expectedFaultCategories)].sort().join("|");
        const det = [...new Set(r.detectedCategories)].sort().join("|");
        return exp === det;
      }).length
    : 0;
  const exactCategorySetMatchPct =
    e2eReport && e2eReport.imageResults.length > 0
      ? Math.round((exactCategorySetMatchCount / e2eReport.imageResults.length) * 1000) / 10
      : 0;
  const targetFaultPassCount = e2eReport
    ? e2eReport.imageResults.filter((r) => r.faultDetectionPassed).length
    : 0;
  const piiTargetRows = e2eReport
    ? e2eReport.audioResults.filter((a) => a.expectedRedactionCount > 0)
    : [];
  const piiRedactedCount = piiTargetRows.filter(
    (a) => a.redactionCount >= a.expectedRedactionCount
  ).length;

  const gateChecklist = [
    {
      label: "Substantive Recall >= 94%",
      value: `${report.overall.recallPct}%`,
      passed: report.gates.recallAtLeast94,
    },
    {
      label: "Substantive F1 >= 94%",
      value: `${report.overall.f1Pct}%`,
      passed: report.gates.f1AtLeast94,
    },
    {
      label: "Clean Bill FPR <= 3%",
      value: `${report.overall.cleanFalsePositiveRatePct}%`,
      passed: report.gates.cleanFprAtMost3,
    },
    {
      label: "Deterministic BigInt Math = 100%",
      value: `${report.overall.deterministicMathAccuracyPct}%`,
      passed: report.gates.mathAccuracy100,
    },
    {
      label: "Max Subgroup Gap <= 5 pp",
      value: `${report.fairness.maxF1GapBelowMeanPct} pp F1 / ${report.fairness.maxRecallGapBelowMeanPct} pp Rec`,
      passed: report.gates.fairnessGapAtMost5,
    },
    {
      label: "Compute p95 < 4,000 ms",
      value: `${report.latency.p95Ms} ms`,
      passed: report.gates.latencyP95Under4000Ms,
    },
    {
      label: "50-Attack Red-Team = 100%",
      value: `${report.redTeam.blockedOrIsolated}/${report.redTeam.totalAttacks}`,
      passed: report.gates.redTeamAll50Passed,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="type-page text-ink">
            Verification Benchmarks, Live OCR+ASR E2E &amp; Fairness Parity
          </h1>
          <p className="type-body text-muted mt-0.5">
            500-bill seeded synthetic rule-core suite ({report.seed}), executed live OCR + Groq Whisper
            ASR end-to-end lab study, 49-bill sampled third-party benchmark, 5-subgroup launch gate,
            and 50-attack red-team audit.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={downloadReport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-line-strong type-pill text-ink hover:bg-subtle cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export Benchmark JSON
          </button>
          <button
            type="button"
            disabled={running}
            onClick={rerunSuite}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-accent text-accent-ink type-pill hover:opacity-90 disabled:opacity-50 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            {running ? "Running 500 + 50 Suite..." : "Re-run Live Benchmark Suite"}
          </button>
        </div>
      </div>

      {/* Explicit Scope Notice Banner */}
      <div className="app-card px-4 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
        <div className="flex items-start sm:items-center gap-2.5">
          <Activity className="w-4 h-4 text-cobalt shrink-0 mt-0.5 sm:mt-0" />
          <div className="type-meta text-muted">
            <span className="font-semibold text-ink">Scope Honesty:</span> Synthetic metrics cover{" "}
            <span className="font-code text-ink">
              {report.totals.totalInvoices} synthetic bills + {report.totals.attackCases} adversarial
              cases
            </span>{" "}
            using <span className="font-code text-ink">{report.oracleProfile}</span>
            {e2eReport ? (
              <>
                {" "}
                alongside an executed live HTTP lab study (
                <span className="font-code text-ink">
                  {e2eReport.imageSummary.totalCases} bill images + {e2eReport.audioSummary.totalClips}{" "}
                  Hinglish audio clips
                </span>
                )
              </>
            ) : null}
            {externalHfReport ? (
              <>
                {" "}
                plus{" "}
                <span className="font-code text-ink">
                  {externalHfReport.overallSummary.totalCases} sampled third-party bills
                </span>{" "}
                from{" "}
                <span className="font-code text-ink">
                  {externalHfReport.attribution.dataset} ({externalHfReport.attribution.license})
                </span>
              </>
            ) : null}
            . Live 10-store Bengaluru field pilot:{" "}
            <span className="inline-flex items-center whitespace-nowrap pill-warning type-pill px-2 py-0.5 rounded">
              Not Run ({report.latency.pilotProtocolStoreCount}-Store Protocol Ready)
            </span>
            .
          </div>
        </div>
        <div className="type-meta font-code text-faint shrink-0">
          Run {report.runId}
          {lastElapsedMs !== null ? ` · Refreshed in ${lastElapsedMs} ms` : ""}
          {cachedNote ? ` · ${cachedNote}` : ""}
        </div>
      </div>

      {runError ? (
        <div className="app-card p-3 border-red-500/40 pill-danger type-meta">{runError}</div>
      ) : null}

      {/* 4 Primary KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <div className="app-card p-4">
          <div className="type-kpi-label text-faint">Substantive Detection F1</div>
          <div className="type-kpi-value numeral text-ink mt-1">{report.overall.f1Pct}%</div>
          <div className="type-meta text-muted mt-1">
            F1 95% CI{" "}
            <span className="numeral">
              [{report.overall.f1Ci95Bootstrap[0]}, {report.overall.f1Ci95Bootstrap[1]}]
            </span>{" "}
            · Prec <span className="numeral">{report.overall.precisionPct}%</span> · Rec{" "}
            <span className="numeral">{report.overall.recallPct}%</span>
          </div>
        </div>

        <div className="app-card p-4">
          <div className="type-kpi-label text-faint">Deterministic Math</div>
          <div className="type-kpi-value numeral text-ink mt-1">
            {report.overall.deterministicMathAccuracyPct.toFixed(1)}%
          </div>
          <div className="type-meta text-muted mt-1">
            <span className="numeral">
              {report.overall.deterministicMathPassed} / {report.overall.deterministicMathTotal}
            </span>{" "}
            bills · Clean FPR <span className="numeral">{report.overall.cleanFalsePositiveRatePct}%</span>
          </div>
        </div>

        <div className="app-card p-4">
          <div className="type-kpi-label text-faint">Subgroup Parity Gate</div>
          <div className="type-kpi-value text-ink mt-1 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            <span>{report.fairness.fairnessGatePassed ? "Pass" : "Hold"}</span>
          </div>
          <div className="type-meta text-muted mt-1">
            Max gap <span className="numeral">{report.fairness.maxF1GapBelowMeanPct} pp</span> F1 ·{" "}
            <span className="numeral">{report.fairness.maxRecallGapBelowMeanPct} pp</span> Rec (Gate{" "}
            &lt;= <span className="numeral">{report.fairness.launchGateThresholdPct} pp</span>)
          </div>
        </div>

        <div className="app-card p-4">
          <div className="type-kpi-label text-faint">Red-Team Resilience</div>
          <div className="type-kpi-value numeral text-ink mt-1">
            {report.redTeam.blockedOrIsolated} / {report.redTeam.totalAttacks}
          </div>
          <div className="type-meta text-muted mt-1">
            <span className="numeral">
              {Math.round((report.redTeam.blockedOrIsolated / report.redTeam.totalAttacks) * 1000) / 10}%
            </span>{" "}
            blocked/isolated ·{" "}
            <span className="numeral">{report.redTeam.taxIntegrityPreserved}</span> grand totals intact
          </div>
        </div>
      </div>

      {/* Main Grid: Fairness Table (7 cols) + Pilot Speedup & Category Recall (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 app-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="type-section text-ink">
                5-Subgroup Fairness Parity (NeuraViz Ch. 8 Launch Gate)
              </h2>
              <p className="type-meta text-muted mt-0.5">
                Macro mean F1 <span className="numeral text-ink">{report.fairness.macroMeanF1Pct}%</span>{" "}
                · Macro mean Recall{" "}
                <span className="numeral text-ink">{report.fairness.macroMeanRecallPct}%</span> · Clarity
                abstention{" "}
                <span className="numeral text-ink">
                  {report.overall.clarityAbstentionCorrect}/{report.overall.clarityAbstentionTotal}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="type-meta font-code text-faint sm:hidden whitespace-nowrap">Scroll -&gt;</span>
              <span
                className={`inline-flex items-center whitespace-nowrap shrink-0 type-pill px-2 py-0.5 rounded ${
                  report.fairness.fairnessGatePassed ? "pill-success" : "pill-danger"
                }`}
              >
                Gap &lt;= {report.fairness.launchGateThresholdPct} pp Enforced
              </span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-line bg-subtle text-faint">
                  <th className="py-2 px-3 type-table-head">Stratum</th>
                  <th className="py-2 px-3 type-table-head text-right">Bills</th>
                  <th className="py-2 px-3 type-table-head text-right">Clean FPR</th>
                  <th className="py-2 px-3 type-table-head text-right">Recall</th>
                  <th className="py-2 px-3 type-table-head text-right">F1</th>
                  <th className="py-2 px-3 type-table-head text-right">F1 Gap vs Mean</th>
                  <th className="py-2 px-3 type-table-head text-right">Gate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.fairness.subgroups.map((row) => {
                  const rowPass =
                    Math.abs(row.f1GapFromMeanPct) <= report.fairness.launchGateThresholdPct &&
                    Math.abs(row.recallGapFromMeanPct) <= report.fairness.launchGateThresholdPct;
                  return (
                    <tr key={row.subgroup} className="hover:bg-subtle/60">
                      <td className="py-2.5 px-3 type-table-cell text-ink font-medium">
                        {labelFor(SUBGROUP_LABELS, row.subgroup, row.subgroup)}
                      </td>
                      <td className="py-2.5 px-3 type-table-cell text-right numeral text-muted">
                        {row.total}
                      </td>
                      <td className="py-2.5 px-3 type-table-cell text-right numeral text-ink">
                        {row.cleanFprPct.toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-3 type-table-cell text-right numeral text-ink">
                        {row.recallPct.toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-3 type-table-cell text-right numeral font-semibold text-ink">
                        {row.f1Pct.toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-3 type-table-cell text-right numeral text-muted">
                        {row.f1GapFromMeanPct >= 0 ? "+" : ""}
                        {row.f1GapFromMeanPct.toFixed(1)} pp
                      </td>
                      <td className="py-2.5 px-3 type-table-cell text-right">
                        <span
                          className={`type-pill px-2 py-0.5 rounded ${
                            rowPass ? "pill-success" : "pill-danger"
                          }`}
                        >
                          {rowPass ? "Pass" : "Fail"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 space-y-4">
          {/* Manual vs Pilot Speedup Comparison Card */}
          <div className="app-card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="type-section text-ink flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-cobalt" />
                Detection Speed & Field Pilot Protocol
              </h2>
              <span className="pill-warning type-pill px-2 py-0.5 rounded">
                {pilotBadgeLabel}
              </span>
            </div>
            <p className="type-meta text-muted leading-relaxed">{report.latency.scopeNote}</p>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-lg bg-subtle p-2.5 border border-line">
                <div className="type-kpi-label text-faint">Stage 3 Manual Assumption</div>
                <div className="type-section numeral text-ink mt-0.5">
                  {report.latency.manualBaselineActiveMinRange[0]} to{" "}
                  {report.latency.manualBaselineActiveMinRange[1]} min
                </div>
                <div className="type-meta text-faint mt-0.5">
                  GST slab lag: {report.latency.manualBaselineLagDaysRange[0]} to{" "}
                  {report.latency.manualBaselineLagDaysRange[1]} days
                </div>
              </div>
              <div className="rounded-lg bg-subtle p-2.5 border border-line">
                <div className="type-kpi-label text-faint">Rule Core Compute (Synthetic)</div>
                <div className="type-section numeral text-ink mt-0.5">
                  {report.latency.p95Ms} ms (p95)
                </div>
                <div className="type-meta text-faint mt-0.5">
                  p50 {report.latency.p50Ms} ms · max {report.latency.maxMs} ms ({report.latency.samplesCount}{" "}
                  runs)
                </div>
              </div>
              {e2eReport ? (
                <>
                  <div className="rounded-lg bg-subtle p-2.5 border border-line">
                    <div className="type-kpi-label text-faint">Live HTTP OCR API (t0 -&gt; JSON flag)</div>
                    <div className="type-section numeral text-ink mt-0.5">
                      {e2eReport.imageSummary.wallClockP50Ms} ms (p50)
                    </div>
                    <div className="type-meta text-faint mt-0.5">
                      p95 {e2eReport.imageSummary.wallClockP95Ms} ms · max{" "}
                      {e2eReport.imageSummary.wallClockMaxMs} ms ({e2eReport.imageSummary.totalCases} images)
                    </div>
                  </div>
                  <div className="rounded-lg bg-subtle p-2.5 border border-line">
                    <div className="type-kpi-label text-faint">Live Whisper ASR + Verify</div>
                    <div className="type-section numeral text-ink mt-0.5">
                      {e2eReport.audioSummary.totalE2eP50Ms} ms (p50)
                    </div>
                    <div className="type-meta text-faint mt-0.5">
                      p95 {e2eReport.audioSummary.totalE2eP95Ms} ms · max{" "}
                      {e2eReport.audioSummary.totalE2eMaxMs} ms ({e2eReport.audioSummary.totalClips} clips)
                    </div>
                  </div>
                </>
              ) : null}
            </div>
            <div className="type-meta text-muted">
              Instrumented <span className="font-code text-ink">t0 -&gt; t_flag</span> telemetry ready for{" "}
              <span className="numeral text-ink">{report.latency.pilotProtocolStoreCount}</span> Bengaluru
              retail stores (5 kirana, 3 textile, 2 pharma) over{" "}
              <span className="numeral text-ink">{report.latency.pilotProtocolWeeks}</span> weeks (Stage 4 Gate 5 sign-off).
            </div>
          </div>

          {/* Fault Category Breakdown */}
          <div className="app-card p-4 space-y-2.5">
            <h2 className="type-section text-ink">Recall by Fault Category</h2>
            <div className="space-y-2">
              {report.byFaultCategory.map((cat) => (
                <div key={cat.category} className="space-y-1">
                  <div className="flex items-center justify-between type-meta">
                    <span className="text-ink font-medium">
                      {labelFor(FAULT_TYPE_LABELS, cat.category, cat.category)}
                    </span>
                    <span className="numeral text-muted">
                      {cat.detectedCorrectLineAndFamily}/{cat.expectedCount} ({cat.recallPct.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-subtle overflow-hidden">
                    <div
                      className="h-full bg-cobalt rounded-full"
                      style={{ width: `${Math.min(100, Math.max(2, cat.recallPct))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Launch Readiness Gates Strip */}
      <div className="app-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="type-section text-ink">Automated Benchmark Gates (7 / 7 Thresholds)</h2>
          <span
            className={`type-pill px-2.5 py-0.5 rounded ${
              report.gates.allGatesPassed ? "pill-success" : "pill-danger"
            }`}
          >
            {report.gates.allGatesPassed ? "All 7 Gates Pass" : "Check Required"}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2.5">
          {gateChecklist.map((g) => (
            <div
              key={g.label}
              className="rounded-lg border border-line bg-subtle/60 p-2.5 flex flex-col justify-between gap-1.5"
            >
              <div className="type-meta text-muted leading-snug">{g.label}</div>
              <div className="flex items-center justify-between gap-1">
                <span className="type-meta font-semibold numeral text-ink">{g.value}</span>
                {g.passed ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Executed Live End-to-End OCR + Groq Whisper ASR Lab Study */}
      {e2eReport ? (
        <div className="app-card p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="type-section text-ink flex items-center gap-1.5">
                <ScanText className="w-4 h-4 text-cobalt" />
                Executed End-to-End OCR + Groq Whisper ASR Lab Study ({e2eReport.imageSummary.totalCases} Images +{" "}
                {e2eReport.audioSummary.totalClips} Audio Clips)
              </h2>
              <p className="type-meta text-muted mt-0.5">
                Live HTTPS round-trip against{" "}
                <span className="font-code text-ink">{e2eReport.targetBaseUrl}</span>
                {e2eReport.targetCodeCommit ? (
                  <>
                    {" "}
                    · commit <span className="font-code text-ink">{e2eReport.targetCodeCommit.slice(0, 7)}</span>
                  </>
                ) : null}{" "}
                · <span className="font-code">{e2eReport.runId}</span> ·{" "}
                {e2eReport.imageSummary.enginesObserved.join(", ")} + {e2eReport.audioSummary.asrModel}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="pill-warning type-pill px-2 py-0.5 rounded">
                10-Store Pilot: Not Run (Gate 5 Hold)
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="rounded-lg border border-line bg-subtle/60 p-3">
              <div className="type-kpi-label text-faint">Clarity Pass / Blurry Abstain</div>
              <div className="type-section numeral text-ink mt-1">
                {e2eReport.imageSummary.clarityPassRatePct}% / {e2eReport.imageSummary.blurryAbstentionRatePct}%
              </div>
              <div className="type-meta text-muted mt-0.5">
                {e2eReport.imageSummary.blurryAbstentionCorrect}/{e2eReport.imageSummary.blurryAbstentionTotal} blurred &lt;85 abstained
              </div>
            </div>
            <div className="rounded-lg border border-line bg-subtle/60 p-3">
              <div className="type-kpi-label text-faint">OCR Line-Count Recall</div>
              <div className="type-section numeral text-ink mt-1">
                {e2eReport.imageSummary.lineExtractionRecallPct}% ({extractedLinesCount}/{expectedLinesCount})
              </div>
              <div className="type-meta text-muted mt-0.5 leading-snug">
                {crispLinesExtracted}/{crispLinesExpected} crisp + {photoLinesExtracted}/{photoLinesExpected} photo ·
                Declared Grand Total Match ({declaredGrandTotalMatchCount}/{sharpImageRows.length}) ·
                Target-Fault {targetFaultPassCount}/{e2eReport.imageResults.length} ({e2eReport.imageSummary.faultAccuracyPct}%) ·
                Exact Category-Set {exactCategorySetMatchCount}/{e2eReport.imageResults.length} ({exactCategorySetMatchPct}%) ·
                GSTIN {e2eReport.imageSummary.gstinMatchRatePct}%
              </div>
            </div>
            <div className="rounded-lg border border-line bg-subtle/60 p-3">
              <div className="type-kpi-label text-faint">OCR API Round-Trip (t0 -&gt; JSON flag)</div>
              <div className="type-section numeral text-ink mt-1">
                p50 {e2eReport.imageSummary.wallClockP50Ms} ms
              </div>
              <div className="type-meta text-muted mt-0.5">
                p95 {e2eReport.imageSummary.wallClockP95Ms} ms · max {e2eReport.imageSummary.wallClockMaxMs} ms
              </div>
            </div>
            <div className="rounded-lg border border-line bg-subtle/60 p-3">
              <div className="type-kpi-label text-faint">Whisper Hinglish Shortage Recall</div>
              <div className="type-section numeral text-ink mt-1">
                {e2eReport.audioSummary.shortageRecallPct}% ({e2eReport.audioSummary.shortageAndRateMatchCount}/
                {e2eReport.audioSummary.shortageAndRateTotal})
              </div>
              <div className="type-meta text-muted mt-0.5">
                ASR p50 {e2eReport.audioSummary.asrLatencyP50Ms} ms · Negation{" "}
                {e2eReport.audioSummary.negationControlPassed ? "Pass" : "Fail"} · Mobile PII{" "}
                {piiTargetRows.length > 0
                  ? `${piiRedactedCount}/${piiTargetRows.length} ${
                      e2eReport.audioSummary.piiRedactionPassed ? "Pass" : "Fail"
                    }`
                  : e2eReport.audioSummary.piiRedactionPassed
                    ? "Pass"
                    : "Fail"}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
              <button
                type="button"
                onClick={() => setE2eTab("images")}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md type-pill cursor-pointer ${
                  e2eTab === "images" ? "bg-surface text-ink shadow-xs" : "text-muted hover:text-ink"
                }`}
              >
                <ScanText className="w-3.5 h-3.5" />
                Image OCR Cases ({e2eReport.imageResults.length})
              </button>
              <button
                type="button"
                onClick={() => setE2eTab("audio")}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md type-pill cursor-pointer ${
                  e2eTab === "audio" ? "bg-surface text-ink shadow-xs" : "text-muted hover:text-ink"
                }`}
              >
                <Mic className="w-3.5 h-3.5" />
                Hinglish Whisper Clips ({e2eReport.audioResults.length})
              </button>
            </div>
            <span className="type-meta font-code text-faint">
              Executed {e2eReport.executedAtIso}
            </span>
          </div>

          {e2eTab === "images" ? (
            <div className="overflow-x-auto rounded-lg border border-line max-h-80 overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-subtle z-10">
                  <tr className="border-b border-line text-faint">
                    <th className="py-2 px-3 type-table-head">Case ID</th>
                    <th className="py-2 px-3 type-table-head">Group</th>
                    <th className="py-2 px-3 type-table-head text-right">Clarity</th>
                    <th className="py-2 px-3 type-table-head">Engine</th>
                    <th className="py-2 px-3 type-table-head text-right">Lines</th>
                    <th className="py-2 px-3 type-table-head text-right">API Round-Trip</th>
                    <th className="py-2 px-3 type-table-head text-right">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {e2eReport.imageResults.map((row) => {
                    const ok = row.expectedClarityPass
                      ? row.faultDetectionPassed && Boolean(row.grandTotalMatched)
                      : row.abstentionPassed;
                    return (
                      <tr key={row.caseId} className="hover:bg-subtle/60">
                        <td className="py-2 px-3 type-table-cell font-code text-ink whitespace-nowrap">
                          {row.caseId}
                        </td>
                        <td className="py-2 px-3 type-table-cell text-muted whitespace-nowrap">
                          {row.merchandiseGroup === "blurry_control"
                            ? "Blurry <85 Control"
                            : labelFor(MERCHANDISE_LABELS, row.merchandiseGroup, row.merchandiseGroup)}
                        </td>
                        <td className="py-2 px-3 type-table-cell text-right numeral text-ink">
                          {row.clarityScore}/255
                        </td>
                        <td className="py-2 px-3 type-table-cell font-code text-muted whitespace-nowrap">
                          {row.ocrEngine}
                        </td>
                        <td className="py-2 px-3 type-table-cell text-right numeral text-ink">
                          {row.extractedLineCount}/{row.expectedLineCount}
                        </td>
                        <td className="py-2 px-3 type-table-cell text-right numeral text-ink whitespace-nowrap">
                          {row.wallClockMs} ms
                        </td>
                        <td className="py-2 px-3 type-table-cell text-right whitespace-nowrap">
                          <span className={`type-pill px-2 py-0.5 rounded ${ok ? "pill-success" : "pill-warning"}`}>
                            {row.abstainedClarity ? "Abstained" : ok ? "Pass" : "Review"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-line bg-subtle text-faint">
                    <th className="py-2 px-3 type-table-head">Clip</th>
                    <th className="py-2 px-3 type-table-head">Transcript Preview</th>
                    <th className="py-2 px-3 type-table-head text-right">PII Masked</th>
                    <th className="py-2 px-3 type-table-head text-right">ASR / Total</th>
                    <th className="py-2 px-3 type-table-head text-right">Match</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {e2eReport.audioResults.map((row) => (
                    <tr key={row.caseId} className="hover:bg-subtle/60">
                      <td className="py-2 px-3 type-table-cell font-code text-ink whitespace-nowrap">
                        {row.caseId}
                      </td>
                      <td className="py-2 px-3 type-table-cell text-muted max-w-md truncate">
                        {row.scrubbedTranscript}
                      </td>
                      <td className="py-2 px-3 type-table-cell text-right numeral text-ink">
                        {row.redactionCount}
                      </td>
                      <td className="py-2 px-3 type-table-cell text-right numeral text-ink whitespace-nowrap">
                        {row.asrLatencyMs} / {row.totalWallClockMs} ms
                      </td>
                      <td className="py-2 px-3 type-table-cell text-right whitespace-nowrap">
                        <span
                          className={`type-pill px-2 py-0.5 rounded ${
                            row.matchedExpectation ? "pill-success" : "pill-danger"
                          }`}
                        >
                          {row.matchedExpectation ? "Pass" : "Miss"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {/* Third-Party Dataset Benchmarks (Self-Administered: Pinned Baseline, Held-Out 50, Dev Rerun) */}
      {[
        externalHfReport
          ? {
              key: "baseline",
              heading: `Third-Party Dataset Benchmark (Self-Administered: ${externalHfReport.attribution.dataset}, ${externalHfReport.attribution.license}, commit ${externalHfReport.attribution.datasetCommit.slice(0, 8)}, ${externalHfReport.overallSummary.totalCases} Sampled Bills)`,
              notePrefix: "General layout and guard upgrades informed by a 5-row diagnostic probe; zero per-row hardcoding",
              data: externalHfReport,
            }
          : null,
        externalHfHeldout
          ? {
              key: "heldout",
              heading: `Third-Party Dataset Benchmark: 50-Bill Held-Out Divya52 Sample (${externalHfHeldout.overallSummary.totalCases} Disjoint Bills, Seed 20261123)`,
              notePrefix: "Strictly disjoint held-out sample run on hardened v2 pipeline",
              data: externalHfHeldout,
            }
          : null,
        externalHfDevRerun
          ? {
              key: "dev-rerun",
              heading: `Third-Party Dataset Benchmark: Dev Rerun (Post-Error-Analysis, Non-Headline, ${externalHfDevRerun.overallSummary.totalCases} Bills)`,
              notePrefix: "Iterative dev rerun on baseline rows after M10/M12 fixes (non-headline)",
              data: externalHfDevRerun,
            }
          : null,
      ]
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .map(({ key, heading, notePrefix, data }) => {
          const activeTab = extTabs[key] ?? "breakdown";
          const degClean = data.cleanSummary.byDegradationLevel.clean;
          const degScan = data.cleanSummary.byDegradationLevel.scan;
          const degPhoto = data.cleanSummary.byDegradationLevel.photo;
          const cleanRows = data.results.filter((r) => r.attack === null);
          const photoCleanRows = cleanRows.filter((r) => r.level === "photo");
          const photoFullyCorrect = photoCleanRows.filter(
            (r) =>
              r.grandTotalMatched &&
              r.vendorGstinMatched &&
              r.extractedLineCount >= r.expectedLineCount &&
              !r.hasArithmeticMismatch
          ).length;
          const captureGapPp = Number(
            ((degClean?.grandTotalExactMatchPct ?? 0) - (degPhoto?.grandTotalExactMatchPct ?? 0)).toFixed(1)
          );
          const missedAttacks = data.results.filter((r) => r.attack !== null && r.attackDefeated === false);
          const lowContrastRows = data.results.filter((r) => r.attackStyle === "low_contrast");
          const lowContrastGuardDetected = lowContrastRows.filter((r) => r.promptGuardBlocked).length;
          const hasAttacks = data.injectionSummary.totalAttacks > 0;

          return (
            <div key={key} className="app-card p-4 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="type-section text-ink flex items-start gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-cobalt shrink-0 mt-0.5" />
                    <span>{heading}</span>
                  </h2>
                  <p className="type-meta text-muted mt-0.5">
                    Live HTTPS round-trip against{" "}
                    <span className="font-code text-ink">{data.targetBaseUrl}</span> · commit{" "}
                    <span className="font-code text-ink">{data.targetCodeCommit.slice(0, 7)}</span> ·{" "}
                    <span className="font-code">{data.runId}</span> ·{" "}
                    {data.overallSummary.enginesObserved.join(", ")} · {notePrefix}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <span
                    className={`inline-flex items-center whitespace-nowrap type-pill px-2 py-0.5 rounded ${
                      data.cleanSummary.promptGuardFalsePositiveCount === 0
                        ? "pill-success"
                        : "pill-danger"
                    }`}
                  >
                    {data.cleanSummary.promptGuardFalsePositiveCount}/{data.cleanSummary.totalCases}{" "}
                    Prompt-Guard FP
                  </span>
                  <span className="inline-flex items-center whitespace-nowrap pill-warning type-pill px-2 py-0.5 rounded">
                    10-Store Pilot: Not Run (Gate 5 Hold)
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <div className="rounded-lg border border-line bg-subtle/60 p-3">
                  <div className="type-kpi-label text-faint">
                    Clean Grand Totals ({data.cleanSummary.totalCases} Clean Bills)
                  </div>
                  <div className="type-section numeral text-ink mt-1">
                    {data.cleanSummary.grandTotalExactMatchPct}% (
                    {data.cleanSummary.grandTotalExactCount}/{data.cleanSummary.totalCases})
                  </div>
                  <div className="type-meta text-muted mt-0.5 leading-snug">
                    Synth {data.cleanSummary.bySplit.synthetic?.grandTotalExactMatchPct ?? 0}% (
                    {data.cleanSummary.bySplit.synthetic?.grandTotalExactCount ?? 0}/
                    {data.cleanSummary.bySplit.synthetic?.totalCases ?? 0}) · Reg{" "}
                    {data.cleanSummary.bySplit.regional?.grandTotalExactMatchPct ?? 0}% (
                    {data.cleanSummary.bySplit.regional?.grandTotalExactCount ?? 0}/
                    {data.cleanSummary.bySplit.regional?.totalCases ?? 0}) · GSTIN{" "}
                    {data.cleanSummary.supplierGstinMatchedCount}/{data.cleanSummary.totalCases} (
                    {data.cleanSummary.supplierGstinExactMatchPct}%) ·{" "}
                    {data.cleanSummary.cleanArithmeticFpCount}/{data.cleanSummary.totalCases} (
                    {data.cleanSummary.cleanArithmeticFpRatePct}%) Arith FP
                  </div>
                </div>

                <div className="rounded-lg border border-line bg-subtle/60 p-3">
                  <div className="type-kpi-label text-faint">Clean by Capture Quality</div>
                  <div className="type-section numeral text-ink mt-1">
                    Digital {degClean?.grandTotalExactCount ?? 0}/{degClean?.totalCases ?? 0} (
                    {degClean?.grandTotalExactMatchPct ?? 0}% GT)
                  </div>
                  <div className="type-meta text-muted mt-0.5 leading-snug">
                    Scan ({degScan?.totalCases ?? 0}): {degScan?.grandTotalExactCount ?? 0}/
                    {degScan?.totalCases ?? 0} ({degScan?.grandTotalExactMatchPct ?? 0}% GT) · Noisy Photo (
                    {degPhoto?.totalCases ?? 0}): {degPhoto?.grandTotalExactCount ?? 0}/
                    {degPhoto?.totalCases ?? 0} ({degPhoto?.grandTotalExactMatchPct ?? 0}% GT;{" "}
                    {photoFullyCorrect}/{photoCleanRows.length} noisy photos fully correct)
                  </div>
                </div>

                <div className="rounded-lg border border-line bg-subtle/60 p-3">
                  <div className="type-kpi-label text-faint">Capture Gap &amp; Clarity Gate</div>
                  <div className="type-section numeral text-ink mt-1">
                    {captureGapPp} pp Capture Gap
                  </div>
                  <div className="type-meta text-muted mt-0.5 leading-snug">
                    Rule-layer gap &lt;= {report.fairness.launchGateThresholdPct} pp on fixture tags;
                    end-to-end capture gap {captureGapPp} pp (photo path assist-only) · Clarity gate passed{" "}
                    {data.overallSummary.clarityPassedCount}/{data.overallSummary.totalCases} · API p50{" "}
                    {data.overallSummary.apiWallClockP50Ms} ms / p95 {data.overallSummary.apiWallClockP95Ms} ms
                  </div>
                </div>

                {hasAttacks ? (
                  <div className="rounded-lg border border-line bg-subtle/60 p-3">
                    <div className="type-kpi-label text-faint">
                      Visual Injections ({data.injectionSummary.totalAttacks} Separate Attacks)
                    </div>
                    <div className="type-section numeral text-ink mt-1">
                      {data.injectionSummary.attackDefeatedCount}/{data.injectionSummary.totalAttacks} (
                      {data.injectionSummary.attackDefeatedRatePct}%) Defeated
                    </div>
                    <div className="type-meta text-muted mt-0.5 leading-snug">
                      Preserved {data.injectionSummary.grandTotalPreservedCount}/
                      {data.injectionSummary.totalAttacks} ({data.injectionSummary.grandTotalPreservedRatePct}%) ·
                      Guard {data.injectionSummary.promptGuardDetectedCount}/{data.injectionSummary.totalAttacks}{" "}
                      ({data.injectionSummary.promptGuardDetectedRatePct}%) · Misses ({missedAttacks.length}):{" "}
                      {missedAttacks.length > 0
                        ? missedAttacks
                            .map((m) => `${m.caseId} (${m.attack ?? "unknown"}/${m.attackStyle ?? "unknown"})`)
                            .join(", ")
                        : "none"}
                      {lowContrastRows.length > 0
                        ? ` · low_contrast: ${lowContrastGuardDetected}/${lowContrastRows.length} guard-detected (low-contrast note unextracted by OCR; pixels isolated from LLM)`
                        : ""}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-line bg-subtle/60 p-3">
                    <div className="type-kpi-label text-faint">
                      Clean-Only Held-Out Scope (0 Attacks)
                    </div>
                    <div className="type-section numeral text-ink mt-1">
                      {data.cleanSummary.promptGuardFalsePositiveCount}/{data.cleanSummary.totalCases}{" "}
                      Prompt-Guard FP
                    </div>
                    <div className="type-meta text-muted mt-0.5 leading-snug">
                      Strictly disjoint unseen clean bills · Clarity gate passed{" "}
                      {data.overallSummary.clarityPassedCount}/{data.overallSummary.totalCases}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
                  <button
                    type="button"
                    onClick={() => setExtTabs((prev) => ({ ...prev, [key]: "breakdown" }))}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md type-pill cursor-pointer ${
                      activeTab === "breakdown"
                        ? "bg-surface text-ink shadow-xs"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    {hasAttacks ? "Degradation & Attack Breakdown" : "Clean Degradation Breakdown"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setExtTabs((prev) => ({ ...prev, [key]: "cases" }))}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md type-pill cursor-pointer ${
                      activeTab === "cases"
                        ? "bg-surface text-ink shadow-xs"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    <ScanText className="w-3.5 h-3.5 shrink-0" />
                    All {data.results.length} Sampled Bills
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="type-meta font-code text-faint sm:hidden whitespace-nowrap">
                    Scroll -&gt;
                  </span>
                  <span className="type-meta font-code text-faint">Executed {data.executedAtIso}</span>
                </div>
              </div>

              {activeTab === "breakdown" ? (
                <div className={hasAttacks ? "grid grid-cols-1 lg:grid-cols-2 gap-3" : "grid grid-cols-1 gap-3"}>
                  <div className="overflow-x-auto rounded-lg border border-line">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-line bg-subtle text-faint">
                          <th className="py-2 px-3 type-table-head">Clean Bucket</th>
                          <th className="py-2 px-3 type-table-head text-right">Bills</th>
                          <th className="py-2 px-3 type-table-head text-right">Grand Total</th>
                          <th className="py-2 px-3 type-table-head text-right">GSTIN</th>
                          <th className="py-2 px-3 type-table-head text-right">Lines</th>
                          <th className="py-2 px-3 type-table-head text-right">Arith FP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {[
                          { label: "Clean Digital", row: degClean },
                          { label: "Scanned Print", row: degScan },
                          { label: "Noisy Photo", row: degPhoto },
                          { label: "Synthetic Split", row: data.cleanSummary.bySplit.synthetic },
                          { label: "Regional Split", row: data.cleanSummary.bySplit.regional },
                        ]
                          .filter((entry) => Boolean(entry.row))
                          .map(({ label, row }) => (
                            <tr key={label} className="hover:bg-subtle/60">
                              <td className="py-2 px-3 type-table-cell text-ink font-medium whitespace-nowrap">
                                {label}
                              </td>
                              <td className="py-2 px-3 type-table-cell text-right numeral text-muted">
                                {row.totalCases}
                              </td>
                              <td className="py-2 px-3 type-table-cell text-right numeral text-ink whitespace-nowrap">
                                {row.grandTotalExactMatchPct}% ({row.grandTotalExactCount}/{row.totalCases})
                              </td>
                              <td className="py-2 px-3 type-table-cell text-right numeral text-muted">
                                {row.supplierGstinExactMatchPct}%
                              </td>
                              <td className="py-2 px-3 type-table-cell text-right numeral text-muted">
                                {row.lineCountRecallPct}%
                              </td>
                              <td className="py-2 px-3 type-table-cell text-right numeral text-muted">
                                {row.cleanArithmeticFpRatePct}%
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>

                  {hasAttacks ? (
                    <div className="overflow-x-auto rounded-lg border border-line">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-line bg-subtle text-faint">
                            <th className="py-2 px-3 type-table-head">Injection Style</th>
                            <th className="py-2 px-3 type-table-head text-right">Attacks</th>
                            <th className="py-2 px-3 type-table-head text-right">Guard Detect</th>
                            <th className="py-2 px-3 type-table-head text-right">Total Preserved</th>
                            <th className="py-2 px-3 type-table-head text-right">Defeated</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {data.injectionSummary.byAttackStyle.map((styleRow) => (
                            <tr key={styleRow.attackStyle} className="hover:bg-subtle/60">
                              <td className="py-2 px-3 type-table-cell font-code text-ink whitespace-nowrap">
                                {styleRow.attackStyle}
                              </td>
                              <td className="py-2 px-3 type-table-cell text-right numeral text-muted">
                                {styleRow.total}
                              </td>
                              <td className="py-2 px-3 type-table-cell text-right numeral text-ink whitespace-nowrap">
                                {styleRow.promptGuardDetected}/{styleRow.total} ({styleRow.promptGuardDetectedPct}%)
                              </td>
                              <td className="py-2 px-3 type-table-cell text-right numeral text-ink whitespace-nowrap">
                                {styleRow.grandTotalPreserved}/{styleRow.total} ({styleRow.grandTotalPreservedPct}%)
                              </td>
                              <td className="py-2 px-3 type-table-cell text-right whitespace-nowrap">
                                <span
                                  className={`inline-flex items-center whitespace-nowrap type-pill px-2 py-0.5 rounded ${
                                    styleRow.attackDefeated === styleRow.total
                                      ? "pill-success"
                                      : "pill-warning"
                                  }`}
                                >
                                  {styleRow.attackDefeated}/{styleRow.total} ({styleRow.attackDefeatedPct}%)
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-line max-h-80 overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-subtle z-10">
                      <tr className="border-b border-line text-faint">
                        <th className="py-2 px-3 type-table-head">Case ID</th>
                        <th className="py-2 px-3 type-table-head">Split / Degradation</th>
                        <th className="py-2 px-3 type-table-head text-right">Clarity</th>
                        <th className="py-2 px-3 type-table-head text-right">Lines</th>
                        <th className="py-2 px-3 type-table-head text-right">API Round-Trip</th>
                        <th className="py-2 px-3 type-table-head text-right">Outcome</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {data.results.map((row) => {
                        const isInj = row.attack !== null;
                        const pass = isInj
                          ? Boolean(row.attackDefeated)
                          : row.grandTotalMatched && !row.hasArithmeticMismatch;
                        return (
                          <tr key={row.caseId} className="hover:bg-subtle/60">
                            <td className="py-2 px-3 type-table-cell font-code text-ink whitespace-nowrap">
                              {row.caseId}
                            </td>
                            <td className="py-2 px-3 type-table-cell text-muted whitespace-nowrap">
                              {isInj
                                ? `${row.attack} (${row.attackStyle ?? "unknown"})`
                                : `${row.config} · ${row.level}`}
                            </td>
                            <td className="py-2 px-3 type-table-cell text-right numeral text-ink">
                              {row.clarityScore}/255
                            </td>
                            <td className="py-2 px-3 type-table-cell text-right numeral text-ink">
                              {row.extractedLineCount}/{row.expectedLineCount}
                            </td>
                            <td className="py-2 px-3 type-table-cell text-right numeral text-ink whitespace-nowrap">
                              {row.wallClockMs} ms
                            </td>
                            <td className="py-2 px-3 type-table-cell text-right whitespace-nowrap">
                              <span
                                className={`inline-flex items-center whitespace-nowrap type-pill px-2 py-0.5 rounded ${
                                  pass ? "pill-success" : "pill-warning"
                                }`}
                              >
                                {isInj
                                  ? row.attackDefeated
                                    ? row.promptGuardBlocked
                                      ? "Blocked"
                                      : "Math Safe"
                                    : "Miss"
                                  : row.grandTotalMatched
                                    ? "GT Match"
                                    : "Partial"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}

      {/* Additive Wave 2 GST 2.0 + Hardened E2E Reruns */}
      {v2Report || e2eV2Report ? (
        <div className="app-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="type-section text-ink">
                Additive Post-GST 2.0 &amp; Security Hardening Rerun (v2 Artifacts)
              </h2>
              <p className="type-meta text-muted mt-0.5">
                Additive Wave 2 reruns against updated date-effective GST 2.0 schedule and hardened prompt/OCR guards (baseline pinned artifacts above remain untouched).
              </p>
            </div>
            <span className="inline-flex items-center whitespace-nowrap pill-cobalt type-pill px-2 py-0.5 rounded">
              Additive v2 Run
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {v2Report ? (
              <div className="rounded-lg border border-line bg-subtle/60 p-3 space-y-1">
                <div className="type-kpi-label text-faint">500-Bill Synthetic Suite (v2)</div>
                <div className="type-section numeral text-ink">
                  F1 {v2Report.overall.f1Pct}% · Math {v2Report.overall.deterministicMathAccuracyPct.toFixed(1)}% · Red-Team {v2Report.redTeam.blockedOrIsolated}/{v2Report.redTeam.totalAttacks}
                </div>
                <div className="type-meta font-code text-muted">
                  Run {v2Report.runId} · {v2Report.ruleBundleVersion}
                </div>
              </div>
            ) : null}
            {e2eV2Report ? (
              <div className="rounded-lg border border-line bg-subtle/60 p-3 space-y-1">
                <div className="type-kpi-label text-faint">Executed Live E2E Lab Study (v2)</div>
                <div className="type-section numeral text-ink">
                  Images {e2eV2Report.imageSummary.totalCases} (p50 {e2eV2Report.imageSummary.wallClockP50Ms} ms) · Audio {e2eV2Report.audioSummary.totalClips} (p50 {e2eV2Report.audioSummary.totalE2eP50Ms} ms)
                </div>
                <div className="type-meta font-code text-muted">
                  Run {e2eV2Report.runId}
                  {e2eV2Report.targetCodeCommit ? ` · commit ${e2eV2Report.targetCodeCommit.slice(0, 7)}` : ""}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 50-Attack Adversarial Red-Team Evidence Table */}
      <div className="app-card p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="type-section text-ink flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-cobalt shrink-0" />
              Adversarial Red-Team Evaluation (6 Attack Families · {redTeamSource.redTeam.totalAttacks} Cases + Clean Controls)
            </h2>
            <p className="type-meta text-muted mt-0.5">
              Untrusted text notes and transcripts are screened separately from BigInt GST math, HSN slabs,
              and export eligibility (up to 2 representative cases sampled per Family A..F).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="type-meta font-code text-faint sm:hidden whitespace-nowrap">Scroll -&gt;</span>
            <div className="type-meta font-code text-muted">
              Canaries Scrubbed: {redTeamSource.redTeam.piiZeroLeakPassed}/{redTeamSource.redTeam.totalAttacks} · Engine Export False:{" "}
              {redTeamSource.redTeam.exportBlockedCount}/{redTeamSource.redTeam.totalAttacks}
            </div>
          </div>
        </div>

        {/* Filter Chips */}
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setFamilyFilter("all")}
            className={`type-pill px-2.5 py-1 rounded-md border cursor-pointer ${
              familyFilter === "all"
                ? "bg-accent text-accent-ink border-transparent"
                : "bg-surface text-muted border-line hover:text-ink"
            }`}
          >
            All Sample Logs ({representativeLogs.length})
          </button>
          {redTeamSource.redTeam.byFamily.map((fam) => (
            <button
              key={fam.family}
              type="button"
              onClick={() => setFamilyFilter(fam.family)}
              className={`type-pill px-2.5 py-1 rounded-md border cursor-pointer ${
                familyFilter === fam.family
                  ? "bg-accent text-accent-ink border-transparent"
                  : "bg-surface text-muted border-line hover:text-ink"
              }`}
            >
              {labelFor(ATTACK_FAMILY_LABELS, fam.family, fam.family)} ({fam.passed}/{fam.total})
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-line bg-subtle text-faint">
                <th className="py-2 px-3 type-table-head">Case ID</th>
                <th className="py-2 px-3 type-table-head">Family</th>
                <th className="py-2 px-3 type-table-head">Truncated Raw Payload Preview</th>
                <th className="py-2 px-3 type-table-head">Matched Rule</th>
                <th className="py-2 px-3 type-table-head text-right">Blocked / Isolated</th>
                <th className="py-2 px-3 type-table-head text-right">Tax Integrity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-3 px-3 type-meta text-muted text-center">
                    No individual preview row recorded for this family in the truncated sample log; see verified family score in the filter chips above.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.caseId} className="hover:bg-subtle/60">
                    <td className="py-2.5 px-3 type-table-cell font-code text-ink whitespace-nowrap">
                      {log.caseId}
                    </td>
                    <td className="py-2.5 px-3 type-table-cell text-muted whitespace-nowrap">
                      {labelFor(ATTACK_FAMILY_LABELS, log.family, log.family)}
                    </td>
                    <td className="py-2.5 px-3 type-table-cell font-code text-muted max-w-md truncate">
                      {log.payloadPreview}
                    </td>
                    <td className="py-2.5 px-3 type-table-cell font-code text-ink whitespace-nowrap">
                      {log.ruleMatched}
                    </td>
                    <td className="py-2.5 px-3 type-table-cell text-right whitespace-nowrap">
                      <span
                        className={`inline-flex items-center whitespace-nowrap type-pill px-2 py-0.5 rounded ${
                          log.quarantined ? "pill-success" : "pill-danger"
                        }`}
                      >
                        {log.quarantined ? "Blocked" : "Missed"}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 type-table-cell text-right whitespace-nowrap">
                      <span
                        className={`inline-flex items-center whitespace-nowrap type-pill px-2 py-0.5 rounded ${
                          log.taxUnchanged ? "pill-success" : "pill-danger"
                        }`}
                      >
                        {log.taxUnchanged ? "Intact" : "Drifted"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
