import { GovernanceClient } from "@/components/GovernanceClient";
import {
  LIFECYCLE_GATES,
  computeAutomationBiasMonitor,
  readLedgerWithIntegrity,
} from "@/lib/governance-ledger";

export const dynamic = "force-dynamic";

export default function GovernancePage() {
  const { events, verification } = readLedgerWithIntegrity();
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
