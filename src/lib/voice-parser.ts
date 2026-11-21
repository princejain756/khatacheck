import { halfUpDiv, parseINRToPaise } from "./money";
import type { InvoiceLineInput } from "./types";

const HINDI_NUMBER_WORDS: Readonly<Record<string, number>> = {
  ek: 1,
  one: 1,
  do: 2,
  two: 2,
  teen: 3,
  three: 3,
  chaar: 4,
  char: 4,
  four: 4,
  paanch: 5,
  panch: 5,
  five: 5,
  chhe: 6,
  che: 6,
  six: 6,
  saat: 7,
  sat: 7,
  seven: 7,
  aath: 8,
  ath: 8,
  eight: 8,
  nau: 9,
  nine: 9,
  das: 10,
  ten: 10,
  bees: 20,
  twenty: 20,
  pachas: 50,
  fifty: 50,
  sau: 100,
  hundred: 100,
};

const UNIT_WORDS = new Set([
  "peti",
  "carton",
  "cartons",
  "dabba",
  "dabbe",
  "bori",
  "strip",
  "strips",
  "box",
  "boxes",
  "kg",
  "ltr",
  "pkt",
  "pcs",
  "piece",
  "pieces",
  "bundle",
  "bundles",
]);

const SHORTAGE_CUES = /\b(?:kum|kam|short|shortage|missing|damaged?|broken|nahi\s+aaya|nhi\s+aaya|mili\s+nahi)\b/i;
const NEGATION_CUES = /\b(?:short\s+nahi|nahi\s+short|no\s+shortage|all\s+received|poora\s+aaya|sab\s+theek)\b/i;

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

export function normalizeTranscriptText(raw: string): string {
  const nfkc = String(raw ?? "").normalize("NFKC");
  let out = "";
  for (const ch of nfkc) {
    out += Object.hasOwn(DEVANAGARI_DIGITS, ch) ? DEVANAGARI_DIGITS[ch] : ch;
  }
  return out
    .replace(/(?:₹|rs\.?|inr)\s*/gi, "rs ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ParsedVoiceHit {
  matchedLineNumber: number | null;
  sku: string | null;
  kind: "shortage" | "rate_jump" | "unmatched_manual";
  shortageQty: number;
  claimedRatePaise: string | null;
  variancePaise: string;
  confirmationPrompt: string;
  rawSpan: string;
}

function parseQtyToken(tok: string): number | null {
  const clean = tok.toLowerCase().trim();
  if (/^\d+(?:\.\d+)?$/.test(clean)) {
    const n = Number(clean);
    return Number.isFinite(n) && n > 0 && n <= 10000 ? n : null;
  }
  if (Object.hasOwn(HINDI_NUMBER_WORDS, clean)) {
    return HINDI_NUMBER_WORDS[clean];
  }
  return null;
}

function scoreLineAlias(clauseLower: string, line: InvoiceLineInput): number {
  const skuToks = line.sku.toLowerCase().split(/[-_\s]+/).filter((w) => w.length >= 3);
  const descToks = line.description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !["and", "the", "per", "pack", "grade"].includes(w));

  let score = 0;
  for (const t of descToks) {
    if (clauseLower.includes(t)) score += 2;
  }
  for (const t of skuToks) {
    if (clauseLower.includes(t)) score += 3;
  }
  return score;
}

function findBestMatchingLine(clause: string, lines: InvoiceLineInput[]): InvoiceLineInput | null {
  const low = clause.toLowerCase();
  let best: InvoiceLineInput | null = null;
  let bestScore = 0;
  let tied = false;

  for (const l of lines) {
    const sc = scoreLineAlias(low, l);
    if (sc > bestScore) {
      bestScore = sc;
      best = l;
      tied = false;
    } else if (sc > 0 && sc === bestScore) {
      tied = true;
    }
  }
  if (bestScore >= 2 && !tied) return best;
  if (lines.length === 1 && bestScore >= 1) return lines[0];
  return null;
}

