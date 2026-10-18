import { transcribeAudio } from './asr';
import type { DictationSegment, DictationStorage } from './journal';
/** Only remove a multiword seam from deliberately overlapping audio. Never
 * deduplicate natural pauses or normal repetitions within a spoken fragment. */
export function withoutOverlap(previous: string, next: string, overlap: boolean): string {
    if (!overlap)
        return next;
    const words = (text: string) => [...text.matchAll(/[\p{L}\p{N}]+/gu)];
    const left = words(previous.slice(-1500)), right = words(next);
    for (let n = Math.min(8, left.length, right.length); n >= 2; n--) {
        const a = left.slice(-n).map(w => w[0].toLocaleLowerCase('ru')).join(' ');
        const b = right.slice(0, n).map(w => w[0].toLocaleLowerCase('ru')).join(' ');
        if (a.length >= 8 && a === b)
            return next.slice(right[n - 1].index! + right[n - 1][0].length).replace(/^[\s,.;:!?…—-]+/u, '');
    }
    return next;
}
export interface DictationDelivery {
    append(segment: DictationSegment, text: string): void | Promise<void>;
    tail(segment: DictationSegment): string;
}
export class TranscriptionQueue {
    private running?: Promise<void>;
    private blocked = false;
    private requested = false;
    private disposed = false;
    private retrying?: Promise<void>;
    private cancel = new AbortController();
    constructor(private storage: DictationStorage, private scope: string, private delivery: DictationDelivery, private changed: (error?: string) => void, private transcribe = transcribeAudio) { }
    drain(): Promise<void> {
        if (this.running) {
            this.requested = true;
            return this.running;
        }
        if (this.blocked || this.disposed)
            return Promise.resolve();
        const work = this.run();
        this.running = work;
        void work.finally(() => { if (this.running === work)
            this.running = undefined; if (this.requested) {
            this.requested = false;
            void this.drain();
        } });
        return work;
    }
    private async run() {
        try {
            while (!this.disposed) {
                const segments = await this.storage.list(this.scope);
                // Never pass an earlier recording still waiting for its stop event.
                const segment = segments[0];
                if (!segment || !segment.complete)
                    return;
                if (!segment.parts.some(p => p.size)) {
                    await this.storage.remove(segment.id);
                    continue;
                }
                if (segment.text === undefined) {
                    await this.storage.put(segment); // durable before any network upload
                    const text = await this.transcribe(new Blob(segment.parts, { type: segment.mime }), segment.settings, this.cancel.signal, { allowEmpty: true });
                    if (this.disposed)
                        return;
                    segment.text = withoutOverlap(this.delivery.tail(segment), text, segment.overlap);
                    await this.storage.put(segment);
                }
                if (this.disposed)
                    return;
                // append persists a receipt with the draft before audio can be removed.
                await this.delivery.append(segment, segment.text);
                await this.storage.remove(segment.id);
                this.changed();
            }
        }
        catch (error) {
            if (!this.disposed) {
                this.blocked = true;
                this.changed(error instanceof Error ? error.message : String(error));
            }
        }
    }
    retry(active: ReadonlySet<string> = new Set()): Promise<void> {
        if (this.retrying)
            return this.retrying;
        const attempt = this.restore(active);
        this.retrying = attempt;
        void attempt.then(() => { this.retrying = undefined; }, () => { this.retrying = undefined; });
        return attempt;
    }
    private async restore(active: ReadonlySet<string>) {
        if (this.disposed)
            return;
        this.blocked = true;
        this.requested = false;
        await this.running;
        if (this.disposed)
            return;
        for (const segment of await this.storage.list(this.scope)) {
            if (active.has(segment.id))
                continue;
            segment.complete = true;
            await this.storage.put(segment);
        }
        this.blocked = false;
        return this.drain();
    }
    dispose() { this.disposed = true; this.cancel.abort(); }
}
