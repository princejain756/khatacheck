import { NextRequest, NextResponse } from "next/server";
import { DPDP_CONSENT_NOTICE, scrubPiiForModelEgress } from "@/lib/dpdp-privacy";
import {
  clearLedgerForPrivacyDelete,
  readLedgerEvents,
  seedDefaultLedger,
} from "@/lib/governance-ledger";

export async function GET() {
  const events = readLedgerEvents();
  const receipt = {
    standard: "India DPDP Act 2023 Store Data Export",
    exportedAtIso: new Date().toISOString(),
    tenantId: "store-ganesh-blr-01",
    noticeVersion: DPDP_CONSENT_NOTICE.version,
    rawMediaAutoPurgeDays: DPDP_CONSENT_NOTICE.retentionDays,
    auditLedgerEvents: events,
  };
  return new NextResponse(JSON.stringify(receipt, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="khatacheck_dpdp_store_export.json"',
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action: "scrub" | "delete" | "restore";
      text?: string;
    };

    if (body.action === "scrub") {
      return NextResponse.json(scrubPiiForModelEgress(body.text || ""), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (body.action === "delete") {
      clearLedgerForPrivacyDelete();
      return NextResponse.json(
        {
          ok: true,
          deletedAtIso: new Date().toISOString(),
          notice: "All tenant review events and temporary state wiped under DPDP erasure right (/delete-data).",
          remainingCount: 0,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (body.action === "restore") {
      const events = seedDefaultLedger();
      return NextResponse.json(
        {
          ok: true,
          restoredAtIso: new Date().toISOString(),
          eventCount: events.length,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Privacy action failed" },
      { status: 400 }
    );
  }
}
