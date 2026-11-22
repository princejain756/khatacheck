import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DEMO_PRIOR_BILLS, DEMO_SCENARIOS, DEMO_VENDOR_HISTORY } from "./bill-scenarios";
import { DPDP_CONSENT_NOTICE, scrubPiiForModelEgress } from "./dpdp-privacy";
import { computeBillSha256, verifyInvoicePipeline } from "./engine";
import { RULE_BUNDLE_VERSION } from "./gst-rules";
import { formatPaiseDecimalString } from "./money";
import type {
  AuditLedgerEvent,
  CropBbox,
  InvoiceInput,
  ReviewDecision,
  ServerVerdictRecord,
  VerificationResult,
} from "./types";

export type { ServerVerdictRecord } from "./types";

export const GENESIS_HASH = "0".repeat(64);
export const STORE_TENANT_ID = "store-ganesh-blr-01";
const DATA_DIR = path.join(process.cwd(), "data");
const LEDGER_PATH = path.join(DATA_DIR, "audit-ledger.jsonl");
const VERDICTS_PATH = path.join(DATA_DIR, "server-verdicts.json");
const CONSENT_PATH = path.join(DATA_DIR, "dpdp-consent.json");

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const PAISE_DECIMAL_RE = /^\d{1,15}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_DECISIONS = new Set<ReviewDecision>([
  "pending_review",
  "approved_flag",
  "overridden_clean",
  "contested_appeal",
  "retake_requested",
  "abstained_clarity",
]);

function writeFileAtomic(targetPath: string, content: string): void {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, targetPath);
}

const verdictCache = new Map<string, ServerVerdictRecord>();
const seededDemoHashes = new Set<string>();
let verdictsSeeded = false;

function isServerVerdictRecord(
  input: VerificationResult | ServerVerdictRecord
): input is ServerVerdictRecord {
  return (
    typeof input === "object" &&
    input !== null &&
    "humanApprovalAllowed" in input &&
    "autoCleanEligible" in input
  );
}

function buildVerdictFromResult(result: VerificationResult): ServerVerdictRecord {
  const hasLowConfLine = result.lines.some((l) => l.needsManualReview);
  const hasUnmatchedVoice = result.voiceMatches.some((v) => v.kind === "unmatched_manual");
  const hasDuplicateFault = result.faults.some((f) => f.category === "duplicate_invoice");
  const gstinOcrAmbiguous = Boolean(result.gstinOcrAmbiguous);
  const fieldConfidencesMin =
    result.lines.length > 0
      ? Math.min(...result.lines.map((l) => l.ocrConfidence))
      : result.abstainedClarity
        ? 0
        : 1;
  const ruleChecks =
    result.faults.length > 0
      ? [...new Set(result.faults.map((f) => f.ruleId))]
      : result.gstinValid
        ? ["GSTIN-MOD36-CHECK", "MATH-LINE-BIGINT-PAISE"]
        : ["GSTIN-MOD36-CHECK"];

  const autoCleanEligible =
    result.faults.length === 0 &&
    !result.promptGuardBlocked &&
    !hasLowConfLine &&
    !hasUnmatchedVoice &&
    !result.abstainedClarity &&
    result.gstinValid &&
    !gstinOcrAmbiguous;

  const humanApprovalAllowed =
    !result.promptGuardBlocked &&
    !result.abstainedClarity &&
    result.gstinValid &&
    !hasDuplicateFault &&
    !hasUnmatchedVoice;

  return {
    billSha256: result.billSha256,
    invoiceId: result.invoiceId,
    ruleChecks,
    varianceAtRiskPaise: result.totalVarianceAtRiskPaise,
    fieldConfidencesMin: Number(fieldConfidencesMin.toFixed(4)),
    promptGuardBlocked: result.promptGuardBlocked,
    abstainedClarity: result.abstainedClarity,
    gstinValid: result.gstinValid,
    autoCleanEligible,
    humanApprovalAllowed,
    exportEligible: result.exportEligible,
    clarityScore: result.clarityScore,
    gstScheduleVersion: result.gstScheduleVersion,
    recordedAtIso: new Date().toISOString(),
  };
}

function persistVerdictCache(): void {
  const records = Object.fromEntries(verdictCache.entries());
  writeFileAtomic(VERDICTS_PATH, JSON.stringify(records, null, 2) + "\n");
}

