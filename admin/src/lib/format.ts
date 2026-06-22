function numberValue(value?: string | number | null): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * 千位分隔符整数  12345 → "12,345"
 */
export function formatInteger(value?: string | number | null): string {
  const numeric = numberValue(value);
  if (numeric == null) return "--";
  return Math.round(numeric).toLocaleString("en-US");
}

/**
 * 千位分隔符小数  12345.6789 → "12,345.68"
 */
export function formatDecimal(value?: string | number | null): string {
  const numeric = numberValue(value);
  if (numeric == null) return "--";
  return numeric.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * 百分比  0.156789 → "15.68%"
 */
export function formatPercent(value?: string | number | null): string {
  const numeric = numberValue(value);
  if (numeric == null) return "--";
  return `${(numeric * 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/**
 * 金额  $1,000,000.00
 */
export function formatMoney(value?: string | number | null): string {
  const numeric = numberValue(value);
  if (numeric == null) return "--";
  return `$${numeric.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * 非定距小数（如 Sharpe 保留 2 位但不强制定距）  4.036 → "4.04"
 */
export function formatRatio(value?: string | number | null): string {
  const numeric = numberValue(value);
  if (numeric == null) return "--";
  return numeric.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
