import fs from "node:fs";
import path from "node:path";
import { BenchmarksClient } from "@/components/BenchmarksClient";
import { runFullBenchmarkSuite } from "@/lib/benchmark-runner";
import type { BenchmarkReport, E2eOcrAsrReport } from "@/lib/types";

export const dynamic = "force-dynamic";

function loadInitialBenchmark(): BenchmarkReport {
  const dataFile = path.join(process.cwd(), "src", "data", "benchmark-results.json");
  if (fs.existsSync(dataFile)) {
    return JSON.parse(fs.readFileSync(dataFile, "utf8")) as BenchmarkReport;
  }
  return runFullBenchmarkSuite({ writeDisk: false });
}

function loadE2eBenchmark(): E2eOcrAsrReport | null {
  const e2eFile = path.join(process.cwd(), "src", "data", "e2e-ocr-asr-results.json");
  if (fs.existsSync(e2eFile)) {
    return JSON.parse(fs.readFileSync(e2eFile, "utf8")) as E2eOcrAsrReport;
  }
  return null;
}

export default function BenchmarksPage() {
  const report = loadInitialBenchmark();
  const e2eReport = loadE2eBenchmark();
  return <BenchmarksClient initialReport={report} initialE2eReport={e2eReport} />;
}
