import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { runFullBenchmarkSuite } from "@/lib/benchmark-runner";
import type { BenchmarkReport, E2eOcrAsrReport, ExternalHfReport } from "@/lib/types";

const DATA_FILE = path.join(process.cwd(), "src", "data", "benchmark-results.json");
const E2E_FILE = path.join(process.cwd(), "src", "data", "e2e-ocr-asr-results.json");
const EXTERNAL_HF_FILE = path.join(process.cwd(), "src", "data", "external-hf-results.json");

function readJsonOrNull<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export async function GET() {
  const baseReport: BenchmarkReport = fs.existsSync(DATA_FILE)
    ? (JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as BenchmarkReport)
    : runFullBenchmarkSuite({ writeDisk: false });
  const e2eOcrAsr = readJsonOrNull<E2eOcrAsrReport>(E2E_FILE);
  const externalHf = readJsonOrNull<ExternalHfReport>(EXTERNAL_HF_FILE);
  return NextResponse.json(
    {
      ...baseReport,
      ...(e2eOcrAsr ? { e2eOcrAsr } : {}),
      ...(externalHf ? { externalHf } : {}),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST() {
  const start = Date.now();
  const report = runFullBenchmarkSuite({ writeDisk: false });
  const totalElapsedMs = Date.now() - start;
  const e2eOcrAsr = readJsonOrNull<E2eOcrAsrReport>(E2E_FILE);
  const externalHf = readJsonOrNull<ExternalHfReport>(EXTERNAL_HF_FILE);
  return NextResponse.json(
    { totalElapsedMs, report, e2eOcrAsr, externalHf },
    { headers: { "Cache-Control": "no-store" } }
  );
}
