import { PrivacyClient } from "@/components/PrivacyClient";
import { readLedgerEvents } from "@/lib/governance-ledger";

export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  const events = readLedgerEvents();
  return <PrivacyClient initialEventCount={events.length} />;
}
