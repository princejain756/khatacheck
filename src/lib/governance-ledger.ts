import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { RULE_BUNDLE_VERSION } from "./gst-rules";
import { formatPaiseDecimalString } from "./money";
import type { AuditLedgerEvent, CropBbox, InvoiceInput, ReviewDecision } from "./types";

export const GENESIS_HASH = "0".repeat(64);
const DATA_DIR = path.join(process.cwd(), "data");
const LEDGER_PATH = path.join(DATA_DIR, "audit-ledger.jsonl");

function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const rec = obj as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
}

export function computeLedgerEntryHash(
  prevHash: string,
  eventWithoutHash: Omit<AuditLedgerEvent, "entryHash">
): string {
  const payload = `${prevHash}\n${canonicalJson(eventWithoutHash)}`;
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

function ensureLedgerSeeded(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(LEDGER_PATH) || fs.readFileSync(LEDGER_PATH, "utf8").trim() === "") {
    seedDefaultLedger();
  }
}

export function seedDefaultLedger(): AuditLedgerEvent[] {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const initialSeeds: Array<Omit<AuditLedgerEvent, "seq" | "prevHash" | "entryHash">> = [
    {
      eventId: "EVT-1001",
      tenantId: "store-ganesh-blr-01",
      invoiceId: "SCN-01-KIRANA-SHORT",
      invoiceNumber: "SLGW/24-25/0736",
      vendorName: "Shree Lakshmi General Wholesalers",
      billSha256: "a84e3d9c5f14b2116e7e98a003c7f19f891a4b67c5319023e014e1b881a4d7c1",
      billReceivedTs: "2026-11-20T09:14:00.000Z",
      flagSentTs: "2026-11-20T09:14:00.412Z",
      ownerApprovalTs: "2026-11-20T09:14:28.900Z",
      modelId: "khatacheck-hybrid-ocr-v1+deterministic-gst",
      promptHash: "sha256:b391a0d788c312e5",
      ruleBundleVersion: RULE_BUNDLE_VERSION,
      fieldConfidencesMin: 0.94,
      sourceCropBbox: { id: "row-1", label: "Row 1 · Toor Dal (50 Kg)", topPct: 47, leftPct: 8, widthPct: 84, heightPct: 5, lineNumber: 1 },
      ruleChecks: ["GSTIN-MOD36-CHECK", "MATH-LINE-BIGINT-PAISE", "VOICE-SHORTAGE-RECON"],
      varianceAtRiskPaise: "61950",
      decision: "approved_flag",
      overrideReason: "",
      dwellMs: 28488,
      actorRef: "owner_ganesh_01",
    },
    {
      eventId: "EVT-1002",
      tenantId: "store-ganesh-blr-01",
      invoiceId: "SCN-02-PHARMACY-HSN",
      invoiceNumber: "MED/26-27/4418",
      vendorName: "Kaveri Surgical & Pharma Distributors",
      billSha256: "f412bc194aa279d0e8c331f5130a870cc41e2aa0998b7c0018a6235b79c4d812",
      billReceivedTs: "2026-11-20T11:42:10.000Z",
      flagSentTs: "2026-11-20T11:42:10.355Z",
      ownerApprovalTs: "2026-11-20T11:42:46.100Z",
      modelId: "khatacheck-hybrid-ocr-v1+deterministic-gst",
      promptHash: "sha256:b391a0d788c312e5",
      ruleBundleVersion: RULE_BUNDLE_VERSION,
      fieldConfidencesMin: 0.97,
      sourceCropBbox: { id: "row-2", label: "Row 2 · HSN 3004 Tax 18% vs 12%", topPct: 54, leftPct: 8, widthPct: 84, heightPct: 6, lineNumber: 2 },
      ruleChecks: ["GSTIN-MOD36-CHECK", "HSN-3004-12", "MATH-LINE-BIGINT-PAISE"],
      varianceAtRiskPaise: "144000",
      decision: "approved_flag",
      overrideReason: "",
      dwellMs: 35745,
      actorRef: "owner_ganesh_01",
    },
    {
      eventId: "EVT-1003",
      tenantId: "store-ganesh-blr-01",
      invoiceId: "SCN-03-TEXTILE-DRIFT",
      invoiceNumber: "KPT/26-27/1190",
      vendorName: "Karnataka Powerloom Textiles Pvt Ltd",
      billSha256: "7b21ee341ac98d44f08c237f92b4e5a011223344556677889900aabbccddeeff",
      billReceivedTs: "2026-11-21T07:20:00.000Z",
      flagSentTs: "2026-11-21T07:20:00.289Z",
      ownerApprovalTs: "2026-11-21T07:20:42.800Z",
      modelId: "khatacheck-hybrid-ocr-v1+deterministic-gst",
      promptHash: "sha256:b391a0d788c312e5",
      ruleBundleVersion: RULE_BUNDLE_VERSION,
      fieldConfidencesMin: 0.96,
      sourceCropBbox: { id: "row-1", label: "Row 1 · Cotton Cambric Rate Creep", topPct: 48, leftPct: 8, widthPct: 84, heightPct: 6, lineNumber: 1 },
      ruleChecks: ["GSTIN-MOD36-CHECK", "HSN-5208-5", "DRIFT-90D-MEDIAN-20PCT"],
      varianceAtRiskPaise: "240000",
      decision: "overridden_clean",
      overrideReason: "Agreed festive season combed-yarn price revision on phone with distributor.",
      dwellMs: 42511,
      actorRef: "owner_ganesh_01",
    },
    {
      eventId: "EVT-1004",
      tenantId: "store-ganesh-blr-01",
      invoiceId: "SCN-05-PROMPT-INJECT",
      invoiceNumber: "ADV/26-27/9901",
      vendorName: "Unverified Trader Demo Co",
      billSha256: "10a3b9c8d7e6f501928374650192837465019283746501928374650192837465",
      billReceivedTs: "2026-11-21T10:05:00.000Z",
      flagSentTs: "2026-11-21T10:05:00.198Z",
      ownerApprovalTs: "2026-11-21T10:05:31.500Z",
      modelId: "khatacheck-hybrid-ocr-v1+deterministic-gst",
      promptHash: "sha256:quarantined-guard-v1",
      ruleBundleVersion: RULE_BUNDLE_VERSION,
      fieldConfidencesMin: 0.91,
      sourceCropBbox: null,
      ruleChecks: ["PG-A01-IGNORE-POLICY", "PG-A02-FORCE-APPROVE", "HSN-1701-5"],
      varianceAtRiskPaise: "84000",
      decision: "contested_appeal",
      overrideReason: "Escalated suspicious tax-zeroing note in vendor bill to CA audit queue.",
      dwellMs: 31302,
      actorRef: "owner_ganesh_01",
    },
  ];

  const built: AuditLedgerEvent[] = [];
  let prevHash = GENESIS_HASH;
  initialSeeds.forEach((item, idx) => {
    const seq = idx + 1;
    const base: Omit<AuditLedgerEvent, "entryHash"> = { seq, ...item, prevHash };
    const entryHash = computeLedgerEntryHash(prevHash, base);
    built.push({ ...base, entryHash });
    prevHash = entryHash;
  });

  fs.writeFileSync(LEDGER_PATH, built.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  return built;
}

export function readLedgerEvents(): AuditLedgerEvent[] {
  ensureLedgerSeeded();
  const raw = fs.readFileSync(LEDGER_PATH, "utf8");
  const events: AuditLedgerEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as AuditLedgerEvent);
    } catch {
      // Ignore torn tail gracefully for resilience
    }
  }
  return events;
}

