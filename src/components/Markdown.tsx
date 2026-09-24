import {memo, useMemo, useState} from 'react';
import ReactMarkdown, {type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {safeExternalUrl} from '../util/markdown';
import {highlightCode} from '../chat/highlight';
import {CopyButton} from './CopyButton';
import {Icon} from './Icon';

export function CodeBlock({code,language=''}:{code:string;language?:string}) {
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState('');
 const value=editing?draft:code;
 const html=useMemo(()=>highlightCode(code,language),[code,language]);
 return <section className="code-block" aria-label={`Блок кода${language?' '+language:''}`}>
  <div className="code-toolbar"><span className="code-language">{language||'Текст'}</span>
   {editing&&<span className="code-local">Локальная копия</span>}<span className="spacer"/>
   <button className="message-action" title={editing?'Вернуть исходный код':'Изменить копию кода'} aria-label={editing?'Вернуть исходный код':'Изменить копию кода'} onClick={()=>{if(!editing)setDraft(code);setEditing(!editing);}}><Icon name={editing?'close':'edit'} size={15}/></button>
   <CopyButton text={value} label="Копировать только код"/>
  </div>
  {editing?<><textarea className="code-editor" aria-label="Редактируемая копия кода" spellCheck={false} value={draft} onChange={e=>setDraft(e.target.value)} rows={Math.max(4,Math.min(18,draft.split('\n').length))}/><div className="code-edit-note">Правки только для копирования. Ответ и файлы остаются прежними.</div></>
    :<pre tabIndex={0}><code className="hljs" dangerouslySetInnerHTML={{__html:html}}/></pre>}
 </section>;
}
const components:Components={
 pre({node,children}) {
  const code=node?.children[0];
  if(code?.type==='element'&&code.tagName==='code') {
   const text=code.children.map(n=>n.type==='text'?n.value:'').join('').replace(/\n$/,'');
   const classes=Array.isArray(code.properties.className)?code.properties.className:[];
   const language=String(classes.find(x=>String(x).startsWith('language-'))??'').slice(9);
   return <CodeBlock code={text} language={language}/>;
  }
  return <pre>{children}</pre>;
 },
 a({href,children}) {
  const safe=safeExternalUrl(href??null);
  return safe?<a href={safe} onClick={e=>{e.preventDefault();void import('@tauri-apps/plugin-opener').then(x=>x.openUrl(safe)).catch(()=>window.open(safe,'_blank','noopener,noreferrer'));}}>{children}</a>:<span>{children}</span>;
 },
 // Markdown images remain bounded; late dimensions are handled by the viewport observer.
 img({src,alt}) {return <img src={src} alt={alt??''} loading="lazy" referrerPolicy="no-referrer"/>;},
};
export const Markdown=memo(function Markdown({source}:{source:string}) {
 return <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>{source}</ReactMarkdown></div>;
});