function ensureVerdictsSeeded(): void {
  if (verdictsSeeded) return;
  verdictsSeeded = true;
  let dirty = false;

  if (fs.existsSync(VERDICTS_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(VERDICTS_PATH, "utf8")) as Record<
        string,
        ServerVerdictRecord
      >;
      if (parsed && typeof parsed === "object") {
        for (const [hash, rec] of Object.entries(parsed)) {
          if (rec && typeof rec === "object" && SHA256_HEX_RE.test(hash)) {
            verdictCache.set(hash, rec);
          }
        }
      }
    } catch {
      // Ignore corrupt verdict file; demo verdicts will be regenerated below.
    }
  } else {
    dirty = true;
  }

  for (const sc of DEMO_SCENARIOS) {
    const res = verifyInvoicePipeline(sc.invoice, {
      vendorHistory: DEMO_VENDOR_HISTORY,
      priorBills: DEMO_PRIOR_BILLS,
    });
    const rec = buildVerdictFromResult(res);
    seededDemoHashes.add(rec.billSha256);
    const existing = verdictCache.get(rec.billSha256);
    if (
      !existing ||
      existing.varianceAtRiskPaise !== rec.varianceAtRiskPaise ||
      existing.humanApprovalAllowed !== rec.humanApprovalAllowed ||
      existing.autoCleanEligible !== rec.autoCleanEligible
    ) {
      verdictCache.set(rec.billSha256, rec);
      dirty = true;
    }
  }

  if (dirty) {
    persistVerdictCache();
  }
}

export function recordServerVerdict(
  input: VerificationResult | ServerVerdictRecord
): ServerVerdictRecord {
  ensureVerdictsSeeded();
  const record = isServerVerdictRecord(input) ? input : buildVerdictFromResult(input);
  verdictCache.set(record.billSha256, record);
  persistVerdictCache();
  return record;
}

export function getServerVerdict(billSha256: string): ServerVerdictRecord | null {
  if (typeof billSha256 !== "string" || !SHA256_HEX_RE.test(billSha256.trim())) {
    return null;
  }
  ensureVerdictsSeeded();
  return verdictCache.get(billSha256.trim()) ?? null;
}

export interface ValidatedLedgerDecisionInput {
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
}

export type LedgerPostValidationResult =
  | { ok: true; action: "reset-demo" }
  | { ok: true; action: "stress-bias" }
  | { ok: true; action: "decision"; data: ValidatedLedgerDecisionInput }
  | { ok: false; status: 400 | 403; error: string };

