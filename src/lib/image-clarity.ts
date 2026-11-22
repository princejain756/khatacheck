import { spawn } from "node:child_process";

export type ClarityMethod = "python_pil_laplacian_3x3" | "byte_entropy_fallback";

export interface ImageClarityResult {
  clarityScore: number;
  clarityMethod: ClarityMethod;
  laplacianVariance: number | null;
  width: number | null;
  height: number | null;
  latencyMs: number;
}

const PYTHON_CANDIDATES = [
  process.env.KHATACHECK_PYTHON_BIN,
  "/opt/homebrew/opt/python@3.13/libexec/bin/python3",
  "/opt/homebrew/bin/python3",
  "/usr/local/bin/python3",
  "/usr/bin/python3",
  "python3",
].filter((p): p is string => Boolean(p && p.trim()));

const PIL_LAPLACIAN_SCRIPT = [
  "import io, json, math, sys",
  "try:",
  "    from PIL import Image",
  "except Exception as exc:",
  '    sys.stderr.write("PIL_IMPORT_ERROR:" + str(exc))',
  "    sys.exit(42)",
  "Image.MAX_IMAGE_PIXELS = 25_000_000",
  "data = sys.stdin.buffer.read()",
  "if not data:",
  '    print(json.dumps({"variance": 0.0, "score": 0, "width": 0, "height": 0}))',
  "    sys.exit(0)",
  "try:",
  "    with Image.open(io.BytesIO(data)) as im:",
  "        orig_w, orig_h = im.size",
  "        if orig_w * orig_h > 25_000_000:",
  '            raise ValueError("Image pixel dimensions exceed 25MP limit")',
  '        g = im.convert("L")',
  "except Exception:",
  '    print(json.dumps({"variance": 0.0, "score": 0, "width": 0, "height": 0, "invalid": True}))',
  "    sys.exit(0)",
  "max_dim = 1024",
  "w, h = g.size",
  "if max(w, h) > max_dim:",
  "    scale = max_dim / max(w, h)",
  '    resampling = getattr(Image, "Resampling", Image)',
  "    g = g.resize((max(8, int(w * scale)), max(8, int(h * scale))), resampling.BILINEAR)",
  "rw, rh = g.size",
  "if rw < 3 or rh < 3:",
  '    print(json.dumps({"variance": 0.0, "score": 0, "width": orig_w, "height": orig_h}))',
  "    sys.exit(0)",
  "raw = g.tobytes()",
  "total = 0",
  "total_sq = 0",
  "n = (rw - 2) * (rh - 2)",
  "for y in range(1, rh - 1):",
  "    row = y * rw",
  "    up = row - rw",
  "    dn = row + rw",
  "    for x in range(1, rw - 1):",
  "        i = row + x",
  "        v = raw[up + x] + raw[dn + x] + raw[i - 1] + raw[i + 1] - 4 * raw[i]",
  "        total += v",
  "        total_sq += v * v",
  "mean = total / n",
  "var = max(0.0, (total_sq / n) - (mean * mean))",
  "score = int(round(min(255.0, max(0.0, 22.0 * math.log1p(var)))))",
  'print(json.dumps({"variance": round(var, 4), "score": score, "width": orig_w, "height": orig_h}))',
].join("\n");

/**
 * Deterministic byte-entropy + adjacent-byte gradient proxy used ONLY when python3 + Pillow
 * are unavailable in the runtime environment.
 */
