import { NextRequest, NextResponse } from "next/server";
import { DEMO_SCENARIOS } from "@/lib/bill-scenarios";
import {
  LIFECYCLE_GATES,
  buildDisputeCsv,
  buildTallyPurchaseXml,
  computeAutomationBiasMonitor,
  hasApprovedLedgerDecision,
  readLedgerEvents,
  verifyHashChain,
} from "@/lib/governance-ledger";
import { ORACLE_PROFILE_LABEL, RULE_BUNDLE_VERSION } from "@/lib/gst-rules";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format") || "audit-manifest";
  const scenarioId = searchParams.get("scenarioId") || DEMO_SCENARIOS[0].id;

  if (format === "tally-xml") {
    const scenario = DEMO_SCENARIOS.find((s) => s.id === scenarioId) ?? DEMO_SCENARIOS[0];
    if (!hasApprovedLedgerDecision(scenario.id)) {
      return NextResponse.json(
        {
          error:
            "Store owner approval in the SHA-256 audit ledger is required before Tally Sandbox XML export.",
          scenarioId: scenario.id,
          approved: false,
        },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }
    const xml = buildTallyPurchaseXml(scenario.invoice);
    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="khatacheck_${scenario.id}_tally_sandbox.xml"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (format === "dispute-csv") {
    const events = readLedgerEvents();
    const csv = buildDisputeCsv(events);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="khatacheck_dispute_credit_notes.csv"',
        "Cache-Control": "no-store",
      },
    });
  }

  const events = readLedgerEvents();
  const manifest = {
    standard: "ISO/IEC 42001 AIMS Audit Manifest",
    exportedAtIso: new Date().toISOString(),
    ruleBundleVersion: RULE_BUNDLE_VERSION,
    oracleProfile: ORACLE_PROFILE_LABEL,
    chainVerification: verifyHashChain(events),
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
}
