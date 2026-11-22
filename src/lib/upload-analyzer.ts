import { computeGstinCheckChar } from "./gst-rules";
import { halfUpDiv, parseINRToPaise } from "./money";
import {
  type OcrMeta,
  extractAndParseInvoiceImage,
  isImageUpload,
  parseOcrInvoiceText,
} from "./ocr-extractor";
import type { InvoiceInput, InvoiceLineInput } from "./types";

/**
 * Pure TypeScript digital PDF ASCII/text-layer extractor + structured text/CSV/JSON bill parser
 * so custom uploads work reliably without external native binaries.
 */
export function extractTextFromBuffer(buf: Buffer, filename: string): {
  kind: "json" | "csv" | "pdf_text" | "text" | "image_requires_review";
  extractedText: string;
  clarityHint: number;
} {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".webp")) {
    // Simple byte-entropy / size proxy for image uploads (never pretends OCR ran without adapter)
    const clarityHint = buf.length < 25000 ? 62 : 175;
    return {
      kind: "image_requires_review",
      extractedText: "",
      clarityHint,
    };
  }
  if (lower.endsWith(".pdf")) {
    const latin = buf.toString("latin1");
    const tokens: string[] = [];
    const litRegex = /\(([^()]{2,200})\)\s*Tj/g;
    for (const m of latin.matchAll(litRegex)) {
      const cleaned = m[1].replace(/\\([()\\])/g, "$1").replace(/[^\x20-\x7E\n]/g, " ").trim();
      if (cleaned) tokens.push(cleaned);
    }
    const text = tokens.join("\n").trim();
    return {
      kind: "pdf_text",
      extractedText: text,
      clarityHint: text.length > 20 ? 210 : 70,
    };
  }
  const utf = buf.toString("utf8");
  if (lower.endsWith(".json") || utf.trim().startsWith("{")) {
    return { kind: "json", extractedText: utf, clarityHint: 230 };
  }
  if (lower.endsWith(".csv")) {
    return { kind: "csv", extractedText: utf, clarityHint: 230 };
  }
  return { kind: "text", extractedText: utf, clarityHint: 215 };
}

