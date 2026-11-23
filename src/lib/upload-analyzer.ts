import { spawn } from "node:child_process";
import os from "node:os";
import { computeGstinCheckChar } from "./gst-rules";
import { halfUpDiv, parseINRToPaise } from "./money";
import {
  type OcrMeta,
  extractAndParseInvoiceImage,
  extractGstins,
  isImageUpload,
  parseOcrInvoiceText,
} from "./ocr-extractor";
import type { InvoiceInput, InvoiceLineInput } from "./types";

const MAX_REGEX_INPUT_CHARS = 65536;
const MAX_PDF_EXTRACT_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_PDF_RENDER_PNG_BYTES = 10 * 1024 * 1024;

const PDFTOTEXT_CANDIDATES = [
  process.env.PDFTOTEXT_BIN,
  "/usr/bin/pdftotext",
  "/usr/local/bin/pdftotext",
  "/opt/homebrew/bin/pdftotext",
  "pdftotext",
].filter((p): p is string => Boolean(p && p.trim()));

const PDFTOPPM_CANDIDATES = [
  process.env.PDFTOPPM_BIN,
  "/usr/bin/pdftoppm",
  "/usr/local/bin/pdftoppm",
  "/opt/homebrew/bin/pdftoppm",
  "pdftoppm",
].filter((p): p is string => Boolean(p && p.trim()));

const PDF_PYTHON_CANDIDATES = [
  process.env.KHATACHECK_PYTHON_BIN,
  "/usr/bin/python3",
  "/opt/homebrew/opt/python@3.13/libexec/bin/python3",
  "/opt/homebrew/bin/python3",
  "/usr/local/bin/python3",
  "python3",
].filter((p): p is string => Boolean(p && p.trim()));

const FITZ_PDF_SCRIPT = [
  "import base64, json, sys",
  "try:",
  "    import fitz",
  "except Exception:",
  "    sys.exit(42)",
  "data = sys.stdin.buffer.read()",
  "if not data:",
  "    sys.exit(1)",
  'doc = fitz.open(stream=data, filetype="pdf")',
  "pages = min(6, len(doc))",
  'text = "\\n".join(doc[i].get_text("text") for i in range(pages)).strip()',
  "if len(text) >= 40:",
  '    print(json.dumps({"kind": "text", "text": text[:65536]}))',
  "    sys.exit(0)",
  "if len(doc) > 0:",
  "    mat = fitz.Matrix(200 / 72.0, 200 / 72.0)",
  "    pix = doc[0].get_pixmap(matrix=mat, alpha=False)",
  '    png_b64 = base64.b64encode(pix.tobytes("png")).decode("ascii")',
  '    print(json.dumps({"kind": "png", "png_b64": png_b64}))',
].join("\n");

function runBinaryWithStdin(
  binPath: string,
  args: string[],
  stdinBuf: Buffer,
  timeoutMs: number,
  maxStdoutBytes: number
): Promise<{ status: "ok" | "missing" | "error"; stdout: Buffer }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (val: { status: "ok" | "missing" | "error"; stdout: Buffer }) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    let child;
    try {
      child = spawn(binPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: os.tmpdir(),
        env: {
          NODE_ENV: process.env.NODE_ENV ?? "production",
          PATH: process.env.PATH || "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
          LANG: "C.UTF-8",
          LC_ALL: "C.UTF-8",
        },
      });
    } catch {
      done({ status: "missing", stdout: Buffer.alloc(0) });
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore kill failure
      }
      done({ status: "error", stdout: Buffer.alloc(0) });
    }, timeoutMs);

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let exceeded = false;

    child.stdout.on("data", (chunk: Buffer) => {
      if (exceeded) return;
      totalBytes += chunk.byteLength;
      if (totalBytes > maxStdoutBytes) {
        exceeded = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore kill failure
        }
        return;
      }
      chunks.push(chunk);
    });
    child.stdin.on("error", () => {
      // ignore EPIPE if process rejects input early
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      done({ status: err?.code === "ENOENT" ? "missing" : "error", stdout: Buffer.alloc(0) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (exceeded || code !== 0) {
        done({ status: "error", stdout: Buffer.alloc(0) });
        return;
      }
      done({ status: "ok", stdout: Buffer.concat(chunks, totalBytes) });
    });

    child.stdin.end(stdinBuf);
  });
}

