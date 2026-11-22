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
   - `governance-ledger.ts`: Append-only SHA-256 hash-chained audit ledger (`data/audit-ledger.jsonl`), copy-only tamper simulator, Automation Bias Monitor (`n >= 50` gate, alerts if approval > 95% and median dwell < 3s), 5-Gate Lifecycle sign-off matrix, and TallyPrime XML **Sandbox Profile** export.
   - **Stage 4 Demo Boundary**: The deployed web routes and API endpoints run unauthenticated inside an isolated synthetic single-tenant sandbox (`store-ganesh-blr-01`) with zero live merchant records; production multi-tenant store auth and per-store credentialing are scoped for post-pilot rollout.

## Executed Synthetic Benchmark Results (Seed `1263026516`)

All quantitative accuracy and security metrics below come from our local seeded synthetic benchmark suite (`npm run benchmark`):

- **Dataset**: 500 synthetic bills (220 clean, 240 substantive faults across 6 categories, 40 low-clarity abstentions) plus 50 adversarial prompt-injection/exfiltration cases and 50 clean controls under `Synthetic Oracle v1 (Demo Fixture Scope)`.
- **Substantive Detection**: F1 `99.4%` (`[98.5, 100]` 95% bootstrap CI), Precision `100%` (`[98.4, 100]` 95% Wilson CI), Recall `98.8%` (`[96.4, 99.6]` 95% Wilson CI), `237 TP / 0 FP / 3 FN`.
- **Clean Bill & Clarity Gates**: Clean false-positive rate `0%`, Clarity abstentions `40 / 40`, Deterministic BigInt math accuracy `100%` (`460 / 460`).
- **5-Subgroup Fairness Launch Gate (`<= 5.0%` rule)**: Macro mean F1 `99.4%`, max F1 gap below mean `1.5%`, max recall gap below mean `2.9%` (`handwritten_challan` stratum).
- **Red-Team Resilience**: `50 / 50` blocked/isolated, `50 / 50` tax integrity unchanged, `50 / 50` zero PII leaks.
- **Latency & Pilot Status**: In-process deterministic compute across `2,500` runs (`5` passes): `p50 = 0.015 ms`, `p95 = 0.023 ms`, `max = 0.2 ms`. Manual kirana reconciliation baseline runs `12 to 25 min` active time per bill plus `7 to 30 days` GST filing lag. The registered 10-store, 4-week Bengaluru shadow pilot is currently `NOT_RUN`, with `t0 -> t_flag` telemetry instrumented and ready for launch Gate 5 sign-off.

## Reproduction

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run benchmark
npm run build
npm start
```
