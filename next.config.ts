import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

function resolveBuildCommit(): string {
  const fromEnv = (
    process.env.KHATACHECK_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    ""
  ).trim();
  if (fromEnv) return fromEnv;
  try {
    const gitHead = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (gitHead) return gitHead;
  } catch {
    // .git may be absent in rsynced server builds
  }
  const markerPath = path.join(process.cwd(), ".deploy-sha");
  if (fs.existsSync(markerPath)) {
    const fromFile = fs.readFileSync(markerPath, "utf8").trim();
    if (fromFile) return fromFile;
  }
  return "unknown";
}

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    KHATACHECK_BUILD_COMMIT: resolveBuildCommit(),
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