export function parseCustomInvoiceText(
  rawText: string,
  options?: {
    voiceTranscript?: string;
    clarityScore?: number;
    fallbackVendorGstin?: string;
  }
): InvoiceInput {
  const trimmed = rawText.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<InvoiceInput>;
      if (parsed && Array.isArray(parsed.lines) && parsed.lines.length > 0) {
        const rawJsonId = typeof parsed.id === "string" ? parsed.id.trim() : "";
        const safeJsonId =
          rawJsonId && !rawJsonId.toUpperCase().startsWith("SCN-")
            ? rawJsonId.startsWith("UPL-")
              ? rawJsonId
              : `UPL-${rawJsonId}`
            : `UPL-${Date.now()}`;
        return {
          id: safeJsonId,
          tenantId: parsed.tenantId || "store-ganesh-blr-01",
          vendorName: parsed.vendorName || "Uploaded Wholesale Supplier",
          vendorGstin: parsed.vendorGstin || "29AAAAA0000A1ZY",
          buyerName: parsed.buyerName || "Ganesh Kirana Stores",
          buyerGstin: parsed.buyerGstin || "29BBBBB1111B2ZM",
          supplierStateCode: parsed.supplierStateCode || (parsed.vendorGstin || "29").slice(0, 2),
          placeOfSupplyStateCode: parsed.placeOfSupplyStateCode || "29",
          invoiceNumber: parsed.invoiceNumber || `UPL/${Date.now().toString().slice(-4)}`,
          challanNumber: parsed.challanNumber,
          invoiceDate: parsed.invoiceDate || "2026-11-21",
          receivedAtIso: new Date().toISOString(),
          roundOffPaise: parsed.roundOffPaise || "0",
          declaredTaxableSubtotalPaise: parsed.declaredTaxableSubtotalPaise || "0",
          declaredTotalTaxPaise: parsed.declaredTotalTaxPaise || "0",
          declaredGrandTotalPaise: parsed.declaredGrandTotalPaise || "0",
          clarityScore: options?.clarityScore ?? parsed.clarityScore ?? 210,
          subgroup: parsed.subgroup || "printed_en",
          voiceTranscriptRaw: options?.voiceTranscript || parsed.voiceTranscriptRaw,
          notesRaw: parsed.notesRaw,
          lines: parsed.lines,
        };
      }
    } catch {
      // Fall through to plain line parser
    }
  }

  // Parse pipe/CSV/free-text invoice snippets cleanly
  const gstinMatch = /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/.exec(trimmed.toUpperCase());
  const defaultPrefix = "29CUSTM1234A1Z";
  const defaultGstin = defaultPrefix + computeGstinCheckChar(defaultPrefix);
  const vendorGstin = gstinMatch ? gstinMatch[0] : (options?.fallbackVendorGstin || defaultGstin);
  const stateCode = vendorGstin.slice(0, 2);
  const invNoMatch = /(?:invoice|bill)\s*(?:no|#|number)?[:\s-]+([A-Z0-9\/-]{3,24})/i.exec(trimmed);

  const lines: InvoiceLineInput[] = [];
  const rows = trimmed.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  let idx = 1;
  let totalTaxable = 0n;
  let totalTax = 0n;

  for (const row of rows) {
    if (/^sku[,|]/i.test(row) || /^(?:gstin|invoice|buyer|supplier|vendor)\s*[:]/i.test(row)) continue;
    // Expected flexible line format: Description | HSN | Qty | Unit | Rate | GST% [| DeclaredTotal]
    const parts = row.split(/[|,]/).map((s) => s.trim());
    if (parts.length >= 5 && /^\d{4,8}$/.test(parts[1])) {
      const desc = parts[0];
      const hsn = parts[1].slice(0, 4);
      const qtyNum = Number(parts[2]);
      const unit = parts[3] || "pcs";
      const ratePaise = parseINRToPaise(parts[4]);
      const rawGst = (parts[5] ?? "5").replace("%", "").trim();
      const parsedGst = rawGst !== "" ? Number(rawGst) : 5;
      const gstPct = Number.isFinite(parsedGst) && parsedGst >= 0 ? parsedGst : 5;
      const qtyMilli = Math.max(1, Math.round((Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1) * 1000));
      const taxable = halfUpDiv(BigInt(qtyMilli) * ratePaise, 1000n);
      const bps = Math.round(gstPct * 100);
      const halfBps = Math.floor(bps / 2);
      const cgst = halfUpDiv(taxable * BigInt(halfBps), 10000n);
      const sgst = halfUpDiv(taxable * BigInt(bps - halfBps), 10000n);
      const computedLineTotal = taxable + cgst + sgst;
      const declaredTotal = parts[6] ? parseINRToPaise(parts[6]) : computedLineTotal;

      lines.push({
        lineNumber: idx,
        sku: desc.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 18),
        description: desc,
        hsnCode: hsn,
        qtyMilli,
        unit,
        unitRatePaise: ratePaise.toString(),
        discountPaise: "0",
        declaredTaxablePaise: taxable.toString(),
        declaredCgstBps: halfBps,
        declaredSgstBps: bps - halfBps,
        declaredIgstBps: 0,
        declaredCgstPaise: cgst.toString(),
        declaredSgstPaise: sgst.toString(),
        declaredIgstPaise: "0",
        declaredLineTotalPaise: declaredTotal.toString(),
        ocrConfidence: 0.94,
      });
      totalTaxable += taxable;
      totalTax += cgst + sgst;
      idx += 1;
    }
  }

  if (lines.length === 0) {
    // Try multi-column Indian GST parser before manual fallback
    const gstParsed = parseOcrInvoiceText(trimmed, {
      voiceTranscript: options?.voiceTranscript,
      clarityScore: options?.clarityScore,
    });
    if (gstParsed.lines.length > 0) {
      const sumTaxable = gstParsed.lines.reduce(
        (acc, l) => acc + BigInt(l.declaredTaxablePaise || "0"),
        0n
      );
      const sumTax = gstParsed.lines.reduce(
        (acc, l) =>
          acc +
          BigInt(l.declaredCgstPaise || "0") +
          BigInt(l.declaredSgstPaise || "0") +
          BigInt(l.declaredIgstPaise || "0"),
        0n
      );
      const taxableSubtotal = gstParsed.declaredTaxableSubtotalPaise ?? sumTaxable;
      const totalTaxVal = gstParsed.declaredTotalTaxPaise ?? sumTax;
      const grandTotalVal = gstParsed.declaredGrandTotalPaise ?? taxableSubtotal + totalTaxVal;

      return {
        id: `UPL-${Date.now()}`,
        tenantId: "store-ganesh-blr-01",
        vendorName: gstParsed.vendorName,
        vendorGstin: gstParsed.vendorGstin || options?.fallbackVendorGstin || defaultGstin,
        buyerName: gstParsed.buyerName,
        buyerGstin: gstParsed.buyerGstin || defaultGstin,
        supplierStateCode: gstParsed.supplierStateCode,
        placeOfSupplyStateCode: gstParsed.placeOfSupplyStateCode,
        invoiceNumber: gstParsed.invoiceNumber,
        invoiceDate: gstParsed.invoiceDate,
        receivedAtIso: new Date().toISOString(),
        roundOffPaise: gstParsed.roundOffPaise.toString(),
        declaredTaxableSubtotalPaise: taxableSubtotal.toString(),
        declaredTotalTaxPaise: totalTaxVal.toString(),
        declaredGrandTotalPaise: grandTotalVal.toString(),
        clarityScore: options?.clarityScore ?? 215,
        subgroup: "printed_en",
        voiceTranscriptRaw: options?.voiceTranscript,
        notesRaw: trimmed,
        lines: gstParsed.lines,
      };
    }

    // Honest 0-paise manual fallback so unparseable custom text/PDF/CSV still enters DPDP + prompt-guard inspection without fabricating Rs 1,050
    lines.push({
      lineNumber: 1,
      sku: "CUSTOM-MANUAL-REVIEW",
      description: trimmed.slice(0, 96) || "Manual Review Required (0 lines parsed)",
      hsnCode: "0000",
      qtyMilli: 1000,
      unit: "pcs",
      unitRatePaise: "0",
      discountPaise: "0",
      declaredTaxablePaise: "0",
      declaredCgstBps: 0,
      declaredSgstBps: 0,
      declaredIgstBps: 0,
      declaredCgstPaise: "0",
      declaredSgstPaise: "0",
      declaredIgstPaise: "0",
      declaredLineTotalPaise: "0",
      ocrConfidence: 0.25,
    });
    totalTaxable = 0n;
    totalTax = 0n;
  }

  return {
    id: `UPL-${Date.now()}`,
    tenantId: "store-ganesh-blr-01",
    vendorName: "Custom Uploaded Supplier",
    vendorGstin,
    buyerName: "Ganesh Kirana Stores",
    buyerGstin: defaultGstin,
    supplierStateCode: stateCode,
    placeOfSupplyStateCode: stateCode,
    invoiceNumber: invNoMatch ? invNoMatch[1] : `UPL/${Date.now().toString().slice(-4)}`,
    invoiceDate: "2026-11-21",
    receivedAtIso: new Date().toISOString(),
    roundOffPaise: "0",
    declaredTaxableSubtotalPaise: totalTaxable.toString(),
    declaredTotalTaxPaise: totalTax.toString(),
    declaredGrandTotalPaise: (totalTaxable + totalTax).toString(),
    clarityScore: options?.clarityScore ?? 215,
    subgroup: "printed_en",
    voiceTranscriptRaw: options?.voiceTranscript,
    notesRaw: trimmed,
    lines,
  };
}