export function validateLedgerPostBody(body: unknown): LedgerPostValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Request body must be a JSON object." };
  }
  const rec = body as Record<string, unknown>;
  if (rec.action === "reset-demo") {
    return { ok: true, action: "reset-demo" };
  }
  if (rec.action === "stress-bias") {
    return { ok: true, action: "stress-bias" };
  }
  if (rec.action !== undefined && rec.action !== "decision") {
    return { ok: false, status: 400, error: "Unsupported ledger action." };
  }

  const tenantRaw = rec.tenantId === undefined ? "" : String(rec.tenantId).trim();
  if (tenantRaw && tenantRaw !== STORE_TENANT_ID) {
    return {
      ok: false,
      status: 403,
      error: `Tenant ID mismatch: active store tenant is ${STORE_TENANT_ID}.`,
    };
  }

  const decision = (rec.decision === undefined ? "approved_flag" : String(rec.decision)) as ReviewDecision;
  if (!ALLOWED_DECISIONS.has(decision)) {
    return { ok: false, status: 400, error: "Invalid review decision value." };
  }

  const billSha256 = typeof rec.billSha256 === "string" ? rec.billSha256.trim() : "";
  if (!SHA256_HEX_RE.test(billSha256)) {
    return {
      ok: false,
      status: 400,
      error: "billSha256 must be a valid 64-character lowercase SHA-256 hex digest.",
    };
  }

  const invoiceId = typeof rec.invoiceId === "string" ? rec.invoiceId.trim() : "";
  if (!invoiceId || invoiceId.length > 128) {
    return { ok: false, status: 400, error: "invoiceId must be a non-empty string (<= 128 chars)." };
  }

  const invoiceNumberRaw =
    rec.invoiceNumber === undefined ? invoiceId : String(rec.invoiceNumber).trim();
  if (invoiceNumberRaw.length > 128) {
    return { ok: false, status: 400, error: "invoiceNumber exceeds 128 character limit." };
  }

  const vendorNameRaw =
    rec.vendorName === undefined ? "Unknown Vendor" : String(rec.vendorName).trim();
  if (vendorNameRaw.length > 160) {
    return { ok: false, status: 400, error: "vendorName exceeds 160 character limit." };
  }

  const varianceRaw =
    rec.varianceAtRiskPaise === undefined ? "0" : String(rec.varianceAtRiskPaise).trim();
  if (!PAISE_DECIMAL_RE.test(varianceRaw)) {
    return {
      ok: false,
      status: 400,
      error: "varianceAtRiskPaise must be a non-negative integer decimal string.",
    };
  }

  const ruleChecks: string[] = [];
  if (rec.ruleChecks !== undefined) {
    if (!Array.isArray(rec.ruleChecks) || rec.ruleChecks.length > 32) {
      return {
        ok: false,
        status: 400,
        error: "ruleChecks must be an array of at most 32 strings.",
      };
    }
    for (const item of rec.ruleChecks) {
      if (typeof item !== "string" || item.length === 0 || item.length > 64) {
        return {
          ok: false,
          status: 400,
          error: "Each ruleChecks entry must be a non-empty string <= 64 characters.",
        };
      }
      ruleChecks.push(scrubPiiForModelEgress(item).scrubbedText);
    }
  }

  let sourceCropBbox: CropBbox | null = null;
  if (rec.sourceCropBbox !== undefined && rec.sourceCropBbox !== null) {
    if (typeof rec.sourceCropBbox !== "object" || Array.isArray(rec.sourceCropBbox)) {
      return { ok: false, status: 400, error: "sourceCropBbox must be an object or null." };
    }
    const b = rec.sourceCropBbox as Record<string, unknown>;
    const nums = [b.topPct, b.leftPct, b.widthPct, b.heightPct];
    if (
      typeof b.id !== "string" ||
      b.id.length > 64 ||
      typeof b.label !== "string" ||
      b.label.length > 160 ||
      nums.some((n) => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100)
    ) {
      return { ok: false, status: 400, error: "sourceCropBbox contains out-of-range fields." };
    }
    if (
      b.lineNumber !== undefined &&
      (typeof b.lineNumber !== "number" || !Number.isInteger(b.lineNumber) || b.lineNumber < 0)
    ) {
      return { ok: false, status: 400, error: "sourceCropBbox.lineNumber must be a non-negative integer." };
    }
    sourceCropBbox = {
      id: scrubPiiForModelEgress(b.id).scrubbedText,
      label: scrubPiiForModelEgress(b.label).scrubbedText,
      topPct: b.topPct as number,
      leftPct: b.leftPct as number,
      widthPct: b.widthPct as number,
      heightPct: b.heightPct as number,
      ...(typeof b.lineNumber === "number" ? { lineNumber: b.lineNumber } : {}),
    };
  }

  const dwellMs = rec.dwellMs === undefined ? 2500 : Number(rec.dwellMs);
  if (!Number.isFinite(dwellMs) || dwellMs < 0 || dwellMs > 86_400_000) {
    return { ok: false, status: 400, error: "dwellMs must be finite and within [0, 86400000]." };
  }

  const fieldConfidencesMin =
    rec.fieldConfidencesMin === undefined ? 1 : Number(rec.fieldConfidencesMin);
  if (!Number.isFinite(fieldConfidencesMin) || fieldConfidencesMin < 0 || fieldConfidencesMin > 1) {
    return { ok: false, status: 400, error: "fieldConfidencesMin must be within [0, 1]." };
  }

  const rawOverride = rec.overrideReason === undefined ? "" : String(rec.overrideReason).trim();
  if (rawOverride.length > 500) {
    return { ok: false, status: 400, error: "overrideReason exceeds 500 character limit." };
  }
  const overrideReason = scrubPiiForModelEgress(rawOverride).scrubbedText;
  if ((decision === "overridden_clean" || decision === "contested_appeal") && overrideReason.trim().length < 6) {
    return {
      ok: false,
      status: 400,
      error: "Override or appeal requires a written reason (minimum 6 characters).",
    };
  }

  const nowIso = new Date().toISOString();
  const billReceivedTs =
    typeof rec.billReceivedTs === "string" && rec.billReceivedTs.length <= 64
      ? rec.billReceivedTs
      : nowIso;
  const flagSentTs =
    typeof rec.flagSentTs === "string" && rec.flagSentTs.length <= 64
      ? rec.flagSentTs
      : nowIso;

  return {
    ok: true,
    action: "decision",
    data: {
      tenantId: STORE_TENANT_ID,
      invoiceId: scrubPiiForModelEgress(invoiceId).scrubbedText,
      invoiceNumber: scrubPiiForModelEgress(invoiceNumberRaw || invoiceId).scrubbedText,
      vendorName: scrubPiiForModelEgress(vendorNameRaw || "Unknown Vendor").scrubbedText,
      billSha256,
      billReceivedTs,
      flagSentTs,
      fieldConfidencesMin,
      sourceCropBbox,
      ruleChecks,
      varianceAtRiskPaise: varianceRaw,
      decision,
      overrideReason,
      dwellMs: Math.round(dwellMs),
    },
  };
}