export function isInvoiceApprovedInEvents(events: AuditLedgerEvent[], invoiceId: string): boolean {
  return events.some(
    (e) =>
      e.invoiceId === invoiceId &&
      (e.decision === "approved_flag" || e.decision === "overridden_clean")
  );
}

export function getApprovedInvoiceIds(): string[] {
  const events = readLedgerEvents();
  const ids = new Set<string>();
  for (const e of events) {
    if (e.decision === "approved_flag" || e.decision === "overridden_clean") {
      ids.add(e.invoiceId);
    }
  }
  return [...ids];
}

export function hasApprovedLedgerDecision(invoiceId: string): boolean {
  return isInvoiceApprovedInEvents(readLedgerEvents(), invoiceId);
}

export function appendLedgerDecision(input: {
  tenantId: string;
  invoiceId: string;
  invoiceNumber: string;
  vendorName: string;
  billSha256: string;
  billReceivedTs: string;
  flagSentTs: string;
  fieldConfidencesMin: number;
  sourceCropBbox: CropBbox | null;
  ruleChecks: string[];
  varianceAtRiskPaise: string;
  decision: ReviewDecision;
  overrideReason: string;
  dwellMs: number;
  actorRef?: string;
  isSyntheticStress?: boolean;
}): AuditLedgerEvent {
  const existing = readLedgerEvents();
  const last = existing[existing.length - 1];
  const seq = last ? last.seq + 1 : 1;
  const prevHash = last ? last.entryHash : GENESIS_HASH;

  const base: Omit<AuditLedgerEvent, "entryHash"> = {
    seq,
    eventId: `EVT-${1000 + seq}`,
    tenantId: input.tenantId,
    invoiceId: input.invoiceId,
    invoiceNumber: input.invoiceNumber,
    vendorName: input.vendorName,
    billSha256: input.billSha256,
    billReceivedTs: input.billReceivedTs,
    flagSentTs: input.flagSentTs,
    ownerApprovalTs: new Date().toISOString(),
    modelId: "khatacheck-hybrid-ocr-v1+deterministic-gst",
    promptHash: "sha256:b391a0d788c312e5",
    ruleBundleVersion: RULE_BUNDLE_VERSION,
    fieldConfidencesMin: input.fieldConfidencesMin,
    sourceCropBbox: input.sourceCropBbox,
    ruleChecks: input.ruleChecks,
    varianceAtRiskPaise: input.varianceAtRiskPaise,
    decision: input.decision,
    overrideReason: input.overrideReason,
    dwellMs: Math.max(0, Math.round(input.dwellMs)),
    actorRef: input.actorRef ?? "owner_ganesh_01",
    isSyntheticStress: input.isSyntheticStress,
    prevHash,
  };

  const entryHash = computeLedgerEntryHash(prevHash, base);
  const fullEvent: AuditLedgerEvent = { ...base, entryHash };
  fs.appendFileSync(LEDGER_PATH, JSON.stringify(fullEvent) + "\n", "utf8");
  return fullEvent;
}

