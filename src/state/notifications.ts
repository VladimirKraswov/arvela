/** State changes immediately; only paint notifications from text deltas coalesce. */
export class StreamNotifications {
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly emit:()=>void) {}
  notify(defer=false) {
    if (!defer) { this.cancel(); this.emit(); return; }
    this.timer ??= setTimeout(()=>{this.timer=undefined;this.emit();},16);
  }
  cancel() { if(this.timer!==undefined)clearTimeout(this.timer);this.timer=undefined; }
}
/** Cache a selected immutable value for useSyncExternalStore. */
export function selectedSnapshot<S,T>(read:()=>S, select:(state:S)=>T, equal:(a:T,b:T)=>boolean=Object.is) {
  let initialized=false, value:T;
  return () => {const next=select(read()); if(!initialized||!equal(value,next)){value=next;initialized=true;}return value;};
}
export function shallowEqual<T extends object>(a:T,b:T):boolean {
  const keys=Object.keys(a) as (keyof T)[];
  return keys.length===Object.keys(b).length&&keys.every(key=>Object.is(a[key],b[key]));
}
