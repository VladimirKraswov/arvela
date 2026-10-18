/** Recording duration is unlimited; these thresholds bound individual decodable
 * clips. Think for 30s safely; only 60s of observed silence ends the microphone. */
export const SILENCE_STOP_MS = 60000;
export const MIN_PHRASE_MS = 3000;
export const HARD_CLIP_MS = 15000;
export const PAUSE_MS = 650;
export const OVERLAP_MS = 700;
export class VoiceTiming {
    private silence = 0;
    private lastSample: number;
    private clipStarted: number;
    private noise = 0.002;
    private speechInClip = false;
    constructor(now: number) { this.lastSample = now; this.clipStarted = now; this.speechInClip = false; }
    sample(now: number, rms: number | null) {
        // Wall-clock gaps (sleep/background throttling) are not observed silence.
        const elapsed = Math.min(1000, Math.max(0, now - this.lastSample));
        this.lastSample = now;
        const voiced = rms !== null && rms >= Math.max(0.006, Math.min(0.02, this.noise * 2.5));
        if (rms !== null) {
            if (voiced) {
                this.silence = 0;
                this.speechInClip = true;
            }
            else {
                this.silence += elapsed;
                this.noise = this.noise * 0.98 + rms * 0.02;
            }
        }
        const age = now - this.clipStarted;
        return { level: rms ?? 0, silence: this.silence, stop: this.silence >= SILENCE_STOP_MS,
            rotate: age >= HARD_CLIP_MS || (this.speechInClip && age >= MIN_PHRASE_MS && this.silence >= PAUSE_MS),
            overlap: this.silence < PAUSE_MS };
    }
    rotated(now: number) { this.clipStarted = now; this.speechInClip = false; }
}
