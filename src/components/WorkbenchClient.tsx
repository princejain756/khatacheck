"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileAudio,
  FileText,
  Lock,
  Mic,
  ScanText,
  ShieldAlert,
  ShieldCheck,
  Square,
  Upload,
} from "lucide-react";
import {
  FAULT_TYPE_LABELS,
  SEVERITY_LABELS,
  SUBGROUP_LABELS,
  labelFor,
} from "@/lib/display-labels";
import { countLabel, formatPaiseINR } from "@/lib/money";
import type { DemoScenario } from "@/lib/bill-scenarios";
import type { InvoiceInput, OcrMeta, TranscribeResult, VerificationResult } from "@/lib/types";

interface Props {
  scenarios: DemoScenario[];
  initialScenarioId: string;
  initialInvoice: InvoiceInput;
  initialResult: VerificationResult;
  initialApprovedIds: string[];
}

export function WorkbenchClient({
  scenarios,
  initialScenarioId,
  initialInvoice,
  initialResult,
  initialApprovedIds,
}: Props) {
  const [selectedId, setSelectedId] = useState(initialScenarioId);
  const [invoice, setInvoice] = useState<InvoiceInput>(initialInvoice);
  const [result, setResult] = useState<VerificationResult>(initialResult);
  const [approvedIds, setApprovedIds] = useState<string[]>(initialApprovedIds);
  const [voiceInput, setVoiceInput] = useState(initialInvoice.voiceTranscriptRaw ?? "");
  const [enablePiiScrub, setEnablePiiScrub] = useState(true);
  const [activeLineHighlight, setActiveLineHighlight] = useState<number | null>(
    initialResult.faults.find((f) => f.category === "voice_shortage" && f.lineNumber)?.lineNumber ??
      initialResult.faults.find((f) => f.lineNumber)?.lineNumber ??
      null
  );
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideMode, setOverrideMode] = useState<"overridden_clean" | "contested_appeal">("overridden_clean");
  const [overrideReason, setOverrideReason] = useState("");
  const [dwellSec, setDwellSec] = useState(0);
  const [ocrMeta, setOcrMeta] = useState<OcrMeta | null>(null);
  const [extractKind, setExtractKind] = useState<string>("structured_scenario");
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string | null>(null);
  const [asrMeta, setAsrMeta] = useState<TranscribeResult | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const visibleAccumMsRef = useRef(0);
  const visibleStartTsRef = useRef<number | null>(null);

  const resetReviewDwell = useCallback(() => {
    visibleAccumMsRef.current = 0;
    visibleStartTsRef.current =
      typeof document === "undefined" || document.visibilityState === "visible" ? Date.now() : null;
    setDwellSec(0);
  }, []);

  useEffect(() => {
    const readVisibleDwellMs = () => {
      const active =
        visibleStartTsRef.current !== null ? Math.max(0, Date.now() - visibleStartTsRef.current) : 0;
      return Math.round(visibleAccumMsRef.current + active);
    };

    const syncVisibleSegment = () => {
      if (document.visibilityState === "visible") {
        if (visibleStartTsRef.current === null) {
          visibleStartTsRef.current = Date.now();
        }
      } else if (visibleStartTsRef.current !== null) {
        visibleAccumMsRef.current += Math.max(0, Date.now() - visibleStartTsRef.current);
        visibleStartTsRef.current = null;
      }
      setDwellSec(Math.floor(readVisibleDwellMs() / 1000));
    };

    syncVisibleSegment();
    document.addEventListener("visibilitychange", syncVisibleSegment);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setDwellSec(Math.floor(readVisibleDwellMs() / 1000));
      }
    }, 500);
    return () => {
      document.removeEventListener("visibilitychange", syncVisibleSegment);
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current !== null) {
        window.clearInterval(recordTimerRef.current);
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  const updateUploadedPreview = (nextUrl: string | null) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    previewUrlRef.current = nextUrl;
    setUploadedPreviewUrl(nextUrl);
  };

  const runScenario = async (scenarioId: string, customVoice?: string, scrubFlag = enablePiiScrub) => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const resp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId,
          voiceTranscript: customVoice,
          enablePiiScrub: scrubFlag,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Analysis failed");
      setSelectedId(scenarioId);
      setInvoice(data.invoice);
      setResult(data.verification);
      setOcrMeta(null);
      setExtractKind(data.extractKind || "structured_scenario");
      updateUploadedPreview(null);
      if (customVoice === undefined) {
        setVoiceInput(data.invoice.voiceTranscriptRaw ?? "");
        setAsrMeta(null);
      }
      setActiveLineHighlight(
        data.verification.faults.find(
          (f: { category?: string; lineNumber?: number }) => f.category === "voice_shortage" && f.lineNumber
        )?.lineNumber ??
          data.verification.faults.find((f: { lineNumber?: number }) => f.lineNumber)?.lineNumber ??
          null
      );
      resetReviewDwell();
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : "Unable to verify bill");
    } finally {
      setBusy(false);
    }
  };

  const transcribeAudioFile = async (audioFile: File) => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const form = new FormData();
      form.append("file", audioFile);
      const trResp = await fetch("/api/transcribe", { method: "POST", body: form });
      const trData = await trResp.json();
      if (!trResp.ok) {
        throw new Error(trData.error || "Groq Whisper transcription failed");
      }
      const tr = trData as TranscribeResult;
      setAsrMeta(tr);
      const nextVoice = tr.transcript || "";
      setVoiceInput(nextVoice);

      const analyzeResp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice: { ...invoice, voiceTranscriptRaw: nextVoice },
          enablePiiScrub,
        }),
      });
      const analyzeData = await analyzeResp.json();
      if (!analyzeResp.ok) {
        throw new Error(analyzeData.error || "Voice reconciliation failed");
      }
      setInvoice(analyzeData.invoice);
      setResult(analyzeData.verification);
      resetReviewDwell();
      setActiveLineHighlight(
        analyzeData.verification.faults.find(
          (f: { category?: string; lineNumber?: number }) => f.category === "voice_shortage" && f.lineNumber
        )?.lineNumber ??
          analyzeData.verification.faults.find((f: { lineNumber?: number }) => f.lineNumber)?.lineNumber ??
          null
      );
      setStatusMsg(
        `Transcribed ${audioFile.name} via ${tr.model} in ${tr.asrLatencyMs} ms (${tr.redactionCount} PII masked) and reconciled against invoice rows.`
      );
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : "Voice transcription failed");
    } finally {
      setBusy(false);
      if (audioInputRef.current) audioInputRef.current.value = "";
    }
  };

  const stopRecording = () => {
    if (recordTimerRef.current !== null) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    } else {
      setIsRecording(false);
      setRecordingSec(0);
    }
  };

  const startRecording = async () => {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setStatusMsg("Microphone recording is unavailable in this browser; upload an .mp3, .wav, .m4a, or .webm clip instead.");
      return;
    }
    setStatusMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ].find((t) => MediaRecorder.isTypeSupported(t));

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        if (recordTimerRef.current !== null) {
          window.clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop());
          mediaStreamRef.current = null;
        }
        setIsRecording(false);
        setRecordingSec(0);

        const actualMime = recorder.mimeType || mimeType || "audio/webm";
        const ext = actualMime.includes("ogg")
          ? ".ogg"
          : actualMime.includes("mp4") || actualMime.includes("m4a")
            ? ".m4a"
            : ".webm";
        const blob = new Blob(audioChunksRef.current, { type: actualMime });
        if (blob.size > 0) {
          const recordedFile = new File([blob], `hinglish_voice_note${ext}`, { type: actualMime });
          void transcribeAudioFile(recordedFile);
        }
      };

      recorder.start();
      setIsRecording(true);
      setRecordingSec(0);
      recordTimerRef.current = window.setInterval(() => {
        setRecordingSec((prev) => {
          if (prev + 1 >= 45) {
            stopRecording();
            return 45;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (e) {
      setStatusMsg(
        e instanceof Error
          ? `Microphone access failed (${e.message}). Upload an .mp3, .wav, .m4a, or .webm clip instead.`
          : "Microphone access denied."
      );
    }
  };

  const handleVoiceReconcile = async () => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const resp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice: { ...invoice, voiceTranscriptRaw: voiceInput },
          enablePiiScrub,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Voice check failed");
      setInvoice(data.invoice);
      setResult(data.verification);
      resetReviewDwell();
      setStatusMsg("Voice note reconciled through deterministic rupee checks.");
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : "Voice check failed");
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setStatusMsg(null);
    const isImg = /\.(png|jpg|jpeg|webp)$/i.test(file.name) || file.type.startsWith("image/");
    if (isImg) {
      updateUploadedPreview(URL.createObjectURL(file));
    } else {
      updateUploadedPreview(null);
    }
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("voiceTranscript", voiceInput);
      form.append("enablePiiScrub", String(enablePiiScrub));
      const resp = await fetch("/api/analyze", { method: "POST", body: form });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Upload inspection failed");
      setSelectedId("CUSTOM-UPLOAD");
      setInvoice(data.invoice);
      setResult(data.verification);
      setOcrMeta(data.ocrMeta ?? null);
      setExtractKind(data.extractKind || "custom_upload");
      setActiveLineHighlight(
        data.verification.faults.find((f: { lineNumber?: number }) => f.lineNumber)?.lineNumber ?? null
      );
      if (data.ocrMeta) {
        setStatusMsg(
          `Uploaded ${file.name} (${data.extractKind.replace(/_/g, " ")}, clarity ${data.ocrMeta.clarityScore}/255, ${data.ocrMeta.ocrLatencyMs} ms).`
        );
      } else {
        setStatusMsg(`Uploaded ${file.name} (${data.extractKind.replace(/_/g, " ")}) inspected.`);
      }
      resetReviewDwell();
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const submitOwnerDecision = async (
    decision: "approved_flag" | "overridden_clean" | "contested_appeal" | "retake_requested",
    reasonText = ""
  ) => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const activeSliceMs =
        visibleStartTsRef.current !== null ? Math.max(0, Date.now() - visibleStartTsRef.current) : 0;
      const dwellMs = Math.round(visibleAccumMsRef.current + activeSliceMs);
      const minConf =
        result.lines.length > 0
          ? Math.min(...result.lines.map((l) => l.ocrConfidence))
          : 0.5;
      const resp = await fetch("/api/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "decision",
          tenantId: invoice.tenantId,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          vendorName: invoice.vendorName,
          billSha256: result.billSha256,
          billReceivedTs: result.t0Iso,
          flagSentTs: result.tFlagIso,
          fieldConfidencesMin: minConf,
          sourceCropBbox: result.faults[0]?.bbox ?? null,
          ruleChecks: result.faults.map((f) => f.ruleId),
          varianceAtRiskPaise: result.totalVarianceAtRiskPaise,
          decision,
          overrideReason: reasonText,
          dwellMs,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to record decision");
      if (decision === "approved_flag" || decision === "overridden_clean") {
        setApprovedIds((prev) => (prev.includes(invoice.id) ? prev : [...prev, invoice.id]));
      }
      setOverrideOpen(false);
      setOverrideReason("");
      setStatusMsg(
        `Decision recorded to SHA-256 Audit Ledger (${data.event.eventId}, chain length ${data.events.length}, dwell ${(dwellMs / 1000).toFixed(1)}s).`
      );
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleScrub = async () => {
    const next = !enablePiiScrub;
    setEnablePiiScrub(next);
    const resp = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoice: { ...invoice, voiceTranscriptRaw: voiceInput },
        enablePiiScrub: next,
      }),
    });
    const data = await resp.json();
    if (resp.ok) setResult(data.verification);
  };

  const isBundledScenario = selectedId === invoice.id && scenarios.some((s) => s.id === invoice.id);
  const isLedgerApproved = approvedIds.includes(invoice.id);
  const tallyApproved = isBundledScenario && isLedgerApproved;

  return (
    <div className="space-y-5">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="type-page text-ink">Live Bill Verification Workbench</h1>
          <p className="type-body text-muted mt-0.5">
            Deterministic GST math isolated from OCR & Hinglish voice reconciliation.{" "}
            <span className="font-code type-meta text-faint">Rule Bundle {result.ruleBundleVersion}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tallyApproved ? (
            <a
              href={`/api/export?format=tally-xml&scenarioId=${encodeURIComponent(invoice.id)}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-line-strong type-pill text-ink hover:bg-subtle"
            >
              <Download className="w-3.5 h-3.5" />
              Tally Sandbox XML
            </a>
          ) : (
            <button
              type="button"
              disabled
              title={
                isLedgerApproved && !isBundledScenario
                  ? "Tally Sandbox XML export supports the 6 bundled scenarios; custom uploads are logged in the SHA-256 audit ledger"
                  : "Record store owner approval below to enable Tally Sandbox XML export"
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-line type-pill text-faint opacity-60 cursor-not-allowed"
            >
              <Lock className="w-3.5 h-3.5" />
              {isLedgerApproved && !isBundledScenario
                ? "Tally XML (Bundled Scenarios)"
                : "Tally XML (Approval Required)"}
            </button>
          )}
          <a
            href="/api/export?format=dispute-csv"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-line-strong type-pill text-ink hover:bg-subtle"
          >
            <Download className="w-3.5 h-3.5" />
            Dispute CSV
          </a>
        </div>
      </div>

      {/* Primary 4 KPI Strip (Horizontal above the fold on desktop) */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <div className="app-card p-4">
          <div className="type-kpi-label text-faint">Detected Issues</div>
          <div className="type-kpi-value numeral text-ink mt-1">
            {countLabel(result.faults.length, "Issue")}
          </div>
          <div className="type-meta text-muted mt-1 truncate">
            {result.abstainedClarity
              ? "Retake gate triggered"
              : result.faults[0]
                ? labelFor(FAULT_TYPE_LABELS, result.faults[0].category, "Review Item")
                : "All checks clear"}
          </div>
        </div>

        <div className="app-card p-4">
          <div className="type-kpi-label text-faint">Amount at Risk</div>
          <div className="type-kpi-value numeral text-ink mt-1">
            {formatPaiseINR(result.totalVarianceAtRiskPaise)}
          </div>
          <div className="type-meta text-muted mt-1">
            Declared {formatPaiseINR(result.declaredGrandTotalPaise)} · Expected{" "}
            <span className="numeral">{formatPaiseINR(result.expectedGrandTotalPaise)}</span>
          </div>
        </div>

        <div className="app-card p-4">
          <div className="type-kpi-label text-faint">Engine Compute Latency</div>
          <div className="type-kpi-value numeral text-ink mt-1">
            {result.computeLatencyMs.toFixed(2)} ms
          </div>
          <div className="type-meta text-muted mt-1">
            In-process check · Review dwell <span className="numeral font-medium">{dwellSec}s</span>
          </div>
        </div>

        <div className="app-card p-4">
          <div className="type-kpi-label text-faint">Governance & Privacy Gates</div>
          <div className="flex items-center gap-2 mt-1.5">
            <span className={`type-pill px-2 py-0.5 rounded ${result.promptGuardBlocked ? "pill-danger" : "pill-success"}`}>
              {result.promptGuardBlocked ? "Injection Quarantined" : "Guard Clear"}
            </span>
            <span className="type-pill px-2 py-0.5 rounded pill-cobalt numeral">
              {result.dpdpRedactionCount} PII Masked
            </span>
          </div>
          <div className="type-meta text-muted mt-1.5">
            {result.gstinValid ? "GSTIN Mod-36 Valid" : "GSTIN Check Failed"}
          </div>
        </div>
      </div>

      {statusMsg && (
        <div
          role="status"
          className="p-3 rounded-lg bg-surface border border-line-strong flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2 type-body text-ink">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{statusMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMsg(null)}
            className="type-meta text-faint hover:text-ink cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Scenario Switcher + Custom Upload Row */}
      <div className="app-card p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="type-kpi-label text-ink">
            Realistic Indian Retail Test Scenarios (Click to Inspect Live)
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.csv,.json,.pdf,.png,.jpg,.jpeg,.webp"
              onChange={(e) => handleUpload(e.target.files?.[0])}
              className="hidden"
              id="custom-bill-upload"
            />
            <label
              htmlFor="custom-bill-upload"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-subtle border border-line-strong type-pill text-ink cursor-pointer hover:bg-rail-hover"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload Custom Bill (CSV / TXT / PDF / Photo)
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {scenarios.map((sc) => {
            const active = selectedId === sc.id;
            return (
              <button
                key={sc.id}
                type="button"
                disabled={busy}
                onClick={() => runScenario(sc.id)}
                className={`text-left p-2.5 rounded-lg border transition-colors cursor-pointer ${
                  active
                    ? "bg-subtle border-line-strong text-ink"
                    : "bg-surface border-line text-muted hover:bg-subtle hover:text-ink"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="type-table-cell font-semibold truncate">{sc.tabTitle}</span>
                  <span className="type-pill px-1.5 py-0.5 rounded pill-neutral shrink-0">{sc.tag}</span>
                </div>
                <div className="type-meta text-faint mt-1 line-clamp-1">{sc.summary}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Two-Column Evidence & Decision Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left 5 Cols: Annotated Source Bill Crop Provenance + Voice / DPDP Controls */}
        <div className="lg:col-span-5 space-y-4">
          <div className="app-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="type-section text-ink">Source Evidence & Bounding Crops</h2>
              <span className="type-pill px-2 py-0.5 rounded pill-neutral whitespace-nowrap shrink-0">
                {labelFor(SUBGROUP_LABELS, invoice.subgroup, "Standard Bill")}
              </span>
            </div>

            {invoice.imageUrl ? (
              <div className="space-y-2">
                <div className="relative rounded-lg overflow-hidden border border-line bg-subtle">
                  <Image
                    src={invoice.imageUrl}
                    alt={`Scanned bill from ${invoice.vendorName}`}
                    width={1086}
                    height={1448}
                    unoptimized
                    className="w-full h-auto block"
                  />
                  {invoice.lines.map((line) => {
                    if (!line.bbox) return null;
                    const highlighted = activeLineHighlight === line.lineNumber;
                    const isFlagged = result.faults.some((f) => f.lineNumber === line.lineNumber);
                    return (
                      <button
                        key={line.bbox.id}
                        type="button"
                        onClick={() => setActiveLineHighlight(line.lineNumber)}
                        title={line.bbox.label}
                        aria-label={line.bbox.label}
                        style={{
                          top: `${line.bbox.topPct}%`,
                          left: `${line.bbox.leftPct}%`,
                          width: `${line.bbox.widthPct}%`,
                          height: `${line.bbox.heightPct}%`,
                        }}
                        className={`absolute rounded-xs transition-all cursor-pointer ${
                          highlighted
                            ? "border-2 border-blue-600 bg-blue-600/20 z-20"
                            : isFlagged
                              ? "border border-red-500/80 bg-red-500/10 hover:bg-red-500/20 z-10"
                              : "border border-transparent hover:border-blue-500/70 hover:bg-blue-500/10"
                        }`}
                      />
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 type-meta text-muted">
                  <span>
                    {activeLineHighlight
                      ? (() => {
                          const row = invoice.lines.find((l) => l.lineNumber === activeLineHighlight);
                          return row
                            ? `Selected row #${row.lineNumber}: ${row.description}`
                            : "Click any printed bill row to highlight";
                        })()
                      : "Click any printed bill row or table line to highlight"}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-xs border-2 border-blue-600 bg-blue-600/20 inline-block" />
                      Selected
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-xs border border-red-500 bg-red-500/10 inline-block" />
                      Flagged
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {uploadedPreviewUrl && (
                  <div className="rounded-lg overflow-hidden border border-line bg-white p-1.5">
                    <Image
                      src={uploadedPreviewUrl}
                      alt={`Uploaded bill preview from ${invoice.vendorName}`}
                      width={900}
                      height={1200}
                      unoptimized
                      className="w-full max-h-56 object-contain block mx-auto"
                    />
                  </div>
                )}
                <div className="rounded-lg border border-line bg-subtle p-4 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-line pb-2">
                    <div>
                      <div className="type-table-cell font-semibold text-ink">{invoice.vendorName}</div>
                      <div className="font-code type-meta text-muted">
                        GSTIN: {invoice.vendorGstin || "Pending"} · Inv {invoice.invoiceNumber}
                      </div>
                    </div>
                    <FileText className="w-4 h-4 text-faint shrink-0" />
                  </div>
                  <div className="type-meta text-muted flex flex-wrap gap-3">
                    <span>Date: {invoice.invoiceDate}</span>
                    <span>Place of Supply: State {invoice.placeOfSupplyStateCode}</span>
                    <span className="numeral">Clarity: {invoice.clarityScore}/255</span>
                  </div>
                  {invoice.notesRaw && (
                    <div className="p-2.5 rounded bg-surface border border-line font-code text-xs text-muted break-words max-h-24 overflow-y-auto">
                      <span className="font-semibold text-ink">Sanitized Bill Note Preview: </span>
                      {enablePiiScrub ? result.dpdpScrubbedNotes : invoice.notesRaw}
                    </div>
                  )}
                </div>
              </div>
            )}

            {ocrMeta && (
              <div
                data-testid="ocr-clarity-telemetry"
                className="rounded-lg border border-line bg-subtle/80 p-3 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="type-kpi-label text-ink flex items-center gap-1.5">
                    <ScanText className="w-3.5 h-3.5 text-cobalt" />
                    OCR &amp; Clarity Telemetry
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`type-pill px-2 py-0.5 rounded ${
                        ocrMeta.clarityScore >= 85 ? "pill-success" : "pill-danger"
                      }`}
                    >
                      {ocrMeta.clarityScore >= 85 ? "Clarity >= 85 Pass" : "Below 85 Retake"}
                    </span>
                    <span className="type-pill px-2 py-0.5 rounded pill-neutral font-code">
                      {extractKind}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded bg-surface border border-line p-2">
                    <div className="type-meta text-faint">Laplacian Clarity</div>
                    <div className="type-table-cell font-semibold numeral text-ink">
                      {ocrMeta.clarityScore}/255
                    </div>
                    <div className="type-meta text-faint truncate">
                      {ocrMeta.clarityMethod === "python_pil_laplacian_3x3"
                        ? "3x3 Laplacian"
                        : "Byte Entropy"}
                    </div>
                  </div>
                  <div className="rounded bg-surface border border-line p-2">
                    <div className="type-meta text-faint">OCR Engine</div>
                    <div className="type-table-cell font-semibold text-ink truncate">
                      {ocrMeta.engine === "tesseract_cli"
                        ? "Tesseract Local"
                        : ocrMeta.engine === "tesseract_js"
                          ? "Tesseract JS"
                          : "Abstained"}
                    </div>
                    <div className="type-meta text-faint truncate">
                      {ocrMeta.usedLlmStructurer ? "Scrubbed Fallback" : "Deterministic Parser"}
                    </div>
                  </div>
                  <div className="rounded bg-surface border border-line p-2">
                    <div className="type-meta text-faint">OCR Latency</div>
                    <div className="type-table-cell font-semibold numeral text-ink">
                      {ocrMeta.ocrLatencyMs} ms
                    </div>
                    <div className="type-meta text-faint truncate">Local server</div>
                  </div>
                </div>

                <div>
                  <div className="type-meta text-faint mb-1">Scrubbed OCR Preview</div>
                  <pre className="type-meta font-code text-muted bg-surface border border-line rounded p-2 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
                    {ocrMeta.scrubbedOcrPreview || "(clarity gate abstained prior to OCR)"}
                  </pre>
                </div>
              </div>
            )}

            {/* Hinglish Voice Reconciliation Interactive Input */}
            <div className="pt-2 border-t border-line space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="voice-transcript" className="type-kpi-label text-ink flex items-center gap-1.5">
                  <Mic className="w-3.5 h-3.5" />
                  15s Bilingual Receiving Voice Note (Live ASR / Editable)
                </label>
                <button
                  type="button"
                  onClick={toggleScrub}
                  className={`type-pill px-2 py-0.5 rounded cursor-pointer flex items-center gap-1 ${
                    enablePiiScrub ? "pill-success" : "pill-warning"
                  }`}
                >
                  <Lock className="w-3 h-3" />
                  {enablePiiScrub ? "DPDP Scrub ON" : "DPDP Scrub OFF"}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy && !isRecording}
                  onClick={isRecording ? stopRecording : () => void startRecording()}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border type-pill cursor-pointer disabled:opacity-50 ${
                    isRecording
                      ? "pill-danger border-red-500/50"
                      : "bg-subtle border-line-strong text-ink hover:bg-rail-hover"
                  }`}
                >
                  {isRecording ? (
                    <>
                      <Square className="w-3 h-3 fill-current" />
                      Stop Recording ({recordingSec}s)
                    </>
                  ) : (
                    <>
                      <Mic className="w-3.5 h-3.5 text-cobalt" />
                      Record Hinglish Voice Note
                    </>
                  )}
                </button>

                <input
                  ref={audioInputRef}
                  type="file"
                  accept=".mp3,.wav,.m4a,.webm,.ogg,audio/*"
                  onChange={(e) => {
                    const clip = e.target.files?.[0];
                    if (clip) void transcribeAudioFile(clip);
                  }}
                  className="hidden"
                  id="audio-clip-upload"
                />
                <label
                  htmlFor="audio-clip-upload"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface border border-line-strong type-pill text-ink cursor-pointer hover:bg-subtle"
                >
                  <FileAudio className="w-3.5 h-3.5 text-cobalt" />
                  Upload Audio Clip (.mp3 / .wav / .m4a / .webm)
                </label>
              </div>

              {asrMeta && (
                <div
                  data-testid="asr-telemetry"
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-subtle px-2.5 py-1.5"
                >
                  <span className="type-pill px-2 py-0.5 rounded pill-cobalt font-code">
                    {asrMeta.model}
                  </span>
                  <span className="type-meta font-code numeral text-ink">
                    ASR Latency: {asrMeta.asrLatencyMs} ms
                  </span>
                  {asrMeta.durationSec !== null && (
                    <span className="type-meta font-code numeral text-muted">
                      Clip: {asrMeta.durationSec}s
                    </span>
                  )}
                  <span className="type-meta numeral text-muted">
                    {asrMeta.redactionCount} PII masked
                  </span>
                </div>
              )}

              <textarea
                id="voice-transcript"
                rows={2}
                value={voiceInput}
                onChange={(e) => setVoiceInput(e.target.value)}
                placeholder='e.g. "Bhaiya 5 kg Toor Dal kum aaya hai, customer +91 98927 45631"'
                className="w-full p-2.5 app-field type-body"
              />

              <div className="flex items-center justify-between gap-2">
                <span className="type-meta text-muted truncate">
                  Model sees:{" "}
                  <span className="font-code">{result.dpdpScrubbedVoice || "(no voice transcript)"}</span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleVoiceReconcile}
                  className="px-3 py-1.5 rounded-lg bg-accent text-accent-ink type-pill cursor-pointer shrink-0 hover:opacity-90"
                >
                  Re-Verify Voice
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right 7 Cols: Deterministic Audit Breakdown, Line Table & Owner Decision Gate */}
        <div className="lg:col-span-7 space-y-4">
          {/* Prompt Guard & Fault Cards */}
          <div className="app-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="type-section text-ink">Verification Findings & Evidence Trace</h2>
              <span
                className={`type-pill px-2.5 py-0.5 rounded ${
                  result.abstainedClarity
                    ? "pill-warning"
                    : result.faults.length > 0
                      ? "pill-danger"
                      : "pill-success"
                }`}
              >
                {result.abstainedClarity
                  ? "Abstained: Retake Requested"
                  : result.faults.length > 0
                    ? `${result.faults.length} Flagged ${result.faults.length === 1 ? "Discrepancy" : "Discrepancies"}`
                    : "Verified Clean"}
              </span>
            </div>

            {result.promptGuardBlocked && (
              <div className="p-3 rounded-lg pill-danger space-y-1">
                <div className="flex items-center gap-1.5 type-table-cell font-semibold">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  Prompt-Injection Isolation Triggered (Rules Unchanged)
                </div>
                {result.promptGuardFindings.map((f, idx) => (
                  <div key={idx} className="type-meta font-code">
                    [{f.ruleId}] in {f.field}: quarantined {JSON.stringify(f.excerptRedacted)}
                  </div>
                ))}
              </div>
            )}

            {result.faults.length === 0 ? (
              <div className="p-3 rounded-lg bg-subtle border border-line type-body text-muted">
                GSTIN Mod-36 checksum, all CBIC HSN slabs, BigInt paise arithmetic, duplicate challan history, and voice notes passed cleanly.
              </div>
            ) : (
              <div className="space-y-2">
                {result.faults.map((f) => (
                  <div
                    key={f.faultId}
                    onClick={() => f.lineNumber && setActiveLineHighlight(f.lineNumber)}
                    className={`p-3 rounded-lg border transition-colors ${
                      f.lineNumber ? "cursor-pointer hover:bg-subtle" : ""
                    } ${
                      activeLineHighlight && activeLineHighlight === f.lineNumber
                        ? "border-line-strong bg-subtle"
                        : "border-line bg-surface"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="type-table-cell font-semibold text-ink">{f.title}</span>
                          <span className="type-pill px-1.5 py-0.5 rounded pill-neutral">
                            {labelFor(SEVERITY_LABELS, f.severity, "Medium")}
                          </span>
                          <span className="font-code type-meta text-faint">{f.ruleId}</span>
                        </div>
                        <p className="type-meta text-muted leading-relaxed">{f.explanation}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="type-table-cell font-semibold numeral text-ink">
                          {formatPaiseINR(f.variancePaise)}
                        </div>
                        <div className="type-meta text-faint">variance</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Owner Human-in-the-Loop Decision Gate */}
            <div className="pt-3 border-t border-line flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="type-meta text-muted flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 shrink-0 text-cobalt" />
                <span>
                  Human accountability gate: every claim and Tally Sandbox XML export requires recorded store owner approval.
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {result.abstainedClarity ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      submitOwnerDecision(
                        "retake_requested",
                        "Requested clearer WhatsApp retake from delivery staff."
                      )
                    }
                    className="px-3.5 py-2 rounded-lg bg-accent text-accent-ink type-pill cursor-pointer hover:opacity-90"
                  >
                    Send Retake Prompt
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => submitOwnerDecision("approved_flag")}
                      className="px-3.5 py-2 rounded-lg bg-accent text-accent-ink type-pill cursor-pointer hover:opacity-90"
                    >
                      Approve Flag & Log
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setOverrideMode("overridden_clean");
                        setOverrideOpen(true);
                      }}
                      className="px-3 py-2 rounded-lg bg-surface border border-line-strong text-ink type-pill cursor-pointer hover:bg-subtle"
                    >
                      Override / Appeal
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Line-by-Line Deterministic Accounting Table */}
          {result.lines.length > 0 && (
            <div className="app-card overflow-hidden">
              <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
                <h3 className="type-section text-ink">Deterministic Paise Tax Ledger</h3>
                <span className="type-meta text-faint">{result.oracleProfile}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-line bg-subtle text-faint">
                      <th className="py-2 px-3 type-table-head"># · Item</th>
                      <th className="py-2 px-3 type-table-head">HSN Slab</th>
                      <th className="py-2 px-3 type-table-head text-right">Billed Total</th>
                      <th className="py-2 px-3 type-table-head text-right">Deterministic Total</th>
                      <th className="py-2 px-3 type-table-head text-right">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.lines.map((line) => {
                      const deltaBig = BigInt(line.deltaPaise);
                      const rowClass =
                        activeLineHighlight === line.lineNumber ? "bg-subtle" : "hover:bg-subtle/60";
                      return (
                        <tr
                          key={line.lineNumber}
                          onClick={() => setActiveLineHighlight(line.lineNumber)}
                          className={`border-b border-line last:border-b-0 cursor-pointer ${rowClass}`}
                        >
                          <td className="py-2.5 px-3 type-table-cell">
                            <div className="font-medium text-ink">
                              {line.lineNumber}. {line.description}
                            </div>
                            <div className="type-meta text-faint font-code">
                              {line.sku} · Conf {(line.ocrConfidence * 100).toFixed(0)}%
                            </div>
                          </td>
                          <td className="py-2.5 px-3 type-table-cell">
                            <div className="font-code text-ink">{line.hsnCode}</div>
                            <div className="type-meta text-faint numeral">
                              Decl {(line.declaredRateBps / 100).toFixed(0)}% · Rule{" "}
                              {line.expectedRateBps !== null
                                ? `${(line.expectedRateBps / 100).toFixed(0)}%`
                                : "Manual"}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 type-table-cell text-right numeral text-ink">
                            {formatPaiseINR(line.declaredLineTotalPaise)}
                          </td>
                          <td className="py-2.5 px-3 type-table-cell text-right numeral text-ink">
                            {formatPaiseINR(line.expectedLineTotalPaise)}
                          </td>
                          <td className="py-2.5 px-3 type-table-cell text-right numeral">
                            <span
                              className={`type-pill px-2 py-0.5 rounded ${
                                deltaBig === 0n ? "pill-success" : "pill-danger"
                              }`}
                            >
                              {formatPaiseINR(deltaBig)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Override / Contestability Modal */}
      {overrideOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        >
          <div className="app-card w-full max-w-md p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="type-drawer text-ink">Contest or Override AI Finding</h3>
                <p className="type-meta text-muted mt-0.5">
                  Every human override logs an immutable ISO/IEC 42001 appeal entry to prevent automation bias.
                </p>
              </div>
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOverrideMode("overridden_clean")}
                className={`flex-1 py-2 px-3 rounded-lg border type-pill cursor-pointer ${
                  overrideMode === "overridden_clean"
                    ? "bg-subtle border-line-strong text-ink"
                    : "bg-surface border-line text-muted"
                }`}
              >
                Override as Agreed Clean
              </button>
              <button
                type="button"
                onClick={() => setOverrideMode("contested_appeal")}
                className={`flex-1 py-2 px-3 rounded-lg border type-pill cursor-pointer ${
                  overrideMode === "contested_appeal"
                    ? "bg-subtle border-line-strong text-ink"
                    : "bg-surface border-line text-muted"
                }`}
              >
                Escalate / Contest to CA
              </button>
            </div>

            <div>
              <label htmlFor="override-reason" className="type-kpi-label text-ink block mb-1">
                Mandatory Justification (min 6 characters)
              </label>
              <textarea
                id="override-reason"
                rows={3}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g. Verified distributor approved seasonal price update via call."
                className="w-full p-2.5 app-field type-body"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOverrideOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-surface border border-line-strong type-pill text-ink cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || overrideReason.trim().length < 6}
                onClick={() => submitOwnerDecision(overrideMode, overrideReason)}
                className="px-3.5 py-1.5 rounded-lg bg-accent text-accent-ink type-pill cursor-pointer disabled:opacity-40"
              >
                Record Signed Override
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
