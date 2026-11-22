import { scrubPiiForModelEgress } from "./dpdp-privacy";
import type { PromptGuardFinding, Severity } from "./types";

const MAX_GUARD_FIELD_CHARS = 65536;
const MAX_TOTAL_DECODED_BYTES = 16384;

const DEFAULT_IGNORABLE_RE =
  /[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFE00-\uFE0F\uFEFF]|[\u{E0000}-\u{E007F}]/gu;
const STRIP_IGNORABLE_FOR_NORM_RE =
  /[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/gu;

interface GuardRule {
  ruleId: string;
  family: PromptGuardFinding["family"];
  severity: Severity;
  pattern: RegExp;
  rawOnly?: boolean;
}

const GUARD_RULES: readonly GuardRule[] = [
  {
    ruleId: "PG-A01-IGNORE-POLICY",
    family: "A_policy_override",
    severity: "critical",
    pattern:
      /\b(?:ignore|disregard|override|bypass|forget)\s+(?:all\s+|the\s+)?(?:(?:above|previous|prior|printed|listed|system|tax|gst|verification)\s+(?:rules?|instructions?|checks?|prompts?|amounts?|totals?|values?|numbers?|prices?|gstin|items?|lines?)|everything\s+(?:after|below|above|before)\s+(?:this\s+)?line)/i,
  },
  {
    ruleId: "PG-A02-FORCE-APPROVE",
    family: "A_policy_override",
    severity: "critical",
    pattern:
      /\b(?:auto[-\s]*approve|mark\s+(?:as\s+)?(?:verified|clean|paid)|this\s+invoice\s+is\s+pre[-\s]*verified|output\s+needs_review\s*:\s*false|treat\s+this\s+as\s+an\s+inter[-\s]*state\s+supply|skip\s+human\s+review)\b/i,
  },
  {
    ruleId: "PG-A03-FIELD-TAMPER",
    family: "A_policy_override",
    severity: "critical",
    pattern:
      /\b(?:set|change|replace|overwrite|swap|force)\s+(?:all\s+|every\s+|the\s+)?(?:(?:supplier|vendor|buyer)\s+)?(?:grand[_\s]*total|invoice[_\s]*total|net[_\s]*payable|total[_\s]*amount|total|gstin|gst|cgst(?:\s*,\s*sgst(?:\s+and\s+igst)?)?|sgst|igst|tax|rate)\s*(?:(?:to|with|as|is)\b|=)/i,
  },
  {
    ruleId: "PG-B01-TAG-BREAKOUT",
    family: "B_boundary_escape",
    severity: "critical",
    pattern:
      /<\/?(?:system|assistant|developer|tool_call|invoice|instruction|prompt)\b[^>]{0,200}>|"""|```json\s{0,8}\{\s{0,8}"override"|"}\s{0,8}]\s{0,8},\s{0,8}"(?:totals|line_items|supplier|buyer)"\s{0,8}:\s{0,8}\{|\}\s{0,8}\}\s{0,8}END\b/i,
  },
  {
    ruleId: "PG-B02-JSON-ROLE-INJECT",
    family: "B_boundary_escape",
    severity: "high",
    pattern: /"(?:role|tool|action|approved)"\s*:\s*"(?:system|developer|approve_all|bypass)"/i,
  },
  {
    ruleId: "PG-B03-ROLE-PREFIX-BREAKOUT",
    family: "B_boundary_escape",
    severity: "critical",
    pattern:
      /(?:^|[\s"'‘’(\[])(?:(?:SYSTEM|ASSISTANT|DEVELOPER|LLM)(?:\s+OVER[A-Z]{2,8})?\s*:\s*\S|(?:system|assistant|developer|llm|instruction)(?:\s{1,4}override)?\s{0,4}:\s{0,8}(?:ignore|disregard|override|bypass|forget|auto|set\b|change\b|replace\b|overwrite\b|swap\b|force\b|output\b|treat\b|return\b|reply\b|mark\b|skip\b|do\s+not|don't|you\b|the\b|all\b|every\b|new\b|zero\b|double\b|halve\b|invoice|grand|total|tax|gst|cgst|sgst|igst|buyer|supplier|\{|\[|")|Assistant\s*:\s*\S|Instruction\s*:\s*\S|Note\s+to\s+A[Ilv]\s+assistant\s*:\s*\S|A[Ilv]\s+extraction\s+note\s*:\s*\S|(?:\S{1,40}\s{1,8})?assistant(?=\s{0,4}:\s{0,8}(?:the|set|ignore|change|override|output|treat|this|ne))\s{0,4}:\s{0,8}\S)/i,
  },
  {
    ruleId: "PG-B04-MODEL-ROLE-DIRECTIVE",
    family: "B_boundary_escape",
    severity: "critical",
    pattern:
      /(?:^|[\s"'‘’(\[])MODEL\s*:\s*(?:ignore|disregard|override|bypass|forget|auto[-\s]*approve|set\s+|change\s+|replace\s+|overwrite\s+|swap\s+|force\s+|output\s+|treat\s+|return\s+|reply\s+|you\s+are|this\s+invoice|\{)/i,
  },
  {
    ruleId: "PG-D01-BIDI-CONTROL",
    family: "D_unicode_numeric",
    severity: "critical",
    pattern: /[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/u,
    rawOnly: true,
  },
  {
    ruleId: "PG-E01-PII-EXFIL",
    family: "E_pii_exfil",
    severity: "critical",
    pattern: /\b(?:dump|export|send|append|forward|exfiltrate|leak)\b.{0,40}\b(?:phone|mobile|pan|aadhaar|all\s+tenants|database|env|secret|api\s*key)\b/i,
  },
  {
    ruleId: "PG-F01-HINGLISH-OVERRIDE",
    family: "F_multilingual_override",
    severity: "high",
    pattern:
      /\b(?:sab\s+(?:bill|tax|line)\s+pass\s+kar\s+do|bina\s+check\s+kiye\s+approve|tax\s+zero\s+kar\s+do|naye\s+niyam\s+ignore\s+karo)\b|(?:(?:पिछले|सारे|सभी)\s+(?:सभी\s+)?नियम\s+(?:भूल|न[जज़]रअंदा[जज़]|इग्नोर|छोड़)|टैक्स\s*(?:शून्य|[जज़]ीरो|0)\s*(?:कर|रख|बना|मान)|बिना\s+(?:जांच|चेक)\s*(?:किए\s*)?(?:पास|अप्रूव))/iu,
  },
];

function isDecodedTextReadable(decoded: string): boolean {
  if (!decoded || decoded.includes("\uFFFD")) return false;
  let readable = 0;
  for (const ch of decoded) {
    if (/[\x20-\x7E\n\r\t]/.test(ch) || /\p{L}|\p{N}|\p{P}|\p{S}|\s/u.test(ch)) {
      readable += 1;
    }
  }
  return readable / decoded.length >= 0.8;
}

function safeTryDecodeEncoded(
  text: string,
  budgetRef = { usedBytes: 0 },
  depth = 0
): Array<{ decoded: string; kind: string }> {
  if (depth > 1 || budgetRef.usedBytes >= MAX_TOTAL_DECODED_BYTES) {
    return [];
  }
  const results: Array<{ decoded: string; kind: string }> = [];

  const b64Matches = text.match(/\b[A-Za-z0-9+/_-]{24,22000}={0,2}\b/g) ?? [];
  for (const tok of b64Matches.slice(0, 64)) {
    if (budgetRef.usedBytes >= MAX_TOTAL_DECODED_BYTES) break;
    // Skip ordinary hyphenated/underscored uppercase identifiers like SCN-01-KIRANA-SHORT-TEST
    if (/^[A-Z0-9_-]+$/.test(tok) && /[-_]/.test(tok)) continue;
    try {
      const stdB64 = tok.replace(/-/g, "+").replace(/_/g, "/");
      const padLen = (4 - (stdB64.length % 4)) % 4;
      const padded = stdB64 + "=".repeat(padLen);
      const buf = Buffer.from(padded, "base64");
      if (buf.length < 8 || buf.length > MAX_TOTAL_DECODED_BYTES) continue;
      if (budgetRef.usedBytes + buf.length > MAX_TOTAL_DECODED_BYTES) continue;
      const decoded = buf.toString("utf8");
      if (isDecodedTextReadable(decoded)) {
        budgetRef.usedBytes += buf.length;
        const kind = tok.includes("-") || tok.includes("_") ? "base64url" : "base64";
        results.push({ decoded, kind });
        if (depth === 0) {
          results.push(...safeTryDecodeEncoded(decoded, budgetRef, 1));
        }
      }
    } catch {
      // ignore invalid base64/base64url
    }
  }

  const hexMatches = text.match(/\b(?:[0-9a-fA-F]{2}){12,16384}\b/g) ?? [];
  for (const htok of hexMatches.slice(0, 64)) {
    if (budgetRef.usedBytes >= MAX_TOTAL_DECODED_BYTES) break;
    const byteLen = Math.floor(htok.length / 2);
    if (budgetRef.usedBytes + byteLen > MAX_TOTAL_DECODED_BYTES) continue;
    try {
      const decoded = Buffer.from(htok, "hex").toString("utf8");
      if (isDecodedTextReadable(decoded)) {
        budgetRef.usedBytes += byteLen;
        results.push({ decoded, kind: "hex" });
        if (depth === 0) {
          results.push(...safeTryDecodeEncoded(decoded, budgetRef, 1));
        }
      }
    } catch {
      // ignore invalid hex
    }
  }

  return results;
}

function normalizeTextForGuard(raw: string): string {
  return raw.replace(STRIP_IGNORABLE_FOR_NORM_RE, "").normalize("NFKC");
}

function scanSingleText(
  field: string,
  text: string,
  findings: PromptGuardFinding[],
  seenKey: Set<string>
): void {
  const capped = text.length > MAX_GUARD_FIELD_CHARS ? text.slice(0, MAX_GUARD_FIELD_CHARS) : text;
  const normalized = normalizeTextForGuard(capped);

  for (const rule of GUARD_RULES) {
    const target = rule.rawOnly ? capped : normalized;
    const m = rule.pattern.exec(target);
    if (m) {
      const key = `${rule.ruleId}:${field}`;
      if (!seenKey.has(key)) {
        seenKey.add(key);
        const safeExcerpt = scrubPiiForModelEgress(m[0])
          .scrubbedText.replace(DEFAULT_IGNORABLE_RE, "[UNICODE_CTRL]")
          .slice(0, 96);
        findings.push({
          ruleId: rule.ruleId,
          family: rule.family,
          field,
          excerptRedacted: safeExcerpt,
          severity: rule.severity,
        });
      }
    }
  }

  const decodedChunks = safeTryDecodeEncoded(normalized);
  for (const chunk of decodedChunks) {
    const chunkNorm = normalizeTextForGuard(chunk.decoded);
    for (const rule of GUARD_RULES) {
      const target = rule.rawOnly ? chunk.decoded : chunkNorm;
      if (rule.pattern.test(target)) {
        const key = `PG-C01-ENCODED:${rule.ruleId}:${field}`;
        if (!seenKey.has(key)) {
          seenKey.add(key);
          const safeDecoded = scrubPiiForModelEgress(chunk.decoded)
            .scrubbedText.replace(DEFAULT_IGNORABLE_RE, "[UNICODE_CTRL]")
            .slice(0, 72);
          findings.push({
            ruleId: "PG-C01-ENCODED-INJECTION",
            family: "C_encoded_payload",
            field,
            excerptRedacted: `[DECODED_${chunk.kind.toUpperCase()}] ${safeDecoded}`,
            severity: "critical",
          });
        }
      }
    }
  }
}

export function scanUntrustedInvoiceText(
  fields: Array<{ field: string; text: string | undefined }>
): {
  blocked: boolean;
  findings: PromptGuardFinding[];
} {
  const findings: PromptGuardFinding[] = [];
  const seenKey = new Set<string>();

  const parts: string[] = [];
  for (const { field, text } of fields) {
    if (!text) continue;
    const raw = String(text);
    const capped = raw.length > MAX_GUARD_FIELD_CHARS ? raw.slice(0, MAX_GUARD_FIELD_CHARS) : raw;
    parts.push(capped);
    scanSingleText(field, capped, findings, seenKey);
  }

  if (parts.length > 1) {
    const concatenated = parts.join("\n").slice(0, MAX_GUARD_FIELD_CHARS);
    const beforeRules = new Set(findings.map((f) => f.ruleId));
    const concatFindings: PromptGuardFinding[] = [];
    scanSingleText("concatenated_fields", concatenated, concatFindings, seenKey);
    for (const f of concatFindings) {
      if (!beforeRules.has(f.ruleId)) {
        findings.push(f);
      }
    }
  }

  return {
    blocked: findings.length > 0,
    findings,
  };
}