export interface DpdpConsentState {
  consented: boolean;
  noticeVersion: string;
  timestampIso: string;
}

export interface DpdpConsentEvent extends DpdpConsentState {
  eventHash: string;
}

export function getConsentState(): DpdpConsentState {
  if (fs.existsSync(CONSENT_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(CONSENT_PATH, "utf8")) as Partial<DpdpConsentState>;
      if (typeof parsed.consented === "boolean" && typeof parsed.noticeVersion === "string") {
        return {
          consented: parsed.consented,
          noticeVersion: parsed.noticeVersion,
          timestampIso: typeof parsed.timestampIso === "string" ? parsed.timestampIso : "",
        };
      }
    } catch {
      // Fall through to default unconsented state.
    }
  }
  return {
    consented: false,
    noticeVersion: DPDP_CONSENT_NOTICE.version,
    timestampIso: "",
  };
}

function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const rec = obj as Record<string, unknown>;
  const keys = Object.keys(rec)
    .filter((k) => rec[k] !== undefined)
    .sort();
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
  const billHashFor = (invoiceId: string): string => {
    const sc = DEMO_SCENARIOS.find((s) => s.id === invoiceId);
    if (!sc) {
      throw new Error(`Missing demo scenario ${invoiceId} for default ledger seed`);
    }
    return computeBillSha256(sc.invoice);
  };
  const initialSeeds: Array<Omit<AuditLedgerEvent, "seq" | "prevHash" | "entryHash">> = [
    {
      eventId: "EVT-1001",
      tenantId: "store-ganesh-blr-01",
      invoiceId: "SCN-01-KIRANA-SHORT",
      invoiceNumber: "SLGW/24-25/0736",
      vendorName: "Shree Lakshmi General Wholesalers",
      billSha256: billHashFor("SCN-01-KIRANA-SHORT"),
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
      billSha256: billHashFor("SCN-02-PHARMACY-HSN"),
      billReceivedTs: "2026-11-20T11:42:10.000Z",
      flagSentTs: "2026-11-20T11:42:10.355Z",
      ownerApprovalTs: "2026-11-20T11:42:46.100Z",
      modelId: "khatacheck-hybrid-ocr-v1+deterministic-gst",
      promptHash: "sha256:b391a0d788c312e5",
      ruleBundleVersion: RULE_BUNDLE_VERSION,
      fieldConfidencesMin: 0.97,
      sourceCropBbox: { id: "row-2", label: "Row 2 · HSN 3004 Tax 18% vs 5%", topPct: 54, leftPct: 8, widthPct: 84, heightPct: 6, lineNumber: 2 },
      ruleChecks: ["GSTIN-MOD36-CHECK", "HSN-3004-5", "MATH-LINE-BIGINT-PAISE"],
      varianceAtRiskPaise: "312000",
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
      billSha256: billHashFor("SCN-03-TEXTILE-DRIFT"),
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
      vendorName: "Apex Wholesale Traders",
      billSha256: billHashFor("SCN-05-PROMPT-INJECT"),
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

  writeFileAtomic(LEDGER_PATH, built.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return built;
}

export function readLedgerWithIntegrity(): {
  events: AuditLedgerEvent[];
  corruptLineNumbers: number[];
  verification: ReturnType<typeof verifyHashChain>;
} {
  ensureLedgerSeeded();
  const raw = fs.readFileSync(LEDGER_PATH, "utf8");
  const events: AuditLedgerEvent[] = [];
  const corruptLineNumbers: number[] = [];
  const rawLines = raw.split("\n");
  for (let idx = 0; idx < rawLines.length; idx += 1) {
    const trimmed = rawLines[idx].trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as AuditLedgerEvent;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof parsed.seq !== "number" ||
        typeof parsed.entryHash !== "string" ||
        typeof parsed.prevHash !== "string"
      ) {
        corruptLineNumbers.push(idx + 1);
        continue;
      }
      events.push(parsed);
    } catch {
      corruptLineNumbers.push(idx + 1);
    }
  }
  const chain = verifyHashChain(events);
  const verification =
    corruptLineNumbers.length > 0
      ? {
          ...chain,
          valid: false,
          brokenAtSeq: corruptLineNumbers[0],
          errorReason: `Malformed audit ledger JSONL record at line ${corruptLineNumbers[0]}`,
        }
      : chain;
  return { events, corruptLineNumbers, verification };
}

