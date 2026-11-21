export function labelFor(
  labels: Readonly<Record<string, string>>,
  value: string | null | undefined,
  fallback: string
): string {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!key) return fallback;
  return Object.hasOwn(labels, key) ? labels[key] : fallback;
}

export const FAULT_TYPE_LABELS: Readonly<Record<string, string>> = {
  voice_shortage: "Short Delivery Claim",
  hsn_mismatch: "HSN GST Slab Mismatch",
  arithmetic_mismatch: "Line / Tax Math Error",
  invalid_gstin: "Invalid Supplier GSTIN",
  rate_drift: "90-Day Rate Creep",
  duplicate_invoice: "Duplicate Challan / Bill",
  clarity_abstain: "Low Clarity (Retake)",
  prompt_injection_blocked: "Prompt Injection Blocked",
};

export const SEVERITY_LABELS: Readonly<Record<string, string>> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const DECISION_LABELS: Readonly<Record<string, string>> = {
  pending_review: "Pending Owner Review",
  approved_flag: "Flag Approved",
  overridden_clean: "Overridden (Clean)",
  contested_appeal: "Contested / Appealed",
  retake_requested: "Retake Requested",
  abstained_clarity: "Abstained (Low Clarity)",
};

export const SUBGROUP_LABELS: Readonly<Record<string, string>> = {
  printed_en: "S1 · English Printed PDF",
  bilingual_hinglish: "S2 · Hindi / Bilingual Mobile",
  regional_devanagari: "S3 · Hinglish Handwritten Slip",
  compressed_thermal_4g: "S4 · Kannada / Thermal 4G",
  handwritten_challan: "S5 · Tamil / Mixed Voice",
};

export const MERCHANDISE_LABELS: Readonly<Record<string, string>> = {
  kirana: "Kirana Staples",
  fmcg: "FMCG & Household",
  textile: "Textile & Apparel",
  pharmacy: "Pharmacy & Supplies",
};

export const ATTACK_FAMILY_LABELS: Readonly<Record<string, string>> = {
  A_policy_override: "A · Direct Policy Override",
  B_boundary_escape: "B · Structured Boundary Escape",
  C_encoded_payload: "C · Bounded Encoded Payload",
  D_unicode_numeric: "D · Unicode / Negative Trap",
  E_pii_exfil: "E · Cross-Tenant PII Exfil",
  F_multilingual_override: "F · Hinglish Override Cue",
};

export function applyThemeWithoutFreeze(next: "light" | "dark"): void {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  root.classList.toggle("dark", next === "dark");
  void root.offsetHeight;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove("theme-switching");
    });
  });
}
