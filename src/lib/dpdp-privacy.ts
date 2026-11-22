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
const REGEX_SPOKEN_EMAIL =
  /\b[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}(?:\s+(?:dot|underscore)\s+[A-Za-z0-9._%+-]{1,32}){0,4}\s+at\s+[A-Za-z0-9-]{1,63}(?:\s*(?:\.|dot)\s*[A-Za-z0-9-]{1,63}){0,3}\s*(?:\.|dot)\s*(?:com|in|org|net|co|edu|gov|io|ai|me|info|biz)(?:\s*(?:\.|dot)\s*[a-z]{2,4})?\b/gi;
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
  collect(REGEX_SPOKEN_EMAIL, "[EMAIL_REDACTED]", "personal_email");
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
      "KhataCheck processes uploaded GST bills via local on-server Tesseract OCR and explicitly recorded or uploaded receiving voice notes via Groq Whisper ASR (whisper-large-v3-turbo) solely to flag billing discrepancies, tax-slab mismatches, and rate creep.",
    minimization:
      "Mandatory on-server DPDP regex scrubbing masks walk-in customer mobile numbers, personal emails, PAN, Aadhaar-like numbers, and UPI handles in OCR and ASR text prior to any optional qwen/qwen3.8-27b scrubbed-text structuring call, while preserving 15-character GSTIN tokens.",
    retention:
      "30-day raw-media retention plan: Stage 4 web demo processes image and audio uploads in memory without disk persistence; the automated 30-day expiry worker is scheduled for the Days 61 to 90 controlled rollout. Free-text overrideReason entries are trimmed and stored unmasked in the audit ledger.",
    rights:
      "Export or clear the shared demo review ledger via /privacy (empty demo ledger reseeds 4 default records on next read).",
  },
  hi: {
    title: "डेटा प्रोसेसिंग और गोपनीयता सूचना (DPDP अधिनियम 2023)",
    purpose:
      "KhataCheck अपलोड किए गए GST बिल (लोकल ऑन-सर्वर Tesseract OCR) और स्पष्ट रूप से रिकॉर्ड या अपलोड किए गए वॉइस नोट्स (Groq Whisper ASR) की जांच केवल कम सामान, गलत टैक्स स्लैब और रेट अंतर पकड़ने के लिए करता है।",
    minimization:
      "किसी भी वैकल्पिक qwen/qwen3.8-27b स्क्रब्ड-टेक्स्ट स्ट्रक्चरिंग कॉल से पहले सर्वर पर ही DPDP रेगेक्स स्क्रबिंग ग्राहक के मोबाइल नंबर, ईमेल, PAN, आधार-जैसी संख्याएं और UPI आईडी मास्क करती है, जबकि 15-अंकीय GSTIN पैटर्न सुरक्षित रहते हैं।",
    retention:
      "30-दिन की कच्ची मीडिया नीति: Stage 4 वेब डेमो इमेज और ऑडियो अपलोड मेमोरी में प्रोसेस करता है; स्वतः 30-दिन एक्सपायरी वर्कर Days 61 से 90 नियंत्रित रोलआउट के लिए तय है। फ्री-टेक्स्ट overrideReason ट्रिम होकर बिना मास्क के ऑडिट लेजर में सेव होता है।",
    rights:
      "आप कभी भी /privacy से साझा डेमो रिव्यू लेजर एक्सपोर्ट या क्लियर कर सकते हैं (खाली होने पर अगली रीड पर 4 डिफॉल्ट रिकॉर्ड रीसीड होते हैं)।",
  },
} as const;
