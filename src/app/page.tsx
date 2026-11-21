import { WorkbenchClient } from "@/components/WorkbenchClient";
import { DEMO_PRIOR_BILLS, DEMO_SCENARIOS, DEMO_VENDOR_HISTORY } from "@/lib/bill-scenarios";
import { verifyInvoicePipeline } from "@/lib/engine";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const first = DEMO_SCENARIOS[0];
  const initialResult = verifyInvoicePipeline(first.invoice, {
    vendorHistory: DEMO_VENDOR_HISTORY,
    priorBills: DEMO_PRIOR_BILLS,
    enablePiiScrub: true,
  });

  return (
    <WorkbenchClient
      scenarios={DEMO_SCENARIOS}
      initialScenarioId={first.id}
      initialInvoice={first.invoice}
      initialResult={initialResult}
    />
  );
}
