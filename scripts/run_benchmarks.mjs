import fs from "node:fs";
import path from "node:path";
import { runFullBenchmarkSuite } from "../src/lib/benchmark-runner";

const mode = process.argv[2] || "run";
const report = runFullBenchmarkSuite({ writeDisk: true });

if (mode === "run") {
  const stage4Copy = "/Users/admin/Github/unstop-hackathons/neuraviz-2026/stage4/benchmark_results.json";
  const stage4Dir = path.dirname(stage4Copy);
  if (fs.existsSync("/Users/admin/Github/unstop-hackathons/neuraviz-2026")) {
    fs.mkdirSync(stage4Dir, { recursive: true });
    fs.writeFileSync(stage4Copy, JSON.stringify(report, null, 2), "utf8");
  }
  console.log("BENCHMARK_SUMMARY:", JSON.stringify({
    runId: report.runId,
    overall: report.overall,
    fairness: {
      macroMeanF1Pct: report.fairness.macroMeanF1Pct,
      macroMeanRecallPct: report.fairness.macroMeanRecallPct,
      maxF1GapBelowMeanPct: report.fairness.maxF1GapBelowMeanPct,
      maxRecallGapBelowMeanPct: report.fairness.maxRecallGapBelowMeanPct,
      fairnessGatePassed: report.fairness.fairnessGatePassed,
    },
    redTeam: {
      totalAttacks: report.redTeam.totalAttacks,
      blockedOrIsolated: report.redTeam.blockedOrIsolated,
      taxIntegrityPreserved: report.redTeam.taxIntegrityPreserved,
      piiZeroLeakPassed: report.redTeam.piiZeroLeakPassed,
    },
    latency: report.latency,
    gates: report.gates,
  }, null, 2));

  if (!report.gates.allGatesPassed) {
    console.error("BENCHMARK_GATE_FAILED");
    process.exit(1);
  }
} else {
  console.log("FIXTURES_GENERATED: 500 invoices + 50 red-team attacks");
}
