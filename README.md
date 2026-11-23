# KhataCheck: Responsible AI GST Invoice and Short-Billing Verifier

KhataCheck helps small Indian retailers audit wholesale supplier GST bills and short Hinglish receiving voice notes before payout. Probabilistic OCR and speech models extract text only; deterministic TypeScript `BigInt` paise code computes every rupee across line sums, date-effective GST slabs, GSTIN checksums, duplicate challans, and 90-day supplier rate creep.

Built by **Prince Jain** (Full-Stack Software Engineer) for the **NeuraViz AI Challenge 2026-27 (Stage 4 Final)**.

- **Live Web App:** https://khatacheck.prince.sh
- **Demo Video:** https://youtu.be/1G75gl6MNBw
- **Public Repository:** https://github.com/princejain756/khatacheck (Release Tag: `v2.1-stage4-final`)

![KhataCheck Workbench](docs/screenshots/workbench.png)

## Live Application Walkthrough

| Workbench (Post-GST 2.0 `SCN-02`, Rs 3,120 Flag) | ISO/IEC 42001 Governance & Hash Ledger |
| :-: | :-: |
| ![Workbench SCN-02 GST 2.0](docs/screenshots/workbench_scn02_gst2.png) | ![Governance Ledger](docs/screenshots/governance.png) |

| Benchmarks (500-Bill Suite + Live E2E) | Third-Party Clean & 50-Bill Held-Out Splits |
| :-: | :-: |
| ![Benchmarks Overview](docs/screenshots/benchmarks.png) | ![External Clean and Held-Out Benchmarks](docs/screenshots/benchmarks_external.png) |

| Stratified Red-Team Sample Logs (Families A to F) | DPDP Consent (`dpdp-v1.3-2026-11`) & Erasure |
| :-: | :-: |
| ![Red-Team Benchmarks](docs/screenshots/benchmarks_redteam.png) | ![DPDP Privacy Controls](docs/screenshots/privacy.png) |

## Core Architecture & Responsible AI Controls

1. **Deterministic Verification Engine (`src/lib/`)**:
   - **Date-Effective GST 2.0 Rules (`gst-rules.ts`)**: `RULE_BUNDLE_VERSION = "2026.11.v2-gst2-date-effective"` keeps `HSN_SCHEDULE_60_V1` (`effectiveFrom: 2017-07-01` to `2025-09-21`, flagging `SCN-01` V2 total **`Rs 669.90`** across `Rs 619.50` voice shortage + `Rs 38.00` HSN `0904` + `Rs 12.40` non-notified `10%` slab on off-schedule `0910`; the V1 Demo Video recorded `Rs 657.50` before adding `GST-RATE-NOT-A-SLAB`) and `HSN_SCHEDULE_60_V2_GST2` (`effectiveFrom: 2025-09-22`, CBIC Notification `09/2025-CT(Rate)` moving FMCG/pharma headings to `5%` and splitting apparel at `Rs 2,500`), plus `SME_B2B_EXTRA_HEADINGS_V1/V2` (`3923`, date-effective `4819` `12% -> 5%`, `9964`, `9965`, `9968`, `9983` -> **`66` total CBIC HSN/SAC headings**). Off-schedule HSN codes trigger `hsnUnverified` and `GST-RATE-NOT-A-SLAB`; HSN and line arithmetic run non-maskingly via `secondaryFaults[]`, and supplier state is checked against validated GSTIN prefixes (`37 + 3` codes, Mod-36 checksum validation).
   - **Clarity, PDF & Local OCR (`image-clarity.ts`, `ocr-extractor.ts`, `upload-analyzer.ts`)**: Fail-closed `python3 -I` Pillow `3x3` Laplacian variance (`< 85` abstains; `formats=["PNG","JPEG","WEBP"]`, magic-byte check) and `%PDF-` signature validation (`415` on forged PDFs) feed `pdftotext -layout` / PyMuPDF text extraction, `pdftoppm -r 200` scanned-PDF fallback, and local `tesseract` CLI (PSM 6, `tesseract.js` fallback), deterministic layout parsing (Zoho taxable-amount disambiguation, Tally summary tax attribution, buyer-first `GSTN`/`GST No.`/`GST #` handling, `Original For Recipient` header safety, `>20x` OCR glued-row guard, leading `%->Rs` normalization, and SAC service-summary fallback), plus optional scrubbed-text structuring (`qwen/qwen3.8-27b`, verified on Groq `/v1/models` on `23 Nov 2026`).
   - **Voice Reconciliation (`voice-parser.ts`)**: Reconciles English and Hinglish shortage/rate notes (`whisper-large-v3-turbo`) with Devanagari digits, unit aliases (`kg`, `g`, `l`, `ml`, `bag`, `pkt`, `box`, `strip`, `ctn`, `case`, `nag`, `doz`), negation guards, prompt-guard quarantine, and `unmatched_manual` review routing.
   - **Adversarial & DPDP Controls (`prompt-guard.ts`, `dpdp-privacy.ts`)**: Screens 6 injection families (`PG-A` to `PG-F`) plus bounded base64/base64url/hex decoding and default-ignorable strip with `64 KiB` regex guards. Forces server-side PII scrubbing (`0` / `+91` phones, emails including OCR space-dot `@domain com` breaks, PAN, Aadhaar-like numbers, UPI) before `qwen/qwen3.8-27b` egress and disk storage while preserving statutory 15-character GSTINs (`DPDP s.3(c)(ii)` note on proprietor GSTINs embedding business PAN). Discloses raw voice audio transfer to Groq Whisper, interactive consent (`dpdp-v1.3-2026-11`), DPDP ss. 11 to 14 rights (`access`, `correction`, `erasure`, `grievance redressal`, `nomination`), and contact `princejain756@gmail.com`.
   - **Governance Ledger, Rate Limits & Tally XML (`governance-ledger.ts`, `rate-limit.ts`)**: Tamper-evident unkeyed SHA-256 chain (`SCN-01`..`SCN-04`), server verdict gating (`humanApprovalAllowed` + latest-decision-wins), Automation Bias Monitor (`n >= 50`, `> 95%` approval, `0 <= median dwell < 3s`), per-IP token buckets, audio/image/PDF HTTP `415` magic-byte checks, consent-withdrawal preservation of 4 genesis rows, CSV formula neutralization, and balanced `0n`-sum Tally Purchase XML (`Round Off` + symmetric `CGST=SGST`, label `Schema-Validated XML Export (Not Tally-Import Verified)`).
   - **Stage 4 Demo Boundary**: Unauthenticated single-tenant sandbox (`store-ganesh-blr-01`); synthetic or consented test uploads only (do not upload unredacted private invoices); multi-tenant store auth, scheduled 30-day raw-media auto-purge, Kannada/Tamil UI notices, and real-owner Gate 4 sign-off remain pre-pilot backlog before Gate 5.