export function readLedgerEvents(): AuditLedgerEvent[] {
  return readLedgerWithIntegrity().events;
}

export function isInvoiceApprovedInEvents(
  events: AuditLedgerEvent[],
  invoiceId: string,
  expectedBillSha256?: string,
  expectedTenantId?: string
): boolean {
  let latestMatch: AuditLedgerEvent | null = null;
  for (const e of events) {
    if (
      e.invoiceId === invoiceId &&
      (!expectedBillSha256 || e.billSha256 === expectedBillSha256) &&
      (!expectedTenantId || e.tenantId === expectedTenantId)
    ) {
      latestMatch = e;
    }
  }
  return Boolean(
    latestMatch &&
      (latestMatch.decision === "approved_flag" || latestMatch.decision === "overridden_clean")
  );
}

export function getApprovedInvoiceIds(): string[] {
  const { events, verification } = readLedgerWithIntegrity();
  if (!verification.valid) {
    return [];
  }
  const latestByInvoice = new Map<string, AuditLedgerEvent>();
  for (const e of events) {
    if (e.invoiceId === "SYS-PRIVACY-RESET") continue;
    latestByInvoice.set(e.invoiceId, e);
  }
  const approved: string[] = [];
  for (const [invoiceId, latest] of latestByInvoice.entries()) {
    if (latest.decision === "approved_flag" || latest.decision === "overridden_clean") {
      approved.push(invoiceId);
    }
  }
  return approved;
}

export function hasApprovedLedgerDecision(invoiceId: string): boolean {
  const { events, verification } = readLedgerWithIntegrity();
  if (!verification.valid) {
    return false;
  }
  return isInvoiceApprovedInEvents(events, invoiceId);
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
  const { events: existing, verification } = readLedgerWithIntegrity();
  if (!verification.valid) {
    throw new Error(verification.errorReason || "Audit ledger integrity check failed; reset demo ledger first.");
  }
  const last = existing[existing.length - 1];
  const seq = last ? last.seq + 1 : 1;
  const prevHash = last ? last.entryHash : GENESIS_HASH;
  const cleanInvoiceId = scrubPiiForModelEgress(input.invoiceId).scrubbedText;
  const cleanOverrideReason = scrubPiiForModelEgress(input.overrideReason).scrubbedText;
  const cleanVendorName = scrubPiiForModelEgress(input.vendorName).scrubbedText;
  const cleanInvoiceNumber = scrubPiiForModelEgress(input.invoiceNumber).scrubbedText;
  const cleanRuleChecks = input.ruleChecks.map((r) => scrubPiiForModelEgress(r).scrubbedText);
  const cleanActorRef = scrubPiiForModelEgress(input.actorRef ?? "owner_ganesh_01").scrubbedText;
  const cleanBbox: CropBbox | null = input.sourceCropBbox
    ? {
        ...input.sourceCropBbox,
        id: scrubPiiForModelEgress(input.sourceCropBbox.id).scrubbedText,
        label: scrubPiiForModelEgress(input.sourceCropBbox.label).scrubbedText,
      }
    : null;

  const base: Omit<AuditLedgerEvent, "entryHash"> = {
    seq,
    eventId: `EVT-${1000 + seq}`,
    tenantId: input.tenantId,
    invoiceId: cleanInvoiceId,
    invoiceNumber: cleanInvoiceNumber,
    vendorName: cleanVendorName,
    billSha256: input.billSha256,
    billReceivedTs: input.billReceivedTs,
    flagSentTs: input.flagSentTs,
    ownerApprovalTs: new Date().toISOString(),
    modelId: "khatacheck-hybrid-ocr-v1+deterministic-gst",
    promptHash: "sha256:b391a0d788c312e5",
    ruleBundleVersion: RULE_BUNDLE_VERSION,
    fieldConfidencesMin: input.fieldConfidencesMin,
    sourceCropBbox: cleanBbox,
    ruleChecks: cleanRuleChecks,
    varianceAtRiskPaise: input.varianceAtRiskPaise,
    decision: input.decision,
    overrideReason: cleanOverrideReason,
    dwellMs: Math.max(0, Math.round(input.dwellMs)),
    actorRef: cleanActorRef,
    ...(input.isSyntheticStress ? { isSyntheticStress: true } : {}),
    prevHash,
  };

  const entryHash = computeLedgerEntryHash(prevHash, base);
  const fullEvent: AuditLedgerEvent = { ...base, entryHash };
  fs.appendFileSync(LEDGER_PATH, JSON.stringify(fullEvent) + "\n", "utf8");
  return fullEvent;
}

