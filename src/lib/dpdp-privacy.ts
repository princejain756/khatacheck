export interface ScrubResult {
  scrubbedText: string;
  redactionCount: number;
  redactedKinds: string[];
}

export const DPDP_GRIEVANCE_EMAIL = "princejain756@gmail.com";
const MAX_SCRUB_CHARS = 65536;

const DEVANAGARI_DIGITS: Readonly<Record<string, string>> = {
  "०": "0",
  "१": "1",
  "२": "2",
  "३": "3",
  "४": "4",
  "५": "5",
  "६": "6",
  "७": "7",
  "८": "8",
  "९": "9",
};

const INVISIBLE_STRIP_RE = /[\u00AD\u034F\u061C\u180E\u200B-\u200F\u2060-\u2064\uFEFF]/g;

function normalizeForPiiScan(raw: string): string {
  const capped = raw.length > MAX_SCRUB_CHARS ? raw.slice(0, MAX_SCRUB_CHARS) : raw;
  const cleaned = capped.normalize("NFKC").replace(INVISIBLE_STRIP_RE, "");
  let out = "";
  for (const ch of cleaned) {
    out += Object.hasOwn(DEVANAGARI_DIGITS, ch) ? DEVANAGARI_DIGITS[ch] : ch;
  }
  return out;
}

const REGEX_GSTIN = /\b[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z][Zz][0-9A-Za-z]\b/g;
const REGEX_MOBILE =
  /(?<!\d)(?:(?:\+91[\s.-]?|0(?=[6-9]))|(?<![A-Za-z0-9/]))[6-9](?:\d{9}|\d{4}[\s.-]\d{5}|\d{2}[\s.-]\d{3}[\s.-]\d{4}|\d{3}[\s.-]\d{3}[\s.-]\d{3})(?!\d)/g;
const REGEX_AADHAAR = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;
const REGEX_PAN = /\b[A-Za-z]{5}[0-9]{4}[A-Za-z]\b/g;
const REGEX_EMAIL =
  /\b[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,4}\.[A-Za-z]{2,15}\b/g;
const REGEX_OCR_BROKEN_EMAIL =
  /\b[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9-]{2,63}(?:\s+(?:co\s+in|com|in|org|net|edu|gov))\b/gi;
const REGEX_SPOKEN_EMAIL =
  /\b[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}(?:(?:\s+(?:dot|underscore)\s+|\s+\.\s*)[A-Za-z0-9._%+-]{1,32}){0,4}\s+at\s+(?:[A-Za-z0-9-]*[A-Za-z][A-Za-z0-9-]*)(?:\.[A-Za-z0-9-]{1,63}|\s+\.\s*[A-Za-z0-9-]{1,63}|\s+dot\s+[A-Za-z0-9-]{1,63}){0,3}(?:\.[A-Za-z]{2,15}|\s+\.\s*[A-Za-z]{2,15}|\s+dot\s+[A-Za-z]{2,15})\b/gi;
const REGEX_UPI =
  /\b[a-zA-Z0-9._-]{2,64}@(?:okaxis|okicici|okhdfcbank|oksbi|ybl|paytm|ibl|axl|upi|icici|hdfcbank|sbi|kotak|axisbank|indus|federal|barodampay|apl|rapl|abfspay|pingpay|jupiteraxis|sliceaxis)\b/gi;
const BUSINESS_ID_PREFIX_RE =
  /\b(?:inv(?:oice)?|bill|challan|e-?way|ewb|po|order|batch|lr|gr|awb|hsn|sac|serial)\s*(?:no\.?|number|id|#)?\s*[:=\-#]?\s*$/i;

/**
 * Redacts personal identifiers under India DPDP Act 2023 data minimization BEFORE text model egress,
 * while preserving task-restricted supplier/buyer 15-character GSTIN tokens cleanly.
 */
export function scrubPiiForModelEgress(rawText: string | undefined): ScrubResult {
  if (!rawText) {
    return { scrubbedText: "", redactionCount: 0, redactedKinds: [] };
  }

  const normalizedInput = normalizeForPiiScan(String(rawText));

  // Reserve GSTIN character spans so embedded 10-char PAN inside GSTIN is never broken
  const protectedRanges: Array<[number, number]> = [];
  for (const m of normalizedInput.matchAll(REGEX_GSTIN)) {
    if (typeof m.index === "number") {
      protectedRanges.push([m.index, m.index + m[0].length]);
    }
  }

  const isInsideProtected = (start: number, len: number): boolean => {
    const end = start + len;
    return protectedRanges.some(([ps, pe]) => start >= ps && end <= pe);
  };

  const replacements: Array<{ start: number; end: number; tag: string; kind: string }> = [];

  const collect = (regex: RegExp, tag: string, kind: string, checkBusinessContext = false) => {
    for (const m of normalizedInput.matchAll(regex)) {
      if (typeof m.index !== "number") continue;
      if (isInsideProtected(m.index, m[0].length)) continue;
      if (checkBusinessContext) {
        const before = normalizedInput.slice(Math.max(0, m.index - 36), m.index);
        if (!m[0].startsWith("+") && BUSINESS_ID_PREFIX_RE.test(before)) {
          continue;
        }
      }
      replacements.push({ start: m.index, end: m.index + m[0].length, tag, kind });
    }
  };

  collect(REGEX_UPI, "[UPI_REDACTED]", "upi_id");
  collect(REGEX_EMAIL, "[EMAIL_REDACTED]", "personal_email");
  collect(REGEX_OCR_BROKEN_EMAIL, "[EMAIL_REDACTED]", "personal_email");
  collect(REGEX_SPOKEN_EMAIL, "[EMAIL_REDACTED]", "personal_email");
  collect(REGEX_MOBILE, "[MOBILE_REDACTED]", "mobile_number", true);
  collect(REGEX_AADHAAR, "[AADHAAR_REDACTED]", "aadhaar_like", true);
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
    return { scrubbedText: normalizedInput, redactionCount: 0, redactedKinds: [] };
  }

  let rebuilt = "";
  let pos = 0;
  const kindSet = new Set<string>();
  for (const r of filtered) {
    rebuilt += normalizedInput.slice(pos, r.start) + r.tag;
    pos = r.end;
    kindSet.add(r.kind);
  }
  rebuilt += normalizedInput.slice(pos);

  return {
    scrubbedText: rebuilt,
    redactionCount: filtered.length,
    redactedKinds: [...kindSet],
  };
}