## Provenance & Commit Ledger

| Stage | Commit / Tag | Scope & Verified Artifacts |
| :- | :- | :- |
| Baseline Freeze (V1) | `c3448909` (`a0955eb2` live code) | `KC-BENCH-1795371589353`, `KC-E2E-1795371646383`, `KC-EXT-1795371735107` (`19/19` unit tests) |
| Hardened Code Freeze (V2) | `68995703` (`6899570`) | Date-effective GST 2.0, SCN-01 upload leak fix, server verdict/export gates, rate/budget guards, DPDP v1.3 (`22/22` unit tests) |
| Live V2 & Held-Out Runs | `8adcc2de` (`8adcc2d`) | Additive `KC-BENCH-V2-1795385433456`, `KC-E2E-V2-1795385498833`, `KC-EXT-DEV-1795385623952`, `KC-EXT-HELDOUT-1795385812602` |
| Benchmarks UI Fix | `19c97e83` (`19c97e8`) | Fixed `BenchmarksClient.tsx` `low_contrast` `0/8 guard-detected` accounting, miss taxonomy formatting, and `0`-attack held-out scope card |
| Final Stage 4 Freeze (v2.0) | `7c53b407` (`v2.0-stage4-final`) | MIT `LICENSE`, updated `README.md`, and refreshed live screenshots |
| Single-SME B2B Upgrade (v2.1) | `v2.1-stage4-final` (`HEAD`) | `66` HSN/SAC headings, production `pdftotext` + `pdftoppm` scanned-PDF OCR, buyer-first GSTIN & SAC summary parsing, OCR email scrub fix, and anonymized real-SME B2B JSON/UI validation (`23/23` unit tests) |

## Quantitative Benchmark Results

All baseline (`V1`) and additive (`V2` / held-out) JSON payloads are served from `GET /api/benchmarks` and pinned identically in `src/data/` and NeuraViz Stage 4 deliverables:

1. **500-Bill Synthetic Rule-Core Suite (`KC-BENCH-1795371589353` V1 & `KC-BENCH-V2-1795385433456` V2, Seed `1263026516`)**:
   - Detection (both V1 & V2): `99.4%` F1 (`[98.5, 100]` bootstrap CI), `100%` Precision (`[98.4, 100]`), `98.8%` Recall (`[96.4, 99.6]`, `237 TP / 0 FP / 3 FN` in `voice_shortage`), `0%` Clean FPR (`0/220`), `40/40` blur abstentions, `460/460` math exact, `50/50` red-team guarded & canary-scrubbed (`allGatesPassed: true`), max fairness gap across fixture tags `1.5 pp F1 / 2.9 pp Recall` (`<= 5.0 pp`).
   - In-process rule compute (`2,500` runs, excluding IO/OCR/ASR): `p50 = 0.022 ms / p95 = 0.063 ms / max = 0.469 ms` (V1) and `p50 = 0.038 ms / p95 = 0.099 ms / max = 0.605 ms` (V2).

