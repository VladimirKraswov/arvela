/** Binary drafts live outside localStorage, which cannot safely hold pasted files. */
export interface DraftAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  blob: Blob;
}

interface StoredAttachment extends DraftAttachment { scope: string }
const DB = "ocdesktop-attachments-v1";
const STORE = "files";
const empty: DraftAttachment[] = [];
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const cache = new Map<string, DraftAttachment[]>();
const loading = new Map<string, Promise<void>>();
const pending = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();
let database: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const table = request.result.createObjectStore(STORE, { keyPath: "id" });
      table.createIndex("scope", "scope", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}

async function all(scope: string): Promise<DraftAttachment[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).index("scope").getAll(scope);
    request.onsuccess = () => resolve((request.result as StoredAttachment[]).map(({ scope: _scope, ...item }) => item));
    request.onerror = () => reject(request.error);
  });
}

async function write(items: StoredAttachment[], remove: string[] = []): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    for (const id of remove) tx.objectStore(STORE).delete(id);
    for (const item of items) tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function emit() { for (const listener of listeners) listener(); }
function serialize<T>(scope: string, task: () => Promise<T>): Promise<T> {
  const previous = pending.get(scope) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  pending.set(scope, next);
  void next.finally(() => { if (pending.get(scope) === next) pending.delete(scope); }).catch(() => {});
  return next;
}
export const attachmentDrafts = {
  snapshot(scope: string) { return cache.get(scope) ?? empty; },
  subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
  async ensure(scope: string) {
    if (cache.has(scope)) return;
    if (!loading.has(scope)) loading.set(scope, all(scope).then(items => {
      cache.set(scope, items); emit();
    }).finally(() => loading.delete(scope)));
    await loading.get(scope);
  },
  add(scope: string, files: File[]) { return serialize(scope, async () => {
    await this.ensure(scope);
    const existing = cache.get(scope) ?? empty;
    if (existing.length + files.length > 12) throw new Error("Можно приложить не более 12 файлов к одному запросу.");
    if (files.some(file => !file.size || file.size > MAX_ATTACHMENT_BYTES))
      throw new Error("Каждый файл должен быть непустым и не больше 50 МБ.");
    if (existing.reduce((n, file) => n + file.size, 0) + files.reduce((n, file) => n + file.size, 0) > MAX_ATTACHMENT_BYTES)
      throw new Error("Общий размер вложений не должен превышать 50 МБ.");
    const items = files.map(file => ({
      id: crypto.randomUUID(), name: file.name || "Вложение", mime: file.type,
      size: file.size, blob: file as Blob,
    }));
    await write(items.map(item => ({ ...item, scope })));
    cache.set(scope, [...existing, ...items]); emit();
    return items;
  }); },
  remove(scope: string, ids: string[]) { return serialize(scope, async () => {
    await this.ensure(scope);
    const owned = (cache.get(scope) ?? empty).filter(item => ids.includes(item.id)).map(item => item.id);
    await write([], owned);
    cache.set(scope, (cache.get(scope) ?? empty).filter(item => !ids.includes(item.id))); emit();
  }); },
  copy(from: string, to: string, ids: string[]) { return serialize(to, async () => {
    await Promise.all([this.ensure(from), this.ensure(to)]);
    const source = ids.map(id => (cache.get(from) ?? empty).find(file => file.id === id));
    if (new Set(ids).size !== ids.length || source.some(file => !file))
      throw new Error("Вложения не найдены. Верните запрос в черновик и приложите файлы заново.");
    const existing = cache.get(to) ?? empty;
    const items = source.map(file => ({ ...file!, id: crypto.randomUUID() }));
    if (existing.length + items.length > 12 || [...existing, ...items].reduce((n, file) => n + file.size, 0) > MAX_ATTACHMENT_BYTES)
      throw new Error("В черновике слишком много вложений: до 12 файлов и 50 МБ.");
    await write(items.map(item => ({ ...item, scope: to })));
    cache.set(to, [...existing, ...items]); emit();
    return items;
  }); },
  async move(from: string, to: string) {
    if (from === to) return;
    await Promise.all([this.ensure(from), this.ensure(to)]);
    const source = cache.get(from) ?? empty;
    if (!source.length) return;
    await write(source.map(item => ({ ...item, scope: to })));
    cache.set(to, [...(cache.get(to) ?? empty), ...source]);
    cache.set(from, []); emit();
  },
};

export function attachmentScope(endpoint: string, directory: string | null, sessionId: string | null) {
  return JSON.stringify([endpoint, directory, sessionId]);
}
