interface TokenBucket {
  tokens: number;
  lastRefillMs: number;
}

interface DailyCounter {
  utcDay: string;
  used: number;
}

interface GlobalRateState {
  buckets: Map<string, TokenBucket>;
  groqDaily: DailyCounter;
  inflight: Map<string, number>;
}

const DEFAULT_DAILY_GROQ_LIMIT = 200;

function getRateState(): GlobalRateState {
  const g = globalThis as unknown as { __khataCheckRateState?: GlobalRateState };
  if (!g.__khataCheckRateState) {
    g.__khataCheckRateState = {
      buckets: new Map(),
      groqDaily: { utcDay: new Date().toISOString().slice(0, 10), used: 0 },
      inflight: new Map(),
    };
  }
  return g.__khataCheckRateState;
}

export function extractClientIp(req: { headers: Headers }): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }
  return "local";
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs = 60_000
): {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  limit: number;
} {
  const state = getRateState();
  const now = Date.now();
  const safeLimit = Math.max(1, Math.floor(limit));
  const safeWindow = Math.max(1000, Math.floor(windowMs));
  const refillPerMs = safeLimit / safeWindow;

  if (state.buckets.size > 2000) {
    for (const [k, b] of state.buckets.entries()) {
      if (now - b.lastRefillMs > safeWindow * 2) {
        state.buckets.delete(k);
      }
    }
  }

  const existing = state.buckets.get(key);
  const bucket: TokenBucket = existing
    ? {
        tokens: Math.min(safeLimit, existing.tokens + Math.max(0, now - existing.lastRefillMs) * refillPerMs),
        lastRefillMs: now,
      }
    : { tokens: safeLimit, lastRefillMs: now };

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    state.buckets.set(key, bucket);
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      retryAfterSec: 0,
      limit: safeLimit,
    };
  }

  state.buckets.set(key, bucket);
  const deficit = 1 - bucket.tokens;
  const retryAfterSec = Math.max(1, Math.ceil(deficit / refillPerMs / 1000));
  return {
    allowed: false,
    remaining: 0,
    retryAfterSec,
    limit: safeLimit,
  };
}

export function checkDailyGroqBudget(
  dailyLimit?: number,
  options: { consume?: boolean } = {}
): {
  allowed: boolean;
  used: number;
  remaining: number;
  limit: number;
  resetAtIso: string;
} {
  const envLimit = Number(process.env.KHATACHECK_DAILY_GROQ_LIMIT);
  const limit =
    typeof dailyLimit === "number" && Number.isFinite(dailyLimit) && dailyLimit >= 1
      ? Math.floor(dailyLimit)
      : Number.isFinite(envLimit) && envLimit >= 1
        ? Math.floor(envLimit)
        : DEFAULT_DAILY_GROQ_LIMIT;

  const state = getRateState();
  const today = new Date().toISOString().slice(0, 10);
  if (state.groqDaily.utcDay !== today) {
    state.groqDaily = { utcDay: today, used: 0 };
  }

  const resetDate = new Date(`${today}T00:00:00.000Z`);
  resetDate.setUTCDate(resetDate.getUTCDate() + 1);
  const resetAtIso = resetDate.toISOString();

  if (state.groqDaily.used >= limit) {
    return {
      allowed: false,
      used: state.groqDaily.used,
      remaining: 0,
      limit,
      resetAtIso,
    };
  }

  if (options.consume !== false) {
    state.groqDaily.used += 1;
  }

  return {
    allowed: true,
    used: state.groqDaily.used,
    remaining: Math.max(0, limit - state.groqDaily.used),
    limit,
    resetAtIso,
  };
}

export function tryAcquireConcurrency(bucket: string, maxConcurrent: number): (() => void) | null {
  const state = getRateState();
  const active = state.inflight.get(bucket) ?? 0;
  if (active >= Math.max(1, maxConcurrent)) {
    return null;
  }
  state.inflight.set(bucket, active + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = state.inflight.get(bucket) ?? 0;
    if (current <= 1) {
      state.inflight.delete(bucket);
    } else {
      state.inflight.set(bucket, current - 1);
    }
  };
}

export function validateAudioMagicBytes(
  buf: Buffer,
  ext: string
): { valid: boolean; reason?: string } {
  const normalizedExt = ext.toLowerCase().trim().replace(/^\./, "");
  if (!buf || buf.length < 4) {
    return { valid: false, reason: "Audio buffer is too short to verify file signature" };
  }

  switch (normalizedExt) {
    case "mp3": {
      const hasId3 = buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33;
      const hasMpegLayer3Sync = buf[0] === 0xff && (buf[1] & 0xe6) === 0xe2;
      return hasId3 || hasMpegLayer3Sync
        ? { valid: true }
        : { valid: false, reason: "Invalid MP3 magic bytes (expected ID3 or MPEG Layer III sync)" };
    }
    case "ogg":
      return buf.toString("ascii", 0, 4) === "OggS"
        ? { valid: true }
        : { valid: false, reason: "Invalid OGG magic bytes (expected OggS)" };
    case "wav":
      return buf.length >= 12 &&
        buf.toString("ascii", 0, 4) === "RIFF" &&
        buf.toString("ascii", 8, 12) === "WAVE"
        ? { valid: true }
        : { valid: false, reason: "Invalid WAV magic bytes (expected RIFF/WAVE)" };
    case "flac":
      return buf.toString("ascii", 0, 4) === "fLaC"
        ? { valid: true }
        : { valid: false, reason: "Invalid FLAC magic bytes (expected fLaC)" };
    case "m4a":
    case "mp4":
      return buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp"
        ? { valid: true }
        : { valid: false, reason: "Invalid M4A/MP4 magic bytes (expected ISO BMFF ftyp)" };
    case "webm":
      return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3
        ? { valid: true }
        : { valid: false, reason: "Invalid WebM magic bytes (expected EBML 0x1A45DFA3)" };
    default:
      return { valid: false, reason: `Unsupported audio extension '.${normalizedExt}'` };
  }
}

export function validateImageMagicBytes(buf: Buffer): {
  valid: boolean;
  kind?: "png" | "jpeg" | "webp";
  reason?: string;
} {
  if (!buf || buf.length < 12) {
    return { valid: false, reason: "Image file is truncated or missing magic header" };
  }

  const isPng =
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a;
  if (isPng) return { valid: true, kind: "png" };

  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (isJpeg) return { valid: true, kind: "jpeg" };

  const isWebp = buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP";
  if (isWebp) return { valid: true, kind: "webp" };

  return {
    valid: false,
    reason: "Unsupported or mismatched image file signature (only PNG, JPEG, and WebP allowed)",
  };
}