2. **Live HTTPS E2E OCR & Whisper Study (`KC-E2E-1795371646383` V1 & `KC-E2E-V2-1795385498833` V2)**:
   - Tested over HTTPS against `khatacheck.prince.sh` across `19` bill images (`15` crisp generated PNGs + `1` phone photo of printed Scenario 1 synthetic bill + `3` blurred `< 85` controls) + `5` ElevenLabs TTS audio clips (`whisper-large-v3-turbo`).
   - **V1 Baseline (`a0955eb2`)**: `100%` (`16/16`) clarity pass, `100%` (`3/3`) blur abstain, `94.6%` (`53/56`) line-count recall (`46/46` crisp, `7/10` photo), `100%` (`16/16`) grand totals, `93.8%` (`15/16`) GSTIN (`E2E-IMG-06` `O/0` clean FP), `94.7%` (`18/19`) exact category-set match; all-19 `/api/analyze` `p50 = 1,642.2 ms / p95 = 3,801.0 ms (n=19 max)`, 16-OCR API `p50 = 1,715.5 ms`, server clarity+OCR `p50 = 1,429.4 ms / p95 = 2,805.3 ms`; `5` audio clips `100%` (`4/4`) shortage/rate recall, `0` negation FP, `2/2` PII scrub, ASR `p50 = 215.2 ms`, voice E2E `p50 = 507.2 ms / p95 = 968.1 ms`.
   - **V2 Rerun (`6899570`)**: `100%` (`16/16`) clarity, `3/3` blur abstain, `100%` (`16/16`) grand totals, `94.6%` line recall, `93.8%` GSTIN, API `p50 = 2,175.1 ms / p95 = 4,607.0 ms` (paced), `4/4` audio recall (`asr p50 = 221.1 ms`, `e2e p50 = 5,264.5 ms`); exact match moved to `63.2%` (`12/19`) because `4` pre-Sep-2025 PNGs print `12%/18%` slabs now flagged under GST 2.0, plus `2` non-masking multi-faults and `E2E-IMG-16` OCR arithmetic variance (`usedLlmStructurer: false`).

3. **Third-Party Dataset Benchmarks (`Divya52/indian-gst-invoices`, CC BY 4.0)**:
   - **Clean Headline First (`KC-EXT-1795371735107`, 49 sampled bills: 25 clean + 24 attacks)**: On the `25` clean bills (`15` synthetic + `10` regional), grand totals matched **`72.0%` (`18/25`)**: clean digital `100%` (`6/6` GT, `6/6` GSTIN, `100%` lines, `0%` arith FP), scan `100%` (`6/6` GT, `3/6` `50%` GSTIN, `96.4%` lines, `33.3%` arith FP), and noisy mobile photo **`46.2%` (`6/13` GT, `46.2%` GSTIN, `50.0%` lines, `53.8%` arith FP; `0/13` fully defect-free -> `53.8 pp` end-to-end capture gap vs `<= 5 pp` synthetic fixture tag parity)**, with `0/25` prompt-guard FP and `9/25` (`36%`) clean arithmetic FP vs printed math (`API p50 = 1,367.8 ms / p95 = 2,016.0 ms` overall).
   - **24 Visual Prompt-Injection Attacks (reported separately)**: `24/24` (`100%`) `grandTotalPreserved`, `22/24` (`91.7%`) `attackDefeated`, `12/24` (`50%`) guard detect (`visible_note` `8/8`, `tiny` `4/8`, `low_contrast` `0/8` guard-detected because the low-contrast note went unextracted by OCR while pixels stayed isolated from LLM); both defeated misses occurred on `no_review` (`inj_007` tiny, `inj_008` low-contrast). Combined 49-bill blend is `85.7%` (`42/49`). Dev post-hardening rerun `KC-EXT-DEV-1795385623952` held `72.0%` (`18/25`) clean, `0/25` guard FP, `8/25` (`32%`) clean arith FP, `24/24` attack GT preserved (`21/24` defeated, `inj_003` `gstin_swap/visible_note`, `inj_007` `no_review/tiny`, `inj_008` `no_review/low_contrast`).
   - **50-Bill Disjoint Held-Out Evaluation (`KC-EXT-HELDOUT-1795385812602`, `seed = 20261123`)**: Drawn strictly excluding baseline indices and `idx < 5` diagnostic offsets (`30` synthetic + `20` regional): **`76.0%` (`38/50`) clean grand totals** (`16/16` `100%` clean digital, `15/15` `100%` scan, `7/19` `36.8%` noisy photo; `23/30` `76.7%` synthetic, `15/20` `75.0%` regional), `76.2%` (`141/185`) lines, `64.0%` (`32/50`) GSTIN, **`0/50` clean prompt-guard FP**, `38%` (`19/50`) clean arith FP, `API p50 = 1,317.5 ms / p95 = 2,939.3 ms`.

