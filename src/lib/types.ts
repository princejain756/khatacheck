export type MerchandiseGroup = "kirana" | "fmcg" | "textile" | "pharmacy";

export type SubgroupId =
  | "printed_en"
  | "bilingual_hinglish"
  | "regional_devanagari"
  | "compressed_thermal_4g"
  | "handwritten_challan";

export type FaultCategory =
  | "voice_shortage"
  | "hsn_mismatch"
  | "arithmetic_mismatch"
  | "invalid_gstin"
  | "rate_drift"
  | "duplicate_invoice"
  | "clarity_abstain"
  | "prompt_injection_blocked";

export type Severity = "critical" | "high" | "medium" | "low";

export type ReviewDecision =
  | "pending_review"
  | "approved_flag"
  | "overridden_clean"
  | "contested_appeal"
  | "retake_requested"
  | "abstained_clarity";

export interface CropBbox {
  id: string;
  label: string;
  topPct: number;
  leftPct: number;
  widthPct: number;
  heightPct: number;
  lineNumber?: number;
}

export interface InvoiceLineInput {
  lineNumber: number;
  sku: string;
  description: string;
  hsnCode: string;
  qtyMilli: number; // qty * 1000 for 3-decimal precision without floats
  unit: string;
  unitRatePaise: string; // BigInt decimal string
  discountPaise: string;
  declaredTaxablePaise: string;
  declaredCgstBps: number;
  declaredSgstBps: number;
  declaredIgstBps: number;
  declaredCgstPaise: string;
  declaredSgstPaise: string;
  declaredIgstPaise: string;
  declaredLineTotalPaise: string;
  ocrConfidence: number; // 0..1 calibrated field confidence
  bbox?: CropBbox;
}

export interface InvoiceInput {
  id: string;
  tenantId: string;
  vendorName: string;
  vendorGstin: string;
  buyerName: string;
  buyerGstin: string;
  supplierStateCode: string;
  placeOfSupplyStateCode: string;
  invoiceNumber: string;
  challanNumber?: string;
  invoiceDate: string; // YYYY-MM-DD
  receivedAtIso: string; // t0
  isReverseCharge?: boolean;
  roundOffPaise: string; // signed BigInt decimal string, max abs 50 paise when declared
  declaredTaxableSubtotalPaise: string;
  declaredTotalTaxPaise: string;
  declaredGrandTotalPaise: string;
  clarityScore: number; // Laplacian proxy 0..255 (threshold >= 85)
  subgroup: SubgroupId;
  imageUrl?: string;
  voiceTranscriptRaw?: string;
  notesRaw?: string;
  lines: InvoiceLineInput[];
}

export interface VendorRatePoint {
  vendorGstin: string;
  sku: string;
  unit: string;
  invoiceDate: string;
  unitRatePaise: string;
  approved: boolean;
}

export interface HistoricalBillRecord {
  id: string;
  tenantId: string;
  vendorGstin: string;
  invoiceNumber: string;
  challanNumber?: string;
  invoiceDate: string;
  grandTotalPaise: string;
  lineSignature: Array<{ sku: string; qtyMilli: number; unit: string }>;
}

export interface DetectedFault {
  faultId: string;
  category: FaultCategory;
  severity: Severity;
  ruleId: string;
  lineNumber?: number;
  sku?: string;
  title: string;
  explanation: string;
  declaredPaise: string;
  expectedPaise: string;
  variancePaise: string;
  bbox?: CropBbox;
  confidence: number;
}

export interface LineVerificationResult {
  lineNumber: number;
  sku: string;
  description: string;
  hsnCode: string;
  hsnMatchedRuleId: string | null;
  hsnDescription: string | null;
  expectedRateBps: number | null;
  declaredRateBps: number;
  expectedTaxablePaise: string;
  expectedCgstPaise: string;
  expectedSgstPaise: string;
  expectedIgstPaise: string;
  expectedLineTotalPaise: string;
  declaredLineTotalPaise: string;
  deltaPaise: string;
  ocrConfidence: number;
  needsManualReview: boolean;
  bbox?: CropBbox;
}

export interface PromptGuardFinding {
  ruleId: string;
  family: "A_policy_override" | "B_boundary_escape" | "C_encoded_payload" | "D_unicode_numeric" | "E_pii_exfil" | "F_multilingual_override";
  field: string;
  excerptRedacted: string;
  severity: Severity;
}

