import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, extractClientIp } from "@/lib/rate-limit";
import type { BenchmarkReport, E2eOcrAsrReport, ExternalHfReport } from "@/lib/types";

const DATA_FILE = path.join(process.cwd(), "src", "data", "benchmark-results.json");
const DATA_V2_FILE = path.join(process.cwd(), "src", "data", "benchmark-results-v2.json");
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

function loadPinnedArtifacts() {
  const baseReport = readJsonOrNull<BenchmarkReport>(DATA_FILE);
  const v2Report = readJsonOrNull<BenchmarkReport>(DATA_V2_FILE);
  const e2eOcrAsr = readJsonOrNull<E2eOcrAsrReport>(E2E_FILE);
  const e2eOcrAsrV2 = readJsonOrNull<E2eOcrAsrReport>(E2E_V2_FILE);
  const externalHf = readJsonOrNull<ExternalHfReport>(EXTERNAL_HF_FILE);
  const externalHfHeldout = readJsonOrNull<ExternalHfReport>(EXTERNAL_HF_HELDOUT_FILE);
  const externalHfDevRerun = readJsonOrNull<ExternalHfReport>(EXTERNAL_HF_DEV_RERUN_FILE);

  return {
    baseReport,
    v2Report,
    e2eOcrAsr,
    e2eOcrAsrV2,
    externalHf,
    externalHfHeldout,
    externalHfDevRerun,
  };
}

export async function GET(req: NextRequest) {
  const ip = extractClientIp(req);
  const rl = checkRateLimit(`benchmarks:${ip}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many benchmark read requests; please wait briefly." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(rl.retryAfterSec),
        },
      }
    );
  }

  const artifacts = loadPinnedArtifacts();
  if (!artifacts.baseReport) {
    return NextResponse.json(
      { error: "Pinned benchmark report not found" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    {
      ...artifacts.baseReport,
      ...(artifacts.v2Report ? { v2Report: artifacts.v2Report } : {}),
      ...(artifacts.e2eOcrAsr ? { e2eOcrAsr: artifacts.e2eOcrAsr } : {}),
      ...(artifacts.e2eOcrAsrV2 ? { e2eOcrAsrV2: artifacts.e2eOcrAsrV2 } : {}),
      ...(artifacts.externalHf ? { externalHf: artifacts.externalHf } : {}),
      ...(artifacts.externalHfHeldout ? { externalHfHeldout: artifacts.externalHfHeldout } : {}),
      ...(artifacts.externalHfDevRerun ? { externalHfDevRerun: artifacts.externalHfDevRerun } : {}),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  const ip = extractClientIp(req);
  const rl = checkRateLimit(`benchmarks:${ip}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many benchmark requests; please wait briefly." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(rl.retryAfterSec),
        },
      }
    );
  }

  const artifacts = loadPinnedArtifacts();
  if (!artifacts.baseReport) {
    return NextResponse.json(
      { error: "Pinned benchmark report not found" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    {
      cached: true,
      totalElapsedMs: 0,
      report: artifacts.baseReport,
      ...(artifacts.v2Report ? { v2Report: artifacts.v2Report } : {}),
      e2eOcrAsr: artifacts.e2eOcrAsr,
      ...(artifacts.e2eOcrAsrV2 ? { e2eOcrAsrV2: artifacts.e2eOcrAsrV2 } : {}),
      externalHf: artifacts.externalHf,
      ...(artifacts.externalHfHeldout ? { externalHfHeldout: artifacts.externalHfHeldout } : {}),
      ...(artifacts.externalHfDevRerun ? { externalHfDevRerun: artifacts.externalHfDevRerun } : {}),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
