import {useEffect, useRef, useState} from 'react';
import {Icon} from './Icon';
export function CopyButton({text,label,compact=false}:{text:string;label:string;compact?:boolean}) {
 const [state,setState]=useState<'idle'|'done'|'error'>('idle');const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 const copy=async()=>{
  try {await navigator.clipboard.writeText(text);setState('done');} catch {setState('error');}
  clearTimeout(timer.current);timer.current=setTimeout(()=>setState('idle'),2400);
 };
 const title=state==='done'?'Скопировано':state==='error'?'Не удалось скопировать — попробуйте снова':label;
 return <span className="copy-control"><button type="button" className="message-action" title={title} aria-label={title} onClick={()=>void copy()}>
  <Icon name={state==='done'?'check':'copy'} size={15}/>{!compact&&<span>{state==='idle'?'Копировать':state==='done'?'Скопировано':'Ошибка копирования'}</span>}
 </button><span className="sr-only" role="status">{state==='idle'?'':title}</span></span>;
}
