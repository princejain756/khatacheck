import crypto from "node:crypto";
import { scrubPiiForModelEgress } from "./dpdp-privacy";
import {
  ORACLE_PROFILE_LABEL,
  RULE_BUNDLE_VERSION,
  verifyInvoiceDeterministic,
} from "./gst-rules";
import { scanUntrustedInvoiceText } from "./prompt-guard";
import type {
  DetectedFault,
  HistoricalBillRecord,
  InvoiceInput,
  VendorRatePoint,
  VerificationResult,
} from "./types";
import { parseVoiceRemarks } from "./voice-parser";

export const CLARITY_MIN_THRESHOLD = 85;
const MAX_ENGINE_TEXT_BYTES = 64 * 1024;

function capEngineField(value: string | undefined): string | undefined {
  if (!value) return value;
  return value.length <= MAX_ENGINE_TEXT_BYTES ? value : value.slice(0, MAX_ENGINE_TEXT_BYTES);
}

export function computeBillSha256(invoice: InvoiceInput): string {
  const billCanonical = JSON.stringify({
    id: invoice.id,
    tenantId: invoice.tenantId,
    vendorName: invoice.vendorName,
    vendorGstin: invoice.vendorGstin,
    buyerName: invoice.buyerName,
    buyerGstin: invoice.buyerGstin,
    supplierStateCode: invoice.supplierStateCode,
    placeOfSupplyStateCode: invoice.placeOfSupplyStateCode,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    roundOffPaise: invoice.roundOffPaise,
    declaredTaxableSubtotalPaise: invoice.declaredTaxableSubtotalPaise,
    declaredTotalTaxPaise: invoice.declaredTotalTaxPaise,
    declaredGrandTotalPaise: invoice.declaredGrandTotalPaise,
    lines: invoice.lines.map((l) => [
      l.lineNumber,
      l.sku,
      l.hsnCode,
      l.qtyMilli,
      l.unit,
      l.unitRatePaise,
      l.discountPaise,
      l.declaredTaxablePaise,
      l.declaredCgstBps,
      l.declaredSgstBps,
      l.declaredIgstBps,
      l.declaredCgstPaise,
      l.declaredSgstPaise,
      l.declaredIgstPaise,
      l.declaredLineTotalPaise,
    ]),
  });
  return crypto.createHash("sha256").update(billCanonical, "utf8").digest("hex");
}

