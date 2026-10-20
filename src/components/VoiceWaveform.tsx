import { useEffect, useRef, type RefObject } from 'react';

/** Independent paint loop: capture/VAD samples never make the whole composer
 * render at display frequency. Start at the left, then scroll subpixel-smooth. */
export function VoiceWaveform({level}: {level: RefObject<number>}) {
    const canvas = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const el = canvas.current, ctx = el?.getContext('2d');
        if (!el || !ctx) return;
        let frame = 0, last = performance.now(), sampleAt = last, envelope = 0, peak = 0;
        let width = 0, height = 0, color = '';
        const values: number[] = [];
        const resize = () => {
            const box = el.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
            width = box.width; height = box.height;
            el.width = Math.max(1, Math.round(width * ratio)); el.height = Math.max(1, Math.round(height * ratio));
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            color = getComputedStyle(el).color;
        };
        resize();
        const observer = new ResizeObserver(resize); observer.observe(el);
        const draw = (now: number) => {
            const dt = Math.min(80, Math.max(0, now - last)); last = now;
            const target = Math.min(1, Math.sqrt(Math.max(0, level.current)) * 2.6);
            envelope += (target - envelope) * (1 - Math.exp(-dt / (target > envelope ? 30 : 110)));
            peak = Math.max(peak, envelope);
            if (now - sampleAt >= 80) { values.push(peak); peak = envelope; sampleAt = now; }
            const count = Math.max(1, Math.ceil(width / 7));
            if (values.length > count + 1) values.splice(0, values.length - count - 1);
            const fraction = Math.min(1, (now - sampleAt) / 80);
            const shift = values.length >= count ? fraction * 7 : 0;
            ctx.clearRect(0, 0, width, height); ctx.fillStyle = color;
            values.forEach((value, i) => {
                const grow = i === values.length - 1 ? fraction : 1;
                const bar = Math.max(3, value * (height - 6) * grow);
                ctx.beginPath(); ctx.roundRect(i * 7 - shift, (height - bar) / 2, 3.5, bar, 2); ctx.fill();
            });
            frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
        return () => { cancelAnimationFrame(frame); observer.disconnect(); };
    }, [level]);
    return <canvas ref={canvas} aria-label="Уровень звука микрофона"/>;
}
