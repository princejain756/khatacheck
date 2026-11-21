"use client";

import React, { useState } from "react";
import {
  AlertOctagon,
  CheckCircle2,
  Download,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { DECISION_LABELS, labelFor } from "@/lib/display-labels";
import type { AutomationBiasReport } from "@/lib/governance-ledger";
import { formatPaiseINR } from "@/lib/money";
import type { AuditLedgerEvent } from "@/lib/types";

interface ChainVerify {
  valid: boolean;
  totalEntries: number;
  headHash: string;
  brokenAtSeq: number | null;
  errorReason: string | null;
}

interface GateItem {
  gate: string;
  question: string;
  status: string;
  owner: string;
  evidence: string;
}

interface Props {
  initialEvents: AuditLedgerEvent[];
  initialVerification: ChainVerify;
  initialBias: AutomationBiasReport;
  gates: readonly GateItem[];
}

export function GovernanceClient({
  initialEvents,
  initialVerification,
  initialBias,
  gates,
}: Props) {
  const [events, setEvents] = useState<AuditLedgerEvent[]>(initialEvents);
  const [verification, setVerification] = useState<ChainVerify>(initialVerification);
  const [bias, setBias] = useState<AutomationBiasReport>(initialBias);
  const [tamperReport, setTamperReport] = useState<{
    tamperedSeq: number;
    description: string;
    verification: ChainVerify;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshLedger = async () => {
    setBusy(true);
    setTamperReport(null);
    try {
      const resp = await fetch("/api/ledger", { cache: "no-store" });
      const data = await resp.json();
      setEvents(data.events);
      setVerification(data.verification);
      setBias(data.biasMonitor);
    } finally {
      setBusy(false);
    }
  };

  const runCopyTamperSim = async () => {
    setBusy(true);
    try {
      const resp = await fetch("/api/audit/tamper-test", { method: "POST" });
      const data = await resp.json();
      setTamperReport(data);
    } finally {
      setBusy(false);
    }
  };

  const runBiasAction = async (action: "stress-bias" | "reset-demo") => {
    setBusy(true);
    setTamperReport(null);
    try {
      const resp = await fetch("/api/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setEvents(data.events);
        setVerification(data.verification);
        setBias(data.biasMonitor);
      }
    } finally {
      setBusy(false);
    }
  };

  const defaultTallyApproved = events.some(
    (e) =>
      e.invoiceId === "SCN-01-KIRANA-SHORT" &&
      (e.decision === "approved_flag" || e.decision === "overridden_clean")
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="type-page text-ink">ISO/IEC 42001 Governance & Audit Ledger</h1>
          <p className="type-body text-muted mt-0.5">
            Append-only SHA-256 hash chain, Automation Bias Oversight Monitor, and 5-Gate Lifecycle Sign-Off Matrix.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/api/export?format=audit-manifest"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-line-strong type-pill text-ink hover:bg-subtle"
          >
            <Download className="w-3.5 h-3.5" />
            ISO 42001 JSON Manifest
          </a>
          {defaultTallyApproved ? (
            <a
              href="/api/export?format=tally-xml&scenarioId=SCN-01-KIRANA-SHORT"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-line-strong type-pill text-ink hover:bg-subtle"
            >
              <Download className="w-3.5 h-3.5" />
              Tally Sandbox XML
            </a>
          ) : (
            <button
              type="button"
              disabled
              title="Approve or override a review decision first to enable Tally Sandbox XML export"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-line type-pill text-faint opacity-60 cursor-not-allowed"
            >
              <Lock className="w-3.5 h-3.5" />
              Tally XML (Approval Required)
            </button>
          )}
        </div>
      </div>

      {/* 4 Primary Governance KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <div className="app-card p-4">
          <div className="type-kpi-label text-faint">Cryptographic Chain</div>
          <div className="type-kpi-value text-ink mt-1 flex items-center gap-2">
            {verification.valid ? (
              <>
                <ShieldCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                <span>Intact</span>
              </>
            ) : (
              <>
                <AlertOctagon className="w-6 h-6 text-red-600" />
                <span>Broken</span>
              </>
            )}
          </div>
          <div className="type-meta font-code text-muted mt-1 truncate">
            Head {verification.headHash.slice(0, 14)}… ({verification.totalEntries} rows)
          </div>
        </div>

        <div className="app-card p-4">
          <div className="type-kpi-label text-faint">Completed Decisions</div>
          <div className="type-kpi-value numeral text-ink mt-1">{bias.completedDecisions}</div>
          <div className="type-meta text-muted mt-1">
            Approval <span className="numeral">{bias.approvalRatePct}%</span> · Overrides{" "}
            <span className="numeral">{bias.overriddenCount}</span>
          </div>
        </div>

        <div className="app-card p-4">
          <div className="type-kpi-label text-faint">Median Review Dwell</div>
          <div className="type-kpi-value numeral text-ink mt-1">
            {(bias.medianDwellMs / 1000).toFixed(1)}s
          </div>
          <div className="type-meta text-muted mt-1">
            Alert gate: n &gt;= 50, approval &gt; 95%, 0 &lt; dwell &lt; 3s
          </div>
        </div>

        <div className="app-card p-4">
          <div className="type-kpi-label text-faint">Lifecycle Gates</div>
          <div className="type-kpi-value numeral text-ink mt-1">4 / 5 Pass</div>
          <div className="type-meta text-muted mt-1">Gate 5 Live Retail Pilot: Hold until launch</div>
        </div>
      </div>

      {/* Automation Bias Monitor & Tamper Verification Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="app-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="type-section text-ink">Automation Bias Monitor (NeuraViz Ch. 8)</h2>
            <span
              className={`type-pill px-2 py-0.5 rounded ${
                bias.alertActive
                  ? "pill-danger"
                  : bias.thresholdMet
                    ? "pill-success"
                    : "pill-neutral"
              }`}
            >
              {bias.alertActive
                ? "Bias Alert Active"
                : bias.thresholdMet
                  ? "Healthy Oversight"
                  : "Sample < 50"}
            </span>
          </div>
          <p className="type-body text-muted leading-relaxed">{bias.statusText}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => runBiasAction("stress-bias")}
              className="px-3 py-1.5 rounded-lg bg-accent text-accent-ink type-pill cursor-pointer hover:opacity-90"
            >
              Simulate 50 Rapid Rubber-Stamp Approvals
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => runBiasAction("reset-demo")}
              className="px-3 py-1.5 rounded-lg bg-surface border border-line-strong type-pill text-ink cursor-pointer hover:bg-subtle"
            >
              Reset Demo Ledger
            </button>
          </div>
        </div>

        <div className="app-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="type-section text-ink">Copy-Only Tamper Detection Test</h2>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={refreshLedger}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface border border-line-strong type-pill text-ink cursor-pointer hover:bg-subtle"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Verify Chain
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={runCopyTamperSim}
                className="px-3 py-1 rounded-lg bg-subtle border border-line-strong type-pill text-ink cursor-pointer hover:bg-rail-hover"
              >
                Simulate Copy Tamper
              </button>
            </div>
          </div>
          {tamperReport ? (
            <div className="p-3 rounded-lg pill-danger space-y-1">
              <div className="flex items-center gap-1.5 type-table-cell font-semibold">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                {tamperReport.verification.errorReason}
              </div>
              <p className="type-meta">{tamperReport.description}</p>
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-subtle border border-line type-body text-muted">
              Each ledger event hashes <span className="font-code">sha256(prevHash + &quot;\n&quot; + canonicalJson(event))</span>. Click &quot;Simulate Copy Tamper&quot; to test mid-chain modification detection in memory without mutating disk records.
            </div>
          )}
        </div>
      </div>

      {/* 5-Gate Lifecycle Sign-Off Matrix */}
      <div className="app-card overflow-hidden">
        <div className="px-4 py-3 border-b border-line">
          <h2 className="type-section text-ink">5-Gate AI Lifecycle Sign-Off Matrix</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-line bg-subtle text-faint">
                <th className="py-2 px-3 type-table-head">Lifecycle Gate</th>
                <th className="py-2 px-3 type-table-head">Status</th>
                <th className="py-2 px-3 type-table-head">Accountable Owner</th>
                <th className="py-2 px-3 type-table-head">Implemented Evidence</th>
              </tr>
            </thead>
            <tbody>
              {gates.map((g) => (
                <tr key={g.gate} className="border-b border-line last:border-b-0">
                  <td className="py-2.5 px-3 type-table-cell">
                    <div className="font-semibold text-ink">{g.gate}</div>
                    <div className="type-meta text-faint">{g.question}</div>
                  </td>
                  <td className="py-2.5 px-3 type-table-cell whitespace-nowrap">
                    <span
                      className={`type-pill px-2 py-0.5 rounded whitespace-nowrap ${
                        g.status === "PASS" ? "pill-success" : "pill-warning"
                      }`}
                    >
                      {g.status === "PASS" ? "Passed" : "Hold (Pending Pilot)"}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 type-table-cell text-muted">{g.owner}</td>
                  <td className="py-2.5 px-3 type-table-cell text-muted">{g.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live Hash-Chained Audit Ledger Table */}
      <div className="app-card overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
          <h2 className="type-section text-ink">Append-Only Audit Ledger (Recent Entries)</h2>
          <span className="type-meta text-faint numeral">Showing latest {Math.min(15, events.length)} of {events.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-line bg-subtle text-faint">
                <th className="py-2 px-3 type-table-head">Seq · Invoice</th>
                <th className="py-2 px-3 type-table-head">Human Decision</th>
                <th className="py-2 px-3 type-table-head text-right">Variance</th>
                <th className="py-2 px-3 type-table-head text-right">Dwell</th>
                <th className="py-2 px-3 type-table-head">Entry SHA-256 Digest</th>
              </tr>
            </thead>
            <tbody>
              {[...events]
                .reverse()
                .slice(0, 15)
                .map((evt) => (
                  <tr key={evt.seq} className="border-b border-line last:border-b-0">
                    <td className="py-2.5 px-3 type-table-cell">
                      <div className="font-medium text-ink">
                        #{evt.seq} · {evt.invoiceNumber}
                      </div>
                      <div className="type-meta text-faint">{evt.vendorName}</div>
                    </td>
                    <td className="py-2.5 px-3 type-table-cell">
                      <span
                        className={`type-pill px-2 py-0.5 rounded ${
                          evt.decision === "approved_flag"
                            ? "pill-cobalt"
                            : evt.decision === "overridden_clean" || evt.decision === "contested_appeal"
                              ? "pill-warning"
                              : "pill-neutral"
                        }`}
                      >
                        {labelFor(DECISION_LABELS, evt.decision, "Recorded")}
                      </span>
                      {evt.overrideReason && (
                        <div className="type-meta text-muted mt-1">{evt.overrideReason}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 type-table-cell text-right numeral text-ink">
                      {formatPaiseINR(evt.varianceAtRiskPaise)}
                    </td>
                    <td className="py-2.5 px-3 type-table-cell text-right numeral text-muted">
                      {evt.dwellMs ? `${(evt.dwellMs / 1000).toFixed(1)}s` : "n/a"}
                    </td>
                    <td className="py-2.5 px-3 type-table-cell font-code text-faint">
                      <div className="flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span>{evt.entryHash.slice(0, 18)}…</span>
                      </div>
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