export const DPDP_CONSENT_NOTICE = {
  version: "dpdp-v1.3-2026-11",
  retentionDays: 30,
  grievanceContact: DPDP_GRIEVANCE_EMAIL,
  en: {
    title: "Data Processing & Privacy Notice (DPDP Act 2023)",
    purpose:
      "KhataCheck processes uploaded GST bills via local on-server Tesseract OCR and explicitly recorded or uploaded receiving voice notes by sending raw audio to Groq Whisper ASR (whisper-large-v3-turbo) solely to flag billing discrepancies, tax-slab mismatches, and rate creep.",
    minimization:
      "Mandatory on-server DPDP regex scrubbing masks customer mobile numbers, personal emails, PAN, Aadhaar-like numbers, and UPI handles in OCR and ASR text prior to any optional qwen/qwen3.8-27b scrubbed-text structuring call and before audit-ledger persistence. Under DPDP s. 3(c)(ii) statutory/public tax-identifier rules, 15-character supplier/buyer GSTIN tokens remain intact (note a proprietor GSTIN embeds the publicly searchable business PAN).",
    retention:
      "30-day raw-media retention plan: Stage 4 web demo processes image and audio uploads in memory without disk persistence; automated 30-day raw-media expiry worker is planned for Days 61 to 90 rollout. All ledger strings (vendorName, invoiceId, invoiceNumber, ruleChecks, sourceCropBbox label, and overrideReason) are trimmed and stored scrubbed on disk.",
    rights:
      `Under DPDP Act 2023 ss. 11 to 14, store owners hold the rights to access, correction, erasure, grievance redressal (${DPDP_GRIEVANCE_EMAIL}), and nomination. Withdrawing consent or deleting user data via /privacy clears user-submitted entries and verdicts while preserving the 4 seeded synthetic demo genesis rows with a DPDP reset log entry.`,
  },
  hi: {
    title: "डेटा प्रोसेसिंग और गोपनीयता सूचना (DPDP अधिनियम 2023)",
    purpose:
      "KhataCheck अपलोड किए गए GST बिल (लोकल ऑन-सर्वर Tesseract OCR) और स्पष्ट रूप से रिकॉर्ड या अपलोड किए गए वॉइस नोट्स (कच्चा ऑडियो Groq Whisper ASR whisper-large-v3-turbo को भेजकर) की जांच केवल कम सामान, गलत टैक्स स्लैब और रेट अंतर पकड़ने के लिए करता है।",
    minimization:
      "किसी भी वैकल्पिक qwen/qwen3.8-27b स्क्रब्ड-टेक्स्ट कॉल और ऑडिट लेजर सेव से पहले सर्वर पर DPDP स्क्रबिंग मोबाइल नंबर, ईमेल, PAN, आधार-जैसी संख्याएं और UPI आईडी मास्क करती है। DPDP धारा 3(c)(ii) वैधानिक टैक्स पहचान नियम के तहत 15-अंकीय GSTIN सुरक्षित रहते हैं (प्रोप्राइटर GSTIN में सार्वजनिक व्यवसाय PAN शामिल होता है)।",
    retention:
      "30-दिन कच्ची मीडिया नीति: Stage 4 वेब डेमो इमेज और ऑडियो मेमोरी में प्रोसेस करता है; स्वचालित 30-दिन एक्सपायरी Days 61 से 90 रोलआउट में तय है। लेजर के सभी टेक्स्ट फ़ील्ड (vendorName, invoiceId, invoiceNumber, ruleChecks, sourceCropBbox लेबल, और overrideReason) स्क्रब्ड रूप में सेव होते हैं।",
    rights:
      `DPDP अधिनियम 2023 धारा 11 से 14 के तहत आपको पहुंच (access), सुधार (correction), विलोपन (erasure), शिकायत निवारण (${DPDP_GRIEVANCE_EMAIL}), और नामांकन (nomination) के अधिकार हैं। /privacy से सहमति वापस लेने या डेटा हटाने पर उपयोगकर्ता प्रविष्टियाँ हट जाती हैं जबकि 4 सीडेड डेमो रिकॉर्ड सुरक्षित रहते हैं।`,
  },
} as const;
