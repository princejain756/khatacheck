import { NextRequest, NextResponse } from "next/server";
import { DEMO_PRIOR_BILLS, DEMO_SCENARIOS, DEMO_VENDOR_HISTORY } from "@/lib/bill-scenarios";
import { verifyInvoicePipeline } from "@/lib/engine";
import { STORE_TENANT_ID, recordServerVerdict } from "@/lib/governance-ledger";
import type { OcrMeta } from "@/lib/ocr-extractor";
import {
  checkRateLimit,
  extractClientIp,
  tryAcquireConcurrency,
  validateImageMagicBytes,
  validatePdfMagicBytes,
} from "@/lib/rate-limit";
import type { InvoiceInput } from "@/lib/types";
import {
  PayloadTooLargeError,
  analyzeUploadedBuffer,
  parseCustomInvoiceText,
  readRequestBufferWithLimit,
} from "@/lib/upload-analyzer";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_ECHO_TEXT_CHARS = 65536;
const TEXT_LAYER_CLARITY_SCORE = 215;

const ALLOWED_ANALYZE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".pdf",
  ".txt",
  ".csv",
  ".json",
]);
const IMAGE_ANALYZE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function getLowerExtension(filename: string): string {
  const lower = (filename || "").toLowerCase().trim();
  const dotIdx = lower.lastIndexOf(".");
  return dotIdx >= 0 ? lower.slice(dotIdx) : "";
}

function capEchoText(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  return raw.length > MAX_ECHO_TEXT_CHARS ? raw.slice(0, MAX_ECHO_TEXT_CHARS) : raw;
}

