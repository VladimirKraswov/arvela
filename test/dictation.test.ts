import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { VoiceTiming, SILENCE_STOP_MS } from '../src/voice/segmenter';
import { DictationJournal, dictationScope, type DictationSegment } from '../src/voice/journal';
import { TranscriptionQueue, withoutOverlap } from '../src/voice/transcriptionQueue';
import { defaultAsr } from '../src/voice/asr';
import { SegmentedCapture, flushDictationCapture } from '../src/voice/capture';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const segment = (sequence = 0): DictationSegment => ({ id: crypto.randomUUID(), group: 'test', scope: dictationScope('host', 'draft'), workspace: 'host', draft: 'draft', settings: defaultAsr, created: 1, sequence, overlap: false, mime: 'audio/webm', parts: [new Blob(['audio'])], complete: true });
function memory() { const records = new Map<string, DictationSegment>(); return { records, ready: async () => { }, list: async (scope: string) => [...records.values()].filter(r => r.scope === scope).sort((a, b) => a.sequence - b.sequence), put: vi.fn(async (s: DictationSegment) => { records.set(s.id, { ...s, parts: [...s.parts] }); }), remove: vi.fn(async (id: string) => { records.delete(id); }) }; }
it('keeps thirty-second thinking pauses, resets silence after speech and stops after one minute', () => {
    const timing = new VoiceTiming(0);
    let state = timing.sample(250, 0.1);
    for (let t = 500; t <= 30250; t += 250) {
        state = timing.sample(t, 0);
        expect(state.stop).toBe(false);
    }
    expect(timing.sample(30500, 0.1).silence).toBe(0);
    for (let t = 30750; t < 30500 + SILENCE_STOP_MS; t += 250)
        expect(timing.sample(t, 0).stop).toBe(false);
    expect(timing.sample(30500 + SILENCE_STOP_MS, 0).stop).toBe(true);
});
it('has no total recording cutoff, uses short clips and never mistakes a sleep gap for silence', () => {
    const timing = new VoiceTiming(0);
    let rotations = 0;
    for (let t = 250; t <= 10 * 60000; t += 250) {
        const state = timing.sample(t, 0.1);
        expect(state.stop).toBe(false);
        if (state.rotate) {
            rotations++;
            expect(state.overlap).toBe(true);
            timing.rotated(t);
        }
    }
    expect(rotations).toBeGreaterThan(30);
    expect(timing.sample(20 * 60000, 0).stop).toBe(false);
});
it('finds natural phrase boundaries without cutting during a short hesitation', () => {
    const t = new VoiceTiming(0);
    t.sample(250, 0.1);
    t.sample(3000, 0.1);
    expect(t.sample(3250, 0).rotate).toBe(false);
    expect(t.sample(3500, 0).rotate).toBe(false);
    expect(t.sample(3750, 0)).toMatchObject({ rotate: true, overlap: false, stop: false });
});
it('removes only multiword forced-cut seams; preserves normal repetition', () => {
    expect(withoutOverlap('проверяем работу системы', 'работу системы и завершаем.', true)).toBe('и завершаем.');
    expect(withoutOverlap('Да, да.', 'Да, да.', false)).toBe('Да, да.');
    expect(withoutOverlap('пять', 'пять минут', true)).toBe('пять минут');
});
it('persists audio across journal instances and preserves scope isolation', async () => {
    const journal = new DictationJournal(), record = segment();
    record.scope = crypto.randomUUID();
    await journal.put(record);
    const restored = await new DictationJournal().list(record.scope);
    const db = await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('arvela-dictation-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const raw = await new Promise<any>(resolve=>{const request=db.transaction('segments').objectStore('segments').get(record.id);request.onsuccess=()=>resolve(request.result);});
    expect(raw.parts[0]).toBeInstanceOf(ArrayBuffer);db.close();
    expect(restored).toHaveLength(1);
    expect(await new Blob(restored[0].parts).text()).toBe('audio');
    expect(await journal.list('another-session')).toEqual([]);
    await journal.remove(record.id);
    expect(await journal.list(record.scope)).toEqual([]);
});
it('processes serially in order, retains failed audio, then retries without duplicating delivered text', async () => {
    const storage = memory(), a = segment(), b = segment(1);
    await storage.put(a);
    await storage.put(b);
    const transcribe = vi.fn().mockResolvedValueOnce('первая фраза').mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce('вторая фраза');
    const append = vi.fn(), changed = vi.fn();
    const queue = new TranscriptionQueue(storage, a.scope, { append, tail: () => '' }, changed, transcribe);
    await Promise.all([queue.drain(), queue.drain()]);
    expect(append).toHaveBeenCalledTimes(1);
    expect(storage.records.has(a.id)).toBe(false);
    expect(storage.records.has(b.id)).toBe(true);
    expect(changed).toHaveBeenCalledWith('offline');
    await queue.retry();
    expect(append.mock.calls.map(c => c[1])).toEqual(['первая фраза', 'вторая фраза']);
    expect(storage.records.size).toBe(0);
});
it('keeps recognized text until durable draft acknowledgement and retries delivery without another ASR call', async () => {
    const storage = memory(), a = segment();
    await storage.put(a);
    const transcribe = vi.fn().mockResolvedValue('текст');
    const append = vi.fn().mockRejectedValueOnce(Error('disk full')).mockResolvedValue(undefined);
    const queue = new TranscriptionQueue(storage, a.scope, { append, tail: () => '' }, () => { }, transcribe);
    await queue.drain();
    expect(storage.records.get(a.id)?.text).toBe('текст');
    await queue.retry();
    expect(transcribe).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledTimes(2);
    expect(storage.records.size).toBe(0);
});
it('recovers interrupted clips only on explicit retry and never finalizes active clips', async () => {
    const storage = memory(), a = { ...segment(), complete: false };
    await storage.put(a);
    const transcribe = vi.fn().mockResolvedValue('restored'), append = vi.fn();
    const queue = new TranscriptionQueue(storage, a.scope, { append, tail: () => '' }, () => { }, transcribe);
    await queue.drain();
    expect(transcribe).not.toHaveBeenCalled();
    await queue.retry(new Set([a.id]));
    expect(transcribe).not.toHaveBeenCalled();
    await queue.retry();
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ id: a.id }), 'restored');
});
it('creates independently headed clips, checkpoints partial audio, and flush waits for final persistence', async () => {
    vi.useFakeTimers();
    const storage = memory();
    let level = 150;
    const stopped = vi.fn();
    const tracks = vi.fn();
    const recorders: any[] = [];
    vi.stubGlobal('MediaRecorder', class {
        static isTypeSupported() { return true; }
        state = 'inactive';
        mimeType = 'audio/webm';
        ondataavailable: any;
        onstop: any;
        onerror: any;
        constructor() { recorders.push(this); }
        start() { this.state = 'recording'; this.ondataavailable({ data: new Blob(['header-' + recorders.length]) }); }
        stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['tail']) }); this.onstop(); }
    });
    const context = { state: 'running', close: async () => { }, createMediaStreamSource: () => ({ connect() { } }), createAnalyser: () => ({ fftSize: 1024, getByteTimeDomainData: (array: Uint8Array) => array.fill(level) }) } as unknown as AudioContext;
    const capture = new SegmentedCapture({ getTracks: () => [{ stop: tracks }] } as unknown as MediaStream, context, storage, 'host', 'draft', defaultAsr, { progress() { }, segmentReady() { }, stopped, error() { } });
    capture.start();
    await vi.advanceTimersByTimeAsync(120000);
    expect(recorders.length).toBeGreaterThan(6);
    expect(stopped).not.toHaveBeenCalled();
    level = 128;
    await vi.advanceTimersByTimeAsync(30000);
    expect(stopped).not.toHaveBeenCalled();
    await flushDictationCapture();
    expect(stopped).toHaveBeenCalledOnce();
    expect(tracks).toHaveBeenCalledOnce();
    const records = await storage.list(dictationScope('host', 'draft'));
    expect(records.every(r => r.complete)).toBe(true);
    for (const r of records)
        expect(await new Blob(r.parts).text()).toMatch(/^header-\d+tail$/);
});
it('never uploads a segment when its durable checkpoint cannot be written',async()=>{
 const storage=memory(),record=segment();await storage.put(record);
 storage.put.mockRejectedValueOnce(Error('quota'));
 const transcribe=vi.fn().mockResolvedValue('text');
 const queue=new TranscriptionQueue(storage,record.scope,{append:vi.fn(),tail:()=>''},()=>{},transcribe);
 await queue.drain();expect(transcribe).not.toHaveBeenCalled();expect(storage.records.has(record.id)).toBe(true);
 await queue.retry();expect(transcribe).toHaveBeenCalledOnce();
});
it('stops waiting for a broken recorder and keeps partial checkpoints recoverable',async()=>{
 vi.useFakeTimers();const storage=memory(),stopTrack=vi.fn(),error=vi.fn(),stopped=vi.fn();
 vi.stubGlobal('MediaRecorder',class{
  static isTypeSupported(){return true;}
  state='inactive';mimeType='audio/mp4';ondataavailable:any;onstop:any;
  start(){this.state='recording';this.ondataavailable({data:new Blob(['partial-container'])});}
  stop(){this.state='inactive';} // browser fails to dispatch its final stop event
 });
 const capture=new SegmentedCapture({getTracks:()=>[{stop:stopTrack}]} as unknown as MediaStream,null,storage,'host','draft',defaultAsr,{progress(){},segmentReady(){},error,stopped});
 capture.start();const finishing=capture.finish();await vi.advanceTimersByTimeAsync(5000);await finishing;
 expect(stopTrack).toHaveBeenCalledOnce();expect(stopped).toHaveBeenCalledOnce();expect(error).toHaveBeenCalledOnce();
 const records=await storage.list(dictationScope('host','draft'));expect(records[0].complete).toBe(false);expect(await new Blob(records[0].parts).text()).toBe('partial-container');
});