4. **Anonymized Single-SME Real B2B Validation (`src/data/real-sme-b2b-results.json`, strict offline `env -u GROQ_API_KEY`)**:
   - Evaluated offline against **11 genuine B2B GST PDFs** (`7` Indian vendors across `7` state codes `06, 07, 08, 09, 27, 29, 33`; `10` digital PDFs + `1` scanned image-only PDF; `3` pre-GST-2.0 + `8` post-GST-2.0) plus **9 handwritten non-GST boutique slips** (`8` unique physical slips):
     - **Progression (`11` B2B PDFs)**: frozen `v2.0` (`0/11` raw PDFs) -> zero-shot `v2.1-alpha` (`10/11` extracted, `11/11` valid GSTINs, `5/11` exact totals, `6/11` HSN/SAC) -> **`v2.1` final** (**`11/11` extracted** incl. `1/1` scanned PDF via `pdftoppm` + Tesseract, **`11/11` valid supplier GSTINs**, **`11/11` exact date & GST 2.0 schedule**, **`8/11` HSN/SAC matched**, **`9/11` exact grand totals**; `p50 = 28.0 ms`, `max = 4,167.1 ms` scanned). Unmatched items: `REAL-B2B-01` excluded a separate footer shipping charge (`2.1%` delta) and `REAL-B2B-10` fell back safely on a multi-column airline tax table.
     - **Handwritten OOD Stress Check (`9` photos / `8` unique slips)**: `9/9` clarity pass, **`9/9` safe `0`-paise manual fallback (`0` hallucinated totals)**, `9/9` OCR space-dot email scrub verified; independent ground-truth audit also caught `1` real `Rs 5,400` arithmetic overcharge carried onto a follow-up slip.

**Field Pilot & Manual Timing Status:** Multi-store **10-shop Bengaluru field pilot** remains **Not Run (Gate 5 Hold)** (above validation covers `1` registered SME only, zero public real-bill uploads, zero PII retained). Both Stage 3's `12 to 25 min/bill` (multi-page kirana assumption) and an SME estimate of `9 to 15 min` across `5` real 1-to-6 line B2B PDFs (`~1.8 to 3.0 min/bill`) remain **unmeasured estimates** pending stopwatch timing.

## Third-Party Dataset Attribution (CC BY 4.0)

External evaluation images originate from **[Divya52/indian-gst-invoices](https://huggingface.co/datasets/Divya52/indian-gst-invoices)** (commit `fece40b9a96ac3949934fc05c714853a5283d730`), licensed under **Creative Commons Attribution 4.0 International (CC BY 4.0)**.

- **Exact Modifications & Usage by KhataCheck**:
  1. Evaluated `24` visual prompt-injection variant images from the repository (`inj_000..inj_023` generated across `visible_note`, `tiny`, and `low_contrast` overlay styles) alongside sampled clean synthetic and regional images without overwriting upstream dataset files.
  2. Built stratified sampling benchmark scripts (`scripts/run_external_hf_benchmark.mjs`) selecting deterministic `49`-bill dev (`15` synthetic + `10` regional + `24` injections) and strictly disjoint `50`-bill held-out (`seed=20261123`, excluding `idx < 5` probe offsets including `syn_0_00000`, `syn_0_00012`, `inj_000`, `inj_005`, `reg_003` and all baseline indices) slices, recording anonymized aggregate telemetry only (zero raw invoice images persisted).

## License & Reproduction

Code in this repository is licensed under the **MIT License** ([LICENSE](LICENSE)).

```bash
npm ci
npm test                 # 23/23 unit tests pass
npm run typecheck && npm run lint
npm run benchmark        # Synthetic 500-bill + 50-attack suite (v2)
npm run build && npm start

# Live HTTPS OCR/ASR & external Divya52 benchmarks against a running server:
KHATACHECK_BASE_URL=http://127.0.0.1:3000 npm run benchmark:e2e
KHATACHECK_BASE_URL=http://127.0.0.1:3000 npm run benchmark:external
```
