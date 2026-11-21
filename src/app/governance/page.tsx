import { GovernanceClient } from "@/components/GovernanceClient";
import {
  LIFECYCLE_GATES,
  computeAutomationBiasMonitor,
  readLedgerEvents,
  verifyHashChain,
} from "@/lib/governance-ledger";

export const dynamic = "force-dynamic";

export default function GovernancePage() {
  const events = readLedgerEvents();
  const verification = verifyHashChain(events);
  const bias = computeAutomationBiasMonitor(events);

  return (
    <GovernanceClient
      initialEvents={events}
      initialVerification={verification}
      initialBias={bias}
      gates={LIFECYCLE_GATES}
    />
  );
}
