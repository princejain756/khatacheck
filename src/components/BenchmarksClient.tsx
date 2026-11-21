"use client";

import React, { useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock,
  Download,
  Lock,
  Play,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import {
  ATTACK_FAMILY_LABELS,
  FAULT_TYPE_LABELS,
  SUBGROUP_LABELS,
  labelFor,
} from "@/lib/display-labels";
import type { BenchmarkReport } from "@/lib/types";

interface Props {
  initialReport: BenchmarkReport;
}

export function BenchmarksClient({ initialReport }: Props) {
  const [report, setReport] = useState<BenchmarkReport>(initialReport);
  const [running, setRunning] = useState(false);
  const [lastElapsedMs, setLastElapsedMs] = useState<number | null>(null);
  const [familyFilter, setFamilyFilter] = useState<string>("all");
  const [runError, setRunError] = useState<string | null>(null);

  const rerunSuite = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const resp = await fetch("/api/benchmarks", {
        method: "POST",
        cache: "no-store",
      });
      const data = await resp.json();
      if (!resp.ok) {
        setRunError(data.error || "Failed to execute benchmark suite");
        return;
      }
      setReport(data.report);
      setLastElapsedMs(data.totalElapsedMs);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Network error while running suite");
    } finally {
      setRunning(false);
    }
  };

  const downloadReport = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], {
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

  const filteredLogs =
    familyFilter === "all"
      ? report.redTeam.sampleLogs
      : report.redTeam.sampleLogs.filter((item) => item.family === familyFilter);

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
            500-Invoice Verification Benchmarks & Fairness Parity
          </h1>
          <p className="type-body text-muted mt-0.5">
            Seeded synthetic verification run ({report.seed}), 5-subgroup launch gate, deterministic
            paise checks, and 50-attack red-team audit.
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
            <span className="font-semibold text-ink">Scope Honesty:</span> Metrics below are executed
            in-process on{" "}
            <span className="font-code text-ink">
              {report.totals.totalInvoices} synthetic bills + {report.totals.attackCases} adversarial
              cases
            </span>{" "}
            using <span className="font-code text-ink">{report.oracleProfile}</span>. Live 10-store
            Bengaluru field pilot:{" "}
            <span className="pill-warning type-pill px-2 py-0.5 rounded">
              Not Run ({report.latency.pilotProtocolStoreCount}-Store Protocol Ready)
            </span>
            .
          </div>
        </div>
        <div className="type-meta font-code text-faint shrink-0">
          Run {report.runId}
          {lastElapsedMs !== null ? ` · Re-executed in ${lastElapsedMs} ms` : ""}
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
            <span
              className={`type-pill px-2 py-0.5 rounded ${
                report.fairness.fairnessGatePassed ? "pill-success" : "pill-danger"
              }`}
            >
              Gap &lt;= {report.fairness.launchGateThresholdPct} pp Enforced
            </span>
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

      {/* 50-Attack Adversarial Red-Team Evidence Table */}
      <div className="app-card p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="type-section text-ink flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-cobalt" />
              Adversarial Red-Team Evaluation (6 Attack Families · 50 Cases + Clean Controls)
            </h2>
            <p className="type-meta text-muted mt-0.5">
              Untrusted OCR text and voice notes are isolated from GST math, HSN slabs, and cross-tenant
              queries.
            </p>
          </div>
          <div className="type-meta font-code text-muted">
            Zero PII Leaks: {report.redTeam.piiZeroLeakPassed}/{report.redTeam.totalAttacks} · Export Blocked:{" "}
            {report.redTeam.crossTenantIsolated}/{report.redTeam.totalAttacks}
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
            All Sample Logs ({report.redTeam.sampleLogs.length})
          </button>
          {report.redTeam.byFamily.map((fam) => (
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
                <th className="py-2 px-3 type-table-head">Redacted Payload Preview</th>
                <th className="py-2 px-3 type-table-head">Matched Rule</th>
                <th className="py-2 px-3 type-table-head text-right">Blocked / Isolated</th>
                <th className="py-2 px-3 type-table-head text-right">Tax Integrity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filteredLogs.map((log) => (
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
                      className={`type-pill px-2 py-0.5 rounded ${
                        log.quarantined ? "pill-success" : "pill-danger"
                      }`}
                    >
                      {log.quarantined ? "Blocked" : "Missed"}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 type-table-cell text-right whitespace-nowrap">
                    <span
                      className={`type-pill px-2 py-0.5 rounded ${
                        log.taxUnchanged ? "pill-success" : "pill-danger"
                      }`}
                    >
                      {log.taxUnchanged ? "Intact" : "Drifted"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
