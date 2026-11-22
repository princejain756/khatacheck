import crypto from "node:crypto";
import { bigIntAbs, halfUpDiv } from "./money";
import type {
  DetectedFault,
  HistoricalBillRecord,
  InvoiceInput,
  LineVerificationResult,
  MerchandiseGroup,
  VendorRatePoint,
} from "./types";

export const RULE_BUNDLE_VERSION = "2026.11.v2-gst2-date-effective";
export const ORACLE_PROFILE_LABEL = "Synthetic Oracle v2 (Date-Effective Pre/Post GST 2.0)";
export const GST2_EFFECTIVE_DATE = "2025-09-22";

export type GstScheduleVersion = "v1_pre_gst2" | "v2_gst2";

export function resolveGstScheduleVersion(invoiceDate?: string): GstScheduleVersion {
  const clean = String(invoiceDate ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean) && clean < GST2_EFFECTIVE_DATE) {
    return "v1_pre_gst2";
  }
  return "v2_gst2";
}

export const V1_LEGAL_SLABS_BPS = new Set([0, 300, 500, 1200, 1800, 2800]);
export const V2_LEGAL_SLABS_BPS = new Set([0, 300, 500, 1800, 4000]);

const GSTIN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const GST_STATE_CODES: Readonly<Record<string, string>> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

const LEGACY_STATE_CODES = new Set(["25", "28", "99"]);

export function computeGstinCheckChar(prefix14: string): string {
  if (prefix14.length !== 14) {
    throw new Error("GSTIN prefix must be 14 characters");
  }
  let total = 0;
  for (let i = 0; i < 14; i += 1) {
    const val = GSTIN_ALPHABET.indexOf(prefix14[i]);
    if (val < 0) {
      throw new Error(`Invalid character in GSTIN prefix at index ${i}`);
    }
    const weight = i % 2 === 0 ? 1 : 2;
    const product = val * weight;
    total += Math.floor(product / 36) + (product % 36);
  }
  const rem = total % 36;
  const codePoint = (36 - rem) % 36;
  return GSTIN_ALPHABET[codePoint];
}

export function makeValidGstin(
  stateCode: string,
  panLetters5 = "AABCK",
  panDigits4 = "4120",
  panLast = "M",
  entityNo = "1"
): string {
  const prefix14 = `${stateCode}${panLetters5}${panDigits4}${panLast}${entityNo}Z`.toUpperCase();
  return prefix14 + computeGstinCheckChar(prefix14);
}

export function validateGstin(rawInput: string): {
  valid: boolean;
  normalized: string;
  stateCode: string | null;
  stateName: string | null;
  reason: string;
  legacyReviewNeeded: boolean;
} {
  const rawStr = String(rawInput ?? "");
  let spStart = 0;
  while (spStart < rawStr.length && rawStr[spStart] === " ") spStart += 1;
  let spEnd = rawStr.length;
  while (spEnd > spStart && rawStr[spEnd - 1] === " ") spEnd -= 1;
  const outerTrimmed = rawStr.slice(spStart, spEnd);
  if (!outerTrimmed) {
    return {
      valid: false,
      normalized: "",
      stateCode: null,
      stateName: null,
      reason: "Missing supplier GSTIN",
      legacyReviewNeeded: false,
    };
  }
  if (/[^\x20-\x7E]/.test(outerTrimmed) || /\s/.test(outerTrimmed)) {
    return {
      valid: false,
      normalized: outerTrimmed,
      stateCode: null,
      stateName: null,
      reason: "GSTIN contains embedded whitespace, non-ASCII, or confusable control characters",
      legacyReviewNeeded: false,
    };
  }
  const normalized = outerTrimmed.toUpperCase();
  if (!GSTIN_REGEX.test(normalized)) {
    return {
      valid: false,
      normalized,
      stateCode: null,
      stateName: null,
      reason: "GSTIN fails 15-character PAN-based structure regex",
      legacyReviewNeeded: false,
    };
  }
  const stateCode = normalized.slice(0, 2);
  if (LEGACY_STATE_CODES.has(stateCode)) {
    return {
      valid: false,
      normalized,
      stateCode,
      stateName: "Legacy / Central Jurisdiction",
      reason: `Jurisdiction prefix ${stateCode} requires manual tax review`,
      legacyReviewNeeded: true,
    };
  }
  const stateName = Object.hasOwn(GST_STATE_CODES, stateCode)
    ? GST_STATE_CODES[stateCode]
    : null;
  if (!stateName) {
    return {
      valid: false,
      normalized,
      stateCode,
      stateName: null,
      reason: `Unsupported GST state/UT prefix ${stateCode}`,
      legacyReviewNeeded: false,
    };
  }
  const expectedChar = computeGstinCheckChar(normalized.slice(0, 14));
  if (normalized[14] !== expectedChar) {
    return {
      valid: false,
      normalized,
      stateCode,
      stateName,
      reason: `Mod-36 check digit mismatch: expected '${expectedChar}', got '${normalized[14]}'`,
      legacyReviewNeeded: false,
    };
  }
  return {
    valid: true,
    normalized,
    stateCode,
    stateName,
    reason: `Valid Mod-36 checksum (${stateName} ${stateCode})`,
    legacyReviewNeeded: false,
  };
}

export type SupportedGstPct = 0 | 3 | 5 | 12 | 18 | 28 | 40;