function isPngBuffer(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

async function extractPdfWithProductionTools(
  buf: Buffer
): Promise<{ kind: "pdf_text"; text: string } | { kind: "pdf_png"; pngBuf: Buffer } | null> {
  let pdftotextAvailable = false;
  let sawEmptyDigitalText = false;

  for (const bin of PDFTOTEXT_CANDIDATES) {
    const res = await runBinaryWithStdin(
      bin,
      ["-layout", "-nopgbrk", "-", "-"],
      buf,
      6000,
      MAX_PDF_EXTRACT_TEXT_BYTES
    );
    if (res.status === "missing") continue;
    pdftotextAvailable = true;
    if (res.status === "ok") {
      const text = capRegexInput(res.stdout.toString("utf8")).trim();
      if (text.length >= 40) {
        return { kind: "pdf_text", text };
      }
      sawEmptyDigitalText = true;
    }
    break;
  }

  if (sawEmptyDigitalText || !pdftotextAvailable) {
    for (const bin of PDFTOPPM_CANDIDATES) {
      const res = await runBinaryWithStdin(
        bin,
        ["-png", "-r", "200", "-f", "1", "-l", "1", "-singlefile", "-"],
        buf,
        10000,
        MAX_PDF_RENDER_PNG_BYTES
      );
      if (res.status === "missing") continue;
      if (res.status === "ok" && isPngBuffer(res.stdout)) {
        return { kind: "pdf_png", pngBuf: res.stdout };
      }
      break;
    }
  }

  if (!pdftotextAvailable) {
    for (const pyBin of PDF_PYTHON_CANDIDATES) {
      const res = await runBinaryWithStdin(
        pyBin,
        ["-I", "-c", FITZ_PDF_SCRIPT],
        buf,
        10000,
        MAX_PDF_RENDER_PNG_BYTES
      );
      if (res.status === "missing") continue;
      if (res.status === "ok") {
        try {
          const parsed = JSON.parse(res.stdout.toString("utf8")) as {
            kind?: string;
            text?: string;
            png_b64?: string;
          };
          if (parsed.kind === "text" && typeof parsed.text === "string" && parsed.text.trim().length >= 40) {
            return { kind: "pdf_text", text: capRegexInput(parsed.text.trim()) };
          }
          if (parsed.kind === "png" && typeof parsed.png_b64 === "string") {
            const pngBuf = Buffer.from(parsed.png_b64, "base64");
            if (isPngBuffer(pngBuf)) {
              return { kind: "pdf_png", pngBuf };
            }
          }
        } catch {
          // ignore malformed helper output
        }
      }
      break;
    }
  }

  return null;
}

function capRegexInput(raw: string): string {
  return raw.length > MAX_REGEX_INPUT_CHARS ? raw.slice(0, MAX_REGEX_INPUT_CHARS) : raw;
}

/**
 * Pure TypeScript digital PDF ASCII/text-layer extractor + structured text/CSV/JSON bill parser
 * so custom uploads work reliably without external native binaries.
 */
export function extractTextFromBuffer(buf: Buffer, filename: string): {
  kind: "json" | "csv" | "pdf_text" | "text" | "image_requires_review" | "unreadable_pdf";
  extractedText: string;
  clarityHint: number;
} {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".webp")) {
    return {
      kind: "image_requires_review",
      extractedText: "",
      clarityHint: 0,
    };
  }
  if (lower.endsWith(".pdf")) {
    const headerSlice = buf.subarray(0, Math.min(buf.length, 1024)).toString("latin1");
    if (!headerSlice.includes("%PDF-")) {
      return {
        kind: "unreadable_pdf",
        extractedText: "",
        clarityHint: 0,
      };
    }
    const latin = buf.subarray(0, Math.min(buf.length, 2 * 1024 * 1024)).toString("latin1");
    const tokens: string[] = [];
    const litRegex = /\(([^()]{2,200})\)\s*Tj/g;
    for (const m of latin.matchAll(litRegex)) {
      const cleaned = m[1].replace(/\\([()\\])/g, "$1").replace(/[^\x20-\x7E\n]/g, " ").trim();
      if (cleaned) tokens.push(cleaned);
    }
    const text = tokens.join("\n").trim();
    if (text.length < 10) {
      return {
        kind: "unreadable_pdf",
        extractedText: "",
        clarityHint: 0,
      };
    }
    return {
      kind: "pdf_text",
      extractedText: capRegexInput(text),
      clarityHint: 210,
    };
  }
  const utf = capRegexInput(buf.toString("utf8"));
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
  const trimmed = capRegexInput(String(rawText ?? "")).trim();
  const safeVoice =
    options?.voiceTranscript !== undefined ? capRegexInput(options.voiceTranscript) : undefined;
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
          tenantId: "store-ganesh-blr-01",
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
          voiceTranscriptRaw:
            safeVoice !== undefined
              ? safeVoice
              : typeof parsed.voiceTranscriptRaw === "string"
                ? capRegexInput(parsed.voiceTranscriptRaw)
                : undefined,
          notesRaw: typeof parsed.notesRaw === "string" ? capRegexInput(parsed.notesRaw) : undefined,
          lines: parsed.lines,
        };
      }
    } catch {
      // Fall through to plain line parser
    }
  }

  // Parse pipe/CSV/free-text invoice snippets cleanly while keeping buyer GSTIN isolated
  const rows = trimmed.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  const extractedGstins = extractGstins(rows);
  const defaultPrefix = "29CUSTM1234A1Z";
  const defaultGstin = defaultPrefix + computeGstinCheckChar(defaultPrefix);
  const vendorGstin =
    extractedGstins.vendorGstin || options?.fallbackVendorGstin || defaultGstin;
  const buyerGstin = extractedGstins.buyerGstin || "29BBBBB1111B2ZM";
  const stateCode = vendorGstin.slice(0, 2);
  const invNoMatch =
    /(?:invoice|bill)(?:[ \t]{0,12}(?:no\.?|#|number))?[ \t]*[:=-][ \t]*([A-Z0-9\/-]{3,24})|(?:invoice|bill)[ \t]+(?:no\.?|#)[ \t]+([A-Z0-9\/-]{3,24})/i.exec(
      trimmed
    );
  const matchedInvNo = invNoMatch ? (invNoMatch[1] || invNoMatch[2] || "").trim() : "";

  const lines: InvoiceLineInput[] = [];
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
      voiceTranscript: safeVoice,
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
        buyerGstin: gstParsed.buyerGstin || "29BBBBB1111B2ZM",
        supplierStateCode: gstParsed.supplierStateCode,
        placeOfSupplyStateCode: gstParsed.placeOfSupplyStateCode,
        invoiceNumber: gstParsed.invoiceNumber,
        invoiceDate: gstParsed.invoiceDate,
        receivedAtIso: new Date().toISOString(),
        ...(gstParsed.gstinOcrAmbiguous ? { gstinOcrAmbiguous: true } : {}),
        roundOffPaise: gstParsed.roundOffPaise.toString(),
        declaredTaxableSubtotalPaise: taxableSubtotal.toString(),
        declaredTotalTaxPaise: totalTaxVal.toString(),
        declaredGrandTotalPaise: grandTotalVal.toString(),
        clarityScore: options?.clarityScore ?? 215,
        subgroup: "printed_en",
        voiceTranscriptRaw: safeVoice,
        notesRaw: trimmed,
        lines: gstParsed.lines,
      };
    }

    // Honest 0-paise manual fallback so unparseable custom text/PDF/CSV preserves parsed metadata & enters DPDP + prompt-guard cleanly
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
    return {
      id: `UPL-${Date.now()}`,
      tenantId: "store-ganesh-blr-01",
      vendorName: gstParsed.vendorName || "Custom Uploaded Supplier",
      vendorGstin: gstParsed.vendorGstin || options?.fallbackVendorGstin || defaultGstin,
      buyerName: gstParsed.buyerName || "Ganesh Kirana Stores",
      buyerGstin: gstParsed.buyerGstin || "29BBBBB1111B2ZM",
      supplierStateCode: gstParsed.supplierStateCode || stateCode,
      placeOfSupplyStateCode: gstParsed.placeOfSupplyStateCode || stateCode,
      invoiceNumber: gstParsed.invoiceNumber || matchedInvNo || `UPL/${Date.now().toString().slice(-4)}`,
      invoiceDate: gstParsed.invoiceDate || "2026-11-21",
      receivedAtIso: new Date().toISOString(),
      ...(gstParsed.gstinOcrAmbiguous ? { gstinOcrAmbiguous: true } : {}),
      roundOffPaise: "0",
      declaredTaxableSubtotalPaise: "0",
      declaredTotalTaxPaise: "0",
      declaredGrandTotalPaise: "0",
      clarityScore: options?.clarityScore ?? 215,
      subgroup: "printed_en",
      voiceTranscriptRaw: safeVoice,
      notesRaw: trimmed,
      lines,
    };
  }

  return {
    id: `UPL-${Date.now()}`,
    tenantId: "store-ganesh-blr-01",
    vendorName: "Custom Uploaded Supplier",
    vendorGstin,
    buyerName: "Ganesh Kirana Stores",
    buyerGstin,
    supplierStateCode: stateCode,
    placeOfSupplyStateCode: stateCode,
    invoiceNumber: matchedInvNo || `UPL/${Date.now().toString().slice(-4)}`,
    invoiceDate: "2026-11-21",
    receivedAtIso: new Date().toISOString(),
    roundOffPaise: "0",
    declaredTaxableSubtotalPaise: totalTaxable.toString(),
    declaredTotalTaxPaise: totalTax.toString(),
    declaredGrandTotalPaise: (totalTaxable + totalTax).toString(),
    clarityScore: options?.clarityScore ?? 215,
    subgroup: "printed_en",
    voiceTranscriptRaw: safeVoice,
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

  const isPdfUpload =
    filename.toLowerCase().endsWith(".pdf") ||
    options?.mimeType?.toLowerCase().split(";")[0].trim() === "application/pdf";
  if (isPdfUpload) {
    const headerSlice = buf.subarray(0, Math.min(buf.length, 1024)).toString("latin1");
    if (headerSlice.includes("%PDF-")) {
      const prodPdf = await extractPdfWithProductionTools(buf);
      if (prodPdf?.kind === "pdf_text") {
        const invoice = parseCustomInvoiceText(prodPdf.text, {
          voiceTranscript: options?.voiceTranscript,
          clarityScore: 215,
        });
        return {
          extractKind: "pdf_text",
          invoice,
        };
      }
      if (prodPdf?.kind === "pdf_png") {
        const imgRes = await extractAndParseInvoiceImage(
          prodPdf.pngBuf,
          filename.replace(/\.pdf$/i, ".png"),
          { voiceTranscript: options?.voiceTranscript }
        );
        return {
          ...imgRes,
          extractKind:
            imgRes.extractKind === "image_ocr_tesseract" ? "pdf_scanned_ocr" : imgRes.extractKind,
        };
      }
    }
  }

  const ex = extractTextFromBuffer(buf, filename);
  if (ex.kind === "unreadable_pdf" || !ex.extractedText.trim()) {
    const abstainedInvoice: InvoiceInput = {
      id: `UPL-ABSTAIN-${Date.now()}`,
      tenantId: "store-ganesh-blr-01",
      vendorName: ex.kind === "unreadable_pdf" ? "Unreadable PDF Capture" : "Empty Upload Capture",
      vendorGstin: "",
      buyerName: "Ganesh Kirana Stores",
      buyerGstin: "29BBBBB1111B2ZM",
      supplierStateCode: "29",
      placeOfSupplyStateCode: "29",
      invoiceNumber: `RETAKE/${Date.now().toString().slice(-4)}`,
      invoiceDate: new Date().toISOString().slice(0, 10),
      receivedAtIso: new Date().toISOString(),
      roundOffPaise: "0",
      declaredTaxableSubtotalPaise: "0",
      declaredTotalTaxPaise: "0",
      declaredGrandTotalPaise: "0",
      clarityScore: 0,
      subgroup: "printed_en",
      voiceTranscriptRaw:
        options?.voiceTranscript !== undefined ? capRegexInput(options.voiceTranscript) : undefined,
      notesRaw:
        ex.kind === "unreadable_pdf"
          ? "Unreadable or compressed PDF (no extractable uncompressed text stream). Upload a clear PNG, JPEG, WebP capture, or structured CSV/JSON."
          : "Uploaded file contained no parseable invoice text.",
      lines: [],
    };
    return {
      extractKind: ex.kind === "unreadable_pdf" ? "unreadable_pdf" : ex.kind,
      invoice: abstainedInvoice,
    };
  }

  const invoice = parseCustomInvoiceText(ex.extractedText, {
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
