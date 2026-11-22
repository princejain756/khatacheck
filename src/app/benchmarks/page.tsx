import fs from "node:fs";
import path from "node:path";
import { BenchmarksClient } from "@/components/BenchmarksClient";
import { runFullBenchmarkSuite } from "@/lib/benchmark-runner";
import type { BenchmarkReport, E2eOcrAsrReport, ExternalHfReport } from "@/lib/types";

export const dynamic = "force-dynamic";

const BENCHMARK_FILE = path.join(process.cwd(), "src", "data", "benchmark-results.json");
const E2E_FILE = path.join(process.cwd(), "src", "data", "e2e-ocr-asr-results.json");
const EXTERNAL_HF_FILE = path.join(process.cwd(), "src", "data", "external-hf-results.json");

function readJsonOrNull<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export default function BenchmarksPage() {
  const report =
    readJsonOrNull<BenchmarkReport>(BENCHMARK_FILE) ?? runFullBenchmarkSuite({ writeDisk: false });
  const e2eReport = readJsonOrNull<E2eOcrAsrReport>(E2E_FILE);
  const externalHfReport = readJsonOrNull<ExternalHfReport>(EXTERNAL_HF_FILE);
  return (
    <BenchmarksClient
      initialReport={report}
      initialE2eReport={e2eReport}
      initialExternalHfReport={externalHfReport}
    />
  );
}