export interface HsnRuleEntry {
  ruleId: string;
  hsnCode: string;
  description: string;
  merchandiseGroup: MerchandiseGroup;
  taxTreatment: "taxable" | "nil_rated" | "exempt";
  cgstBps: number;
  sgstOrUtgstBps: number;
  igstBps: number;
  effectiveFrom: string;
  effectiveTo?: string;
  scheduleVersion: GstScheduleVersion;
  valueThresholdPaise?: string;
  overThresholdGstPct?: SupportedGstPct;
  sourceDigest: string;
}

function hsnWithSchedule(
  hsnCode: string,
  description: string,
  merchandiseGroup: MerchandiseGroup,
  gstPct: SupportedGstPct,
  scheduleVersion: GstScheduleVersion,
  options?: {
    taxTreatment?: "taxable" | "nil_rated" | "exempt";
    valueThresholdPaise?: string;
    overThresholdGstPct?: SupportedGstPct;
  }
): HsnRuleEntry {
  const igstBps = gstPct * 100;
  const half = Math.floor(igstBps / 2);
  const isV2 = scheduleVersion === "v2_gst2";
  return {
    ruleId: `HSN-${hsnCode}-${gstPct}`,
    hsnCode,
    description,
    merchandiseGroup,
    taxTreatment: options?.taxTreatment ?? "taxable",
    cgstBps: half,
    sgstOrUtgstBps: igstBps - half,
    igstBps,
    effectiveFrom: isV2 ? GST2_EFFECTIVE_DATE : "2017-07-01",
    ...(isV2 ? {} : { effectiveTo: "2025-09-21" }),
    scheduleVersion,
    ...(options?.valueThresholdPaise ? { valueThresholdPaise: options.valueThresholdPaise } : {}),
    ...(options?.overThresholdGstPct !== undefined ? { overThresholdGstPct: options.overThresholdGstPct } : {}),
    sourceDigest: isV2 ? "cbic-56th-council-gst2-2025-09-22" : "demo-synthetic-oracle-v1",
  };
}

function hsn(
  hsnCode: string,
  description: string,
  merchandiseGroup: MerchandiseGroup,
  gstPct: SupportedGstPct,
  taxTreatment: "taxable" | "nil_rated" | "exempt" = "taxable"
): HsnRuleEntry {
  return hsnWithSchedule(hsnCode, description, merchandiseGroup, gstPct, "v1_pre_gst2", {
    taxTreatment,
  });
}

// Legacy pre-22-Sep-2025 60 headings across Kirana (15), FMCG (15), Textile (15), Pharmacy & Supplies (15)
export const HSN_SCHEDULE_60_V1: readonly HsnRuleEntry[] = [
  // Kirana (15)
  hsn("0713", "Dried leguminous vegetables / pulses (prepacked & labelled)", "kirana", 5),
  hsn("0901", "Coffee roasted / retail packets", "kirana", 5),
  hsn("0902", "Tea leaves and packed CTC tea", "kirana", 5),
  hsn("0904", "Black pepper and whole/ground chilli", "kirana", 5),
  hsn("1001", "Wheat & meslin (prepacked & labelled)", "kirana", 5),
  hsn("1006", "Rice (prepacked & labelled <= 25 kg)", "kirana", 5),
  hsn("1101", "Wheat flour / atta / maida (branded prepacked)", "kirana", 5),
  hsn("1102", "Cereal flours (besan / rice flour prepacked)", "kirana", 5),
  hsn("1507", "Soya-bean refined edible oil", "kirana", 5),
  hsn("1508", "Groundnut edible oil", "kirana", 5),
  hsn("1509", "Olive edible oil", "kirana", 5),
  hsn("1510", "Other olive oil fractions", "kirana", 5),
  hsn("1511", "Palm oil & palmolein edible oil", "kirana", 5),
  hsn("1512", "Sunflower / safflower seed oil", "kirana", 5),
  hsn("1515", "Sesame / fixed vegetable edible oils", "kirana", 5),

  // FMCG (15)
  hsn("0401", "Fresh milk and cream (unconcentrated)", "fmcg", 0, "nil_rated"),
  hsn("0405", "Butter and dairy spreads", "fmcg", 12),
  hsn("0406", "Cheese and processed paneer", "fmcg", 12),
  hsn("1513", "Coconut and palm kernel oil", "fmcg", 5),
  hsn("1514", "Mustard / rapeseed / colza edible oil", "fmcg", 5),
  hsn("1701", "Cane sugar & jaggery crystals (refined)", "fmcg", 5),
  hsn("1806", "Chocolate & cocoa food preparations", "fmcg", 18),
  hsn("1905", "Biscuits, wafers & rusks", "fmcg", 18),
  hsn("2106", "Packaged namkeen, mixes & food preparations", "fmcg", 12),
  hsn("3304", "Skin care & cosmetic preparations", "fmcg", 18),
  hsn("3305", "Hair oils & shampoo preparations", "fmcg", 18),
  hsn("3306", "Toothpaste & oral hygiene products", "fmcg", 18),
  hsn("3401", "Toilet soaps & bathing bars", "fmcg", 18),
  hsn("3402", "Laundry detergents & washing powders", "fmcg", 18),
  hsn("4818", "Toilet paper, napkins & sanitary tissues", "fmcg", 12),

  // Textile (15)
  hsn("5208", "Woven cotton fabrics >= 85% cotton <= 200 g/sqm", "textile", 5),
  hsn("5209", "Woven cotton fabrics >= 85% cotton > 200 g/sqm", "textile", 5),
  hsn("5210", "Cotton fabrics blended with man-made fibres", "textile", 5),
  hsn("5211", "Heavyweight blended cotton fabrics", "textile", 5),
  hsn("5407", "Woven fabrics of synthetic filament yarn", "textile", 5),
  hsn("5408", "Woven fabrics of artificial filament yarn", "textile", 5),
  hsn("6006", "Knitted or crocheted cotton/synthetic fabrics", "textile", 5),
  hsn("6105", "Men/boys knitted cotton shirts (value <= threshold)", "textile", 5),
  hsn("6109", "T-shirts, singlets & vests (value <= threshold)", "textile", 5),
  hsn("6203", "Men/boys woven trousers & suits (pre-GST-2.0 slab)", "textile", 12),
  hsn("6204", "Women/girls woven suits & kurtas (pre-GST-2.0 slab)", "textile", 12),
  hsn("6205", "Men/boys woven shirts (pre-GST-2.0 slab)", "textile", 12),
  hsn("6206", "Women/girls woven blouses & tops", "textile", 5),
  hsn("6302", "Cotton bed linen, table linen & towels (<= threshold)", "textile", 5),
  hsn("6304", "Curtains & furnishing articles (pre-GST-2.0 slab)", "textile", 12),

  // Pharmacy & Supplies (15)
  hsn("3003", "Unmixed/compounded ayurvedic & generic medicaments", "pharmacy", 12),
  hsn("3004", "Retail packaged pharmaceutical medicaments", "pharmacy", 12),
  hsn("3005", "Wadding, gauze, bandages & medical dressings", "pharmacy", 12),
  hsn("3006", "First-aid kits, surgical sutures & dental cements", "pharmacy", 12),
  hsn("3407", "Dental waxes & medical modelling pastes", "pharmacy", 18),
  hsn("3822", "Diagnostic lab & clinical test reagents", "pharmacy", 12),
  hsn("4015", "Surgical & examination rubber gloves", "pharmacy", 12),
  hsn("6115", "Graduated compression hosiery & medical stockings", "pharmacy", 12),
  hsn("6505", "Disposable surgical & clinical caps", "pharmacy", 12),
  hsn("9004", "Corrective spectacles & optical protective frames", "pharmacy", 12),
  hsn("9018", "Surgical, dental & diagnostic instruments", "pharmacy", 12),
  hsn("9019", "Mechano-therapy, nebulizers & oxygen therapy kits", "pharmacy", 12),
  hsn("9020", "Breathing appliances & clinical gas masks", "pharmacy", 12),
  hsn("9021", "Orthopaedic appliances, splints & hearing aids", "pharmacy", 5),
  hsn("9022", "Medical X-ray & imaging apparatus", "pharmacy", 12),
];

