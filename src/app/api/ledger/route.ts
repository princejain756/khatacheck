import { NextRequest, NextResponse } from "next/server";
import {
  LIFECYCLE_GATES,
  STORE_TENANT_ID,
  appendLedgerDecision,
  computeAutomationBiasMonitor,
  getServerVerdict,
  readLedgerWithIntegrity,
  seedDefaultLedger,
  validateLedgerPostBody,
  verifyHashChain,
} from "@/lib/governance-ledger";
import { checkRateLimit, extractClientIp } from "@/lib/rate-limit";
import { PayloadTooLargeError, readRequestBufferWithLimit } from "@/lib/upload-analyzer";

const MAX_LEDGER_JSON_BYTES = 64 * 1024;
const MAX_SYNTHETIC_STRESS_ROWS = 50;

export async function GET() {
  try {
    const { events, verification } = readLedgerWithIntegrity();
    return NextResponse.json(
      {
        events,
        verification,
        biasMonitor: computeAutomationBiasMonitor(events),
        gates: LIFECYCLE_GATES,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const errId = `lg_${Date.now().toString(36)}`;
    console.error(`[ledger:get:${errId}]`, err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json(
      { error: "Audit ledger unavailable", errorId: errId },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function POST(req: NextRequest) {
  const ip = extractClientIp(req);
  const rl = checkRateLimit(`ledger:${ip}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many ledger write requests; please wait briefly." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(rl.retryAfterSec),
        },
      }
    );
  }

  try {
    const rawBuf = await readRequestBufferWithLimit(req, MAX_LEDGER_JSON_BYTES);
    const bodyText = rawBuf.toString("utf8").trim();
    const parsedBody: unknown = bodyText ? JSON.parse(bodyText) : {};
    const validated = validateLedgerPostBody(parsedBody);

    if (!validated.ok) {
      return NextResponse.json(
        { error: validated.error },
        { status: validated.status, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (validated.action === "reset-demo") {
      const events = seedDefaultLedger();
      return NextResponse.json(
        {
          events,
          verification: verifyHashChain(events),
          biasMonitor: computeAutomationBiasMonitor(events),
          gates: LIFECYCLE_GATES,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (validated.action === "stress-bias") {
      const { events: beforeEvents, verification: preCheck } = readLedgerWithIntegrity();
      if (!preCheck.valid) {
        return NextResponse.json(
          { error: "Audit ledger integrity check failed; reset demo ledger first." },
          { status: 409, headers: { "Cache-Control": "no-store" } }
        );
      }

      const existingSynthetic = beforeEvents.filter((e) => e.isSyntheticStress).length;
      const remaining = Math.max(0, MAX_SYNTHETIC_STRESS_ROWS - existingSynthetic);

      for (let offset = 1; offset <= remaining; offset += 1) {
        const i = existingSynthetic + offset;
        appendLedgerDecision({
          tenantId: STORE_TENANT_ID,
          invoiceId: `STRESS-${i}`,
          invoiceNumber: `STR/${String(i).padStart(3, "0")}`,
          vendorName: "Synthetic Bias Stress Fixture",
          billSha256: `stress_${String(i).padStart(4, "0")}_${"a".repeat(52)}`,
          billReceivedTs: new Date(Date.now() - 1200).toISOString(),
          flagSentTs: new Date(Date.now() - 1000).toISOString(),
          fieldConfidencesMin: 0.94,
          sourceCropBbox: null,
          ruleChecks: ["STRESS-BIAS-DRILL"],
          varianceAtRiskPaise: "25000",
          decision: "approved_flag",
          overrideReason: "",
          dwellMs: 950 + (i % 6) * 180,
          isSyntheticStress: true,
        });
      }

      const { events, verification } = readLedgerWithIntegrity();
      return NextResponse.json(
        {
          events,
          verification,
          biasMonitor: computeAutomationBiasMonitor(events),
          gates: LIFECYCLE_GATES,
          syntheticStressCount: Math.min(MAX_SYNTHETIC_STRESS_ROWS, existingSynthetic + remaining),
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const input = validated.data;
    const verdict = getServerVerdict(input.billSha256);
    if (!verdict) {
      return NextResponse.json(
        {
          error:
            "Unknown or unverified billSha256; run /api/analyze on the invoice before recording a ledger decision.",
        },
        { status: 422, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (input.decision === "approved_flag" && !verdict.humanApprovalAllowed) {
      return NextResponse.json(
        {
          error:
            "Server verdict blocks approval for this bill (prompt-guard blocked, clarity below 85, invalid GSTIN, duplicate, or manual voice claim).",
        },
        { status: 422, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (
      input.decision === "overridden_clean" &&
      (verdict.promptGuardBlocked || verdict.abstainedClarity)
    ) {
      return NextResponse.json(
        {
          error:
            "Cannot override bill as clean when prompt-guard quarantine or clarity abstention is active.",
        },
        { status: 422, headers: { "Cache-Control": "no-store" } }
      );
    }

    const event = appendLedgerDecision({
      tenantId: STORE_TENANT_ID,
      invoiceId: input.invoiceId,
      invoiceNumber: input.invoiceNumber,
      vendorName: input.vendorName,
      billSha256: input.billSha256,
      billReceivedTs: input.billReceivedTs,
      flagSentTs: input.flagSentTs,
      fieldConfidencesMin: input.fieldConfidencesMin,
      sourceCropBbox: input.sourceCropBbox,
      ruleChecks: input.ruleChecks,
      varianceAtRiskPaise: input.varianceAtRiskPaise,
      decision: input.decision,
      overrideReason: input.overrideReason,
      dwellMs: input.dwellMs,
    });

    const { events, verification } = readLedgerWithIntegrity();
    return NextResponse.json(
      {
        event,
        events,
        verification,
        biasMonitor: computeAutomationBiasMonitor(events),
        gates: LIFECYCLE_GATES,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return NextResponse.json(
        { error: "Ledger request exceeds 64 KiB limit" },
        { status: 413, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Malformed JSON payload" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    const errId = `lp_${Date.now().toString(36)}`;
    console.error(`[ledger:post:${errId}]`, err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json(
      { error: "Failed to write audit ledger", errorId: errId },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}