export function clearLedgerForPrivacyDelete(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(LEDGER_PATH, "", "utf8");
}

export function verifyHashChain(events: AuditLedgerEvent[]): {
  valid: boolean;
  totalEntries: number;
  headHash: string;
  brokenAtSeq: number | null;
  errorReason: string | null;
} {
  if (events.length === 0) {
    return {
      valid: true,
      totalEntries: 0,
      headHash: GENESIS_HASH,
      brokenAtSeq: null,
      errorReason: null,
    };
  }
  let expectedPrev = GENESIS_HASH;
  for (let i = 0; i < events.length; i += 1) {
    const evt = events[i];
    if (evt.seq !== i + 1) {
      return {
        valid: false,
        totalEntries: events.length,
        headHash: events[events.length - 1].entryHash,
        brokenAtSeq: evt.seq,
        errorReason: `Sequence gap at seq=${evt.seq}, expected ${i + 1}`,
      };
    }
    if (evt.prevHash !== expectedPrev) {
      return {
        valid: false,
        totalEntries: events.length,
        headHash: events[events.length - 1].entryHash,
        brokenAtSeq: evt.seq,
        errorReason: `Previous-hash mismatch at seq=${evt.seq}`,
      };
    }
    const { entryHash, ...withoutHash } = evt;
    const recomputed = computeLedgerEntryHash(expectedPrev, withoutHash);
    if (recomputed !== entryHash) {
      return {
        valid: false,
        totalEntries: events.length,
        headHash: events[events.length - 1].entryHash,
        brokenAtSeq: evt.seq,
        errorReason: `SHA-256 content tampering detected at seq=${evt.seq} (${evt.invoiceNumber})`,
      };
    }
    expectedPrev = entryHash;
  }
  return {
    valid: true,
    totalEntries: events.length,
    headHash: expectedPrev,
    brokenAtSeq: null,
    errorReason: null,
  };
}

