import { NextRequest, NextResponse } from "next/server";
import { DEMO_PRIOR_BILLS, DEMO_SCENARIOS, DEMO_VENDOR_HISTORY } from "@/lib/bill-scenarios";
import { verifyInvoicePipeline } from "@/lib/engine";
import type { OcrMeta } from "@/lib/ocr-extractor";
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

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    const isMultipart = contentType.includes("multipart/form-data");
    const rawBuf = await readRequestBufferWithLimit(
      req,
      isMultipart ? MAX_MULTIPART_BYTES : MAX_JSON_BYTES
    );

    let invoice: InvoiceInput | null = null;
    let enablePiiScrub = true;
    let extractKind = "structured_scenario";
    let ocrMeta: OcrMeta | undefined;

    if (isMultipart) {
      const form = await new Response(new Uint8Array(rawBuf), {
        headers: { "content-type": contentType },
      }).formData();
      const file = form.get("file");
      const voiceTranscript = String(form.get("voiceTranscript") || "").trim() || undefined;
      enablePiiScrub = String(form.get("enablePiiScrub") ?? "true") !== "false";

      if (file && file instanceof File) {
        if (file.size === 0) {
          return NextResponse.json({ error: "Uploaded file is empty" }, { status: 400 });
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          return NextResponse.json({ error: "File exceeds 10 MiB stage-4 demo limit" }, { status: 413 });
        }
        const buf = Buffer.from(await file.arrayBuffer());
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
      enablePiiScrub = body.enablePiiScrub !== false;

      if (body.invoice) {
        invoice = body.invoice;
      } else if (body.scenarioId) {
        const sc = DEMO_SCENARIOS.find((s) => s.id === body.scenarioId);
        if (!sc) {
          return NextResponse.json({ error: "Unknown scenarioId" }, { status: 404 });
        }
        invoice = {
          ...sc.invoice,
          voiceTranscriptRaw:
            body.voiceTranscript !== undefined ? body.voiceTranscript : sc.invoice.voiceTranscriptRaw,
          clarityScore: body.clarityScore !== undefined ? body.clarityScore : sc.invoice.clarityScore,
          receivedAtIso: new Date().toISOString(),
        };
      } else if (typeof body.rawText === "string" && body.rawText.trim()) {
        extractKind = "custom_text";
        invoice = parseCustomInvoiceText(body.rawText, {
          voiceTranscript: body.voiceTranscript,
          clarityScore: body.clarityScore,
        });
      }
    }

    if (!invoice) {
      return NextResponse.json({ error: "Missing scenarioId, invoice, rawText, or file" }, { status: 400 });
    }

    const verification = verifyInvoicePipeline(invoice, {
      vendorHistory: DEMO_VENDOR_HISTORY,
      priorBills: DEMO_PRIOR_BILLS,
      enablePiiScrub,
    });

    return NextResponse.json(
      { extractKind, invoice, verification, ...(ocrMeta ? { ocrMeta } : {}) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return NextResponse.json(
        { error: "Request payload exceeds stage-4 size limit" },
        { status: 413, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to analyze invoice" },
      { status: 400 }
    );
  }
}