const V2_OVERRIDES: Readonly<
  Record<
    string,
    {
      gstPct: SupportedGstPct;
      valueThresholdPaise?: string;
      overThresholdGstPct?: SupportedGstPct;
    }
  >
> = {
  "0405": { gstPct: 5 },
  "0406": { gstPct: 5 },
  "1806": { gstPct: 5 },
  "1905": { gstPct: 5 },
  "2106": { gstPct: 5 },
  "3305": { gstPct: 5 },
  "3306": { gstPct: 5 },
  "3401": { gstPct: 5 },
  "4818": { gstPct: 5 },
  "6203": { gstPct: 5, valueThresholdPaise: "250000", overThresholdGstPct: 18 },
  "6204": { gstPct: 5, valueThresholdPaise: "250000", overThresholdGstPct: 18 },
  "6205": { gstPct: 5, valueThresholdPaise: "250000", overThresholdGstPct: 18 },
  "6304": { gstPct: 5, valueThresholdPaise: "250000", overThresholdGstPct: 18 },
  "3003": { gstPct: 5 },
  "3004": { gstPct: 5 },
  "3005": { gstPct: 5 },
  "3006": { gstPct: 5 },
  "3822": { gstPct: 5 },
  "4015": { gstPct: 5 },
  "6115": { gstPct: 5, valueThresholdPaise: "250000", overThresholdGstPct: 18 },
  "6505": { gstPct: 5, valueThresholdPaise: "250000", overThresholdGstPct: 18 },
  "9004": { gstPct: 5 },
  "9018": { gstPct: 5 },
  "9019": { gstPct: 5 },
  "9020": { gstPct: 5 },
  "9022": { gstPct: 5 },
};

// Post-22-Sep-2025 GST 2.0 (CBIC 56th Council / Notification 09/2025-CT(Rate))
export const HSN_SCHEDULE_60_V2_GST2: readonly HsnRuleEntry[] = HSN_SCHEDULE_60_V1.map((entry) => {
  const ov = V2_OVERRIDES[entry.hsnCode];
  const basePct = (ov ? ov.gstPct : Math.round(entry.igstBps / 100)) as SupportedGstPct;
  return hsnWithSchedule(entry.hsnCode, entry.description, entry.merchandiseGroup, basePct, "v2_gst2", {
    taxTreatment: entry.taxTreatment,
    valueThresholdPaise: ov?.valueThresholdPaise,
    overThresholdGstPct: ov?.overThresholdGstPct,
  });
});

export const HSN_SCHEDULE_60: readonly HsnRuleEntry[] = HSN_SCHEDULE_60_V1;

