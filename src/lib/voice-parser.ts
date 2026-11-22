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

const CANONICAL_UNITS: Record<string, string> = {
  peti: "peti",
  carton: "carton",
  cartons: "carton",
  dabba: "dabba",
  dabbe: "dabba",
  bori: "bori",
  bag: "bag",
  bags: "bag",
  strip: "strip",
  strips: "strip",
  box: "box",
  boxes: "box",
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",
  kilogramme: "kg",
  kilogrammes: "kg",
  ltr: "ltr",
  ltrs: "ltr",
  liter: "ltr",
  liters: "ltr",
  litre: "ltr",
  litres: "ltr",
  kl: "kl",
  kiloliter: "kl",
  kiloliters: "kl",
  kilolitre: "kl",
  kilolitres: "kl",
  pkt: "pkt",
  pkts: "pkt",
  packet: "pkt",
  packets: "pkt",
  pack: "pkt",
  packs: "pkt",
  pcs: "pcs",
  pc: "pcs",
  piece: "pcs",
  pieces: "pcs",
  nos: "pcs",
  bundle: "bundle",
  bundles: "bundle",
  mtr: "mtr",
  mtrs: "mtr",
  meter: "mtr",
  meters: "mtr",
  metre: "mtr",
  metres: "mtr",
  tin: "tin",
  tins: "tin",
  bottle: "bottle",
  bottles: "bottle",
  btl: "bottle",
  jar: "jar",
  jars: "jar",
  roll: "roll",
  rolls: "roll",
  unit: "unit",
  units: "unit",
  g: "gram",
  gm: "gram",
  gms: "gram",
  gram: "gram",
  grams: "gram",
  gramme: "gram",
  grammes: "gram",
  mg: "mg",
  mgs: "mg",
  milligram: "mg",
  milligrams: "mg",
  ml: "ml",
  mls: "ml",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  quintal: "quintal",
  quintals: "quintal",
  qtl: "quintal",
  ton: "ton",
  tons: "ton",
  tonne: "ton",
  tonnes: "ton",
  dozen: "dozen",
  dozens: "dozen",
  dz: "dozen",
  pair: "pair",
  pairs: "pair",
  can: "can",
  cans: "can",
  sack: "sack",
  sacks: "sack",
  crate: "crate",
  crates: "crate",
  set: "set",
  sets: "set",
  bale: "bale",
  bales: "bale",
  pouch: "pouch",
  pouches: "pouch",
  tray: "tray",
  trays: "tray",
  drum: "drum",
  drums: "drum",
  sheet: "sheet",
  sheets: "sheet",
  bar: "bar",
  bars: "bar",
  tub: "tub",
  tubs: "tub",
};

const UNIT_WORDS = new Set(Object.keys(CANONICAL_UNITS));

export function canonicalizeVoiceUnit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase().replace(/[.,;:!?]/g, "");
  if (!cleaned) return null;
  return CANONICAL_UNITS[cleaned] ?? cleaned;
}

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
      const matched = findBestMatchingLine(clause, lines);
      const tokens = clause.toLowerCase().split(/\s+/);
      const cleanToken = (t: string | undefined): string =>
        (t ?? "").replace(/^[(\["']+|[)\]"'.,;:!?]+$/g, "");
      const unitPairs: Array<{ qty: number; unit: string }> = [];
      const consumedIdx = new Set<number>();
      let fallbackQty: number | null = null;

      for (let i = 0; i < tokens.length; i += 1) {
        if (consumedIdx.has(i)) continue;
        const tok = cleanToken(tokens[i]);
        const attached = /^(\d+(?:\.\d+)?)([a-z]+)$/.exec(tok);
        if (attached && UNIT_WORDS.has(attached[2])) {
          const aq = Number(attached[1]);
          if (Number.isFinite(aq) && aq > 0 && aq <= 10000) {
            unitPairs.push({ qty: aq, unit: attached[2] });
            consumedIdx.add(i);
            continue;
          }
        }
        const q = parseQtyToken(tok);
        if (q !== null) {
          const next = cleanToken(tokens[i + 1]);
          const prev = cleanToken(tokens[i - 1]);
          if (next && UNIT_WORDS.has(next) && !consumedIdx.has(i + 1)) {
            unitPairs.push({ qty: q, unit: next });
            consumedIdx.add(i);
            consumedIdx.add(i + 1);
            continue;
          }
          if (prev && UNIT_WORDS.has(prev) && !consumedIdx.has(i - 1)) {
            unitPairs.push({ qty: q, unit: prev });
            consumedIdx.add(i);
            consumedIdx.add(i - 1);
            continue;
          }
          if (fallbackQty === null) fallbackQty = q;
        }
      }

      let foundQty: number | null = null;
      let foundUnit: string | null = null;
      if (matched && unitPairs.length > 0) {
        const lineUnitCanon = canonicalizeVoiceUnit(matched.unit);
        const exactUnitMatch = unitPairs.find(
          (p) => canonicalizeVoiceUnit(p.unit) === lineUnitCanon
        );
        if (exactUnitMatch) {
          foundQty = exactUnitMatch.qty;
          foundUnit = exactUnitMatch.unit;
        } else {
          const descCompact = matched.description.toLowerCase().replace(/[^a-z0-9]/g, "");
          const nonPackPair = unitPairs.find((p) => {
            const rawUnit = p.unit.toLowerCase();
            const canon = canonicalizeVoiceUnit(rawUnit);
            const candidates = [rawUnit, canon, canon === "gram" ? "g" : null].filter(Boolean);
            return !candidates.some((u) => descCompact.includes(`${p.qty}${u}`));
          });
          const chosen = nonPackPair ?? unitPairs[0];
          foundQty = chosen.qty;
          foundUnit = chosen.unit;
        }
      } else if (unitPairs.length > 0) {
        foundQty = unitPairs[0].qty;
        foundUnit = unitPairs[0].unit;
      } else {
        foundQty = fallbackQty;
      }

      if (foundQty !== null && foundQty > 0) {
        if (matched) {
          const spokenUnitCanon = canonicalizeVoiceUnit(foundUnit);
          const lineUnitCanon = canonicalizeVoiceUnit(matched.unit);
          if (spokenUnitCanon && lineUnitCanon && spokenUnitCanon !== lineUnitCanon) {
            hits.push({
              matchedLineNumber: matched.lineNumber,
              sku: matched.sku,
              kind: "unmatched_manual",
              shortageQty: foundQty,
              claimedRatePaise: null,
              variancePaise: "0",
              confirmationPrompt: `Unit mismatch on Line ${matched.lineNumber} (${matched.description}): spoken ${foundQty} ${foundUnit} vs billed unit ${matched.unit}. Enter manual conversion before raising debit note.`,
              rawSpan: clause,
            });
            continue;
          }
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
