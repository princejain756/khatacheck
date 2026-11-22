import { NextRequest, NextResponse } from "next/server";
import { scrubPiiForModelEgress } from "@/lib/dpdp-privacy";
import {
  LIFECYCLE_GATES,
  STORE_TENANT_ID,
  appendLedgerDecision,
  computeAutomationBiasMonitor,
  readLedgerWithIntegrity,
  seedDefaultLedger,
  verifyHashChain,
} from "@/lib/governance-ledger";
import type { CropBbox, ReviewDecision } from "@/lib/types";

export async function GET() {
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
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action?: "decision" | "stress-bias" | "reset-demo";
      tenantId?: string;
      invoiceId?: string;
      invoiceNumber?: string;
      vendorName?: string;
      billSha256?: string;
      billReceivedTs?: string;
      flagSentTs?: string;
      fieldConfidencesMin?: number;
      sourceCropBbox?: CropBbox | null;
      ruleChecks?: string[];
      varianceAtRiskPaise?: string;
      decision?: ReviewDecision;
      overrideReason?: string;
      dwellMs?: number;
    };

    if (body.action === "reset-demo") {
      const events = seedDefaultLedger();
      return NextResponse.json({
        events,
        verification: verifyHashChain(events),
        biasMonitor: computeAutomationBiasMonitor(events),
        gates: LIFECYCLE_GATES,
      });
    }

    if (body.action === "stress-bias") {
      // Appends 50 rapid synthetic stress approvals (<1.5s dwell) to demonstrate >50 decision Bias Monitor trigger
      for (let i = 1; i <= 50; i += 1) {
        appendLedgerDecision({
          tenantId: "store-ganesh-blr-01",
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
      return NextResponse.json({
        events,
        verification,
        biasMonitor: computeAutomationBiasMonitor(events),
        gates: LIFECYCLE_GATES,
      });
    }

    const requestedTenant = body.tenantId !== undefined ? String(body.tenantId).trim() : "";
    if (requestedTenant && requestedTenant !== STORE_TENANT_ID) {
      return NextResponse.json(
        { error: `Tenant ID mismatch: active store tenant is ${STORE_TENANT_ID}.` },
        { status: 403 }
      );
    }

    const decision = body.decision ?? "approved_flag";
    const overrideReason = scrubPiiForModelEgress(String(body.overrideReason ?? "").trim()).scrubbedText;
    if ((decision === "overridden_clean" || decision === "contested_appeal") && overrideReason.length < 6) {
      return NextResponse.json(
        { error: "Override or appeal requires a written reason (minimum 6 characters)." },
        { status: 400 }
      );
    }

    const event = appendLedgerDecision({
      tenantId: STORE_TENANT_ID,
      invoiceId: body.invoiceId || "CUSTOM",
      invoiceNumber: body.invoiceNumber || "CUSTOM/01",
      vendorName: body.vendorName || "Supplier",
      billSha256: body.billSha256 || "0".repeat(64),
      billReceivedTs: body.billReceivedTs || new Date().toISOString(),
      flagSentTs: body.flagSentTs || new Date().toISOString(),
      fieldConfidencesMin: body.fieldConfidencesMin ?? 0.95,
      sourceCropBbox: body.sourceCropBbox ?? null,
      ruleChecks: body.ruleChecks ?? [],
      varianceAtRiskPaise: body.varianceAtRiskPaise ?? "0",
      decision,
      overrideReason,
      dwellMs: body.dwellMs ?? 12000,
    });

    const { events, verification } = readLedgerWithIntegrity();
    return NextResponse.json({
      event,
      events,
      verification,
      biasMonitor: computeAutomationBiasMonitor(events),
      gates: LIFECYCLE_GATES,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to write audit ledger" },
      { status: 400 }
    );
  }
}
