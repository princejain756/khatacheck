import { scrubPiiForModelEgress } from "./dpdp-privacy";
import type { PromptGuardFinding, Severity } from "./types";

interface GuardRule {
  ruleId: string;
  family: PromptGuardFinding["family"];
  severity: Severity;
  pattern: RegExp;
}

const GUARD_RULES: readonly GuardRule[] = [
  {
    ruleId: "PG-A01-IGNORE-POLICY",
    family: "A_policy_override",
    severity: "critical",
    pattern: /\b(?:ignore|disregard|override|bypass)\s+(?:all\s+)?(?:previous|prior|system|tax|gst|verification)\s+(?:rules?|instructions?|checks?|prompts?)/i,
  },
  {
    ruleId: "PG-A02-FORCE-APPROVE",
    family: "A_policy_override",
    severity: "critical",
    pattern: /\b(?:auto[-\s]*approve|mark\s+(?:as\s+)?(?:verified|clean|paid)|set\s+(?:gst|tax|rate)\s*(?:to|=)\s*0|skip\s+human\s+review)\b/i,
  },
  {
    ruleId: "PG-B01-TAG-BREAKOUT",
    family: "B_boundary_escape",
    severity: "critical",
    pattern: /<\/?(?:system|assistant|developer|tool_call|invoice|instruction|prompt)\b[^>]*>|"""|```json\s*\{\s*"override"/i,
  },
  {
    ruleId: "PG-B02-JSON-ROLE-INJECT",
    family: "B_boundary_escape",
    severity: "high",
    pattern: /"(?:role|tool|action|approved)"\s*:\s*"(?:system|developer|approve_all|bypass)"/i,
  },
  {
    ruleId: "PG-D01-BIDI-CONTROL",
    family: "D_unicode_numeric",
    severity: "critical",
    pattern: /[\u202A-\u202E\u2066-\u2069\u200B-\u200F\uFEFF]/,
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
    pattern: /\b(?:sab\s+(?:bill|tax|line)\s+pass\s+kar\s+do|bina\s+check\s+kiye\s+approve|tax\s+zero\s+kar\s+do|naye\s+niyam\s+ignore\s+karo)\b/i,
  },
];

function safeTryDecodeEncoded(text: string): Array<{ decoded: string; kind: string }> {
  const results: Array<{ decoded: string; kind: string }> = [];
  // Strict bounded base64 check (max 16 KiB decoded, max 3 chunks)
  const b64Matches = text.match(/\b[A-Za-z0-9+/]{24,}={0,2}\b/g) ?? [];
  for (const tok of b64Matches.slice(0, 3)) {
    if (tok.length > 22000) continue;
    try {
      const buf = Buffer.from(tok, "base64");
      if (buf.length > 16384 || buf.length < 8) continue;
      // Ensure printable ratio >= 80% before scanning decoded string
      const decoded = buf.toString("utf8");
      const printable = decoded.replace(/[^\x20-\x7E\n\r\t]/g, "").length;
      if (printable / decoded.length >= 0.8) {
        results.push({ decoded, kind: "base64" });
      }
    } catch {
      // ignore invalid base64
    }
  }
  const hexMatches = text.match(/\b(?:[0-9a-fA-F]{2}){12,}\b/g) ?? [];
  for (const htok of hexMatches.slice(0, 3)) {
    if (htok.length > 32768) continue;
    try {
      const decoded = Buffer.from(htok, "hex").toString("utf8");
      const printable = decoded.replace(/[^\x20-\x7E\n\r\t]/g, "").length;
      if (printable / decoded.length >= 0.8) {
        results.push({ decoded, kind: "hex" });
      }
    } catch {
      // ignore
    }
  }
  return results;
}

export function scanUntrustedInvoiceText(
  fields: Array<{ field: string; text: string | undefined }>
): {
  blocked: boolean;
  findings: PromptGuardFinding[];
} {
  const findings: PromptGuardFinding[] = [];
  const seenKey = new Set<string>();

  for (const { field, text } of fields) {
    if (!text) continue;
    const raw = String(text);

    for (const rule of GUARD_RULES) {
      const m = rule.pattern.exec(raw);
      if (m) {
        const key = `${rule.ruleId}:${field}`;
        if (!seenKey.has(key)) {
          seenKey.add(key);
          const safeExcerpt = scrubPiiForModelEgress(m[0])
            .scrubbedText.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "[UNICODE_CTRL]")
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

    // Category C: Bounded encoded note inspection
    const decodedChunks = safeTryDecodeEncoded(raw);
    for (const chunk of decodedChunks) {
      for (const rule of GUARD_RULES) {
        if (rule.pattern.test(chunk.decoded)) {
          const key = `PG-C01-ENCODED:${rule.ruleId}:${field}`;
          if (!seenKey.has(key)) {
            seenKey.add(key);
            const safeDecoded = scrubPiiForModelEgress(chunk.decoded)
              .scrubbedText.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "[UNICODE_CTRL]")
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

  return {
    blocked: findings.length > 0,
    findings,
  };
}
