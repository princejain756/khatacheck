# KhataCheck: Responsible AI GST Invoice and Short-Billing Verifier

KhataCheck helps small Indian retailers check supplier wholesale invoices and receiving voice notes for short billing, GST HSN slab mismatches, BigInt paise arithmetic errors, Mod-36 GSTIN checksum faults, duplicate challans, and 90-day rate creep before approving supplier payouts.

Built by Prince Jain for the **NeuraViz AI Challenge 2026-27 (Stage 4 Final)**.

- Live Web App: https://khatacheck.prince.sh
- Public Repository: https://github.com/princejain756/khatacheck

## Core Architecture and Governance Controls

1. **Deterministic Verification Engine (`src/lib/`)**:
   - `gst-rules.ts`: Validates 15-character supplier/buyer GSTIN tokens via Mod-36 checksums, verifies 60 CBIC HSN headings (`v1-demo-synthetic-oracle`), computes line-item and CGST/SGST/IGST tax in exact `BigInt` paise (`half-up` rounding), flags duplicate invoices and 80% Jaccard challan overlaps, and checks 90-day supplier median unit-rate drift (`>= 20%` jump with `>= 6` prior observations).
   - `voice-parser.ts`: Reconciles English and Hinglish receiving voice notes (for example *"20 peti likha hai par 18 hi aayi"*, Devanagari digits, negation guards) against supplier line items.
   - `prompt-guard.ts`: Quarantines untrusted OCR and voice notes across 6 injection families (`PG-A` through `PG-F`) plus bounded base64/hex decoding before deterministic math executes.
   - `dpdp-privacy.ts`: Masks mobile numbers, emails, PAN, Aadhaar, and UPI handles before model egress while preserving 15-character supplier GSTIN tokens, paired with bilingual English/Hindi notice (`dpdp-v1.2-2026-11`), 30-day raw-media expiry plan (Days 61 to 90 rollout; demo runs in memory), and `/privacy` / `/delete-data` erasure controls.
   - `governance-ledger.ts`: Append-only SHA-256 hash-chained audit ledger (`data/audit-ledger.jsonl`), copy-only tamper simulator, Automation Bias Monitor (`n >= 50` gate, alerts if approval > 95% and `0 <= median dwell < 3s`, including `0 ms` instant approvals), 5-Gate Lifecycle sign-off matrix, and TallyPrime XML **Sandbox Profile** export.
   - **Stage 4 Demo Boundary**: The deployed web routes and API endpoints run unauthenticated inside an isolated synthetic single-tenant sandbox (`store-ganesh-blr-01`) with zero live merchant records; production multi-tenant store auth and per-store credentialing are scoped for post-pilot rollout.

## Executed Synthetic Benchmark Results (`KC-BENCH-1795370440366`, Seed `1263026516`)

All quantitative accuracy and security metrics below come from our local seeded synthetic benchmark suite (`npm run benchmark`):

- **Dataset**: 500 synthetic bills (220 clean, 240 substantive faults across 6 categories, 40 low-clarity abstentions) plus 50 adversarial prompt-injection/exfiltration cases and 50 clean controls under `Synthetic Oracle v1 (Demo Fixture Scope)`.
- **Substantive Detection**: F1 `99.4%` (`[98.5, 100]` 95% bootstrap CI), Precision `100%` (`[98.4, 100]` 95% Wilson CI), Recall `98.8%` (`[96.4, 99.6]` 95% Wilson CI), `237 TP / 0 FP / 3 FN`.
- **Clean Bill & Clarity Gates**: Clean false-positive rate `0%`, Clarity abstentions `40 / 40`, Deterministic BigInt math accuracy `100%` (`460 / 460`).
- **5-Subgroup Fairness Launch Gate (`<= 5.0%` rule)**: Macro mean F1 `99.4%`, max F1 gap below mean `1.5%`, max recall gap below mean `2.9%` (`handwritten_challan` stratum).
- **Red-Team Resilience**: `50 / 50` blocked/isolated, `50 / 50` tax integrity unchanged, `50 / 50` zero PII leaks.
- **Latency & Pilot Status**: In-process deterministic compute across `2,500` runs (`5` passes): `p50 = 0.021 ms`, `p95 = 0.049 ms`, `max = 0.194 ms`. Manual kirana reconciliation baseline runs `12 to 25 min` active time per bill plus `7 to 30 days` GST filing lag. The registered 10-store, 4-week Bengaluru shadow pilot is currently `NOT_RUN`, with `t0 -> t_flag` telemetry instrumented and ready for launch Gate 5 sign-off.

## Executed Live E2E OCR + ASR Lab Study (`KC-E2E-1795370530518`)

Measured live via HTTP round-trips against `https://khatacheck.prince.sh` (`npm run benchmark:e2e`, code commit `8c2be3395021f796393e5a0ab527335f3dec82f5`):

