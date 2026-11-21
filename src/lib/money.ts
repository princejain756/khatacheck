export function halfUpDiv(n: bigint, d: bigint): bigint {
  if (d <= 0n) {
    throw new Error("Denominator must be positive");
  }
  if (n >= 0n) {
    return (2n * n + d) / (2n * d);
  }
  const absN = -n;
  return -((2n * absN + d) / (2n * d));
}

export function parseINRToPaise(raw: string | number | bigint | null | undefined): bigint {
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) throw new Error("Non-finite rupee value");
    return parseINRToPaise(raw.toFixed(2));
  }
  const text = String(raw ?? "").trim();
  if (!text) return 0n;
  // Accept optional sign, digits (or valid grouped commas), optional up to 2 decimal places
  const cleaned = text.replace(/^[₹\s]+/g, "").replace(/,/g, "").trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    throw new Error(`Invalid INR amount string: ${JSON.stringify(raw)}`);
  }
  const neg = match[1] === "-";
  const whole = BigInt(match[2]);
  const fracRaw = (match[3] ?? "").padEnd(2, "0");
  const paise = whole * 100n + BigInt(fracRaw || "0");
  return neg && paise !== 0n ? -paise : paise;
}

export function bigIntAbs(v: bigint): bigint {
  return v < 0n ? -v : v;
}

export function formatPaiseINR(
  paiseInput: string | bigint | number | null | undefined,
  options?: { forceDecimals?: boolean; showSymbol?: boolean }
): string {
  let paise = 0n;
  try {
    if (typeof paiseInput === "bigint") {
      paise = paiseInput;
    } else if (typeof paiseInput === "number") {
      paise = Number.isFinite(paiseInput) ? BigInt(Math.round(paiseInput)) : 0n;
    } else if (typeof paiseInput === "string" && /^-?\d+$/.test(paiseInput.trim())) {
      paise = BigInt(paiseInput.trim());
    }
  } catch {
    paise = 0n;
  }

  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const rupees = abs / 100n;
  const remPaise = Number(abs % 100n);
  const wholeFormatted = rupees.toLocaleString("en-IN");
  const showDecimals = options?.forceDecimals || remPaise !== 0;
  const decPart = showDecimals ? `.${String(remPaise).padStart(2, "0")}` : "";
  const sign = neg && abs > 0n ? "-" : "";
  const sym = options?.showSymbol === false ? "" : "₹";
  return `${sign}${sym}${wholeFormatted}${decPart}`;
}

export function formatPaiseDecimalString(paiseInput: string | bigint): string {
  const paise = typeof paiseInput === "bigint" ? paiseInput : BigInt(paiseInput || "0");
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const rupees = abs / 100n;
  const rem = Number(abs % 100n);
  const sign = neg && abs > 0n ? "-" : "";
  return `${sign}${rupees.toString()}.${String(rem).padStart(2, "0")}`;
}

export function formatINR(
  value: number | string | null | undefined,
  options?: { decimals?: number; showSymbol?: boolean }
): string {
  const n = typeof value === "string" ? Number(value) : Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const round2 = Math.round((safe + Number.EPSILON) * 100) / 100;
  const decimals = options?.decimals ?? (Number.isInteger(round2) ? 0 : 2);
  const formatter = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const magnitude = formatter.format(Math.abs(safe));
  const roundedToZero = !formatter
    .formatToParts(Math.abs(safe))
    .some((part) => (part.type === "integer" || part.type === "fraction") && /[1-9]/.test(part.value));
  const sign = safe < 0 && !roundedToZero ? "-" : "";
  const sym = options?.showSymbol === false ? "" : "₹";
  return sign + sym + magnitude;
}

export function formatINRCompact(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const abs = Math.abs(safe);
  const sign = safe < 0 ? "-" : "";

  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2).replace(/\.00$/, "")}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2).replace(/\.00$/, "")}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return formatINR(safe);
}

export function formatCount(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : Number(value ?? 0);
  const safe = Number.isFinite(n) ? Math.trunc(n) : 0;
  return new Intl.NumberFormat("en-IN").format(safe);
}

export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}
