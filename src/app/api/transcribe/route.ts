import { NextRequest, NextResponse } from "next/server";
import { scrubPiiForModelEgress } from "@/lib/dpdp-privacy";
import {
  checkDailyGroqBudget,
  checkRateLimit,
  extractClientIp,
  tryAcquireConcurrency,
  validateAudioMagicBytes,
} from "@/lib/rate-limit";
import { PayloadTooLargeError, readRequestBufferWithLimit } from "@/lib/upload-analyzer";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_AUDIO_BYTES + 64 * 1024;
const WHISPER_MODEL = "whisper-large-v3-turbo";

const EXT_TO_MIME: Readonly<Record<string, string>> = {
  ".webm": "audio/webm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
};

const MIME_TO_EXT: Readonly<Record<string, string>> = {
  "audio/webm": ".webm",
  "video/webm": ".webm",
  "audio/wav": ".wav",
  "audio/wave": ".wav",
  "audio/x-wav": ".wav",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/mp4": ".m4a",
  "audio/m4a": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/ogg": ".ogg",
  "application/ogg": ".ogg",
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
};

const HINGLISH_RETAIL_GLOSSARY_PROMPT =
  "Indian kirana, pharmacy, FMCG, and textile receiving voice note in Hinglish and English. " +
  "Examples: Bhaiya Bill mein 5 kg Toor Dal kum aaya hai, Chana Dal short hai, Red Chilli Powder 2 pkt missing, " +
  "Turmeric Powder 1 pkt damaged, Sugar M-30 rate 42 se 48 badh gaya, Cotton Cambric bhav 120 to 155 ho gaya, " +
  "Paracetamol 3 strip nahi aaya, Amoxicillin HSN 3004, peti, bori, dabba, carton, box, kg, ltr, pkt, mtr, GSTIN, challan.";

function resolveAudioMeta(
  filename: string,
  mimeType: string
): { safeName: string; safeMime: string; ext: string } | null {
  const lowerName = (filename || "").toLowerCase().trim();
  const baseMime = (mimeType || "").toLowerCase().split(";")[0].trim();

  for (const [ext, canonicalMime] of Object.entries(EXT_TO_MIME)) {
    if (lowerName.endsWith(ext)) {
      return {
        safeName: `voice_note${ext}`,
        safeMime: canonicalMime,
        ext,
      };
    }
  }

  if (baseMime && Object.hasOwn(MIME_TO_EXT, baseMime)) {
    const ext = MIME_TO_EXT[baseMime];
    return {
      safeName: `voice_note${ext}`,
      safeMime: EXT_TO_MIME[ext],
      ext,
    };
  }

  return null;
}

export async function POST(req: NextRequest) {
  const ip = extractClientIp(req);
  const rl = checkRateLimit(`transcribe:${ip}`, 12, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many transcription requests; please wait before retrying." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(rl.retryAfterSec),
        },
      }
    );
  }

  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "GROQ_API_KEY is not configured on the server" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const releaseConcurrency = tryAcquireConcurrency("transcribe", 4);
  if (!releaseConcurrency) {
    return NextResponse.json(
      { error: "Transcription queue is busy; please retry shortly." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "2",
        },
      }
    );
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Expected multipart/form-data audio upload" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const rawBuf = await readRequestBufferWithLimit(req, MAX_MULTIPART_BYTES);
    const form = await new Response(new Uint8Array(rawBuf), {
      headers: { "content-type": contentType },
    }).formData();
    const rawFile = form.get("file") ?? form.get("audio");
    if (!(rawFile instanceof File)) {
      return NextResponse.json(
        { error: "Missing multipart audio file field ('file' or 'audio')" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (rawFile.size === 0) {
      return NextResponse.json(
        { error: "Uploaded audio file is empty" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (rawFile.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: "Audio clip exceeds 10 MiB limit" },
        { status: 413, headers: { "Cache-Control": "no-store" } }
      );
    }

    const audioMeta = resolveAudioMeta(rawFile.name, rawFile.type);
    if (!audioMeta) {
      return NextResponse.json(
        { error: "Unsupported audio format. Allowed: .webm, .wav, .mp3, .m4a, .ogg, .flac" },
        { status: 415, headers: { "Cache-Control": "no-store" } }
      );
    }

    const buf = Buffer.from(await rawFile.arrayBuffer());
    const magicCheck = validateAudioMagicBytes(buf, audioMeta.ext);
    if (!magicCheck.valid) {
      return NextResponse.json(
        { error: magicCheck.reason || "Invalid audio file signature" },
        { status: 415, headers: { "Cache-Control": "no-store" } }
      );
    }

    const budget = checkDailyGroqBudget();
    if (!budget.allowed) {
      return NextResponse.json(
        {
          error: "Daily voice transcription demo quota reached; paste or edit the transcript manually.",
          limit: budget.limit,
          resetAtIso: budget.resetAtIso,
        },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": "3600",
          },
        }
      );
    }

    const groqForm = new FormData();
    groqForm.append("file", new File([buf], audioMeta.safeName, { type: audioMeta.safeMime }));
    groqForm.append("model", WHISPER_MODEL);
    groqForm.append("response_format", "verbose_json");
    groqForm.append("temperature", "0");
    groqForm.append("prompt", HINGLISH_RETAIL_GLOSSARY_PROMPT);

    const startNs = process.hrtime.bigint();
    const groqResp = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: groqForm,
      signal: AbortSignal.timeout(20000),
    });
    const asrLatencyMs = Number((Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(1));

    if (!groqResp.ok) {
      return NextResponse.json(
        { error: `Upstream ASR transcription failed with HTTP ${groqResp.status}` },
        { status: 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    const groqData = (await groqResp.json()) as {
      text?: string;
      duration?: number;
    };
    const rawTranscript = String(groqData.text ?? "").trim();
    const durationSec =
      typeof groqData.duration === "number" && Number.isFinite(groqData.duration)
        ? Number(groqData.duration.toFixed(2))
        : null;

    const scrub = scrubPiiForModelEgress(rawTranscript);

    return NextResponse.json(
      {
        transcript: scrub.scrubbedText,
        scrubbedTranscript: scrub.scrubbedText,
        redactionCount: scrub.redactionCount,
        redactedKinds: scrub.redactedKinds,
        durationSec,
        asrLatencyMs,
        model: WHISPER_MODEL,
        audioEgressDisclosed: true,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return NextResponse.json(
        { error: "Request payload exceeds 10 MiB limit" },
        { status: 413, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return NextResponse.json(
        { error: "Upstream ASR transcription timed out" },
        { status: 504, headers: { "Cache-Control": "no-store" } }
      );
    }
    const errId = `tr_${Date.now().toString(36)}`;
    console.error(`[transcribe:${errId}]`, err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json(
      { error: "Audio transcription failed", errorId: errId },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  } finally {
    releaseConcurrency();
  }
}
