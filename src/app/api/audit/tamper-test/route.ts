import { NextResponse } from "next/server";
import { readLedgerEvents, simulateCopyOnlyTamper } from "@/lib/governance-ledger";

export async function POST() {
  const events = readLedgerEvents();
  const sim = simulateCopyOnlyTamper(events);
  return NextResponse.json(sim, { headers: { "Cache-Control": "no-store" } });
}
