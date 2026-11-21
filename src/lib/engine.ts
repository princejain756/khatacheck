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

  const billCanonical = JSON.stringify({
    id: invoice.id,
    vendorGstin: invoice.vendorGstin,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    declaredGrandTotalPaise: invoice.declaredGrandTotalPaise,
    lines: invoice.lines.map((l) => [l.lineNumber, l.sku, l.hsnCode, l.qtyMilli, l.declaredLineTotalPaise]),
  });
  const billSha256 = crypto.createHash("sha256").update(billCanonical, "utf8").digest("hex");

  // 1. Pre-flight DPDP PII Scrub BEFORE extraction/voice inference
  const notesScrub = enablePiiScrub
    ? scrubPiiForModelEgress(invoice.notesRaw)
    : { scrubbedText: invoice.notesRaw ?? "", redactionCount: 0, redactedKinds: [] };
  const voiceScrub = enablePiiScrub
    ? scrubPiiForModelEgress(invoice.voiceTranscriptRaw)
    : { scrubbedText: invoice.voiceTranscriptRaw ?? "", redactionCount: 0, redactedKinds: [] };
  const allRedactedKinds = [...new Set([...notesScrub.redactedKinds, ...voiceScrub.redactedKinds])];
  const totalRedactions = notesScrub.redactionCount + voiceScrub.redactionCount;

  // 2. Untrusted Input Prompt-Injection Guard (before downstream matching)
  const untrustedInputs: Array<{ field: string; text: string | undefined }> = [
    { field: "notesRaw", text: invoice.notesRaw },
    { field: "voiceTranscriptRaw", text: invoice.voiceTranscriptRaw },
    { field: "invoiceNumber", text: invoice.invoiceNumber },
    ...invoice.lines.map((l) => ({
      field: `line_${l.lineNumber}_description`,
      text: `${l.sku} ${l.description}`,
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
      totalVarianceAtRiskPaise: "0",
      expectedGrandTotalPaise: invoice.declaredGrandTotalPaise,
      declaredGrandTotalPaise: invoice.declaredGrandTotalPaise,
      exportEligible: false,
      recommendedAction: "retake_required",
    };
  }

  // 4. Deterministic Accounting, Tax, Duplicate & 90-Day Rate-Drift Verification
  const det = verifyInvoiceDeterministic(invoice, vendorHistory, priorBills);
  const faults: DetectedFault[] = [...det.faults];

  // 5. Bilingual Hinglish / Regional Voice Receiving Reconciliation
  const voiceHits = parseVoiceRemarks(voiceScrub.scrubbedText, invoice.lines);
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
  if (guardResult.blocked) {
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

  // Sum unique line/bill variances without double-counting exact duplicate/GSTIN full-bill totals
  let atRiskPaise = 0n;
  const countedLines = new Set<string>();
  const wholeBillFault = faults.find(
    (f) => f.category === "duplicate_invoice" || f.category === "invalid_gstin"
  );
  if (wholeBillFault) {
    atRiskPaise = BigInt(wholeBillFault.variancePaise || "0");
  } else {
    for (const f of faults) {
      const key = `${f.category}:${f.lineNumber ?? "bill"}`;
      if (!countedLines.has(key)) {
        countedLines.add(key);
        atRiskPaise += BigInt(f.variancePaise || "0");
      }
    }
  }

  const endNs = process.hrtime.bigint();
  const tFlagIso = new Date().toISOString();
  const latencyMs = Number(endNs - startNs) / 1e6;

  const hasLowConfLine = det.lineResults.some((l) => l.needsManualReview);
  const recommendedAction =
    faults.length > 0 || hasLowConfLine
      ? "owner_confirmation_required"
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
    totalVarianceAtRiskPaise: atRiskPaise.toString(),
    expectedGrandTotalPaise: det.expectedGrandTotalPaise,
    declaredGrandTotalPaise: invoice.declaredGrandTotalPaise,
    exportEligible: faults.length === 0 && !guardResult.blocked && !hasLowConfLine,
    recommendedAction,
  };
}