export function verifyInvoicePipeline(
  invoice: InvoiceInput,
  options?: {
    vendorHistory?: VendorRatePoint[];
    priorBills?: HistoricalBillRecord[];
    enablePiiScrub?: boolean;
  }
): VerificationResult {
  const startNs = process.hrtime.bigint();
  const vendorHistory = options?.vendorHistory ?? [];
  const priorBills = options?.priorBills ?? [];
  const enablePiiScrub = options?.enablePiiScrub !== false;

  const billSha256 = computeBillSha256(invoice);

  const notesCapped = capEngineField(invoice.notesRaw);
  const voiceCapped = capEngineField(invoice.voiceTranscriptRaw);

  // 1. Pre-flight DPDP PII Scrub BEFORE extraction/voice inference
  const notesScrub = enablePiiScrub
    ? scrubPiiForModelEgress(notesCapped)
    : { scrubbedText: notesCapped ?? "", redactionCount: 0, redactedKinds: [] };
  const voiceScrub = enablePiiScrub
    ? scrubPiiForModelEgress(voiceCapped)
    : { scrubbedText: voiceCapped ?? "", redactionCount: 0, redactedKinds: [] };
  const allRedactedKinds = [...new Set([...notesScrub.redactedKinds, ...voiceScrub.redactedKinds])];
  const totalRedactions = notesScrub.redactionCount + voiceScrub.redactionCount;

  // 2. Untrusted Input Prompt-Injection Guard (before downstream matching)
  const untrustedInputs: Array<{ field: string; text: string | undefined }> = [
    { field: "notesRaw", text: notesCapped },
    { field: "voiceTranscriptRaw", text: voiceCapped },
    { field: "invoiceNumber", text: capEngineField(invoice.invoiceNumber) },
    { field: "vendorName", text: capEngineField(invoice.vendorName) },
    { field: "buyerName", text: capEngineField(invoice.buyerName) },
    { field: "challanNumber", text: capEngineField(invoice.challanNumber) },
    ...invoice.lines.map((l) => ({
      field: `line_${l.lineNumber}_description`,
      text: capEngineField(`${l.sku} ${l.description} ${l.unit}`),
    })),
  ];
  const guardResult = scanUntrustedInvoiceText(untrustedInputs);

  // 3. Clarity Pre-Flight Abstention Gate
  if (invoice.clarityScore < CLARITY_MIN_THRESHOLD) {
    const endNs = process.hrtime.bigint();
    const tFlagIso = new Date().toISOString();
    const latencyMs = Number(endNs - startNs) / 1e6;
    const clarityFault: DetectedFault = {
      faultId: "FLT-CLARITY-1",
      category: "clarity_abstain",
      severity: "high",
      ruleId: "CLARITY-LAPLACIAN-GATE",
      title: "Blurry Image / Low Contrast: Owner Retake Required",
      explanation: `Sharpness score (${invoice.clarityScore}/255) fell below minimum release threshold (${CLARITY_MIN_THRESHOLD}). KhataCheck abstains rather than guessing rupee totals.`,
      declaredPaise: invoice.declaredGrandTotalPaise,
      expectedPaise: invoice.declaredGrandTotalPaise,
      variancePaise: "0",
      confidence: 1.0,
    };

    return {
      invoiceId: invoice.id,
      billSha256,
      ruleBundleVersion: RULE_BUNDLE_VERSION,
      oracleProfile: ORACLE_PROFILE_LABEL,
      t0Iso: invoice.receivedAtIso,
      tFlagIso,
      computeLatencyMs: Number(latencyMs.toFixed(3)),
      abstainedClarity: true,
      clarityScore: invoice.clarityScore,
      gstinValid: false,
      gstinMessage: "Abstained prior to GSTIN inference due to blurred scan",
      isInterstate: false,
      dpdpScrubbedNotes: notesScrub.scrubbedText,
      dpdpScrubbedVoice: voiceScrub.scrubbedText,
      dpdpRedactionCount: totalRedactions,
      dpdpRedactedKinds: allRedactedKinds,
      promptGuardBlocked: guardResult.blocked,
      promptGuardFindings: guardResult.findings,
      voiceMatches: [],
      lines: [],
      faults: [clarityFault],
      secondaryFaults: [],
      totalVarianceAtRiskPaise: "0",
      expectedGrandTotalPaise: invoice.declaredGrandTotalPaise,
      declaredGrandTotalPaise: invoice.declaredGrandTotalPaise,
      gstinOcrAmbiguous: Boolean(invoice.gstinOcrAmbiguous),
      exportEligible: false,
      recommendedAction: "retake_required",
    };
  }

  // 4. Deterministic Accounting, Tax, Duplicate & 90-Day Rate-Drift Verification
  const det = verifyInvoiceDeterministic(invoice, vendorHistory, priorBills);
  const faults: DetectedFault[] = [...det.faults];

  // 5. Bilingual Hinglish / Regional Voice Receiving Reconciliation (quarantined if prompt guard tripped)
  const voiceHits = guardResult.blocked
    ? []
    : parseVoiceRemarks(voiceScrub.scrubbedText, invoice.lines);
  let nextSeq = faults.length + 1;
  for (const vh of voiceHits) {
    if (vh.kind === "shortage" || vh.kind === "rate_jump") {
      const targetLine = invoice.lines.find((l) => l.lineNumber === vh.matchedLineNumber);
      faults.push({
        faultId: `FLT-${nextSeq++}`,
        category: "voice_shortage",
        severity: "high",
        ruleId: vh.kind === "shortage" ? "VOICE-SHORTAGE-RECON" : "VOICE-RATE-CLAIM",
        lineNumber: vh.matchedLineNumber ?? undefined,
        sku: vh.sku ?? undefined,
        title:
          vh.kind === "shortage"
            ? `Line ${vh.matchedLineNumber}: Voice Shortage Claim (${vh.shortageQty} ${targetLine?.unit || "units"})`
            : `Line ${vh.matchedLineNumber}: Voice Rate Discrepancy`,
        explanation: vh.confirmationPrompt,
        declaredPaise: targetLine?.declaredLineTotalPaise ?? "0",
        expectedPaise: targetLine
          ? (BigInt(targetLine.declaredLineTotalPaise) - BigInt(vh.variancePaise)).toString()
          : "0",
        variancePaise: vh.variancePaise,
        bbox: targetLine?.bbox,
        confidence: targetLine?.ocrConfidence ?? 0.9,
      });
    }
  }

  // Record Prompt-Injection Guard Quarantine Fault (without skipping deterministic tax checks)
  if (guardResult.blocked && guardResult.findings.length > 0) {
    const first = guardResult.findings[0];
    faults.push({
      faultId: `FLT-${nextSeq++}`,
      category: "prompt_injection_blocked",
      severity: "critical",
      ruleId: first.ruleId,
      title: "Adversarial Prompt-Injection Payload Quarantined",
      explanation: `Untrusted text inside ${first.field} attempted policy/tax override (${first.ruleId}). Deterministic engine ignored injected text and preserved statutory GST calculation.`,
      declaredPaise: invoice.declaredGrandTotalPaise,
      expectedPaise: det.expectedGrandTotalPaise,
      variancePaise: "0",
      confidence: 1.0,
    });
  }

  // Sum unique rule/line variances without double-counting duplicate/GSTIN whole-bill totals
  let atRiskPaise = 0n;
  const wholeBillFaults = faults.filter(
    (f) => f.category === "duplicate_invoice" || f.category === "invalid_gstin"
  );
  if (wholeBillFaults.length > 0) {
    let maxWhole = 0n;
    for (const wf of wholeBillFaults) {
      const v = BigInt(wf.variancePaise || "0");
      if (v > maxWhole) maxWhole = v;
    }
    atRiskPaise = maxWhole;
  } else {
    const countedKeys = new Set<string>();
    for (const f of faults) {
      const key = `${f.ruleId}:${f.lineNumber ?? "bill"}`;
      if (!countedKeys.has(key)) {
        countedKeys.add(key);
        atRiskPaise += BigInt(f.variancePaise || "0");
      }
    }
  }

  const endNs = process.hrtime.bigint();
  const tFlagIso = new Date().toISOString();
  const latencyMs = Number(endNs - startNs) / 1e6;

  const hasLowConfLine = det.lineResults.some((l) => l.needsManualReview);
  const hasUnmatchedVoice = voiceHits.some((vh) => vh.kind === "unmatched_manual");
  const gstinOcrAmbiguous = Boolean(invoice.gstinOcrAmbiguous);
  const needsHumanReview = hasLowConfLine || hasUnmatchedVoice || gstinOcrAmbiguous;
  const autoCleanEligible =
    faults.length === 0 && !guardResult.blocked && !needsHumanReview;
  const recommendedAction: VerificationResult["recommendedAction"] =
    faults.length > 0 || guardResult.blocked || hasLowConfLine
      ? "owner_confirmation_required"
      : hasUnmatchedVoice || gstinOcrAmbiguous
        ? "human_review_required"
        : "clean_ready_for_approval";

  return {
    invoiceId: invoice.id,
    billSha256,
    ruleBundleVersion: RULE_BUNDLE_VERSION,
    oracleProfile: ORACLE_PROFILE_LABEL,
    t0Iso: invoice.receivedAtIso,
    tFlagIso,
    computeLatencyMs: Number(latencyMs.toFixed(3)),
    abstainedClarity: false,
    clarityScore: invoice.clarityScore,
    gstinValid: det.gstinCheck.valid,
    gstinMessage: det.gstinCheck.reason,
    isInterstate: det.isInterstate,
    dpdpScrubbedNotes: notesScrub.scrubbedText,
    dpdpScrubbedVoice: voiceScrub.scrubbedText,
    dpdpRedactionCount: totalRedactions,
    dpdpRedactedKinds: allRedactedKinds,
    promptGuardBlocked: guardResult.blocked,
    promptGuardFindings: guardResult.findings,
    voiceMatches: voiceHits,
    lines: det.lineResults,
    faults,
    secondaryFaults: faults.length > 1 ? faults.slice(1) : [],
    totalVarianceAtRiskPaise: atRiskPaise.toString(),
    expectedGrandTotalPaise: det.expectedGrandTotalPaise,
    declaredGrandTotalPaise: invoice.declaredGrandTotalPaise,
    gstScheduleVersion: det.gstScheduleVersion,
    gstinOcrAmbiguous,
    exportEligible: autoCleanEligible,
    recommendedAction,
  };
}
