export interface ScrubResult {
  scrubbedText: string;
  redactionCount: number;
  redactedKinds: string[];
}

const REGEX_GSTIN = /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;
const REGEX_MOBILE = /(?:\+91[\s-]?|0)?\b[6-9]\d{4}[\s-]?\d{5}\b/g;
const REGEX_AADHAAR = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;
const REGEX_PAN = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
const REGEX_EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const REGEX_UPI = /\b[a-zA-Z0-9._-]{2,}@(?:okaxis|okicici|okhdfcbank|oksbi|ybl|paytm|ibl|axl|upi)\b/gi;

/**
 * Redacts personal identifiers under India DPDP Act 2023 data minimization BEFORE model egress,
 * while preserving task-restricted supplier/buyer 15-character GSTIN tokens cleanly.
 */
export function scrubPiiForModelEgress(rawText: string | undefined): ScrubResult {
  if (!rawText) {
    return { scrubbedText: "", redactionCount: 0, redactedKinds: [] };
  }

  // Reserve GSTIN character spans so embedded 10-char PAN inside GSTIN is never broken
  const protectedRanges: Array<[number, number]> = [];
  for (const m of rawText.matchAll(REGEX_GSTIN)) {
    if (typeof m.index === "number") {
      protectedRanges.push([m.index, m.index + m[0].length]);
    }
  }

  const isInsideProtected = (start: number, len: number): boolean => {
    const end = start + len;
    return protectedRanges.some(([ps, pe]) => start >= ps && end <= pe);
  };

  const replacements: Array<{ start: number; end: number; tag: string; kind: string }> = [];

  const collect = (regex: RegExp, tag: string, kind: string) => {
    for (const m of rawText.matchAll(regex)) {
      if (typeof m.index !== "number") continue;
      if (isInsideProtected(m.index, m[0].length)) continue;
      replacements.push({ start: m.index, end: m.index + m[0].length, tag, kind });
    }
  };

  collect(REGEX_UPI, "[UPI_REDACTED]", "upi_id");
  collect(REGEX_EMAIL, "[EMAIL_REDACTED]", "personal_email");
  collect(REGEX_MOBILE, "[MOBILE_REDACTED]", "mobile_number");
  collect(REGEX_AADHAAR, "[AADHAAR_REDACTED]", "aadhaar_like");
  collect(REGEX_PAN, "[PAN_REDACTED]", "pan_card");

  // Resolve overlaps preferring earlier/longer match cleanly
  replacements.sort((a, b) => a.start - b.start || b.end - a.end);
  const filtered: typeof replacements = [];
  let cursor = 0;
  for (const r of replacements) {
    if (r.start >= cursor) {
      filtered.push(r);
      cursor = r.end;
    }
  }

  if (filtered.length === 0) {
    return { scrubbedText: rawText, redactionCount: 0, redactedKinds: [] };
  }

  let rebuilt = "";
  let pos = 0;
  const kindSet = new Set<string>();
  for (const r of filtered) {
    rebuilt += rawText.slice(pos, r.start) + r.tag;
    pos = r.end;
    kindSet.add(r.kind);
  }
  rebuilt += rawText.slice(pos);

  return {
    scrubbedText: rebuilt,
    redactionCount: filtered.length,
    redactedKinds: [...kindSet],
  };
}

export const DPDP_CONSENT_NOTICE = {
  version: "dpdp-v1.2-2026-11",
  retentionDays: 30,
  en: {
    title: "Data Processing & Privacy Notice (DPDP Act 2023)",
    purpose:
      "KhataCheck processes supplier GST bills and short receiving voice notes solely to detect billing discrepancies, tax-slab mismatches, and rate creep for your store.",
    minimization:
      "Unrelated walk-in customer phone numbers, personal emails, PAN, Aadhaar, and UPI handles are masked locally before OCR/model inference.",
    retention:
      "30-day raw-media retention policy: uploaded photos and audio are processed in memory during the Stage 4 web demo and scheduled for 30-day automated expiry upon Gate 5 pilot deployment. Only non-personal verified tax hashes and dispute ledgers remain for audit.",
    rights:
      "You may export all store records as JSON, withdraw processing consent, or wipe personal/store data at any time.",
  },
  hi: {
    title: "डेटा प्रोसेसिंग और गोपनीयता सूचना (DPDP अधिनियम 2023)",
    purpose:
      "KhataCheck आपके सप्लायर GST बिल और छोटे वॉयस नोट्स का उपयोग केवल कम सामान, गलत टैक्स स्लैब और रेट अंतर पकड़ने के लिए करता है।",
    minimization:
      "ग्राहकों के मोबाइल नंबर, व्यक्तिगत ईमेल, PAN और UPI आईडी मॉडल विश्लेषण से पहले ही लोकल स्तर पर हटा दिए जाते हैं।",
    retention:
      "30 दिनों की रिटेंशन नीति लागू है; डेमो में कच्ची फाइलें डिस्क पर सेव नहीं होतीं और केवल ऑडिट व टैक्स हैश सुरक्षित रहते हैं।",
    rights:
      "आप कभी भी अपना पूरा डेटा JSON में डाउनलोड कर सकते हैं या एक क्लिक से सारा डेटा मिटा सकते हैं।",
  },
} as const;