export async function analyzeUploadedBuffer(
  buf: Buffer,
  filename: string,
  options?: {
    mimeType?: string;
    voiceTranscript?: string;
  }
): Promise<{
  extractKind: string;
  invoice: InvoiceInput;
  ocrMeta?: OcrMeta;
}> {
  if (isImageUpload(filename, options?.mimeType)) {
    return extractAndParseInvoiceImage(buf, filename, {
      voiceTranscript: options?.voiceTranscript,
    });
  }

  const ex = extractTextFromBuffer(buf, filename);
  const invoice = parseCustomInvoiceText(ex.extractedText || filename, {
    voiceTranscript: options?.voiceTranscript,
    clarityScore: ex.clarityHint,
  });
  return {
    extractKind: ex.kind,
    invoice,
  };
}

export class PayloadTooLargeError extends Error {
  constructor(message = "Request payload exceeds byte limit") {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

/**
 * Enforces byte limit on both declared Content-Length and chunked request body streams
 * before multipart or JSON parsing buffers arbitrary memory.
 */
export async function readRequestBufferWithLimit(req: Request, maxBytes: number): Promise<Buffer> {
  const rawContentLen = req.headers.get("content-length");
  if (rawContentLen) {
    const contentLen = Number(rawContentLen);
    if (Number.isFinite(contentLen) && contentLen > maxBytes) {
      throw new PayloadTooLargeError();
    }
  }

  if (!req.body) {
    return Buffer.alloc(0);
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks, total);
}