/**
 * Simulates tampering on an in-memory copy ONLY so the real ledger is never corrupted.
 */
export function simulateCopyOnlyTamper(events: AuditLedgerEvent[]): {
  tamperedSeq: number;
  verification: ReturnType<typeof verifyHashChain>;
  description: string;
} {
  const copy = events.map((e) => ({ ...e }));
  if (copy.length === 0) {
    return {
      tamperedSeq: 0,
      verification: verifyHashChain(copy),
      description: "Ledger empty; nothing to tamper.",
    };
  }
  const idx = copy.length > 1 ? 1 : 0;
  copy[idx] = {
    ...copy[idx],
    varianceAtRiskPaise: "0",
    decision: "overridden_clean",
  };
  return {
    tamperedSeq: copy[idx].seq,
    verification: verifyHashChain(copy),
    description: `Copy-only simulation altered varianceAtRiskPaise to 0 on seq=${copy[idx].seq} (${copy[idx].invoiceNumber}). Real disk ledger remains untouched and intact.`,
  };
}

export interface AutomationBiasReport {
  completedDecisions: number;
  minimumAlertThreshold: number;
  thresholdMet: boolean;
  approvedCount: number;
  overriddenCount: number;
  approvalRatePct: number;
  medianDwellMs: number;
  alertActive: boolean;
  statusText: string;
}

export function computeAutomationBiasMonitor(events: AuditLedgerEvent[]): AutomationBiasReport {
  const completed = events.filter(
    (e) =>
      e.decision === "approved_flag" ||
      e.decision === "overridden_clean" ||
      e.decision === "contested_appeal"
  );
  const completedCount = completed.length;
  const approvedCount = completed.filter((e) => e.decision === "approved_flag").length;
  const overriddenCount = completed.filter(
    (e) => e.decision === "overridden_clean" || e.decision === "contested_appeal"
  ).length;

  const approvalRatePct = completedCount > 0 ? Math.round((approvedCount * 1000) / completedCount) / 10 : 0;
  const dwells = completed
    .map((e) => e.dwellMs ?? 0)
    .filter((d) => Number.isFinite(d) && d > 0)
    .sort((a, b) => a - b);

  let medianDwellMs = 0;
  if (dwells.length > 0) {
    const mid = Math.floor(dwells.length / 2);
    medianDwellMs = dwells.length % 2 === 1 ? dwells[mid] : Math.round((dwells[mid - 1] + dwells[mid]) / 2);
  }

  const minThreshold = 50;
  const thresholdMet = completedCount >= minThreshold;
  const alertActive = thresholdMet && approvalRatePct > 95 && medianDwellMs > 0 && medianDwellMs < 3000;

  let statusText = `Formal alert suppressed below ${minThreshold} completed decisions (n=${completedCount}).`;
  if (thresholdMet) {
    statusText = alertActive
      ? `AUTOMATION BIAS WARNING: Approval rate ${approvalRatePct}% (>95%) with ${(medianDwellMs / 1000).toFixed(2)}s median dwell (<3.0s). Open-crop gate forced.`
      : `Healthy human oversight: Approval rate ${approvalRatePct}% and ${(medianDwellMs / 1000).toFixed(1)}s median foreground dwell across n=${completedCount} decisions.`;
  }

  return {
    completedDecisions: completedCount,
    minimumAlertThreshold: minThreshold,
    thresholdMet,
    approvedCount,
    overriddenCount,
    approvalRatePct,
    medianDwellMs,
    alertActive,
    statusText,
  };
}