export function clearUserDataPreservingSeeded(noticeVersion?: string): {
  clearedCount: number;
  preservedSeededCount: number;
  resetEventHash: string;
} {
  ensureLedgerSeeded();
  let { events } = readLedgerWithIntegrity();
  let seeded = events.slice(0, 4);
  if (
    seeded.length < 4 ||
    seeded[0]?.eventId !== "EVT-1001" ||
    !verifyHashChain(seeded).valid
  ) {
    const freshSeed = seedDefaultLedger();
    seeded = freshSeed.slice(0, 4);
    events = freshSeed;
  }

  const priorHeadHash =
    events.length > 0 ? events[events.length - 1].entryHash : seeded[seeded.length - 1].entryHash;
  const clearedLedgerCount = Math.max(0, events.length - seeded.length);

  ensureVerdictsSeeded();
  let clearedVerdictsCount = 0;
  for (const hash of [...verdictCache.keys()]) {
    if (!seededDemoHashes.has(hash)) {
      verdictCache.delete(hash);
      clearedVerdictsCount += 1;
    }
  }
  if (clearedVerdictsCount > 0) {
    persistVerdictCache();
  }

  const nowIso = new Date().toISOString();
  const cleanNoticeVersion = scrubPiiForModelEgress(
    (noticeVersion || DPDP_CONSENT_NOTICE.version).slice(0, 64)
  ).scrubbedText;
  const prevHash = seeded[seeded.length - 1].entryHash;
  const resetBase: Omit<AuditLedgerEvent, "entryHash"> = {
    seq: seeded.length + 1,
    eventId: `EVT-${1000 + seeded.length + 1}`,
    tenantId: STORE_TENANT_ID,
    invoiceId: "SYS-PRIVACY-RESET",
    invoiceNumber: "DPDP-ERASE-LOG",
    vendorName: "DPDP Privacy Controller",
    billSha256: GENESIS_HASH,
    billReceivedTs: nowIso,
    flagSentTs: nowIso,
    ownerApprovalTs: nowIso,
    modelId: "khatacheck-privacy-controller-v1",
    promptHash: "sha256:dpdp-consent-withdraw",
    ruleBundleVersion: RULE_BUNDLE_VERSION,
    fieldConfidencesMin: 1,
    sourceCropBbox: null,
    ruleChecks: ["DPDP-ERASURE-2023", `DPDP-${cleanNoticeVersion}`],
    varianceAtRiskPaise: "0",
    decision: "contested_appeal",
    overrideReason: `DPDP user erasure completed; priorHeadHash=${priorHeadHash}; noticeVersion=${cleanNoticeVersion}`,
    dwellMs: 0,
    actorRef: "dpdp_privacy_controller",
    prevHash,
  };
  const resetEventHash = computeLedgerEntryHash(prevHash, resetBase);
  const resetEvent: AuditLedgerEvent = { ...resetBase, entryHash: resetEventHash };

  const nextEvents = [...seeded, resetEvent];
  writeFileAtomic(LEDGER_PATH, nextEvents.map((e) => JSON.stringify(e)).join("\n") + "\n");

  return {
    clearedCount: clearedLedgerCount + clearedVerdictsCount,
    preservedSeededCount: seeded.length,
    resetEventHash,
  };
}

