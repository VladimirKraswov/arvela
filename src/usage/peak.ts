/**
 * DeepSeek peak-hours schedule for the model picker hint. Mirrors the embedded
 * snapshot in src-tauri/src/pricing.rs (UTC, Mon–Fri, excluding Chinese public
 * holidays — not modelled). The picker hint is approximate and network-free;
 * the usage ledger still prices from the fetched book.
 */

export const DEEPSEEK_PEAK_DAYS = [1, 2, 3, 4, 5];
export const DEEPSEEK_PEAK_WINDOWS = [
  { startHour: 1, endHour: 4 },
  { startHour: 6, endHour: 10 },
];

export interface PeakStatus {
  peak: boolean;
  /** Ms until the current peak window ends, set only when `peak` is true. */
  untilMs: number | null;
}

/** Whether DeepSeek is currently in a peak window, and how long until it ends. */
export function deepseekPeakStatus(now = Date.now()): PeakStatus {
  const date = new Date(now);
  const isoDay = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  if (!DEEPSEEK_PEAK_DAYS.includes(isoDay)) return { peak: false, untilMs: null };
  const hour = date.getUTCHours();
  const window = DEEPSEEK_PEAK_WINDOWS.find(w => hour >= w.startHour && hour < w.endHour);
  if (!window) return { peak: false, untilMs: null };
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), window.endHour);
  return { peak: true, untilMs: end - now };
}

/** "45 мин", "2 ч 15 мин" — human duration until cheap hours, floored to a minute. */
export function formatUntilCheap(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}