function escapeXml(raw: string): string {
  return String(raw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildTallyPurchaseXml(invoice: InvoiceInput): string {
  const yyyymmdd = invoice.invoiceDate.replace(/-/g, "");
  const totalDec = formatPaiseDecimalString(invoice.declaredGrandTotalPaise);
  const taxableDec = formatPaiseDecimalString(invoice.declaredTaxableSubtotalPaise);
  const halfTax = BigInt(invoice.declaredTotalTaxPaise || "0") / 2n;
  const remTax = BigInt(invoice.declaredTotalTaxPaise || "0") - halfTax;
  const cgstDec = formatPaiseDecimalString(halfTax);
  const sgstDec = formatPaiseDecimalString(remTax);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- KhataCheck Sandbox Export Profile: Requires TallyPrime Disposable Company Import Verification Before Production Accounting Write -->
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${escapeXml(invoice.buyerName)} (Demo Sandbox)</SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>
    <DATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER REMOTEID="${escapeXml(invoice.id)}" VCHTYPE="Purchase" ACTION="Create">
          <DATE>${escapeXml(yyyymmdd)}</DATE>
          <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${escapeXml(invoice.invoiceNumber)}</VOUCHERNUMBER>
          <REFERENCE>${escapeXml(invoice.invoiceNumber)}</REFERENCE>
          <PARTYLEDGERNAME>${escapeXml(invoice.vendorName)}</PARTYLEDGERNAME>
          <PARTYGSTIN>${escapeXml(invoice.vendorGstin)}</PARTYGSTIN>
          <NARRATION>Verified by KhataCheck ${escapeXml(RULE_BUNDLE_VERSION)}</NARRATION>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(invoice.vendorName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${totalDec}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>GST Purchases Account</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${taxableDec}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Input CGST</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${cgstDec}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Input SGST</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${sgstDec}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>
`;
}

export function buildDisputeCsv(events: AuditLedgerEvent[]): string {
  const header = [
    "event_id",
    "seq",
    "invoice_number",
    "vendor_name",
    "decision",
    "variance_at_risk_inr",
    "rule_checks",
    "bill_sha256",
    "owner_approval_ts",
    "override_reason",
  ].join(",");

  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = events.map((e) =>
    [
      esc(e.eventId),
      e.seq,
      esc(e.invoiceNumber),
      esc(e.vendorName),
      esc(e.decision),
      esc(formatPaiseDecimalString(e.varianceAtRiskPaise)),
      esc(e.ruleChecks.join("; ")),
      esc(e.billSha256),
      esc(e.ownerApprovalTs ?? ""),
      esc(e.overrideReason),
    ].join(",")
  );
  return [header, ...rows].join("\n") + "\n";
}

export const LIFECYCLE_GATES = [
  {
    gate: "Gate 1 · Intake",
    question: "Is AI needed and what is the risk tier?",
    status: "PASS",
    owner: "Prince Jain (Full-Stack Software Engineer)",
    evidence: "Multimodal OCR + ASR strictly for messy paper bills; deterministic code handles 100% of tax math.",
  },
  {
    gate: "Gate 2 · Data & Privacy",
    question: "Is personal data lawful, minimized, and consented?",
    status: "PASS",
    owner: "Prince Jain (Full-Stack Software Engineer)",
    evidence: "DPDP pre-inference scrubber strips customer phone/PAN/UPI; English + Hindi notice; 30-day raw-media retention policy (demo processes uploads in memory) & one-click /delete-data erasure.",
  },
  {
    gate: "Gate 3 · Build & Red-Team",
    question: "Tested across subgroups, edge math, and adversarial injection?",
    status: "PASS",
    owner: "Prince Jain (Full-Stack Software Engineer)",
    evidence: "500-invoice fault-injection suite across 5 strata + 50 red-team injection cases executed reproducibly.",
  },
  {
    gate: "Gate 4 · Deploy & Oversight",
    question: "Are human review, contestability, and bias monitors active?",
    status: "PASS",
    owner: "Store Owner + CA Reviewer",
    evidence: "Cropped bill evidence + Approve / Override & Contest reason required + Automation Bias Monitor (>=50 n gate).",
  },
  {
    gate: "Gate 5 · Live Retail Pilot",
    question: "Have 10 Bengaluru stores completed the 4-week CA-audited shadow run?",
    status: "HOLD",
    owner: "Field Ops (Bengaluru Pilot)",
    evidence: "Registered protocol & instrumentation ready (t0->t_flag->t_confirm); live store rollout gated on Stage 4 launch.",
  },
] as const;
