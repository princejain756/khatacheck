"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  Download,
  EyeOff,
  FileLock2,
  Languages,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { DPDP_CONSENT_NOTICE, DPDP_GRIEVANCE_EMAIL } from "@/lib/dpdp-privacy";

interface ConsentStateView {
  consented: boolean;
  noticeVersion: string;
  timestampIso: string | null;
}

interface Props {
  initialEventCount: number;
  initialConsent?: ConsentStateView;
}

const DEFAULT_SCRUB_SAMPLE =
  "Supplier GSTIN 29AABCS1429B1Z5 delivered 20 bags. Walk-in customer Ramesh (+91 9845012345, ramesh.sharma@gmail.com) paid via ramesh99@okicici. Reference PAN ABCDE1234F kept accidentally on slip.";

export function PrivacyClient({ initialEventCount, initialConsent }: Props) {
  const [lang, setLang] = useState<"en" | "hi">("en");
  const [sampleText, setSampleText] = useState(DEFAULT_SCRUB_SAMPLE);
  const [scrubResult, setScrubResult] = useState<{
    scrubbedText: string;
    redactionCount: number;
    redactedKinds: string[];
  } | null>(null);
  const [eventCount, setEventCount] = useState(initialEventCount);
  const [consent, setConsent] = useState<ConsentStateView>(
    initialConsent ?? {
      consented: false,
      noticeVersion: DPDP_CONSENT_NOTICE.version,
      timestampIso: null,
    }
  );
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeNotice = lang === "en" ? DPDP_CONSENT_NOTICE.en : DPDP_CONSENT_NOTICE.hi;

  const runScrubber = async (inputText: string) => {
    setBusy(true);
    try {
      const resp = await fetch("/api/privacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scrub", text: inputText }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setScrubResult(data);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleConsentAction = async (action: "grant_consent" | "withdraw_consent") => {
    setBusy(true);
    try {
      const resp = await fetch("/api/privacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, noticeVersion: DPDP_CONSENT_NOTICE.version }),
      });
      const data = await resp.json();
      if (resp.ok) {
        if (data.consent) setConsent(data.consent);
        if (typeof data.remainingCount === "number") setEventCount(data.remainingCount);
        else if (typeof data.eventCount === "number") setEventCount(data.eventCount);
        setConfirmDeleteOpen(false);
        setStatusNotice(data.notice || `DPDP consent state updated (${action}).`);
      } else {
        setStatusNotice(data.error || "Failed to update DPDP consent state.");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteData = async () => {
    setBusy(true);
    try {
      const resp = await fetch("/api/privacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete" }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setEventCount(data.remainingCount);
        if (data.consent) setConsent(data.consent);
        setConfirmDeleteOpen(false);
        setStatusNotice(`${data.notice} (${data.deletedAtIso})`);
      } else {
        setStatusNotice(data.error || "Failed to erase store user data.");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreDemo = async () => {
    setBusy(true);
    try {
      const resp = await fetch("/api/privacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setEventCount(data.eventCount);
        setConfirmDeleteOpen(false);
        setStatusNotice(
          `Demo dataset restored cleanly (${data.eventCount} canonical review events as of ${data.restoredAtIso}).`
        );
      } else {
        setStatusNotice(data.error || "Failed to restore demo dataset.");
      }
    } finally {
      setBusy(false);
    }
  };

  const retentionSchedule = [
    {
      artifact: "Supplier Bill Photos (PNG/JPG/WebP)",
      egress:
        "Local on-server Tesseract OCR + DPDP text scrub prior to optional scrubbed-text structuring (qwen/qwen3.8-27b fallback only)",
      ttl: "Planned automated 30-day expiry (Days 61 to 90; Stage 4 runs in-memory)",
      retained: "SHA-256 + tax math hash",
    },
    {
      artifact: "Explicitly Recorded / Uploaded Voice Notes",
      egress:
        "Raw audio sent to Groq Whisper ASR (whisper-large-v3-turbo), followed by immediate on-server DPDP scrub before verification",
      ttl: "Planned automated 30-day expiry (Days 61 to 90; Stage 4 runs in-memory)",
      retained: "Dispute delta & scrubbed transcript",
    },
    {
      artifact: "Walk-in Phone, UPI, PAN, Aadhaar",
      egress: "On-server regex scrub masks OCR and ASR text prior to any LLM call",
      ttl: "Masked in scrubbed OCR & ASR text",
      retained: "Seeded rows PII-free; persisted ledger strings including overrideReason scrubbed on-server",
    },
    {
      artifact: "Supplier 15-Char GSTIN",
      egress: "Permitted under DPDP s. 3(c)(ii) public tax ID rule (proprietor GSTIN embeds business PAN)",
      ttl: "Audit window",
      retained: "Mod-36 check & HSN ledger",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="type-page text-ink">DPDP Act 2023 Privacy, Masking & Data Erasure</h1>
          <p className="type-body text-muted mt-0.5">
            Local Tesseract OCR + mandatory on-server DPDP text scrub before optional scrubbed-text structuring,
            explicit voice audio disclosed to Groq Whisper ASR, bilingual notice ({DPDP_CONSENT_NOTICE.version}),
            ss. 11 to 14 rights, and planned Days 61 to 90 expiry.
          </p>
        </div>
        <a
          href="/api/privacy"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-line-strong type-pill text-ink hover:bg-subtle self-start sm:self-auto whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          Export Store JSON Ledger
        </a>
      </div>

      {/* 4 DPDP KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <div className="app-card p-4">
          <div className="type-kpi-label text-faint">Consent Notice &amp; Status</div>
          <div className="type-section font-code text-ink mt-1.5">{consent.noticeVersion}</div>
          <div className="type-meta text-muted mt-1">
            {consent.consented ? "Consent Recorded" : "Consent Pending / Withdrawn"} · EN + HI
          </div>
        </div>

        <div className="app-card p-4">
          <div className="type-kpi-label text-faint">Raw Media Retention Policy</div>
          <div className="type-kpi-value numeral text-ink mt-1">
            {DPDP_CONSENT_NOTICE.retentionDays} Days (Planned)
          </div>
          <div className="type-meta text-muted mt-1">Days 61 to 90 auto-purge planned (in-memory demo)</div>
        </div>

        <div className="app-card p-4">
          <div className="type-kpi-label text-faint">Masked Identifier Classes</div>
          <div className="type-kpi-value numeral text-ink mt-1">5 Classes</div>
          <div className="type-meta text-muted mt-1">Mobile, Email, PAN, Aadhaar, UPI (GSTIN kept)</div>
        </div>

        <div className="app-card p-4">
          <div className="type-kpi-label text-faint">Persisted Ledger Events</div>
          <div className="type-kpi-value numeral text-ink mt-1">{eventCount}</div>
          <div className="type-meta text-muted mt-1">Tenant: store-ganesh-blr-01</div>
        </div>
      </div>

      {/* Interactive Consent Capture Bar (DPDP ss. 6 & 11-14) */}
      <div className="app-card p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="type-section text-ink">DPDP Consent Capture ({DPDP_CONSENT_NOTICE.version})</h2>
            <span
              className={`inline-flex items-center whitespace-nowrap type-pill px-2 py-0.5 rounded ${
                consent.consented ? "pill-success" : "pill-warning"
              }`}
            >
              {consent.consented ? "Consent Recorded" : "Awaiting Owner Consent"}
            </span>
          </div>
          <p className="type-meta text-muted">
            {consent.consented && consent.timestampIso
              ? `Recorded under ${consent.noticeVersion} at ${consent.timestampIso}. Withdrawing consent erases user-submitted records while preserving the 4 seeded demo genesis rows.`
              : `Record affirmative owner consent for ${DPDP_CONSENT_NOTICE.version}, or withdraw consent to trigger user-data erasure. Grievance Officer: ${DPDP_GRIEVANCE_EMAIL}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleConsentAction("grant_consent")}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-accent text-accent-ink type-pill hover:opacity-90 disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            {consent.consented ? "Re-Record Consent (v1.3)" : "Grant Consent (v1.3)"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleConsentAction("withdraw_consent")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/40 pill-danger type-pill hover:opacity-90 disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0" />
            Withdraw Consent &amp; Erase User Data
          </button>
        </div>
      </div>

      {/* Notice + Live PII Scrubber */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-6 app-card p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="type-section text-ink flex items-center gap-1.5">
              <FileLock2 className="w-4 h-4 text-cobalt" />
              Store Owner Privacy Notice
            </h2>
            <div className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
              <button
                type="button"
                onClick={() => setLang("en")}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md type-pill cursor-pointer ${
                  lang === "en" ? "bg-surface text-ink shadow-xs" : "text-muted hover:text-ink"
                }`}
              >
                <Languages className="w-3.5 h-3.5" />
                English
              </button>
              <button
                type="button"
                onClick={() => setLang("hi")}
                className={`px-2.5 py-1 rounded-md type-pill cursor-pointer ${
                  lang === "hi" ? "bg-surface text-ink shadow-xs" : "text-muted hover:text-ink"
                }`}
              >
                हिन्दी
              </button>
            </div>
          </div>

          <div className="rounded-lg bg-subtle/70 border border-line p-3.5 space-y-2.5">
            <div className="type-meta font-semibold text-ink">{activeNotice.title}</div>
            <div className="space-y-2 type-meta text-muted leading-relaxed">
              <p>
                <span className="font-semibold text-ink">1. Purpose Limitation: </span>
                {activeNotice.purpose}
              </p>
              <p>
                <span className="font-semibold text-ink">2. Data Minimization: </span>
                {activeNotice.minimization}
              </p>
              <p>
                <span className="font-semibold text-ink">3. Storage Retention: </span>
                {activeNotice.retention}
              </p>
              <p>
                <span className="font-semibold text-ink">4. Data Principal Rights (ss. 11 to 14): </span>
                {activeNotice.rights}
              </p>
            </div>
            <div className="pt-2 border-t border-line/70 flex flex-wrap items-center gap-1.5">
              {["Access (s.11)", "Correction (s.12)", "Erasure (s.12)", "Grievance Redressal (s.13)", "Nomination (s.14)"].map(
                (right) => (
                  <span key={right} className="inline-flex items-center whitespace-nowrap type-pill px-2 py-0.5 rounded pill-neutral">
                    {right}
                  </span>
                )
              )}
              <span className="type-meta text-muted">
                Grievance contact: <span className="font-code text-ink">{DPDP_GRIEVANCE_EMAIL}</span>
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-faint sm:hidden">
            <span>Retention &amp; egress matrix</span>
            <span className="font-code">Scroll -&gt;</span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-line bg-subtle text-faint">
                  <th className="py-2 px-3 type-table-head">Data Element</th>
                  <th className="py-2 px-3 type-table-head">Model Egress</th>
                  <th className="py-2 px-3 type-table-head">Retention Policy</th>
                  <th className="py-2 px-3 type-table-head">Audit Kept</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {retentionSchedule.map((row) => (
                  <tr key={row.artifact} className="hover:bg-subtle/60 align-top">
                    <td className="py-2 px-2.5 type-table-cell font-medium text-ink">{row.artifact}</td>
                    <td className="py-2 px-2.5 type-table-cell text-muted">{row.egress}</td>
                    <td className="py-2 px-2.5 type-table-cell numeral text-ink">
                      {row.ttl}
                    </td>
                    <td className="py-2 px-2.5 type-table-cell text-muted">{row.retained}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-6 app-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="type-section text-ink flex items-center gap-1.5">
              <EyeOff className="w-4 h-4 text-cobalt" />
              Server-Side PII Redaction Sandbox
            </h2>
            <span className="pill-success type-pill px-2 py-0.5 rounded">GSTIN Spans Preserved</span>
          </div>
          <p className="type-meta text-muted">
            Embedded 10-character PAN substrings inside 15-character statutory supplier GSTIN tokens are
            preserved cleanly while walk-in customer PAN, mobile, email, Aadhaar, and UPI handles are
            masked.
          </p>

          <textarea
            value={sampleText}
            onChange={(e) => setSampleText(e.target.value)}
            rows={4}
            aria-label="Raw text for DPDP PII scrubbing"
            className="w-full app-field p-3 type-meta font-code resize-y"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => runScrubber(sampleText)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-accent text-accent-ink type-pill hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Run DPDP Scrubber
            </button>
            <button
              type="button"
              onClick={() => {
                setSampleText(DEFAULT_SCRUB_SAMPLE);
                runScrubber(DEFAULT_SCRUB_SAMPLE);
              }}
              className="px-3 py-1.5 rounded-lg bg-surface border border-line-strong type-pill text-ink hover:bg-subtle cursor-pointer"
            >
              Load Mixed Invoice Slip
            </button>
            <button
              type="button"
              onClick={() => {
                const aadhaarSample =
                  "Challan for GSTIN 27AAACP1234A1Z9. Staff ID 4829 1938 7710 copied by error; notify owner@kiranashop.in or 9980112233.";
                setSampleText(aadhaarSample);
                runScrubber(aadhaarSample);
              }}
              className="px-3 py-1.5 rounded-lg bg-surface border border-line-strong type-pill text-ink hover:bg-subtle cursor-pointer"
            >
              Test Aadhaar + GSTIN Mix
            </button>
          </div>

          {scrubResult ? (
            <div className="rounded-lg border border-line bg-subtle p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="type-kpi-label text-ink flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  Masked Text Output (Local Server Scrubber)
                </span>
                <span className="pill-cobalt type-pill px-2 py-0.5 rounded font-code">
                  {scrubResult.redactionCount} redactions
                </span>
              </div>
              <pre className="type-meta font-code text-ink whitespace-pre-wrap break-words bg-surface p-2.5 rounded border border-line">
                {scrubResult.scrubbedText}
              </pre>
              <div className="type-meta text-muted">
                Redacted kinds:{" "}
                <span className="font-code text-ink">
                  {scrubResult.redactedKinds.length > 0
                    ? scrubResult.redactedKinds.join(", ")
                    : "none"}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Store Data Lifecycle & /delete-data Endpoint Controls */}
      <div className="app-card p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="type-section text-ink">Store Data Erasure & Demo Recovery Controls</h2>
            <p className="type-meta text-muted mt-0.5">
              Supports user-data erasure via POST /api/privacy (clearing user rows seq 5+ while preserving the 4 seeded baseline demo rows with a hash-chained DPDP reset entry).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!confirmDeleteOpen ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmDeleteOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/40 pill-danger type-pill hover:opacity-90 cursor-pointer whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                Erase User Data (/delete-data)
              </button>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 bg-subtle px-2.5 py-1">
                <span className="type-meta text-ink font-medium">Erase user rows (keep 4 seeded)?</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleDeleteData}
                  className="px-2.5 py-1 rounded bg-red-600 text-white type-pill hover:bg-red-700 cursor-pointer"
                >
                  Confirm Wipe
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteOpen(false)}
                  className="px-2 py-1 rounded bg-surface border border-line text-muted type-pill hover:text-ink cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={handleRestoreDemo}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-line-strong type-pill text-ink hover:bg-subtle cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restore Demo Dataset
            </button>
          </div>
        </div>

        {statusNotice ? (
          <div className="rounded-lg border border-line bg-subtle p-3 type-meta text-ink">
            {statusNotice}
          </div>
        ) : null}
      </div>
    </div>
  );
}