export interface VerificationResult {
  invoiceId: string;
  billSha256: string;
  ruleBundleVersion: string;
  oracleProfile: string;
  t0Iso: string;
  tFlagIso: string;
  computeLatencyMs: number;
  abstainedClarity: boolean;
  clarityScore: number;
  gstinValid: boolean;
  gstinMessage: string;
  isInterstate: boolean;
  dpdpScrubbedNotes: string;
  dpdpScrubbedVoice: string;
  dpdpRedactionCount: number;
  dpdpRedactedKinds: string[];
  promptGuardBlocked: boolean;
  promptGuardFindings: PromptGuardFinding[];
  voiceMatches: Array<{
    matchedLineNumber: number | null;
    sku: string | null;
    kind: "shortage" | "rate_jump" | "unmatched_manual";
    shortageQty: number;
    claimedRatePaise: string | null;
    variancePaise: string;
    confirmationPrompt: string;
    rawSpan: string;
  }>;
  lines: LineVerificationResult[];
  faults: DetectedFault[];
  totalVarianceAtRiskPaise: string;
  expectedGrandTotalPaise: string;
  declaredGrandTotalPaise: string;
  exportEligible: boolean;
  recommendedAction: "retake_required" | "owner_confirmation_required" | "clean_ready_for_approval";
}

export interface AuditLedgerEvent {
  seq: number;
  eventId: string;
  tenantId: string;
  invoiceId: string;
  invoiceNumber: string;
  vendorName: string;
  billSha256: string;
  billReceivedTs: string; // t0
  flagSentTs: string; // t_flag
  ownerApprovalTs: string | null; // t_confirm
  modelId: string;
  promptHash: string;
  ruleBundleVersion: string;
  fieldConfidencesMin: number;
  sourceCropBbox: CropBbox | null;
  ruleChecks: string[];
  varianceAtRiskPaise: string;
  decision: ReviewDecision;
  overrideReason: string;
  dwellMs: number | null;
  actorRef: string;
  isSyntheticStress?: boolean;
  prevHash: string;
  entryHash: string;
}

export interface BenchmarkReport {
  runId: string;
  executedAtIso: string;
  seed: number;
  generatorVersion: string;
  ruleBundleVersion: string;
  oracleProfile: string;
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
  };
  totals: {
    totalInvoices: number;
    cleanInvoices: number;
    substantiveFaultInvoices: number;
    clarityAbstentionInvoices: number;
    attackCases: number;
    attackControls: number;
  };
  overall: {
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
    precisionPct: number;
    recallPct: number;
    f1Pct: number;
    cleanFalsePositiveRatePct: number;
    cleanAbstentionRatePct: number;
    clarityAbstentionCorrect: number;
    clarityAbstentionTotal: number;
    deterministicMathPassed: number;
    deterministicMathTotal: number;
    deterministicMathAccuracyPct: number;
    precisionCi95: [number, number];
    recallCi95: [number, number];
    f1Ci95Bootstrap: [number, number];
  };
  fairness: {
    macroMeanF1Pct: number;
    macroMeanRecallPct: number;
    maxF1GapBelowMeanPct: number;
    maxRecallGapBelowMeanPct: number;
    launchGateThresholdPct: number;
    fairnessGatePassed: boolean;
    subgroups: Array<{
      subgroup: SubgroupId;
      total: number;
      cleanCount: number;
      substantiveCount: number;
      clarityTargetCount: number;
      precisionPct: number;
      recallPct: number;
      f1Pct: number;
      cleanFprPct: number;
      clarityAbstentionPassCount: number;
      f1GapFromMeanPct: number;
      recallGapFromMeanPct: number;
    }>;
  };
  byFaultCategory: Array<{
    category: FaultCategory;
    expectedCount: number;
    detectedCorrectLineAndFamily: number;
    recallPct: number;
  }>;
  redTeam: {
    totalAttacks: number;
    blockedOrIsolated: number;
    taxIntegrityPreserved: number;
    piiZeroLeakPassed: number;
    exportBlockedCount: number;
    passRatePct: number;
    byFamily: Array<{
      family: string;
      total: number;
      passed: number;
    }>;
    sampleLogs: Array<{
      caseId: string;
      family: string;
      payloadPreview: string;
      quarantined: boolean;
      taxUnchanged: boolean;
      ruleMatched: string;
    }>;
  };
  latency: {
    scopeNote: string;
    passes: number;
    samplesCount: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    manualBaselineActiveMinRange: [number, number];
    manualBaselineLagDaysRange: [number, number];
    pilotStatus: string;
    pilotProtocolStoreCount: number;
    pilotProtocolWeeks: number;
  };
  gates: {
    recallAtLeast94: boolean;
    f1AtLeast94: boolean;
    cleanFprAtMost3: boolean;
    mathAccuracy100: boolean;
    fairnessGapAtMost5: boolean;
    latencyP95Under4000Ms: boolean;
    redTeamAll50Passed: boolean;
    allGatesPassed: boolean;
  };
}