const HSN_MAP_V1 = new Map<string, HsnRuleEntry>();
for (const entry of HSN_SCHEDULE_60_V1) {
  HSN_MAP_V1.set(entry.hsnCode, entry);
}

const HSN_MAP_V2 = new Map<string, HsnRuleEntry>();
for (const entry of HSN_SCHEDULE_60_V2_GST2) {
  HSN_MAP_V2.set(entry.hsnCode, entry);
}

export function lookupHsnRule(
  rawHsn: string,
  invoiceDate?: string,
  unitRatePaise?: bigint | string
): HsnRuleEntry | null {
  const clean = String(rawHsn ?? "").replace(/\s+/g, "").trim();
  if (!clean) return null;
  const version = resolveGstScheduleVersion(invoiceDate);
  const map = version === "v1_pre_gst2" ? HSN_MAP_V1 : HSN_MAP_V2;
  const base = map.get(clean) ?? map.get(clean.slice(0, 4)) ?? null;
  if (!base) return null;

  if (
    version === "v2_gst2" &&
    base.valueThresholdPaise &&
    base.overThresholdGstPct !== undefined &&
    unitRatePaise !== undefined
  ) {
    const rate = typeof unitRatePaise === "bigint" ? unitRatePaise : BigInt(unitRatePaise || "0");
    if (rate > BigInt(base.valueThresholdPaise)) {
      return hsnWithSchedule(
        base.hsnCode,
        base.description,
        base.merchandiseGroup,
        base.overThresholdGstPct,
        "v2_gst2",
        {
          taxTreatment: base.taxTreatment,
          valueThresholdPaise: base.valueThresholdPaise,
          overThresholdGstPct: base.overThresholdGstPct,
        }
      );
    }
  }
  return base;
}

export function normalizeIdToken(raw: string): string {
  return String(raw ?? "").trim().toUpperCase();
}

