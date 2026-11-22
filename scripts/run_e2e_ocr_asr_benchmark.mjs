import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_BASE_URL = "https://khatacheck.prince.sh";
const MANIFEST_PATH = path.join(
  process.cwd(),
  "benchmark",
  "e2e_fixtures",
  "manifest.json"
);
const OUT_SRC_PATH = path.join(process.cwd(), "src", "data", "e2e-ocr-asr-results.json");
const DEFAULT_STAGE4_OUT_PATH =
  "/Users/admin/Github/unstop-hackathons/neuraviz-2026/stage4/e2e_ocr_asr_results.json";
const OUT_STAGE4_PATH = process.env.STAGE4_OUT_PATH || DEFAULT_STAGE4_OUT_PATH;

function resolveRepoPath(relOrAbsPath) {
  return path.isAbsolute(relOrAbsPath)
    ? relOrAbsPath
    : path.resolve(process.cwd(), relOrAbsPath);
}

async function resolveTargetCodeCommit(baseUrl) {
  const isLocalhost = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(baseUrl);
  try {
    const resp = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
    if (resp.ok) {
      const data = await resp.json();
      if (typeof data.commit === "string") {
        const commit = data.commit.trim();
        if (commit && commit.toLowerCase() !== "unknown") {
          return commit;
        }
      }
    }
  } catch (err) {
    if (!isLocalhost) {
      throw new Error(
        `Remote /api/health lookup failed for ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    // Fall back to local git HEAD only on localhost runs when /api/health is unavailable
  }
  if (!isLocalhost) {
    throw new Error(`Remote ${baseUrl}/api/health did not return a valid commit SHA`);
  }
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function nearestRankQuantile(values, q) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1));
  return Number(sorted[idx].toFixed(1));
}

function pct(num, den) {
  if (den <= 0) return 0;
  return Math.round((num / den) * 1000) / 10;
}

async function runImageCase(baseUrl, item) {
  const buf = fs.readFileSync(resolveRepoPath(item.imagePath));
  const lower = item.filename.toLowerCase();
  const mime =
    lower.endsWith(".jpg") || lower.endsWith(".jpeg")
      ? "image/jpeg"
      : lower.endsWith(".webp")
        ? "image/webp"
        : "image/png";
  const form = new FormData();
  form.append("file", new File([buf], item.filename, { type: mime }));
  form.append("enablePiiScrub", "true");

  const t0 = performance.now();
  const resp = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    body: form,
  });
  const data = await resp.json();
  const wallClockMs = Number((performance.now() - t0).toFixed(1));

  if (!resp.ok) {
    throw new Error(`Analyze failed for ${item.caseId} (HTTP ${resp.status}): ${data.error || "unknown"}`);
  }

  const verification = data.verification || {};
  const invoice = data.invoice || {};
  const ocrMeta = data.ocrMeta || {};
  const detectedCategories = Array.isArray(verification.faults)
    ? verification.faults.map((f) => f.category)
    : [];
  const extractedLines = Array.isArray(invoice.lines) ? invoice.lines.length : 0;
  const abstainedClarity = Boolean(verification.abstainedClarity);

  let faultDetectionPassed = false;
  const expectedSet = [...new Set(item.expectedFaultCategories)].sort();
  const detectedSet = [...new Set(detectedCategories)].sort();
  if (!item.expectedClarityPass) {
    faultDetectionPassed = abstainedClarity && detectedSet.includes("clarity_abstain");
  } else {
    faultDetectionPassed =
      expectedSet.length === detectedSet.length &&
      expectedSet.every((c, idx) => detectedSet[idx] === c);
  }

  const abstentionPassed = item.expectedClarityPass
    ? !abstainedClarity && Number(ocrMeta.clarityScore ?? invoice.clarityScore ?? 0) >= 85
    : abstainedClarity && data.extractKind === "image_clarity_abstained";

  return {
    caseId: item.caseId,
    filename: item.filename,
    merchandiseGroup: item.merchandiseGroup,
    kind: item.kind,
    expectedClarityPass: item.expectedClarityPass,
    expectedFaultCategories: item.expectedFaultCategories,
    httpStatus: resp.status,
    extractKind: String(data.extractKind || ""),
    clarityScore: Number(ocrMeta.clarityScore ?? invoice.clarityScore ?? 0),
    clarityMethod: String(ocrMeta.clarityMethod || "unknown"),
    ocrEngine: String(ocrMeta.engine || "unknown"),
    usedLlmStructurer: Boolean(ocrMeta.usedLlmStructurer),
    ocrLatencyMs: Number(ocrMeta.ocrLatencyMs ?? 0),
    wallClockMs,
    expectedLineCount: item.expectedLineCount,
    extractedLineCount: abstainedClarity ? 0 : extractedLines,
    vendorGstinExtracted: String(invoice.vendorGstin || ""),
    vendorGstinMatched: item.expectedClarityPass
      ? String(invoice.vendorGstin || "") === item.expectedVendorGstin
      : null,
    expectedGrandTotalPaise: item.expectedGrandTotalPaise,
    extractedGrandTotalPaise: String(invoice.declaredGrandTotalPaise || "0"),
    grandTotalMatched: item.expectedClarityPass
      ? String(invoice.declaredGrandTotalPaise || "0") === item.expectedGrandTotalPaise
      : null,
    detectedCategories,
    faultDetectionPassed,
    abstainedClarity,
    abstentionPassed,
  };
}

async function runAudioCase(baseUrl, item) {
  const buf = fs.readFileSync(resolveRepoPath(item.audioPath));
  const form = new FormData();
  form.append("file", new File([buf], item.filename, { type: "audio/mpeg" }));

  const t0 = performance.now();
  const asrResp = await fetch(`${baseUrl}/api/transcribe`, {
    method: "POST",
    body: form,
  });
  const asrData = await asrResp.json();
  const asrWallClockMs = Number((performance.now() - t0).toFixed(1));

  if (!asrResp.ok) {
    throw new Error(`Transcribe failed for ${item.caseId} (HTTP ${asrResp.status}): ${asrData.error || "unknown"}`);
  }

  const t1 = performance.now();
  const analyzeResp = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scenarioId: item.scenarioId,
      voiceTranscript: asrData.transcript || "",
      enablePiiScrub: true,
    }),
  });
  const analyzeData = await analyzeResp.json();
  const analyzeWallClockMs = Number((performance.now() - t1).toFixed(1));
  const totalWallClockMs = Number((performance.now() - t0).toFixed(1));

  if (!analyzeResp.ok) {
    throw new Error(
      `Analyze voice failed for ${item.caseId} (HTTP ${analyzeResp.status}): ${analyzeData.error || "unknown"}`
    );
  }

  const verification = analyzeData.verification || {};
  const matches = Array.isArray(verification.voiceMatches) ? verification.voiceMatches : [];
  const primaryHit =
    matches.find((m) => m.kind === "shortage" || m.kind === "rate_jump") || matches[0] || null;
  const totalRedactions = Math.max(
    Number(asrData.redactionCount ?? 0),
    Number(verification.dpdpRedactionCount ?? 0)
  );
  const hasUnmatchedManual = matches.some((m) => m.kind === "unmatched_manual");
  const invoiceLines = Array.isArray(analyzeData.invoice?.lines) ? analyzeData.invoice.lines : [];
  const matchedInvoiceLine = item.expectedSku
    ? invoiceLines.find((l) => l.sku === item.expectedSku) || null
    : null;
  const expectedUnitOk =
    !item.expectedUnit ||
    (matchedInvoiceLine !== null &&
      String(matchedInvoiceLine.unit || "").trim().toLowerCase() ===
        String(item.expectedUnit).trim().toLowerCase());

  let matchedExpectation = false;
  if (item.expectedShortageKind === "none") {
    matchedExpectation =
      matches.length === 0 && Number(asrData.redactionCount ?? 0) >= item.expectedRedactionCount;
  } else if (item.expectedShortageKind === "shortage") {
    matchedExpectation =
      !hasUnmatchedManual &&
      expectedUnitOk &&
      matches.some(
        (m) =>
          m.kind === "shortage" &&
          m.sku === item.expectedSku &&
          Number(m.shortageQty) === item.expectedQty &&
          BigInt(String(m.variancePaise || "0")) > 0n
      ) &&
      Number(asrData.redactionCount ?? 0) >= item.expectedRedactionCount;
  } else if (item.expectedShortageKind === "rate_jump") {
    matchedExpectation =
      !hasUnmatchedManual &&
      matches.some(
        (m) =>
          m.kind === "rate_jump" &&
          m.sku === item.expectedSku &&
          BigInt(String(m.variancePaise || "0")) > 0n
      );
  }

  const scrubbedTranscript = String(asrData.scrubbedTranscript || "");
  if (/(?:98927|ramesh\.sharma)/i.test(scrubbedTranscript)) {
    throw new Error(`Scrubbed ASR transcript for ${item.caseId} still contains raw PII`);
  }

  return {
    caseId: item.caseId,
    filename: item.filename,
    scenarioId: item.scenarioId,
    durationSec: asrData.durationSec ?? null,
    asrHttpStatus: asrResp.status,
    analyzeHttpStatus: analyzeResp.status,
    asrModel: String(asrData.model || "whisper-large-v3-turbo"),
    asrLatencyMs: Number(asrData.asrLatencyMs ?? asrWallClockMs),
    analyzeWallClockMs,
    totalWallClockMs,
    transcript: scrubbedTranscript,
    scrubbedTranscript,
    redactionCount: Number(asrData.redactionCount ?? 0),
    redactedKinds: Array.isArray(asrData.redactedKinds) ? asrData.redactedKinds : [],
    expectedShortageKind: item.expectedShortageKind,
    expectedSku: item.expectedSku,
    expectedQty: item.expectedQty,
    expectedRedactionCount: item.expectedRedactionCount,
    detectedShortageKind: primaryHit ? String(primaryHit.kind) : "none",
    detectedSku: primaryHit ? (primaryHit.sku ?? null) : null,
    detectedQty: primaryHit ? Number(primaryHit.shortageQty ?? 0) : 0,
    detectedVariancePaise: primaryHit ? String(primaryHit.variancePaise ?? "0") : "0",
    matchedExpectation,
    totalVerifyRedactions: totalRedactions,
  };
}

async function main() {
  const baseUrl = (process.env.KHATACHECK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing E2E manifest at ${MANIFEST_PATH}`);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const targetCodeCommit = await resolveTargetCodeCommit(baseUrl);

  console.log(`Running live E2E OCR + ASR benchmark against ${baseUrl} (commit ${targetCodeCommit}) ...`);
  const imageResults = [];
  for (const item of manifest.images) {
    const res = await runImageCase(baseUrl, item);
    imageResults.push(res);
    console.log(
      `[IMG] ${res.caseId} | clarity=${res.clarityScore} | engine=${res.ocrEngine} | lines=${res.extractedLineCount}/${res.expectedLineCount} | wall=${res.wallClockMs}ms | ok=${res.expectedClarityPass ? res.faultDetectionPassed : res.abstentionPassed}`
    );
  }

  const audioResults = [];
  for (const item of manifest.audio) {
    const res = await runAudioCase(baseUrl, item);
    audioResults.push(res);
    console.log(
      `[ASR] ${res.caseId} | model=${res.asrModel} | asr=${res.asrLatencyMs}ms | total=${res.totalWallClockMs}ms | redactions=${res.redactionCount} | match=${res.matchedExpectation}`
    );
  }

  const sharpImages = imageResults.filter((r) => r.expectedClarityPass);
  const crispGenerated = imageResults.filter((r) => r.kind === "crisp_generated");
  const realPhotos = imageResults.filter((r) => r.kind === "real_photo");
  const blurryImages = imageResults.filter((r) => !r.expectedClarityPass);

  const sharpPassed = sharpImages.filter((r) => r.abstentionPassed).length;
  const blurryPassed = blurryImages.filter((r) => r.abstentionPassed).length;
  const gstinMatched = sharpImages.filter((r) => r.vendorGstinMatched).length;
  const expectedLinesSum = sharpImages.reduce((acc, r) => acc + r.expectedLineCount, 0);
  const extractedLinesSum = sharpImages.reduce(
    (acc, r) => acc + Math.min(r.extractedLineCount, r.expectedLineCount),
    0
  );
  const grandTotalMatched = sharpImages.filter((r) => r.grandTotalMatched).length;
  const faultsPassed = imageResults.filter((r) => r.faultDetectionPassed).length;

  const imgWallLatencies = imageResults.map((r) => r.wallClockMs);
  const imgOcrLatencies = sharpImages.map((r) => r.ocrLatencyMs);
  const enginesObserved = [...new Set(imageResults.map((r) => r.ocrEngine))];

  const targetShortages = audioResults.filter((a) => a.expectedShortageKind !== "none");
  const matchedShortages = targetShortages.filter((a) => a.matchedExpectation).length;
  const negationCases = audioResults.filter((a) => a.expectedShortageKind === "none");
  const negationControlPassed = negationCases.every((a) => a.matchedExpectation);
  const piiCases = audioResults.filter((a) => a.expectedRedactionCount > 0);
  const piiRedactionPassed = piiCases.every((a) => a.redactionCount >= a.expectedRedactionCount);

  const asrLatencies = audioResults.map((a) => a.asrLatencyMs);
  const totalAudioLatencies = audioResults.map((a) => a.totalWallClockMs);

  const report = {
    runId: `KC-E2E-${Date.now()}`,
    executedAtIso: new Date().toISOString(),
    targetBaseUrl: baseUrl,
    targetCodeCommit,
    imageSummary: {
      totalCases: imageResults.length,
      crispGeneratedCases: crispGenerated.length,
      realPhotoCases: realPhotos.length,
      blurryCases: blurryImages.length,
      clarityPassRatePct: pct(sharpPassed, sharpImages.length),
      blurryAbstentionCorrect: blurryPassed,
      blurryAbstentionTotal: blurryImages.length,
      blurryAbstentionRatePct: pct(blurryPassed, blurryImages.length),
      gstinMatchRatePct: pct(gstinMatched, sharpImages.length),
      lineExtractionRecallPct: pct(extractedLinesSum, expectedLinesSum),
      grandTotalExactMatchPct: pct(grandTotalMatched, sharpImages.length),
      faultAccuracyPct: pct(faultsPassed, imageResults.length),
      wallClockP50Ms: nearestRankQuantile(imgWallLatencies, 0.5),
      wallClockP95Ms: nearestRankQuantile(imgWallLatencies, 0.95),
      wallClockMaxMs: nearestRankQuantile(imgWallLatencies, 1.0),
      ocrLatencyP50Ms: nearestRankQuantile(imgOcrLatencies, 0.5),
      ocrLatencyP95Ms: nearestRankQuantile(imgOcrLatencies, 0.95),
      ocrLatencyMaxMs: nearestRankQuantile(imgOcrLatencies, 1.0),
      enginesObserved,
    },
    audioSummary: {
      totalClips: audioResults.length,
      asrModel: audioResults[0]?.asrModel || "whisper-large-v3-turbo",
      shortageAndRateMatchCount: matchedShortages,
      shortageAndRateTotal: targetShortages.length,
      shortageRecallPct: pct(matchedShortages, targetShortages.length),
      negationControlPassed,
      piiRedactionPassed,
      asrLatencyP50Ms: nearestRankQuantile(asrLatencies, 0.5),
      asrLatencyP95Ms: nearestRankQuantile(asrLatencies, 0.95),
      asrLatencyMaxMs: nearestRankQuantile(asrLatencies, 1.0),
      totalE2eP50Ms: nearestRankQuantile(totalAudioLatencies, 0.5),
      totalE2eP95Ms: nearestRankQuantile(totalAudioLatencies, 0.95),
      totalE2eMaxMs: nearestRankQuantile(totalAudioLatencies, 1.0),
    },
    pilotStatus: "NOT_RUN_GATE_5_HOLD",
    imageResults,
    audioResults: audioResults.map((a) => ({
      caseId: a.caseId,
      filename: a.filename,
      scenarioId: a.scenarioId,
      durationSec: a.durationSec,
      asrHttpStatus: a.asrHttpStatus,
      analyzeHttpStatus: a.analyzeHttpStatus,
      asrModel: a.asrModel,
      asrLatencyMs: a.asrLatencyMs,
      analyzeWallClockMs: a.analyzeWallClockMs,
      totalWallClockMs: a.totalWallClockMs,
      transcript: a.scrubbedTranscript,
      scrubbedTranscript: a.scrubbedTranscript,
      redactionCount: a.redactionCount,
      redactedKinds: a.redactedKinds,
      expectedShortageKind: a.expectedShortageKind,
      expectedSku: a.expectedSku,
      expectedQty: a.expectedQty,
      expectedRedactionCount: a.expectedRedactionCount,
      detectedShortageKind: a.detectedShortageKind,
      detectedSku: a.detectedSku,
      detectedQty: a.detectedQty,
      detectedVariancePaise: a.detectedVariancePaise,
      matchedExpectation: a.matchedExpectation,
    })),
  };

  fs.mkdirSync(path.dirname(OUT_SRC_PATH), { recursive: true });
  fs.writeFileSync(OUT_SRC_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log("E2E_BENCHMARK_WRITTEN:", OUT_SRC_PATH);

  const stage4Dir = path.dirname(OUT_STAGE4_PATH);
  if (process.env.STAGE4_OUT_PATH || fs.existsSync(stage4Dir)) {
    fs.mkdirSync(stage4Dir, { recursive: true });
    fs.writeFileSync(OUT_STAGE4_PATH, JSON.stringify(report, null, 2), "utf8");
    console.log("STAGE4_COPY_WRITTEN:", OUT_STAGE4_PATH);
  } else {
    console.log("STAGE4_COPY_SKIPPED: parent directory absent:", stage4Dir);
  }
  console.log("SUMMARY:", JSON.stringify({
    imageSummary: report.imageSummary,
    audioSummary: report.audioSummary,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
