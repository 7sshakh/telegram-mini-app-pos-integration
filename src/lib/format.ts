/** Formatting helpers safe for both client and server. */

export function formatSum(value: number): string {
  const safe = Number.isFinite(value) ? Math.round(value) : 0;
  return safe.toLocaleString("ru-RU").replace(/\u00a0/g, " ");
}

export function formatSumWithCurrency(value: number, currency = "UZS"): string {
  return `${formatSum(value)} ${currency === "UZS" ? "so‘m" : currency}`;
}

export function formatDateTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("uz-UZ", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
}

export function pluralUz(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