export function parseVoiceRemarks(
  rawTranscript: string | undefined,
  lines: InvoiceLineInput[]
): ParsedVoiceHit[] {
  if (!rawTranscript || !rawTranscript.trim()) return [];
  const normalized = normalizeTranscriptText(rawTranscript);
  const clauses = normalized
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const hits: ParsedVoiceHit[] = [];

  for (const clause of clauses) {
    if (NEGATION_CUES.test(clause)) {
      continue;
    }

    // Pattern 1: Rate jump expressions ("rate jumped 180 to 195", "bhav 180 se 195", "rate 180 ka 195 ho gaya")
    const ratePairMatch =
      /(?:rate\s+jumped|bhav|rate)\s+(?:rs\s*)?(\d+(?:\.\d{1,2})?)\s+(?:to|se|ka)\s+(?:rs\s*)?(\d+(?:\.\d{1,2})?)/i.exec(
        clause
      );
    if (ratePairMatch) {
      const oldPaise = parseINRToPaise(ratePairMatch[1]);
      const newPaise = parseINRToPaise(ratePairMatch[2]);
      const matched = findBestMatchingLine(clause, lines);
      if (matched && newPaise > oldPaise) {
        const diffPerUnit = newPaise - oldPaise;
        const totalDiff = halfUpDiv(BigInt(matched.qtyMilli) * diffPerUnit, 1000n);
        hits.push({
          matchedLineNumber: matched.lineNumber,
          sku: matched.sku,
          kind: "rate_jump",
          shortageQty: 0,
          claimedRatePaise: newPaise.toString(),
          variancePaise: totalDiff.toString(),
          confirmationPrompt: `Voice reports rate jump on ${matched.description} (${ratePairMatch[1]} to ${ratePairMatch[2]}). Confirm dispute credit note?`,
          rawSpan: clause,
        });
      } else {
        hits.push({
          matchedLineNumber: null,
          sku: null,
          kind: "unmatched_manual",
          shortageQty: 0,
          claimedRatePaise: newPaise.toString(),
          variancePaise: "0",
          confirmationPrompt: `Voice mentioned rate change (${clause}), but SKU requires owner line selection.`,
          rawSpan: clause,
        });
      }
      continue;
    }

    // Pattern 2: Delta-only price increase ("rs 15 badh gaya")
    const deltaMatch = /(?:rs\s*)?(\d+(?:\.\d{1,2})?)\s+badh\s+gaya/i.exec(clause);
    if (deltaMatch) {
      const deltaPaise = parseINRToPaise(deltaMatch[1]);
      const matched = findBestMatchingLine(clause, lines);
      if (matched && deltaPaise > 0n) {
        const totalDiff = halfUpDiv(BigInt(matched.qtyMilli) * deltaPaise, 1000n);
        hits.push({
          matchedLineNumber: matched.lineNumber,
          sku: matched.sku,
          kind: "rate_jump",
          shortageQty: 0,
          claimedRatePaise: (BigInt(matched.unitRatePaise) + deltaPaise).toString(),
          variancePaise: totalDiff.toString(),
          confirmationPrompt: `Voice noted ₹${deltaMatch[1]} unit hike on ${matched.description}. Confirm dispute?`,
          rawSpan: clause,
        });
      }
      continue;
    }

    // Pattern 3: Shortage cues + qty + unit
    if (SHORTAGE_CUES.test(clause)) {
      const tokens = clause.toLowerCase().split(/\s+/);
      let foundQty: number | null = null;
      let foundUnit: string | null = null;
      for (let i = 0; i < tokens.length; i += 1) {
        const q = parseQtyToken(tokens[i]);
        if (q !== null) {
          const next = tokens[i + 1]?.replace(/[.,]/g, "");
          const prev = tokens[i - 1]?.replace(/[.,]/g, "");
          if (next && UNIT_WORDS.has(next)) {
            foundQty = q;
            foundUnit = next;
            break;
          }
          if (prev && UNIT_WORDS.has(prev)) {
            foundQty = q;
            foundUnit = prev;
            break;
          }
          if (foundQty === null) foundQty = q;
        }
      }

      if (foundQty !== null && foundQty > 0) {
        const matched = findBestMatchingLine(clause, lines);
        if (matched) {
          const qtyMilli = BigInt(Math.round(foundQty * 1000));
          const billedQtyMilli = BigInt(matched.qtyMilli);
          const cappedQtyMilli = qtyMilli > billedQtyMilli ? billedQtyMilli : qtyMilli;
          const ratePaise = BigInt(matched.unitRatePaise);
          const baseShortage = halfUpDiv(cappedQtyMilli * ratePaise, 1000n);
          const totalRateBps = BigInt(
            (matched.declaredCgstBps || 0) + (matched.declaredSgstBps || 0) + (matched.declaredIgstBps || 0)
          );
          const taxOnShortage = halfUpDiv(baseShortage * totalRateBps, 10000n);
          const variance = baseShortage + taxOnShortage;
          hits.push({
            matchedLineNumber: matched.lineNumber,
            sku: matched.sku,
            kind: "shortage",
            shortageQty: foundQty,
            claimedRatePaise: null,
            variancePaise: variance.toString(),
            confirmationPrompt: `Confirm ${foundQty} ${foundUnit || matched.unit} short on Line ${matched.lineNumber} (${matched.description})?`,
            rawSpan: clause,
          });
        } else {
          hits.push({
            matchedLineNumber: null,
            sku: null,
            kind: "unmatched_manual",
            shortageQty: foundQty,
            claimedRatePaise: null,
            variancePaise: "0",
            confirmationPrompt: `Voice reported shortage (${clause}); select matching invoice row manually.`,
            rawSpan: clause,
          });
        }
      }
    }
  }

  return hits;
}
