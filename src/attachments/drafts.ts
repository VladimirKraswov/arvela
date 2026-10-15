import { KeyedQueue } from '../util/keyedQueue';

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
const mutations = new KeyedQueue();
const listeners = new Set<() => void>();
let database: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  if (database) return database;
  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const table = request.result.createObjectStore(STORE, { keyPath: "id" });
      table.createIndex("scope", "scope", { unique: false });
    };
    request.onsuccess = () => {
      const db = request.result;
      const invalidate = () => { if (database === attempt) database = undefined; };
      db.onversionchange = () => { db.close(); invalidate(); };
      db.onclose = invalidate;
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
  database = attempt;
  void attempt.catch(() => { if (database === attempt) database = undefined; });
  return attempt;
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
function checkCapacity(files: readonly DraftAttachment[]) {
  if (files.length > 12 || files.reduce((sum, file) => sum + file.size, 0) > MAX_ATTACHMENT_BYTES)
    throw new Error('В черновике слишком много вложений: до 12 файлов и 50 МБ.');
}
export const attachmentDrafts = {
  async flush() { await mutations.drain(); },
  async exportBackup() {
    const db=await open();
    const entries=await new Promise<StoredAttachment[]>((resolve,reject)=>{const r=db.transaction(STORE,'readonly').objectStore(STORE).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    if(entries.length>5000||entries.reduce((n,f)=>n+f.size,0)>128*1024*1024)throw Error('Вложения превышают лимит резервной копии 128 МБ.');
    return Promise.all(entries.map(async({blob,...meta})=>{
      const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
      for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      return {...meta,data:btoa(binary)};
    }));
  },
  async importBackup(entries:{id:string;scope:string;name:string;mime:string;size:number;data:string}[]) {
    if(entries.length>5000||entries.reduce((n,f)=>n+(typeof f.size==='number'?f.size:Infinity),0)>128*1024*1024)throw Error('Недопустимый размер резервной копии.');
    const restored=entries.map(({data,...meta})=>{
      if(!meta.id||!meta.scope||typeof data!=='string'||data.length>MAX_ATTACHMENT_BYTES*2)throw Error('Повреждено вложение резервной копии.');
      const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
      if(bytes.length!==meta.size)throw Error('Размер вложения не совпадает.');
      return {...meta,blob:new Blob([bytes],{type:meta.mime})};
    });
    await write(restored);cache.clear();emit();
  },
  snapshot(scope: string) { return cache.get(scope) ?? empty; },
  subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
  async ensure(scope: string) {
    if (cache.has(scope)) return;
    if (!loading.has(scope)) loading.set(scope, all(scope).then(items => {
      cache.set(scope, items); emit();
    }).finally(() => loading.delete(scope)));
    await loading.get(scope);
  },
  async selected(scope: string, ids: string[]) {
    // A remove click may precede Send in the same paint. Wait for that mutation,
    // then use current IDs, never blobs captured by an older React render.
    await mutations.settled(scope);
    await this.ensure(scope);
    return this.snapshot(scope).filter(file => ids.includes(file.id));
  },
  add(scope: string, files: File[]) { return mutations.run([scope], async () => {
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
  remove(scope: string, ids: string[]) { return mutations.run([scope], async () => {
    await this.ensure(scope);
    const before = cache.get(scope) ?? empty;
    const owned = before.filter(item => ids.includes(item.id)).map(item => item.id);
    cache.set(scope, before.filter(item => !ids.includes(item.id))); emit();
    try { await write([], owned); }
    catch (error) { cache.set(scope, before); emit(); throw error; }
  }); },
  copy(from: string, to: string, ids: string[]) { return mutations.run([from, to], async () => {
    await Promise.all([this.ensure(from), this.ensure(to)]);
    const source = ids.map(id => (cache.get(from) ?? empty).find(file => file.id === id));
    if (new Set(ids).size !== ids.length || source.some(file => !file))
      throw new Error("Вложения не найдены. Верните запрос в черновик и приложите файлы заново.");
    const existing = cache.get(to) ?? empty;
    const items = source.map(file => ({ ...file!, id: crypto.randomUUID() }));
    checkCapacity([...existing, ...items]);
    await write(items.map(item => ({ ...item, scope: to })));
    cache.set(to, [...existing, ...items]); emit();
    return items;
  }); },
  move(from: string, to: string) { return mutations.run([from, to], async () => {
    if (from === to) return;
    await Promise.all([this.ensure(from), this.ensure(to)]);
    const source = cache.get(from) ?? empty;
    if (!source.length) return;
    const destination = [...(cache.get(to) ?? empty), ...source];
    checkCapacity(destination);
    await write(source.map(item => ({ ...item, scope: to })));
    cache.set(to, destination);
    cache.set(from, []); emit();
  }); },
};

export function attachmentScope(endpoint: string, directory: string | null, sessionId: string | null) {
  return JSON.stringify([endpoint, directory, sessionId]);
}