export function recordConsentEvent(
  action: "grant" | "withdraw",
  noticeVersion: string = DPDP_CONSENT_NOTICE.version
): DpdpConsentEvent {
  const cleanVersion = scrubPiiForModelEgress(String(noticeVersion || DPDP_CONSENT_NOTICE.version).trim()).scrubbedText;
  const timestampIso = new Date().toISOString();
  const consented = action === "grant";
  const eventHash = crypto
    .createHash("sha256")
    .update(canonicalJson({ action, noticeVersion: cleanVersion, consented, timestampIso }), "utf8")
    .digest("hex");

  const payload: DpdpConsentEvent = {
    noticeVersion: cleanVersion,
    consented,
    timestampIso,
    eventHash,
  };
  writeFileAtomic(CONSENT_PATH, JSON.stringify(payload, null, 2) + "\n");

  if (action === "withdraw") {
    clearUserDataPreservingSeeded(cleanVersion);
  }
  return payload;
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
  baselineValid: boolean;
  tamperedSeq: number;
  verification: ReturnType<typeof verifyHashChain>;
  description: string;
} {
  const baselineValid = verifyHashChain(events).valid;
  const copy = events.map((e) => ({ ...e }));
  if (copy.length === 0) {
    return {
      baselineValid,
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
    baselineValid,
    tamperedSeq: copy[idx].seq,
    verification: verifyHashChain(copy),
    description: `Copy-only simulation altered varianceAtRiskPaise to 0 on seq=${copy[idx].seq} (${copy[idx].invoiceNumber}). Real disk ledger remains untouched.`,
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
    .map((e) => (typeof e.dwellMs === "number" ? e.dwellMs : 0))
    .filter((d) => Number.isFinite(d) && d >= 0)
    .sort((a, b) => a - b);

  let medianDwellMs = 0;
  let exactMedianMs = 0;
  let medianBelow3s = false;
  if (dwells.length > 0) {
    const mid = Math.floor(dwells.length / 2);
    if (dwells.length % 2 === 1) {
      medianDwellMs = dwells[mid];
      exactMedianMs = dwells[mid];
      medianBelow3s = dwells[mid] < 3000;
    } else {
      const pairSum = dwells[mid - 1] + dwells[mid];
      medianDwellMs = Math.round(pairSum / 2);
      exactMedianMs = pairSum / 2;
      medianBelow3s = pairSum < 6000;
    }
  }

  const minThreshold = 50;
  const thresholdMet = completedCount >= minThreshold;
  const exactApprovalPct = completedCount > 0 ? (approvedCount * 100) / completedCount : 0;
  const alertActive = thresholdMet && approvedCount * 100 > 95 * completedCount && medianBelow3s;
  const alertApprovalRateLabel =
    approvalRatePct > 95
      ? String(approvalRatePct)
      : Number(exactApprovalPct.toFixed(2)) > 95
        ? exactApprovalPct.toFixed(2)
        : exactApprovalPct.toFixed(3);

  let statusText = `Formal alert suppressed below ${minThreshold} completed decisions (n=${completedCount}).`;
  if (thresholdMet) {
    const dwellLabelSec = (exactMedianMs / 1000).toFixed(exactMedianMs >= 2990 && exactMedianMs < 3000 ? 4 : 2);
    statusText = alertActive
      ? `AUTOMATION BIAS WARNING: Approval rate ${alertApprovalRateLabel}% (>95%) with ${dwellLabelSec}s median dwell (<3.0s). Human review warning raised.`
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
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildTallyPurchaseXml(invoice: InvoiceInput): string {
  const rawDate = String(invoice.invoiceDate ?? "").trim();
  if (!ISO_DATE_RE.test(rawDate)) {
    throw new Error(`Invalid invoiceDate for Tally YYYYMMDD export: ${rawDate}`);
  }
  const yyyymmdd = rawDate.replace(/-/g, "");
  const totalGrandPaise = BigInt(invoice.declaredGrandTotalPaise || "0");
  const taxablePaise = BigInt(invoice.declaredTaxableSubtotalPaise || "0");
  const totalTaxPaise = BigInt(invoice.declaredTotalTaxPaise || "0");
  const totalDec = formatPaiseDecimalString(totalGrandPaise);
  const taxableDec = formatPaiseDecimalString(taxablePaise);
  const supState = (invoice.supplierStateCode || invoice.vendorGstin.slice(0, 2) || "").trim().toUpperCase();
  const posState = (invoice.placeOfSupplyStateCode || supState).trim().toUpperCase();
  const isInterstate = Boolean(supState && posState && supState !== posState);

  let taxLedgerXml: string;
  let sumTaxCredited: bigint;
  if (isInterstate) {
    const igstDec = formatPaiseDecimalString(totalTaxPaise);
    sumTaxCredited = totalTaxPaise;
    taxLedgerXml = `          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Input IGST</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${igstDec}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`;
  } else {
    const halfTax = totalTaxPaise / 2n;
    sumTaxCredited = halfTax * 2n;
    const halfDec = formatPaiseDecimalString(halfTax);
    taxLedgerXml = `          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Input CGST</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${halfDec}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Input SGST</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${halfDec}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`;
  }

  const imbalance = totalGrandPaise - taxablePaise - sumTaxCredited;
  let roundOffXml = "";
  if (imbalance !== 0n) {
    const roundEntry = -imbalance;
    const isDebit = roundEntry < 0n;
    const roundDec = formatPaiseDecimalString(isDebit ? -roundEntry : roundEntry);
    roundOffXml = `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Round Off</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${isDebit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
            <AMOUNT>${isDebit ? "-" : ""}${roundDec}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- KhataCheck Purchase Voucher Export: Not import-verified against a live TallyPrime company -->
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${escapeXml(invoice.buyerName)}</SVCURRENTCOMPANY>
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
${taxLedgerXml}${roundOffXml}
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>
`;
}

function safeCsvText(raw: string): string {
  const s = String(raw ?? "");
  const neutralized = /^[\t\r ]*[=+\-@]|^[\t\r]/.test(s) ? `'${s}` : s;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

export function buildDisputeCsv(events: AuditLedgerEvent[], chainValid?: boolean): string {
  const effectiveChainValid = chainValid ?? verifyHashChain(events).valid;
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
    "chain_valid",
  ].join(",");

  const escNum = (v: string) => `"${String(v ?? "0").replace(/"/g, '""')}"`;
  const rows: string[] = [];
  for (const e of events) {
    if (e.isSyntheticStress) continue;
    try {
      rows.push(
        [
          safeCsvText(e.eventId),
          e.seq,
          safeCsvText(e.invoiceNumber),
          safeCsvText(e.vendorName),
          safeCsvText(e.decision),
          escNum(formatPaiseDecimalString(e.varianceAtRiskPaise)),
          safeCsvText(Array.isArray(e.ruleChecks) ? e.ruleChecks.join("; ") : ""),
          safeCsvText(e.billSha256),
          safeCsvText(e.ownerApprovalTs ?? ""),
          safeCsvText(e.overrideReason),
          effectiveChainValid ? "true" : "false",
        ].join(",")
      );
    } catch {
      // Skip malformed event rows cleanly without failing the full export.
    }
  }
  return [header, ...rows].join("\n") + "\n";
}

export const LIFECYCLE_GATES = [
  {
    gate: "Gate 1 · Intake",
    question: "Is AI needed and what is the risk tier?",
    status: "PASS",
    owner: "Prince Jain (Full-Stack Software Engineer)",
    evidence: "Laplacian clarity gate (<85 abstains), local Tesseract OCR + Groq Whisper ASR on explicit voice clips restricted to extraction; all rupees & GST math stay deterministic BigInt.",
  },
  {
    gate: "Gate 2 · Data & Privacy",
    question: "Is personal data lawful, minimized, and consented?",
    status: "PASS",
    owner: "Prince Jain (Full-Stack Software Engineer)",
    evidence: "On-server DPDP PII scrubber masks OCR, ASR, and persisted ledger fields (vendorName, invoiceId, invoiceNumber, ruleChecks, sourceCropBbox label, and overrideReason) prior to storage or qwen/qwen3.8-27b egress; English + Hindi notice dpdp-v1.3-2026-11; Days 61 to 90 30-day expiry; consent & erasure via /privacy.",
  },
  {
    gate: "Gate 3 · Build & Red-Team",
    question: "Tested across subgroups, edge math, and adversarial injection?",
    status: "PASS",
    owner: "Prince Jain (Full-Stack Software Engineer)",
    evidence: "500-invoice fault-injection suite across 5 strata + 50 red-team injection cases + disjoint external held-out evaluation executed reproducibly.",
  },
  {
    gate: "Gate 4 · Deploy & Oversight",
    question: "Are human review, contestability, and bias monitors active?",
    status: "PASS",
    owner: "Store Owner + CA Reviewer",
    evidence: "Author-simulated oversight verification (live store owner + CA sign-off gated in Gate 5); cropped bill evidence, server-verdict-gated Approve / Override & Contest review, and Automation Bias Monitor (>=50 n gate) active.",
  },
  {
    gate: "Gate 5 · Live Retail Pilot",
    question: "Have 10 Bengaluru stores completed the 4-week CA-audited shadow run?",
    status: "HOLD",
    owner: "Field Ops (Bengaluru Pilot)",
    evidence: "Registered protocol & instrumentation ready (t0->t_flag->t_confirm); live store rollout gated on Stage 4 launch.",
  },
] as const;
