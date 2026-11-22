import { NextRequest, NextResponse } from "next/server";
import { DEMO_PRIOR_BILLS, DEMO_SCENARIOS, DEMO_VENDOR_HISTORY } from "@/lib/bill-scenarios";
import { verifyInvoicePipeline } from "@/lib/engine";
import type { OcrMeta } from "@/lib/ocr-extractor";
import type { InvoiceInput } from "@/lib/types";
import { analyzeUploadedBuffer, parseCustomInvoiceText } from "@/lib/upload-analyzer";

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let invoice: InvoiceInput | null = null;
    let enablePiiScrub = true;
    let extractKind = "structured_scenario";
    let ocrMeta: OcrMeta | undefined;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const voiceTranscript = String(form.get("voiceTranscript") || "").trim() || undefined;
      enablePiiScrub = String(form.get("enablePiiScrub") ?? "true") !== "false";

      if (file && file instanceof File) {
        if (file.size === 0) {
          return NextResponse.json({ error: "Uploaded file is empty" }, { status: 400 });
        }
        if (file.size > 10 * 1024 * 1024) {
          return NextResponse.json({ error: "File exceeds 10 MiB stage-4 demo limit" }, { status: 400 });
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
      const body = (await req.json()) as {
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to analyze invoice" },
      { status: 400 }
    );
  }
}
