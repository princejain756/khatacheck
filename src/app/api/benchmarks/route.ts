import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { runFullBenchmarkSuite } from "@/lib/benchmark-runner";
import type { BenchmarkReport, E2eOcrAsrReport } from "@/lib/types";

const DATA_FILE = path.join(process.cwd(), "src", "data", "benchmark-results.json");
const E2E_FILE = path.join(process.cwd(), "src", "data", "e2e-ocr-asr-results.json");

function readE2eReport(): E2eOcrAsrReport | null {
  if (!fs.existsSync(E2E_FILE)) return null;
  return JSON.parse(fs.readFileSync(E2E_FILE, "utf8")) as E2eOcrAsrReport;
}

export async function GET() {
  const baseReport: BenchmarkReport = fs.existsSync(DATA_FILE)
    ? (JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as BenchmarkReport)
    : runFullBenchmarkSuite({ writeDisk: false });
  const e2eOcrAsr = readE2eReport();
  return NextResponse.json(
    { ...baseReport, ...(e2eOcrAsr ? { e2eOcrAsr } : {}) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST() {
  const start = Date.now();
  const report = runFullBenchmarkSuite({ writeDisk: false });
  const totalElapsedMs = Date.now() - start;
  const e2eOcrAsr = readE2eReport();
  return NextResponse.json(
    { totalElapsedMs, report, e2eOcrAsr },
    { headers: { "Cache-Control": "no-store" } }
  );
}
