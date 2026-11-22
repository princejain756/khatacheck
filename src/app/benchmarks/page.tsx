import fs from "node:fs";
import path from "node:path";
import { BenchmarksClient } from "@/components/BenchmarksClient";
import { runFullBenchmarkSuite } from "@/lib/benchmark-runner";
import type { BenchmarkReport, E2eOcrAsrReport, ExternalHfReport } from "@/lib/types";

export const dynamic = "force-dynamic";

const BENCHMARK_FILE = path.join(process.cwd(), "src", "data", "benchmark-results.json");
const BENCHMARK_V2_FILE = path.join(process.cwd(), "src", "data", "benchmark-results-v2.json");
const E2E_FILE = path.join(process.cwd(), "src", "data", "e2e-ocr-asr-results.json");
const E2E_V2_FILE = path.join(process.cwd(), "src", "data", "e2e-ocr-asr-results-v2.json");
const EXTERNAL_HF_FILE = path.join(process.cwd(), "src", "data", "external-hf-results.json");
const EXTERNAL_HF_HELDOUT_FILE = path.join(process.cwd(), "src", "data", "external-hf-heldout-results.json");
const EXTERNAL_HF_DEV_RERUN_FILE = path.join(process.cwd(), "src", "data", "external-hf-dev-rerun.json");

function readJsonOrNull<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export default function BenchmarksPage() {
  const report =
    readJsonOrNull<BenchmarkReport>(BENCHMARK_FILE) ?? runFullBenchmarkSuite({ writeDisk: false });
  const v2Report = readJsonOrNull<BenchmarkReport>(BENCHMARK_V2_FILE);
  const e2eReport = readJsonOrNull<E2eOcrAsrReport>(E2E_FILE);
  const e2eV2Report = readJsonOrNull<E2eOcrAsrReport>(E2E_V2_FILE);
  const externalHfReport = readJsonOrNull<ExternalHfReport>(EXTERNAL_HF_FILE);
  const externalHfHeldout = readJsonOrNull<ExternalHfReport>(EXTERNAL_HF_HELDOUT_FILE);
  const externalHfDevRerun = readJsonOrNull<ExternalHfReport>(EXTERNAL_HF_DEV_RERUN_FILE);
  return (
    <BenchmarksClient
      initialReport={report}
      initialV2Report={v2Report}
      initialE2eReport={e2eReport}
      initialE2eV2Report={e2eV2Report}
      initialExternalHfReport={externalHfReport}
      initialExternalHfHeldout={externalHfHeldout}
      initialExternalHfDevRerun={externalHfDevRerun}
    />
  );
}
