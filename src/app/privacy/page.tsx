import { PrivacyClient } from "@/components/PrivacyClient";
import { getConsentState, readLedgerEvents } from "@/lib/governance-ledger";

export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  const events = readLedgerEvents();
  const consent = getConsentState();
  return <PrivacyClient initialEventCount={events.length} initialConsent={consent} />;
}
