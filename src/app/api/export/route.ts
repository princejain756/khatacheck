import { NextRequest, NextResponse } from "next/server";
import { DEMO_SCENARIOS } from "@/lib/bill-scenarios";
import { computeBillSha256 } from "@/lib/engine";
import {
  LIFECYCLE_GATES,
  buildDisputeCsv,
  buildTallyPurchaseXml,
  computeAutomationBiasMonitor,
  getConsentState,
  getServerVerdict,
  isInvoiceApprovedInEvents,
  readLedgerWithIntegrity,
} from "@/lib/governance-ledger";
import { ORACLE_PROFILE_LABEL, RULE_BUNDLE_VERSION } from "@/lib/gst-rules";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format") || "audit-manifest";
    const rawScenarioId = searchParams.get("scenarioId");

    if (format === "tally-xml") {
      const scenario = rawScenarioId
        ? DEMO_SCENARIOS.find((s) => s.id === rawScenarioId)
        : DEMO_SCENARIOS[0];
      if (!scenario) {
        return NextResponse.json(
          { error: "Unknown scenarioId" },
          { status: 404, headers: { "Cache-Control": "no-store" } }
        );
      }

      const { events, verification: chain } = readLedgerWithIntegrity();
      const expectedBillSha256 = computeBillSha256(scenario.invoice);
      const verdict = getServerVerdict(expectedBillSha256);
      const ledgerApproved = isInvoiceApprovedInEvents(
        events,
        scenario.id,
        expectedBillSha256,
        scenario.invoice.tenantId
      );
      const serverAllowed =
        verdict !== null &&
        !verdict.promptGuardBlocked &&
        !verdict.abstainedClarity &&
        verdict.gstinValid;

      if (!chain.valid || !ledgerApproved || !serverAllowed) {
        return NextResponse.json(
          {
            error: !chain.valid
              ? "Audit ledger SHA-256 hash chain verification failed; Tally Purchase XML export blocked."
              : !serverAllowed
                ? "Server safety, clarity, and GSTIN checks block Tally Purchase XML export for this bill."
                : "Latest audit ledger decision for this bill SHA-256 and tenant must approve export before Tally Purchase XML download.",
            scenarioId: scenario.id,
            approved: false,
            chainValid: chain.valid,
            notImportVerified: true,
          },
          { status: 403, headers: { "Cache-Control": "no-store" } }
        );
      }

      const xml = buildTallyPurchaseXml(scenario.invoice);
      return new NextResponse(xml, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Content-Disposition": `attachment; filename="khatacheck_${scenario.id}_tally_purchase.xml"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (format === "dispute-csv") {
      const { events, verification } = readLedgerWithIntegrity();
      const csv = buildDisputeCsv(events, verification.valid);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="khatacheck_dispute_credit_notes.csv"',
          "Cache-Control": "no-store",
        },
      });
    }

    const { events, verification } = readLedgerWithIntegrity();
    const manifest = {
      standard: "ISO/IEC 42001 AIMS Audit Manifest",
      exportedAtIso: new Date().toISOString(),
      ruleBundleVersion: RULE_BUNDLE_VERSION,
      oracleProfile: ORACLE_PROFILE_LABEL,
      chainModel: "tamper_evident_unkeyed_sha256",
      dpdpConsentState: getConsentState(),
      chainVerification: verification,
      automationBiasMonitor: computeAutomationBiasMonitor(events),
      lifecycleGates: LIFECYCLE_GATES,
      events,
    };
    return new NextResponse(JSON.stringify(manifest, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="khatacheck_iso42001_audit_manifest.json"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const errId = `ex_${Date.now().toString(36)}`;
    console.error(`[export:${errId}]`, err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json(
      { error: "Export generation failed", errorId: errId },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