export async function POST(req: NextRequest) {
  const ip = extractClientIp(req);
  const rl = checkRateLimit(`analyze:${ip}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many invoice analysis requests; please wait briefly." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(rl.retryAfterSec),
        },
      }
    );
  }

  const releaseConcurrency = tryAcquireConcurrency("analyze", 8);
  if (!releaseConcurrency) {
    return NextResponse.json(
      { error: "Invoice verification queue is busy; please retry shortly." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "2",
        },
      }
    );
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    const isMultipart = contentType.includes("multipart/form-data");
    const rawBuf = await readRequestBufferWithLimit(
      req,
      isMultipart ? MAX_MULTIPART_BYTES : MAX_JSON_BYTES
    );

    let invoice: InvoiceInput | null = null;
    let extractKind = "structured_scenario";
    let ocrMeta: OcrMeta | undefined;
    let customVoiceOverride = false;

    if (isMultipart) {
      const form = await new Response(new Uint8Array(rawBuf), {
        headers: { "content-type": contentType },
      }).formData();
      const file = form.get("file");
      const rawVoice = String(form.get("voiceTranscript") || "").trim();
      const voiceTranscript = rawVoice ? capEchoText(rawVoice) : undefined;
      customVoiceOverride = Boolean(voiceTranscript);

      if (file && file instanceof File) {
        if (file.size === 0) {
          return NextResponse.json(
            { error: "Uploaded file is empty" },
            { status: 400, headers: { "Cache-Control": "no-store" } }
          );
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          return NextResponse.json(
            { error: "File exceeds 10 MiB stage-4 demo limit" },
            { status: 413, headers: { "Cache-Control": "no-store" } }
          );
        }
        const ext = getLowerExtension(file.name);
        const isImageMime = file.type.toLowerCase().startsWith("image/");
        if (!ALLOWED_ANALYZE_EXTS.has(ext) && !isImageMime) {
          return NextResponse.json(
            { error: "Unsupported file format. Accepted: PNG, JPEG, WebP, PDF, CSV, TXT, or JSON." },
            { status: 415, headers: { "Cache-Control": "no-store" } }
          );
        }

        const buf = Buffer.from(await file.arrayBuffer());
        if (IMAGE_ANALYZE_EXTS.has(ext) || isImageMime) {
          const magicCheck = validateImageMagicBytes(buf);
          if (!magicCheck.valid) {
            return NextResponse.json(
              { error: magicCheck.reason || "Invalid image signature" },
              { status: 415, headers: { "Cache-Control": "no-store" } }
            );
          }
        } else if (ext === ".pdf" || file.type.toLowerCase() === "application/pdf") {
          const pdfMagic = validatePdfMagicBytes(buf);
          if (!pdfMagic.valid) {
            return NextResponse.json(
              { error: pdfMagic.reason || "Invalid PDF signature" },
              { status: 415, headers: { "Cache-Control": "no-store" } }
            );
          }
        }

        const analyzed = await analyzeUploadedBuffer(buf, file.name, {
          mimeType: file.type,
          voiceTranscript,
        });
        extractKind = analyzed.extractKind;
        invoice = analyzed.invoice;
        ocrMeta = analyzed.ocrMeta;
      }
    } else {
      const bodyText = rawBuf.toString("utf8").trim();
      const body = (bodyText ? JSON.parse(bodyText) : {}) as {
        scenarioId?: string;
        invoice?: InvoiceInput;
        rawText?: string;
        voiceTranscript?: string;
        clarityScore?: number;
        enablePiiScrub?: boolean;
      };

      if (body.invoice !== undefined) {
        if (!body.invoice || typeof body.invoice !== "object" || Array.isArray(body.invoice)) {
          return NextResponse.json(
            { error: "Invalid invoice object payload" },
            { status: 400, headers: { "Cache-Control": "no-store" } }
          );
        }
        const rawId = typeof body.invoice.id === "string" ? body.invoice.id.trim() : "";
        if (!rawId || rawId.toUpperCase().startsWith("SCN-")) {
          return NextResponse.json(
            { error: "Bundled scenario IDs (SCN-*) must be verified via scenarioId, not invoice payloads." },
            { status: 403, headers: { "Cache-Control": "no-store" } }
          );
        }
        const requestedTenant =
          typeof body.invoice.tenantId === "string" ? body.invoice.tenantId.trim() : "";
        if (requestedTenant && requestedTenant !== STORE_TENANT_ID) {
          return NextResponse.json(
            { error: `Tenant ID mismatch: active store tenant is ${STORE_TENANT_ID}.` },
            { status: 403, headers: { "Cache-Control": "no-store" } }
          );
        }
        if (!Array.isArray(body.invoice.lines)) {
          return NextResponse.json(
            { error: "Invoice payload must include a lines array" },
            { status: 400, headers: { "Cache-Control": "no-store" } }
          );
        }
        extractKind = "custom_invoice";
        customVoiceOverride = body.invoice.voiceTranscriptRaw !== undefined;
        invoice = {
          ...body.invoice,
          id: rawId.startsWith("UPL-") ? rawId : `UPL-${rawId}`,
          tenantId: STORE_TENANT_ID,
          clarityScore: body.invoice.lines.length > 0 ? TEXT_LAYER_CLARITY_SCORE : 0,
          notesRaw: capEchoText(body.invoice.notesRaw),
          voiceTranscriptRaw: capEchoText(body.invoice.voiceTranscriptRaw),
        };
      } else if (body.scenarioId) {
        const sc = DEMO_SCENARIOS.find((s) => s.id === body.scenarioId);
        if (!sc) {
          return NextResponse.json(
            { error: "Unknown scenarioId" },
            { status: 404, headers: { "Cache-Control": "no-store" } }
          );
        }
        customVoiceOverride = body.voiceTranscript !== undefined;
        invoice = {
          ...sc.invoice,
          voiceTranscriptRaw:
            body.voiceTranscript !== undefined
              ? capEchoText(body.voiceTranscript)
              : sc.invoice.voiceTranscriptRaw,
          clarityScore: sc.invoice.clarityScore,
          receivedAtIso: new Date().toISOString(),
        };
      } else if (typeof body.rawText === "string" && body.rawText.trim()) {
        extractKind = "custom_text";
        customVoiceOverride = body.voiceTranscript !== undefined;
        invoice = parseCustomInvoiceText(body.rawText, {
          voiceTranscript: capEchoText(body.voiceTranscript),
          clarityScore: TEXT_LAYER_CLARITY_SCORE,
        });
      }
    }

    if (!invoice) {
      return NextResponse.json(
        { error: "Missing scenarioId, invoice, rawText, or file" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const verification = verifyInvoicePipeline(invoice, {
      vendorHistory: DEMO_VENDOR_HISTORY,
      priorBills: DEMO_PRIOR_BILLS,
      enablePiiScrub: true,
    });
    recordServerVerdict(verification);

    const safeInvoice: InvoiceInput = {
      ...invoice,
      notesRaw:
        extractKind === "structured_scenario"
          ? capEchoText(invoice.notesRaw)
          : capEchoText(verification.dpdpScrubbedNotes),
      voiceTranscriptRaw:
        extractKind === "structured_scenario" && !customVoiceOverride
          ? capEchoText(invoice.voiceTranscriptRaw)
          : capEchoText(verification.dpdpScrubbedVoice),
    };

    return NextResponse.json(
      { extractKind, invoice: safeInvoice, verification, ...(ocrMeta ? { ocrMeta } : {}) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return NextResponse.json(
        { error: "Request payload exceeds stage-4 size limit" },
        { status: 413, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Malformed JSON request payload" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    const errId = `an_${Date.now().toString(36)}`;
    console.error(`[analyze:${errId}]`, err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json(
      { error: "Failed to analyze invoice", errorId: errId },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  } finally {
    releaseConcurrency();
  }
}
