import { NextResponse } from "next/server";
import { readLedgerEvents, simulateCopyOnlyTamper } from "@/lib/governance-ledger";

export async function POST() {
  try {
    const events = readLedgerEvents();
    const sim = simulateCopyOnlyTamper(events);
    return NextResponse.json(sim, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const errId = `tt_${Date.now().toString(36)}`;
    console.error(`[tamper-test:${errId}]`, err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json(
      { error: "Tamper simulation failed", errorId: errId },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
