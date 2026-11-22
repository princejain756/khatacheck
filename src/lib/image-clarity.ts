import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import os from "node:os";

export type ClarityMethod = "python_pil_laplacian_3x3" | "byte_entropy_fallback";
export type AllowedImageFormat = "PNG" | "JPEG" | "WEBP";

export interface ImageClarityResult {
  clarityScore: number;
  clarityMethod: ClarityMethod;
  laplacianVariance: number | null;
  width: number | null;
  height: number | null;
  latencyMs: number;
}

export function sniffAllowedImageFormat(buf: Buffer): AllowedImageFormat | null {
  if (!buf || buf.length < 12) {
    if (buf && buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return "JPEG";
    }
    return null;
  }
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "PNG";
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "JPEG";
  }
  if (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "WEBP";
  }
  return null;
}

const PYTHON_CANDIDATES = [
  process.env.KHATACHECK_PYTHON_BIN,
  "/opt/homebrew/opt/python@3.13/libexec/bin/python3",
  "/opt/homebrew/bin/python3",
  "/usr/local/bin/python3",
  "/usr/bin/python3",
  "python3",
].filter((p): p is string => Boolean(p && p.trim()));

let cachedPythonBin: string | null = null;

const PIL_LAPLACIAN_SCRIPT = [
  "import io, json, math, sys, warnings",
  "try:",
  "    from PIL import Image, UnidentifiedImageError",
  "except Exception as exc:",
  '    sys.stderr.write("PIL_IMPORT_ERROR:" + str(exc))',
  "    sys.exit(42)",
  "Image.MAX_IMAGE_PIXELS = 25_000_000",
  'DecompressionBombError = getattr(Image, "DecompressionBombError", ValueError)',
  'DecompressionBombWarning = getattr(Image, "DecompressionBombWarning", Warning)',
  'warnings.simplefilter("ignore", DecompressionBombWarning)',
  "data = sys.stdin.buffer.read()",
  "if not data:",
  '    print(json.dumps({"variance": 0.0, "score": 0, "width": 0, "height": 0}))',
  "    sys.exit(0)",
  "try:",
  '    with Image.open(io.BytesIO(data), formats=["PNG", "JPEG", "WEBP"]) as im:',
  '        if im.format not in ("PNG", "JPEG", "WEBP"):',
  '            raise UnidentifiedImageError("Unsupported format")',
  "        orig_w, orig_h = im.size",
  "        if orig_w * orig_h > 25_000_000:",
  '            raise DecompressionBombError("Image pixel dimensions exceed 25MP limit")',
  "        im.load()",
  '        g = im.convert("L")',
  "    max_dim = 1024",
  "    w, h = g.size",
  "    if max(w, h) > max_dim:",
  "        scale = max_dim / max(w, h)",
  '        resampling = getattr(Image, "Resampling", Image)',
  "        g = g.resize((max(8, int(w * scale)), max(8, int(h * scale))), resampling.BILINEAR)",
  "    rw, rh = g.size",
  "    if rw < 3 or rh < 3:",
  '        print(json.dumps({"variance": 0.0, "score": 0, "width": orig_w, "height": orig_h}))',
  "        sys.exit(0)",
  "    raw = g.tobytes()",
  "except (UnidentifiedImageError, DecompressionBombError, OSError, ValueError, MemoryError):",
  '    print(json.dumps({"variance": 0.0, "score": 0, "width": 0, "height": 0, "invalid": True}))',
  "    sys.exit(0)",
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
  status: "ok" | "missing" | "timeout" | "crash";
  variance: number;
  score: number;
  width: number;
  height: number;
}> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (val: {
      status: "ok" | "missing" | "timeout" | "crash";
      variance: number;
      score: number;
      width: number;
      height: number;
    }) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(pythonBin, ["-I", "-c", PIL_LAPLACIAN_SCRIPT], {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: os.tmpdir(),
        env: {
          NODE_ENV: process.env.NODE_ENV ?? "production",
          PATH: process.env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
          LANG: "C.UTF-8",
          LC_ALL: "C.UTF-8",
        },
      });
    } catch {
      done({ status: "missing", variance: 0, score: 0, width: 0, height: 0 });
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore kill failures
      }
      done({ status: "timeout", variance: 0, score: 0, width: 0, height: 0 });
    }, timeoutMs);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
    child.stdin.on("error", () => {
      // Child exited before consuming all bytes
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      done({
        status: err?.code === "ENOENT" ? "missing" : "crash",
        variance: 0,
        score: 0,
        width: 0,
        height: 0,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const err = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (code === 42 || err.includes("PIL_IMPORT_ERROR")) {
        done({ status: "missing", variance: 0, score: 0, width: 0, height: 0 });
        return;
      }
      if (code !== 0 || !out) {
        done({ status: "crash", variance: 0, score: 0, width: 0, height: 0 });
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
          status: "ok",
          variance: Number(parsed.variance ?? 0),
          score: Math.max(0, Math.min(255, Math.round(Number(parsed.score ?? 0)))),
          width: Number(parsed.width ?? 0),
          height: Number(parsed.height ?? 0),
        });
      } catch {
        done({ status: "crash", variance: 0, score: 0, width: 0, height: 0 });
      }
    });

    child.stdin.end(buf);
  });
}

/**
 * Scores image sharpness from 0 to 255 using a 3x3 grayscale Laplacian variance
 * via python3 + Pillow, failing closed on disallowed magic bytes, crash, or timeout,
 * and falling back to byte entropy only when python3/PIL is absent.
 */
export async function scoreImageClarity(
  buf: Buffer,
  options?: { forceFallback?: boolean; pythonBins?: string[]; timeoutMs?: number }
): Promise<ImageClarityResult> {
  const startNs = process.hrtime.bigint();

  if (!sniffAllowedImageFormat(buf)) {
    const latencyMs = Number((Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(2));
    return {
      clarityScore: 0,
      clarityMethod: "python_pil_laplacian_3x3",
      laplacianVariance: null,
      width: null,
      height: null,
      latencyMs,
    };
  }

  if (!options?.forceFallback) {
    const candidates = options?.pythonBins
      ? options.pythonBins
      : cachedPythonBin
        ? [cachedPythonBin, ...PYTHON_CANDIDATES.filter((b) => b !== cachedPythonBin)]
        : PYTHON_CANDIDATES;
    let sawTerminalFailure = false;

    for (const pyBin of candidates) {
      const res = await runPythonLaplacian(pyBin, buf, options?.timeoutMs ?? 5000);
      if (res.status === "ok") {
        if (!options?.pythonBins) {
          cachedPythonBin = pyBin;
        }
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
      if (res.status === "missing") {
        if (pyBin === cachedPythonBin) cachedPythonBin = null;
        continue;
      }
      sawTerminalFailure = true;
      break;
    }

    if (sawTerminalFailure) {
      const latencyMs = Number((Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(2));
      return {
        clarityScore: 0,
        clarityMethod: "python_pil_laplacian_3x3",
        laplacianVariance: null,
        width: null,
        height: null,
        latencyMs,
      };
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
