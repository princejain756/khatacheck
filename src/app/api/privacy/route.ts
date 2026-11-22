import { NextRequest, NextResponse } from "next/server";
import { DPDP_CONSENT_NOTICE, scrubPiiForModelEgress } from "@/lib/dpdp-privacy";
import {
  STORE_TENANT_ID,
  clearUserDataPreservingSeeded,
  getConsentState,
  readLedgerEvents,
  recordConsentEvent,
  seedDefaultLedger,
} from "@/lib/governance-ledger";
import { checkRateLimit, extractClientIp } from "@/lib/rate-limit";
import { PayloadTooLargeError, readRequestBufferWithLimit } from "@/lib/upload-analyzer";

const MAX_PRIVACY_JSON_BYTES = 64 * 1024;

export async function GET() {
  try {
    const events = readLedgerEvents();
    const receipt = {
      standard: "India DPDP Act 2023 Store Data Export",
      exportedAtIso: new Date().toISOString(),
      tenantId: STORE_TENANT_ID,
      noticeVersion: DPDP_CONSENT_NOTICE.version,
      grievanceContact: DPDP_CONSENT_NOTICE.grievanceContact,
      plannedRetentionDays: DPDP_CONSENT_NOTICE.retentionDays,
      rawMediaExpiryWorkerStatus: "planned_days_61_to_90_in_memory_demo",
      consent: getConsentState(),
      auditLedgerEvents: events,
    };
    return new NextResponse(JSON.stringify(receipt, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="khatacheck_dpdp_store_export.json"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const errId = `pr_${Date.now().toString(36)}`;
    console.error(`[privacy:get:${errId}]`, err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json(
      { error: "Privacy export unavailable", errorId: errId },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function POST(req: NextRequest) {
  const ip = extractClientIp(req);
  const rl = checkRateLimit(`privacy:${ip}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many privacy requests; please wait briefly." },
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
    const rawBuf = await readRequestBufferWithLimit(req, MAX_PRIVACY_JSON_BYTES);
    const bodyText = rawBuf.toString("utf8").trim();
    const body = (bodyText ? JSON.parse(bodyText) : {}) as {
      action?: "scrub" | "delete" | "restore" | "grant_consent" | "withdraw_consent";
      text?: string;
      noticeVersion?: string;
    };

    if (body.action === "scrub") {
      return NextResponse.json(scrubPiiForModelEgress(String(body.text || "")), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (body.action === "grant_consent") {
      const requestedVersion =
        typeof body.noticeVersion === "string" && body.noticeVersion.trim()
          ? body.noticeVersion.trim().slice(0, 64)
          : DPDP_CONSENT_NOTICE.version;
      const consent = recordConsentEvent("grant", requestedVersion);
      const events = readLedgerEvents();
      return NextResponse.json(
        {
          ok: true,
          consent,
          eventCount: events.length,
          notice: `DPDP consent recorded under ${consent.noticeVersion} (${consent.timestampIso}).`,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (body.action === "withdraw_consent") {
      const requestedVersion =
        typeof body.noticeVersion === "string" && body.noticeVersion.trim()
          ? body.noticeVersion.trim().slice(0, 64)
          : DPDP_CONSENT_NOTICE.version;
      const consent = recordConsentEvent("withdraw", requestedVersion);
      const events = readLedgerEvents();
      return NextResponse.json(
        {
          ok: true,
          consent,
          remainingCount: events.length,
          notice: `Consent withdrawn and user-submitted records cleared while preserving 4 seeded demo genesis rows (${events.length} rows including reset log).`,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (body.action === "delete") {
      const res = clearUserDataPreservingSeeded();
      const events = readLedgerEvents();
      return NextResponse.json(
        {
          ok: true,
          deletedAtIso: new Date().toISOString(),
          notice: `Cleared ${res.clearedCount} user-submitted record(s); preserved ${res.preservedSeededCount} seeded demo genesis rows with a DPDP reset entry.`,
          remainingCount: events.length,
          clearedCount: res.clearedCount,
          preservedSeededCount: res.preservedSeededCount,
          resetEventHash: res.resetEventHash,
          consent: getConsentState(),
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
          consent: getConsentState(),
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      { error: "Unsupported privacy action" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return NextResponse.json(
        { error: "Privacy request exceeds 64 KiB limit" },
        { status: 413, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Malformed JSON payload" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    const errId = `pp_${Date.now().toString(36)}`;
    console.error(`[privacy:post:${errId}]`, err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json(
      { error: "Privacy action failed", errorId: errId },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}
