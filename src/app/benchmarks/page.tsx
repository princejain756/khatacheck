import fs from "node:fs";
import path from "node:path";
import { BenchmarksClient } from "@/components/BenchmarksClient";
import { runFullBenchmarkSuite } from "@/lib/benchmark-runner";
import type { BenchmarkReport, E2eOcrAsrReport, ExternalHfReport } from "@/lib/types";

export const dynamic = "force-dynamic";

function loadJsonOrNull<T>(relParts: string[]): T | null {
  const filePath = path.join(process.cwd(), ...relParts);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  }
  return null;
}

function loadInitialBenchmark(): BenchmarkReport {
  return loadJsonOrNull<BenchmarkReport>(["src", "data", "benchmark-results.json"]) ?? runFullBenchmarkSuite({ writeDisk: false });
}

export default function BenchmarksPage() {
  const report = loadInitialBenchmark();
  const e2eReport = loadJsonOrNull<E2eOcrAsrReport>(["src", "data", "e2e-ocr-asr-results.json"]);
  const externalHfReport = loadJsonOrNull<ExternalHfReport>(["src", "data", "external-hf-results.json"]);
  return (
    <BenchmarksClient
      initialReport={report}
      initialE2eReport={e2eReport}
      initialExternalHfReport={externalHfReport}
    />
  );
}
