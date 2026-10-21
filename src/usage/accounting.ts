// IO layer over the incremental usage cache, the closed-day money ledger and
// the price/rate snapshot. Native files are CAS-guarded (sha256); in the plain
// browser (no Tauri) we fall back to the direct scan without any money panel.

import { isNative } from "../native/platform";
import {
  CACHE_FILE,
  LEDGER_FILE,
  emptyCache,
  refreshUsageCache,
  reportFromCache,
  type UsageCache,
} from "./cache";
import {
  emptyLedger,
  moneyTotals,
  modelMoney,
  settleLedger,
  type DayModelMoney,
  type LedgerDoc,
  type MoneySnapshot,
  type PriceBook,
} from "./money";
import type { UsageSource } from "./metrics";
import type { UsagePeriod, UsageReport } from "./metrics";

export const DAY_MS = 24 * 3600 * 1000;

interface StoredFileDto {
  content: string;
  sha: string;
}

interface Stored<T> {
  value: T;
  sha: string;
}

async function native<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isNative()) throw new Error("Доступно только в установленном приложении.");
  return (await import("@tauri-apps/api/core")).invoke<T>(command, args);
}

async function readStored<T>(name: string): Promise<Stored<T> | null> {
  const stored = await native<StoredFileDto | null>("read_usage_file", { name });
  if (!stored) return null;
  try {
    return { value: JSON.parse(stored.content) as T, sha: stored.sha };
  } catch {
    return null;
  }
}

async function writeStored<T>(name: string, value: T, expectedSha: string | null): Promise<boolean> {
  try {
    await native<StoredFileDto>("write_usage_file", {
      name,
      content: JSON.stringify(value),
      expectedSha,
    });
    return true;
  } catch {
    // A concurrent writer won the race; the fresh in-memory data is still shown.
    return false;
  }
}

export interface MoneyView {
  snapshot: MoneySnapshot;
  spentRub: number;
  savedRub: number;
  today: { spentRub: number; savedRub: number };
  perModel: Record<string, DayModelMoney>;
}

export interface UsageComputation {
  report: UsageReport;
  money: MoneyView | null;
  notes: string[];
  /** In-memory state to keep so period switching costs nothing. */
  cache: UsageCache;
  ledger: LedgerDoc;
  snapshot: MoneySnapshot | null;
}

/** Refreshes cache + prices + ledger, then reports the period from the cache. */
export async function computeUsage(
  sources: UsageSource[],
  period: UsagePeriod,
  signal: AbortSignal,
  options: { refreshPrices?: boolean; onProgress?: (done: number, found: number) => void } = {},
): Promise<UsageComputation> {
  const now = Date.now();
  if (!isNative()) {
    // No persistent storage in the plain browser: build the same in-memory cache
    // so period switching stays a filter there too.
    const refresh = await refreshUsageCache(sources, emptyCache(), signal, options.onProgress);
    const report = reportFromCache(refresh.cache, period, now, refresh.failures);
    return { report, money: null, notes: ["Денежная оценка доступна в установленном приложении."], cache: refresh.cache, ledger: emptyLedger(), snapshot: null };
  }
  const storedCache = await readStored<UsageCache>(CACHE_FILE);
  const cache = storedCache?.value?.schema === 1 ? storedCache.value : emptyCache();
  const refresh = await refreshUsageCache(sources, cache, signal, options.onProgress);
  if (refresh.changed)
    await writeStored(CACHE_FILE, refresh.cache, storedCache?.sha ?? null);

  const storedLedger = await readStored<LedgerDoc>(LEDGER_FILE);
  const ledger = storedLedger?.value?.schema === 1 ? storedLedger.value : emptyLedger();
  const notes: string[] = [...refresh.failures.map(f => `${f} — часть ответов могла не попасть в расчёт`)];
  let snapshot = ledger.prices ?? null;
  const stale = !snapshot || now - snapshot.rate.checkedAt >= DAY_MS;
  if (stale || options.refreshPrices) {
    const fresh = await refreshSnapshot(snapshot, options.refreshPrices ? "принудительно" : "по расписанию 24 ч");
    if (fresh) snapshot = fresh.snapshot;
    notes.push(...fresh?.notes ?? []);
  }
  let settledLedger = ledger;
  let cacheSaved = true;
  if (snapshot) {
    const settle = settleLedger(refresh.cache, snapshot, ledger, now);
    if (settle.changed) {
      settledLedger = settle.ledger;
      cacheSaved = await writeStored(LEDGER_FILE, settledLedger, storedLedger?.sha ?? null);
    }
  }
  const report = reportFromCache(refresh.cache, period, now, refresh.failures);
  let money: MoneyView | null = null;
  if (snapshot) {
    const totals = moneyTotals(refresh.cache, snapshot, settledLedger, now);
    const { periodStart } = await import("./metrics");
    money = {
      snapshot,
      spentRub: totals.spentRub,
      savedRub: totals.savedRub,
      today: totals.today,
      perModel: modelMoney(refresh.cache, snapshot, periodStart(period, now), now + DAY_MS),
    };
    notes.push(...snapshot.notes);
  } else {
    notes.push("Курс доллара недоступен — денежные суммы скрыты до следующей проверки.");
  }
  if (!cacheSaved) notes.push("Файл данных использования обновлялся параллельно; показаны свежие данные из этой сессии.");
  return { report, money, notes, cache: refresh.cache, ledger: settledLedger, snapshot };
}

/** Reads the DeepSeek price book and the USD→RUB rate, keeping old values on
 * partial failure so closed-day accounting never depends on a live network. */
export async function refreshSnapshot(
  previous: MoneySnapshot | null,
  reason: string,
): Promise<{ snapshot: MoneySnapshot; notes: string[] } | null> {
  const notes: string[] = [];
  let book: PriceBook | null = previous?.book ?? null;
  try {
    book = await native<PriceBook>("fetch_price_book");
    if (book.warning) notes.push(`Прайс DeepSeek: ${book.warning}.`);
  } catch (error) {
    notes.push(`Прайс DeepSeek не обновился (${reason}): ${String(error)}.`);
  }
  let rate = previous?.rate ?? null;
  try {
    rate = await native<{ source: string; checkedAt: number; rate: number }>("fetch_usd_rate");
  } catch (error) {
    if (!rate) notes.push(`Курс доллара недоступен (${reason}): ${String(error)}.`);
    else notes.push(`Курс доллара не обновился (${reason}); используется прежний ${rate.rate.toFixed(2)} ₽.`);
  }
  if (!book || !rate) return null;
  return { snapshot: { book, rate, notes }, notes };
}
