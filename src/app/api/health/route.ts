import { NextResponse } from "next/server";
import { ORACLE_PROFILE_LABEL, RULE_BUNDLE_VERSION } from "@/lib/gst-rules";

export async function GET() {
  const commit = (
    process.env.KHATACHECK_COMMIT_SHA ||
    process.env.KHATACHECK_BUILD_COMMIT ||
    "unknown"
  ).trim();
  return NextResponse.json(
    {
      ok: true,
      service: "khatacheck",
      commit,
      ruleBundleVersion: RULE_BUNDLE_VERSION,
      oracleProfile: ORACLE_PROFILE_LABEL,
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
