import type { AsrSettings } from './asr';
import { KeyedQueue } from '../util/keyedQueue';
/** Local microphone recovery data. Never part of Hub telemetry or preferences. */
export interface DictationSegment {
    id: string;
    group: string;
    scope: string;
    workspace: string;
    draft: string;
    settings: AsrSettings;
    created: number;
    sequence: number;
    overlap: boolean;
    mime: string;
    parts: Blob[];
    complete: boolean;
    text?: string;
}
type StoredSegment = Omit<DictationSegment, 'parts'> & {parts:ArrayBuffer[]};
export const dictationScope = (workspace: string, draft: string) => JSON.stringify([workspace, draft]);
export interface DictationStorage {
    ready(): Promise<void>;
    list(scope: string): Promise<DictationSegment[]>;
    put(segment: DictationSegment): Promise<void>;
    remove(id: string): Promise<void>;
}
export class DictationJournal implements DictationStorage {
    private database?: Promise<IDBDatabase>;
    // Keep the latest audio in memory if a durable write fails (e.g. full disk).
    // Recording stops at that point; a retry can persist it without losing it.
    private volatile = new Map<string, DictationSegment>();
    private writes = new KeyedQueue();
    private bytes = new WeakMap<Blob,Promise<ArrayBuffer>>();
    private open() {
        if (this.database)
            return this.database;
        const attempt = new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('arvela-dictation-v1', 1);
            request.onupgradeneeded = () => {
                request.result.createObjectStore('segments', { keyPath: 'id' }).createIndex('scope', 'scope');
            };
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => { db.close(); this.database = undefined; };
                db.onclose = () => { this.database = undefined; };
                resolve(db);
            };
            request.onerror = () => reject(Error('Не удалось открыть локальное хранилище диктовки.'));
        });
        this.database = attempt;
        void attempt.catch(() => { if (this.database === attempt)
            this.database = undefined; });
        return attempt;
    }
    async ready() { await this.open(); }
    async flush() {
        await this.writes.drain().catch(() => {});
        for (const segment of [...this.volatile.values()]) await this.put(segment);
    }
    async list(scope: string) {
        await this.writes.drain().catch(() => { });
        const db = await this.open();
        const saved = await new Promise<DictationSegment[]>((resolve, reject) => {
            const request = db.transaction('segments').objectStore('segments').index('scope').getAll(scope);
            request.onsuccess = () => resolve((request.result as StoredSegment[]).map(segment=>({...segment,parts:segment.parts.map(part=>new Blob([part],{type:segment.mime}))})));
            request.onerror = () => reject(Error('Не удалось прочитать сохранённую диктовку.'));
        });
        const records = new Map(saved.map(s => [s.id, s]));
        for (const s of this.volatile.values())
            if (s.scope === scope)
                records.set(s.id, s);
        return [...records.values()].sort((a, b) => a.created - b.created || a.sequence - b.sequence);
    }
    put(segment: DictationSegment) {
        const snapshot = { ...segment, settings: { ...segment.settings }, parts: [...segment.parts] };
        return this.writes.run([segment.id], async () => {
            this.volatile.set(segment.id, snapshot);
            const db = await this.open();
            // WebKit can reject Blob-backed IndexedDB writes (notably in
            // isolated/private stores). Persist plain binary buffers instead.
            const parts = await Promise.all(snapshot.parts.map(part=>{
                let bytes=this.bytes.get(part);
                if(!bytes){bytes=part.arrayBuffer();this.bytes.set(part,bytes);}
                return bytes;
            }));
            const stored:StoredSegment={...snapshot,parts};
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction('segments', 'readwrite');
                tx.objectStore('segments').put(stored);
                tx.oncomplete = () => resolve();
                tx.onabort = tx.onerror = () => reject(Error('Не удалось сохранить звук на диск. Запись остановлена; освободите место и повторите восстановление.'));
            });
            this.volatile.delete(segment.id);
        });
    }
    remove(id: string) {
        return this.writes.run([id], async () => {
            const db = await this.open();
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction('segments', 'readwrite');
                tx.objectStore('segments').delete(id);
                tx.oncomplete = () => resolve();
                tx.onabort = tx.onerror = () => reject(Error('Не удалось удалить обработанный фрагмент диктовки.'));
            });
            this.volatile.delete(id);
        });
    }
}
export const dictationJournal = new DictationJournal();