export function computeByteEntropyClarity(buf: Buffer): number {
  if (!buf || buf.length < 64) return 0;
  const sampleLen = Math.min(buf.length, 65536);
  const step = Math.max(1, Math.floor(buf.length / sampleLen));
  const counts = new Uint32Array(256);
  let samples = 0;
  let gradSum = 0;
  let prev = buf[0];

  for (let i = 0; i < buf.length; i += step) {
    const b = buf[i];
    counts[b] += 1;
    gradSum += Math.abs(b - prev);
    prev = b;
    samples += 1;
  }

  let entropy = 0;
  for (let i = 0; i < 256; i += 1) {
    if (counts[i] === 0) continue;
    const p = counts[i] / samples;
    entropy -= p * Math.log2(p);
  }

  const avgGrad = samples > 1 ? gradSum / (samples - 1) : 0;
  const sizeFactor = buf.length < 18000 ? 0.45 : buf.length < 30000 ? 0.72 : 1.0;
  const raw = (entropy / 8) * 145 * sizeFactor + Math.min(110, avgGrad * 1.15 * sizeFactor);
  return Math.max(0, Math.min(255, Math.round(raw)));
}

function runPythonLaplacian(
  pythonBin: string,
  buf: Buffer,
  timeoutMs = 5000
): Promise<{
  ok: boolean;
  missingPilOrBin: boolean;
  variance: number;
  score: number;
  width: number;
  height: number;
}> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (val: {
      ok: boolean;
      missingPilOrBin: boolean;
      variance: number;
      score: number;
      width: number;
      height: number;
    }) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    let child;
    try {
      child = spawn(pythonBin, ["-c", PIL_LAPLACIAN_SCRIPT], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      done({ ok: false, missingPilOrBin: true, variance: 0, score: 0, width: 0, height: 0 });
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore kill failures
      }
      done({ ok: false, missingPilOrBin: true, variance: 0, score: 0, width: 0, height: 0 });
    }, timeoutMs);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
    child.stdin.on("error", () => {
      // Child exited before consuming all bytes
    });

    child.on("error", () => {
      clearTimeout(timer);
      done({ ok: false, missingPilOrBin: true, variance: 0, score: 0, width: 0, height: 0 });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const err = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (code === 42 || err.includes("PIL_IMPORT_ERROR")) {
        done({ ok: false, missingPilOrBin: true, variance: 0, score: 0, width: 0, height: 0 });
        return;
      }
      if (code !== 0 || !out) {
        done({ ok: false, missingPilOrBin: true, variance: 0, score: 0, width: 0, height: 0 });
        return;
      }
      try {
        const parsed = JSON.parse(out) as {
          variance?: number;
          score?: number;
          width?: number;
          height?: number;
        };
        done({
          ok: true,
          missingPilOrBin: false,
          variance: Number(parsed.variance ?? 0),
          score: Math.max(0, Math.min(255, Math.round(Number(parsed.score ?? 0)))),
          width: Number(parsed.width ?? 0),
          height: Number(parsed.height ?? 0),
        });
      } catch {
        done({ ok: false, missingPilOrBin: true, variance: 0, score: 0, width: 0, height: 0 });
      }
    });

    child.stdin.end(buf);
  });
}

/**
 * Scores image sharpness from 0 to 255 using a 3x3 grayscale Laplacian variance
 * via python3 + Pillow, falling back to deterministic byte entropy only if python3/PIL is absent.
 */
export async function scoreImageClarity(
  buf: Buffer,
  options?: { forceFallback?: boolean }
): Promise<ImageClarityResult> {
  const startNs = process.hrtime.bigint();

  if (!options?.forceFallback) {
    for (const pyBin of PYTHON_CANDIDATES) {
      const res = await runPythonLaplacian(pyBin, buf);
      if (res.ok) {
        const latencyMs = Number((Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(2));
        return {
          clarityScore: res.score,
          clarityMethod: "python_pil_laplacian_3x3",
          laplacianVariance: res.variance,
          width: res.width || null,
          height: res.height || null,
          latencyMs,
        };
      }
    }
  }

  const fallbackScore = computeByteEntropyClarity(buf);
  const latencyMs = Number((Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(2));
  return {
    clarityScore: fallbackScore,
    clarityMethod: "byte_entropy_fallback",
    laplacianVariance: null,
    width: null,
    height: null,
    latencyMs,
  };
}
