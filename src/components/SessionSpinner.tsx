import {useEffect,useRef} from 'react';

// One compositor transform clock for all session indicators. Moving a recent
// row must not restart/freeze its own WebKit CSS animation. No React frame state.
const nodes=new Set<HTMLElement>();
let frame:number|undefined,media:MediaQueryList|undefined;
const reduced=()=>media?.matches??false;
const rotate=(node:HTMLElement,now:number)=>{node.style.transform=`rotate(${((now%850)/850)*360}deg)`;};
function run(now:number) {
 frame=undefined;
 for(const node of nodes)if(node.isConnected)rotate(node,now);
 if(nodes.size&&!reduced()&&document.visibilityState!=='hidden')frame=requestAnimationFrame(run);
}
function restart() {
 if(frame!==undefined)cancelAnimationFrame(frame);frame=undefined;
 if(!nodes.size)return;
 if(reduced())for(const node of nodes)node.style.transform='rotate(0deg)';
 else if(document.visibilityState!=='hidden'&&typeof requestAnimationFrame==='function')frame=requestAnimationFrame(run);
}
export function registerSessionSpinner(node:HTMLElement) {
 if(!nodes.size) {
  media=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):undefined;
  media?.addEventListener('change',restart);
  document.addEventListener('visibilitychange',restart);
 }
 nodes.add(node);rotate(node,performance.now());
 if(frame===undefined)restart();
 return ()=>{nodes.delete(node);if(!nodes.size){if(frame!==undefined)cancelAnimationFrame(frame);frame=undefined;media?.removeEventListener('change',restart);document.removeEventListener('visibilitychange',restart);media=undefined;}};
}
export function SessionSpinner({label='Задача выполняется'}:{label?:string}) {
 const ref=useRef<HTMLSpanElement>(null);
 useEffect(()=>{if(ref.current)return registerSessionSpinner(ref.current);},[]);
 return <span ref={ref} className="session-spinner" role="status" aria-label={label} title={label}/>;
}
