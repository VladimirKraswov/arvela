// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {registerSessionSpinner} from '../src/components/SessionSpinner';
afterEach(()=>{vi.unstubAllGlobals();document.body.innerHTML='';});
it('uses one frame for all indicators and keeps their phase through row moves/remounts',()=>{
 let next:FrameRequestCallback|undefined;const raf=vi.fn((fn:FrameRequestCallback)=>{next=fn;return 1;});vi.stubGlobal('requestAnimationFrame',raf);vi.stubGlobal('cancelAnimationFrame',vi.fn());
 const a=document.createElement('span'),b=document.createElement('span');document.body.append(a,b);
 const stopA=registerSessionSpinner(a),stopB=registerSessionSpinner(b);expect(raf).toHaveBeenCalledOnce();
 next!(212.5);expect(a.style.transform).toBe('rotate(90deg)');expect(b.style.transform).toBe(a.style.transform);
 document.body.prepend(b);next!(425);expect(a.style.transform).toBe('rotate(180deg)');expect(b.style.transform).toBe(a.style.transform);
 stopA();a.remove();const c=document.createElement('span');document.body.append(c);const stopC=registerSessionSpinner(c);next!(637.5);expect(c.style.transform).toBe('rotate(270deg)');expect(b.style.transform).toBe(c.style.transform);
 stopB();stopC();expect(vi.mocked(cancelAnimationFrame)).toHaveBeenCalled();
});
it('honors reduced motion and resumes all nodes when the preference changes',()=>{
 let change:(()=>void)|undefined,next:FrameRequestCallback|undefined;
 const media={matches:true,addEventListener:vi.fn((_e:string,fn:()=>void)=>{change=fn;}),removeEventListener:vi.fn()};
 vi.stubGlobal('matchMedia',()=>media);const raf=vi.fn((fn:FrameRequestCallback)=>{next=fn;return 1;});vi.stubGlobal('requestAnimationFrame',raf);vi.stubGlobal('cancelAnimationFrame',vi.fn());
 const a=document.createElement('span');document.body.append(a);const stop=registerSessionSpinner(a);expect(raf).not.toHaveBeenCalled();expect(a.style.transform).toBe('rotate(0deg)');
 media.matches=false;change!();expect(raf).toHaveBeenCalledOnce();next!(425);expect(a.style.transform).toBe('rotate(180deg)');stop();expect(media.removeEventListener).toHaveBeenCalled();
});