export function computeInvoiceFingerprint(
  vendorGstin: string,
  invoiceNumber: string,
  invoiceDate: string,
  grandTotalPaise: string
): string {
  const payload = JSON.stringify([
    normalizeIdToken(vendorGstin),
    normalizeIdToken(invoiceNumber),
    normalizeIdToken(invoiceDate),
    String(grandTotalPaise),
  ]);
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

function multisetJaccardAtLeast80(
  a: Array<{ sku: string; qtyMilli: number; unit: string }>,
  b: Array<{ sku: string; qtyMilli: number; unit: string }>
): { overlapPct: number; isMatch: boolean } {
  const mapA = new Map<string, number>();
  const mapB = new Map<string, number>();
  for (const item of a) {
    const key = `${normalizeIdToken(item.sku)}|${item.qtyMilli}|${normalizeIdToken(item.unit)}`;
    mapA.set(key, (mapA.get(key) ?? 0) + 1);
  }
  for (const item of b) {
    const key = `${normalizeIdToken(item.sku)}|${item.qtyMilli}|${normalizeIdToken(item.unit)}`;
    mapB.set(key, (mapB.get(key) ?? 0) + 1);
  }
  const keys = new Set([...mapA.keys(), ...mapB.keys()]);
  let intersection = 0;
  let union = 0;
  for (const k of keys) {
    const ca = mapA.get(k) ?? 0;
    const cb = mapB.get(k) ?? 0;
    intersection += Math.min(ca, cb);
    union += Math.max(ca, cb);
  }
  if (union === 0) return { overlapPct: 0, isMatch: false };
  const overlapPct = Math.round((intersection * 1000) / union) / 10;
  return { overlapPct, isMatch: 5 * intersection >= 4 * union };
}

function daysBetweenIso(earlierIso: string, laterIso: string): number {
  const t1 = Date.parse(`${earlierIso}T00:00:00Z`);
  const t2 = Date.parse(`${laterIso}T00:00:00Z`);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return 999;
  return Math.round((t2 - t1) / 86400000);
}

function safeBigInt(raw: string | undefined | null): bigint {
  const s = String(raw ?? "0").trim();
  return /^-?\d+$/.test(s) ? BigInt(s) : 0n;
}

function nearestSlabBps(declaredRateBps: number, legalSlabs: Set<number>): number {
  let best = 0;
  let bestDiff = Infinity;
  for (const s of legalSlabs) {
    const d = Math.abs(s - declaredRateBps);
    if (d < bestDiff) {
      bestDiff = d;
      best = s;
    }
  }
  return best;
}

export function verifyInvoiceDeterministic(
  invoice: InvoiceInput,
  vendorHistory: VendorRatePoint[],
  priorBills: HistoricalBillRecord[]
): {
  gstinCheck: ReturnType<typeof validateGstin>;
  gstScheduleVersion: GstScheduleVersion;
  isInterstate: boolean;
  lineResults: LineVerificationResult[];
  expectedTaxableSubtotalPaise: string;
  expectedTotalTaxPaise: string;
  expectedGrandTotalPaise: string;
  faults: DetectedFault[];
} {
  const scheduleVersion = resolveGstScheduleVersion(invoice.invoiceDate);
  const legalSlabs = scheduleVersion === "v1_pre_gst2" ? V1_LEGAL_SLABS_BPS : V2_LEGAL_SLABS_BPS;
  const gstinCheck = validateGstin(invoice.vendorGstin);
  const faults: DetectedFault[] = [];
  let faultSeq = 1;

  if (!gstinCheck.valid) {
    faults.push({
      faultId: `FLT-${faultSeq++}`,
      category: "invalid_gstin",
      severity: "critical",
      ruleId: gstinCheck.legacyReviewNeeded ? "GST-STATE-LEGACY-REVIEW" : "GSTIN-MOD36-CHECK",
      title: "Invalid or Review-Required Supplier GSTIN",
      explanation: `${gstinCheck.reason}. An invalid supplier GSTIN blocks Input Tax Credit reconciliation in GSTR-2B.`,
      declaredPaise: invoice.declaredTotalTaxPaise,
      expectedPaise: "0",
      variancePaise: safeBigInt(invoice.declaredTotalTaxPaise).toString(),
      confidence: 1.0,
    });
  }

  const rawSupplierState = normalizeIdToken(invoice.supplierStateCode || "");
  const gstinState = gstinCheck.valid && gstinCheck.stateCode ? gstinCheck.stateCode : "";
  const supplierState = gstinState || rawSupplierState;
  if (gstinState && rawSupplierState && rawSupplierState !== gstinState) {
    faults.push({
      faultId: `FLT-${faultSeq++}`,
      category: "invalid_gstin",
      severity: "high",
      ruleId: "GST-STATE-CONFLICT",
      title: "Supplier State Code Conflicts with GSTIN Prefix",
      explanation: `Declared supplier state ${rawSupplierState} conflicts with validated GSTIN state prefix ${gstinState}.`,
      declaredPaise: invoice.declaredTotalTaxPaise,
      expectedPaise: "0",
      variancePaise: safeBigInt(invoice.declaredTotalTaxPaise).toString(),
      confidence: 1.0,
    });
  }

  const rawPosState = normalizeIdToken(invoice.placeOfSupplyStateCode || "");
  const posStateValid = !rawPosState || Object.hasOwn(GST_STATE_CODES, rawPosState);
  if (rawPosState && !posStateValid) {
    faults.push({
      faultId: `FLT-${faultSeq++}`,
      category: "invalid_gstin",
      severity: "high",
      ruleId: "GST-PLACE-OF-SUPPLY-INVALID",
      title: "Invalid Place-of-Supply State Code",
      explanation: `Declared place of supply "${rawPosState}" is not a valid 2-digit CBIC state code.`,
      declaredPaise: invoice.declaredTotalTaxPaise,
      expectedPaise: "0",
      variancePaise: safeBigInt(invoice.declaredTotalTaxPaise).toString(),
      confidence: 1.0,
    });
  }
  const posState = rawPosState && posStateValid ? rawPosState : supplierState;
  const isInterstate = Boolean(supplierState && posState && supplierState !== posState);

  // Check duplicates (exact fingerprint OR <= 30-day same-vendor challan >= 80% Jaccard)
  const curFingerprint = computeInvoiceFingerprint(
    invoice.vendorGstin,
    invoice.invoiceNumber,
    invoice.invoiceDate,
    invoice.declaredGrandTotalPaise
  );
  const curSig = invoice.lines.map((l) => ({
    sku: l.sku,
    qtyMilli: l.qtyMilli,
    unit: l.unit,
  }));

  for (const prev of priorBills) {
    if (prev.tenantId !== invoice.tenantId || prev.id === invoice.id) continue;
    const prevFp = computeInvoiceFingerprint(
      prev.vendorGstin,
      prev.invoiceNumber,
      prev.invoiceDate,
      prev.grandTotalPaise
    );
    if (prevFp === curFingerprint) {
      faults.push({
        faultId: `FLT-${faultSeq++}`,
        category: "duplicate_invoice",
        severity: "critical",
        ruleId: "DUP-EXACT-SHA256",
        title: `Exact Duplicate Bill (${prev.invoiceNumber})`,
        explanation: `Matches earlier recorded invoice ${prev.invoiceNumber} dated ${prev.invoiceDate} for the same amount.`,
        declaredPaise: invoice.declaredGrandTotalPaise,
        expectedPaise: "0",
        variancePaise: safeBigInt(invoice.declaredGrandTotalPaise).toString(),
        confidence: 1.0,
      });
      break;
    }
    if (
      normalizeIdToken(prev.vendorGstin) === normalizeIdToken(invoice.vendorGstin) &&
      invoice.challanNumber &&
      prev.challanNumber &&
      normalizeIdToken(invoice.challanNumber) === normalizeIdToken(prev.challanNumber)
    ) {
      const gap = daysBetweenIso(prev.invoiceDate, invoice.invoiceDate);
      if (gap >= 0 && gap <= 30) {
        const j = multisetJaccardAtLeast80(prev.lineSignature, curSig);
        if (j.isMatch) {
          faults.push({
            faultId: `FLT-${faultSeq++}`,
            category: "duplicate_invoice",
            severity: "high",
            ruleId: "DUP-CHALLAN-JACCARD80",
            title: `Duplicate Challan #${invoice.challanNumber} Re-Billed`,
            explanation: `Shares ${j.overlapPct}% line-item overlap with prior bill ${prev.invoiceNumber} (${prev.invoiceDate}) under the same delivery challan within ${gap} days.`,
            declaredPaise: invoice.declaredGrandTotalPaise,
            expectedPaise: "0",
            variancePaise: safeBigInt(invoice.declaredGrandTotalPaise).toString(),
            confidence: 1.0,
          });
          break;
        }
      }
    }
  }

  // Deterministic BigInt paise verification line-by-line
  const lineResults: LineVerificationResult[] = [];
  let sumTaxable = 0n;
  let sumTax = 0n;
  let sumLineVariances = 0n;

  for (const line of invoice.lines) {
    const safeQtyNum = Number.isFinite(line.qtyMilli) ? Math.max(0, Math.trunc(line.qtyMilli)) : 0;
    const qtyMilli = BigInt(safeQtyNum);
    const ratePaise = safeBigInt(line.unitRatePaise);
    const discountPaise = safeBigInt(line.discountPaise);
    const gross = halfUpDiv(qtyMilli * ratePaise, 1000n);
    const validDiscount = discountPaise < 0n || discountPaise > gross ? 0n : discountPaise;
    const expectedTaxable = gross - validDiscount;
    const declaredTaxable = safeBigInt(line.declaredTaxablePaise);

    const hsnRule = lookupHsnRule(line.hsnCode, invoice.invoiceDate, ratePaise);
    const hsnUnverified = hsnRule === null;
    const expectedRateBps = hsnRule ? hsnRule.igstBps : null;
    const declaredRateBps =
      (line.declaredCgstBps || 0) + (line.declaredSgstBps || 0) + (line.declaredIgstBps || 0);

    let expectedCgst = 0n;
    let expectedSgst = 0n;
    let expectedIgst = 0n;
    if (hsnRule) {
      if (isInterstate) {
        expectedIgst = halfUpDiv(expectedTaxable * BigInt(hsnRule.igstBps), 10000n);
      } else {
        expectedCgst = halfUpDiv(expectedTaxable * BigInt(hsnRule.cgstBps), 10000n);
        expectedSgst = halfUpDiv(expectedTaxable * BigInt(hsnRule.sgstOrUtgstBps), 10000n);
      }
    } else if (isInterstate) {
      expectedIgst = halfUpDiv(expectedTaxable * BigInt(declaredRateBps), 10000n);
    } else {
      const halfBps = Math.floor(declaredRateBps / 2);
      expectedCgst = halfUpDiv(expectedTaxable * BigInt(halfBps), 10000n);
      expectedSgst = halfUpDiv(expectedTaxable * BigInt(declaredRateBps - halfBps), 10000n);
    }

    const declaredCgst = safeBigInt(line.declaredCgstPaise);
    const declaredSgst = safeBigInt(line.declaredSgstPaise);
    const declaredIgst = safeBigInt(line.declaredIgstPaise);

    // Check line arithmetic & tax split against declared rate independently of HSN slab mismatch
    const declHalfBps = Math.floor(declaredRateBps / 2);
    const expectedCgstAtDecl = isInterstate
      ? 0n
      : halfUpDiv(expectedTaxable * BigInt(declHalfBps), 10000n);
    const expectedSgstAtDecl = isInterstate
      ? 0n
      : halfUpDiv(expectedTaxable * BigInt(declaredRateBps - declHalfBps), 10000n);
    const expectedIgstAtDecl = isInterstate
      ? halfUpDiv(expectedTaxable * BigInt(declaredRateBps), 10000n)
      : 0n;
    const expectedLineTotalAtDecl =
      expectedTaxable + expectedCgstAtDecl + expectedSgstAtDecl + expectedIgstAtDecl;

    const hasTaxSplitViolation = isInterstate
      ? (line.declaredCgstBps || 0) !== 0 ||
        (line.declaredSgstBps || 0) !== 0 ||
        declaredCgst !== 0n ||
        declaredSgst !== 0n ||
        declaredIgst !== expectedIgstAtDecl
      : (line.declaredIgstBps || 0) !== 0 ||
        declaredIgst !== 0n ||
        declaredCgst !== expectedCgstAtDecl ||
        declaredSgst !== expectedSgstAtDecl;

    const expectedLineTotal = expectedTaxable + expectedCgst + expectedSgst + expectedIgst;
    const declaredLineTotal = safeBigInt(line.declaredLineTotalPaise);

    // 1. Evaluate HSN slab / notified legal slab independently (no else-if masking)
    if (hsnRule && expectedRateBps !== null && declaredRateBps !== expectedRateBps) {
      const declaredTaxAtWrongSlab = halfUpDiv(expectedTaxable * BigInt(declaredRateBps), 10000n);
      const expectedTaxAtHsnSlab = expectedCgst + expectedSgst + expectedIgst;
      const taxOvercharge = bigIntAbs(declaredTaxAtWrongSlab - expectedTaxAtHsnSlab);
      sumLineVariances += taxOvercharge;
      faults.push({
        faultId: `FLT-${faultSeq++}`,
        category: "hsn_mismatch",
        severity: "high",
        ruleId: hsnRule.ruleId,
        lineNumber: line.lineNumber,
        sku: line.sku,
        title: `Line ${line.lineNumber}: Wrong GST Slab on HSN ${hsnRule.hsnCode}`,
        explanation: `${line.description} carries HSN ${hsnRule.hsnCode} (${hsnRule.description}, ${scheduleVersion}) at ${(expectedRateBps / 100).toFixed(0)}% GST, but bill charged ${(declaredRateBps / 100).toFixed(0)}%.`,
        declaredPaise: declaredTaxAtWrongSlab.toString(),
        expectedPaise: expectedTaxAtHsnSlab.toString(),
        variancePaise: taxOvercharge.toString(),
        bbox: line.bbox,
        confidence: line.ocrConfidence,
      });
    } else if (!hsnRule && !legalSlabs.has(declaredRateBps)) {
      const nearestBps = nearestSlabBps(declaredRateBps, legalSlabs);
      const declaredTaxSum = halfUpDiv(expectedTaxable * BigInt(declaredRateBps), 10000n);
      const nearestLegalTax = halfUpDiv(expectedTaxable * BigInt(nearestBps), 10000n);
      const nonSlabVariance = bigIntAbs(declaredTaxSum - nearestLegalTax);
      sumLineVariances += nonSlabVariance;
      faults.push({
        faultId: `FLT-${faultSeq++}`,
        category: "hsn_mismatch",
        severity: "high",
        ruleId: "GST-RATE-NOT-A-SLAB",
        lineNumber: line.lineNumber,
        sku: line.sku,
        title: `Line ${line.lineNumber}: Unrecognized GST Slab (${(declaredRateBps / 100).toFixed(2).replace(/\.00$/, "")}%)`,
        explanation: `HSN ${line.hsnCode} is off-schedule and declared ${(declaredRateBps / 100).toFixed(2).replace(/\.00$/, "")}% GST is not a notified legal slab under ${scheduleVersion}.`,
        declaredPaise: declaredTaxSum.toString(),
        expectedPaise: nearestLegalTax.toString(),
        variancePaise: nonSlabVariance.toString(),
        bbox: line.bbox,
        confidence: line.ocrConfidence,
      });
    }

    // 2. Evaluate line arithmetic & tax split independently
    if (
      discountPaise < 0n ||
      discountPaise > gross ||
      declaredTaxable !== expectedTaxable ||
      declaredLineTotal !== expectedLineTotalAtDecl ||
      hasTaxSplitViolation
    ) {
      const delta = bigIntAbs(declaredLineTotal - expectedLineTotalAtDecl);
      const splitDelta =
        bigIntAbs(declaredCgst - expectedCgstAtDecl) +
        bigIntAbs(declaredSgst - expectedSgstAtDecl) +
        bigIntAbs(declaredIgst - expectedIgstAtDecl);
      if (
        delta > 0n ||
        splitDelta > 0n ||
        hasTaxSplitViolation ||
        discountPaise < 0n ||
        discountPaise > gross ||
        declaredTaxable !== expectedTaxable
      ) {
        const declaredTaxSum = declaredCgst + declaredSgst + declaredIgst;
        const expectedTaxSum = expectedCgstAtDecl + expectedSgstAtDecl + expectedIgstAtDecl;
        const lineVariance =
          delta > 0n
            ? delta
            : splitDelta > 0n
              ? splitDelta
              : bigIntAbs(declaredTaxable - expectedTaxable);
        sumLineVariances += lineVariance;
        faults.push({
          faultId: `FLT-${faultSeq++}`,
          category: "arithmetic_mismatch",
          severity: "high",
          ruleId: hasTaxSplitViolation && delta === 0n ? "GST-SPLIT-COMPONENT-CHECK" : "MATH-LINE-BIGINT-PAISE",
          lineNumber: line.lineNumber,
          sku: line.sku,
          title:
            hasTaxSplitViolation && delta === 0n
              ? `Line ${line.lineNumber}: Tax Component / Place-of-Supply Split Mismatch`
              : `Line ${line.lineNumber}: Arithmetic / Tax Calculation Mismatch`,
          explanation: `Line ${line.lineNumber} (${line.description}) differs from deterministic ${isInterstate ? "interstate IGST" : "intrastate CGST/SGST"} BigInt calculation.`,
          declaredPaise: (delta === 0n && hasTaxSplitViolation ? declaredTaxSum : declaredLineTotal).toString(),
          expectedPaise: (delta === 0n && hasTaxSplitViolation ? expectedTaxSum : expectedLineTotalAtDecl).toString(),
          variancePaise: lineVariance.toString(),
          bbox: line.bbox,
          confidence: line.ocrConfidence,
        });
      }
    }

    // Check 90-day supplier median rate drift (>= 6 prior approved observations, upward jump >= 20%)
    const priors = vendorHistory
      .filter(
        (p) =>
          p.approved &&
          normalizeIdToken(p.vendorGstin) === normalizeIdToken(invoice.vendorGstin) &&
          normalizeIdToken(p.sku) === normalizeIdToken(line.sku) &&
          normalizeIdToken(p.unit) === normalizeIdToken(line.unit)
      )
      .filter((p) => {
        const d = daysBetweenIso(p.invoiceDate, invoice.invoiceDate);
        return d >= 1 && d <= 90;
      })
      .map((p) => safeBigInt(p.unitRatePaise))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    if (priors.length >= 6) {
      const mid = Math.floor(priors.length / 2);
      // Median fraction m / d with d in {1, 2}
      const d = priors.length % 2 === 1 ? 1n : 2n;
      const m = priors.length % 2 === 1 ? priors[mid] : priors[mid - 1] + priors[mid];
      if (m > 0n && 100n * (ratePaise * d - m) >= 20n * m) {
        const medianRounded = halfUpDiv(m, d);
        const unitSpike = ratePaise - medianRounded;
        const lineSpikeImpact = halfUpDiv(qtyMilli * unitSpike, 1000n);
        faults.push({
          faultId: `FLT-${faultSeq++}`,
          category: "rate_drift",
          severity: "medium",
          ruleId: "DRIFT-90D-MEDIAN-20PCT",
          lineNumber: line.lineNumber,
          sku: line.sku,
          title: `Line ${line.lineNumber}: 90-Day Supplier Unit-Rate Spike`,
          explanation: `${line.description} billed at ${formatSimplePaise(ratePaise)} vs. ${priors.length}-invoice 90-day median ${formatSimplePaise(medianRounded)}.`,
          declaredPaise: gross.toString(),
          expectedPaise: halfUpDiv(qtyMilli * medianRounded, 1000n).toString(),
          variancePaise: lineSpikeImpact.toString(),
          bbox: line.bbox,
          confidence: line.ocrConfidence,
        });
      }
    }

    sumTaxable += expectedTaxable;
    sumTax += expectedCgst + expectedSgst + expectedIgst;

    lineResults.push({
      lineNumber: line.lineNumber,
      sku: line.sku,
      description: line.description,
      hsnCode: line.hsnCode,
      hsnMatchedRuleId: hsnRule ? hsnRule.ruleId : null,
      hsnDescription: hsnRule ? hsnRule.description : null,
      hsnUnverified,
      expectedRateBps,
      declaredRateBps,
      expectedTaxablePaise: expectedTaxable.toString(),
      expectedCgstPaise: expectedCgst.toString(),
      expectedSgstPaise: expectedSgst.toString(),
      expectedIgstPaise: expectedIgst.toString(),
      expectedLineTotalPaise: expectedLineTotal.toString(),
      declaredLineTotalPaise: declaredLineTotal.toString(),
      deltaPaise: (declaredLineTotal - expectedLineTotal).toString(),
      ocrConfidence: line.ocrConfidence,
      needsManualReview: line.ocrConfidence < 0.85,
      bbox: line.bbox,
    });
  }

  const roundOff = safeBigInt(invoice.roundOffPaise);
  const validRoundOff = bigIntAbs(roundOff) <= 50n ? roundOff : 0n;
  const expectedGrandTotal = sumTaxable + sumTax + validRoundOff;
  const declaredGrandTotal = safeBigInt(invoice.declaredGrandTotalPaise);
  const declaredTaxableSubtotal = safeBigInt(invoice.declaredTaxableSubtotalPaise);
  const declaredTotalTax = safeBigInt(invoice.declaredTotalTaxPaise);

  // Header grand-total check fires whenever grandDelta exceeds sum of line variances (no silent masking),
  // plus subtotal/tax check when no line-level math/HSN fault already explains the header gap.
  const hasLineMathOrHsn = faults.some(
    (f) => f.category === "arithmetic_mismatch" || f.category === "hsn_mismatch"
  );
  const grandDelta = bigIntAbs(declaredGrandTotal - expectedGrandTotal);
  const taxableSubDelta = bigIntAbs(declaredTaxableSubtotal - sumTaxable);
  const totalTaxDelta = bigIntAbs(declaredTotalTax - sumTax);

  if (grandDelta > sumLineVariances) {
    const excessGrandVariance = grandDelta - sumLineVariances;
    faults.push({
      faultId: `FLT-${faultSeq++}`,
      category: "arithmetic_mismatch",
      severity: "high",
      ruleId: "MATH-GRAND-TOTAL-CHECK",
      title: "Invoice Grand Total Mismatch",
      explanation: `Declared invoice grand total differs from deterministic sum of line items and GST components beyond line-level discrepancies.`,
      declaredPaise: declaredGrandTotal.toString(),
      expectedPaise: expectedGrandTotal.toString(),
      variancePaise: excessGrandVariance.toString(),
      confidence: 1.0,
    });
  } else if ((grandDelta > 0n || taxableSubDelta > 0n || totalTaxDelta > 0n) && !hasLineMathOrHsn) {
    const headerVariance =
      grandDelta > 0n ? grandDelta : totalTaxDelta > 0n ? totalTaxDelta : taxableSubDelta;
    faults.push({
      faultId: `FLT-${faultSeq++}`,
      category: "arithmetic_mismatch",
      severity: "high",
      ruleId: grandDelta > 0n ? "MATH-GRAND-TOTAL-CHECK" : "MATH-HEADER-TAX-CHECK",
      title: grandDelta > 0n ? "Invoice Grand Total Mismatch" : "Invoice Header Subtotal / Tax Mismatch",
      explanation: `Declared invoice header totals disagree with deterministic sum of line items and GST components.`,
      declaredPaise: (grandDelta > 0n ? declaredGrandTotal : totalTaxDelta > 0n ? declaredTotalTax : declaredTaxableSubtotal).toString(),
      expectedPaise: (grandDelta > 0n ? expectedGrandTotal : totalTaxDelta > 0n ? sumTax : sumTaxable).toString(),
      variancePaise: headerVariance.toString(),
      confidence: 1.0,
    });
  }

  return {
    gstinCheck,
    gstScheduleVersion: scheduleVersion,
    isInterstate,
    lineResults,
    expectedTaxableSubtotalPaise: sumTaxable.toString(),
    expectedTotalTaxPaise: sumTax.toString(),
    expectedGrandTotalPaise: expectedGrandTotal.toString(),
    faults,
  };
}

function formatSimplePaise(p: bigint): string {
  const abs = p < 0n ? -p : p;
  return `₹${(abs / 100n).toString()}.${String(Number(abs % 100n)).padStart(2, "0")}`;
}
