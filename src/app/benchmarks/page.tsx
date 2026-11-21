import fs from "node:fs";
import path from "node:path";
import { BenchmarksClient } from "@/components/BenchmarksClient";
import { runFullBenchmarkSuite } from "@/lib/benchmark-runner";
import type { BenchmarkReport } from "@/lib/types";

export const dynamic = "force-dynamic";

function loadInitialBenchmark(): BenchmarkReport {
  const dataFile = path.join(process.cwd(), "src", "data", "benchmark-results.json");
  if (fs.existsSync(dataFile)) {
    return JSON.parse(fs.readFileSync(dataFile, "utf8")) as BenchmarkReport;
  }
  return runFullBenchmarkSuite({ writeDisk: false });
}

export default function BenchmarksPage() {
  const report = loadInitialBenchmark();
  return <BenchmarksClient initialReport={report} />;
}