- **19 Bill Images (`15` crisp generated + `1` printed Scenario 1 photo + `3` blurred `<85` controls)**: Clarity pass `100%` (`16/16`), blurry abstentions `3/3` (`100%`), line-count recall `94.6%` (`53/56`), declared grand totals `100%` (`16/16`), supplier GSTIN exact match `93.8%` (`15/16`, no check-char mutation), exact fault category-set match `94.7%` (`18/19`).
- **Image Latency (`nearestRankQuantile`)**: All-19 `/api/analyze` API round-trip `p50 = 1962.6 ms`, `p95 = 7118.2 ms`, `max = 7118.2 ms`; server Pillow clarity + Tesseract CLI `p50 = 1508.8 ms`, `p95 = 4735.1 ms`, `max = 4735.1 ms`.
- **5 Hinglish Audio Clips (`whisper-large-v3-turbo`)**: Shortage/rate recall `100%` (`4/4`), negation control `Pass`, DPDP PII redaction `Pass` across mobile and spoken email clips (`[MOBILE_REDACTED]` and `[EMAIL_REDACTED]`), ASR `p50 = 210 ms` (`p95 = 219.1 ms`), full voice E2E `p50 = 477.4 ms` (`p95 = 588.4 ms`). 10-store Bengaluru field pilot remains `NOT_RUN`.

## Independent Third-Party Benchmark (`KC-EXT-1795370633257`)

Evaluated live against `https://khatacheck.prince.sh/api/analyze` (`npm run benchmark:external`, code commit `8c2be3395021f796393e5a0ab527335f3dec82f5`) using `49` sampled invoices from `Divya52/indian-gst-invoices` (CC BY 4.0, dataset commit `fece40b9a96ac3949934fc05c714853a5283d730`: `15` evenly spaced synthetic rows, `10` evenly spaced regional rows, plus all `24` visual injection attacks `inj_000` to `inj_023`), using general layout and guard upgrades informed by an initial 5-row diagnostic probe with zero per-row hardcoding:

- **Overall (`49` sampled bills)**: Clarity pass `100%` (`49/49`), Grand Total exact `85.7%` (`42/49`), Supplier GSTIN exact `77.6%` (`38/49`), line-count recall `81.7%` (`143/175`), API round-trip `p50 = 1526.7 ms` (`p95 = 3921.1 ms`, `max = 4083.6 ms`), server OCR `p50 = 1219 ms` (`p95 = 1579.9 ms`, `max = 1998.9 ms`).
- **Clean Sampled Bills (`25` bills: `15` synthetic + `10` regional)**: `0/25` (`0%`) prompt-guard false positives, `72.0%` (`18/25`) grand total exact (`10/15` synthetic `66.7%`, `8/10` regional `80.0%`), `60.0%` (`15/25`) GSTIN, `74.3%` (`78/105`) line recall, `36.0%` (`9/25`) arithmetic FP vs printed math. By degradation level: clean digital (`6/6`) `100%` grand total / `100%` GSTIN / `100%` line recall / `0%` arithmetic FP; scan (`6/6`) `100%` grand total / `96.4%` line recall / `33.3%` arithmetic FP; noisy photo (`13` bills) `46.2%` grand total / `50.0%` line recall / `53.8%` arithmetic FP.
- **24 Visual Prompt-Injection Attacks**: `100%` (`24/24`) grand total preserved (`grandTotalPreserved = 24/24`), `91.7%` (`22/24`) attack defeated, `50.0%` (`12/24`) prompt-guard detection (`visible_note` `8/8` `100%`, `tiny` `4/8` `50%`, `low_contrast` `0/8` `0%`; deterministic `BigInt` math isolates raw bill pixels from LLMs).

## Prerequisites & Reproduction

- **OCR Engines (`tesseract` CLI + `tesseract.js` Fallback)**: When native `tesseract` CLI is installed (`brew install tesseract` on macOS or `apt-get install tesseract-ocr` on Linux), KhataCheck runs native CLI speed OCR; otherwise it falls back cleanly to the bundled `tesseract.js` WASM worker so offline `npm test` (`19/19` passing) runs without native `tesseract`.
- **Clarity Gate (`Pillow`) & Voice ASR (`GROQ_API_KEY`)**: `python3` with `Pillow` (`PIL`) computes 3x3 Laplacian variance clarity scoring (`<85` abstention gate). Set `GROQ_API_KEY` in `.env.local` (gitignored) to enable live `POST /api/transcribe` (`whisper-large-v3-turbo`) and optional scrubbed-text structuring (`qwen/qwen3.8-27b`). If unset, `POST /api/transcribe` returns HTTP `503`.

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run benchmark
npm run build
npm start
```

To run the live 19-image + 5-audio E2E suite or the 49-invoice external `Divya52/indian-gst-invoices` (CC BY 4.0) benchmark against a running server:

```bash
KHATACHECK_BASE_URL=http://127.0.0.1:3000 npm run benchmark:e2e
KHATACHECK_BASE_URL=http://127.0.0.1:3000 npm run benchmark:external
```
