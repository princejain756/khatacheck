import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { runFullBenchmarkSuite } from "@/lib/benchmark-runner";

const DATA_FILE = path.join(process.cwd(), "src", "data", "benchmark-results.json");

export async function GET() {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return NextResponse.json(JSON.parse(raw), { headers: { "Cache-Control": "no-store" } });
  }
  const fresh = runFullBenchmarkSuite({ writeDisk: false });
  return NextResponse.json(fresh, { headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  const start = Date.now();
  const report = runFullBenchmarkSuite({ writeDisk: false });
  const totalElapsedMs = Date.now() - start;
  return NextResponse.json(
    { totalElapsedMs, report },
    { headers: { "Cache-Control": "no-store" } }
  );
}
