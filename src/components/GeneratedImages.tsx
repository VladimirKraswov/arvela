import {useEffect,useRef,useState} from 'react';
import type {GeneratedImage,ImageResult} from '../images/results';
import {capabilityNative} from '../capabilities/integration';
import {AttachmentViewer} from './AttachmentViewer';
function Preview({image,onOpen}:{image:GeneratedImage;onOpen:(url:string)=>void}){
 const [src,setSrc]=useState(''),[error,setError]=useState('');const button=useRef<HTMLButtonElement>(null);
 useEffect(()=>{let current=true;let observer:IntersectionObserver|undefined;const load=()=>{void capabilityNative<string>('image_asset',{fileUrl:image.previewUrl??image.url}).then(v=>{if(current)setSrc(v)}).catch(()=>{if(current)setError('Превью на компьютере агента')})};
 if(typeof IntersectionObserver==='undefined')load();else{observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer?.disconnect();load()}},{rootMargin:'200px'});if(button.current)observer.observe(button.current)}return()=>{current=false;observer?.disconnect()}},[image.url,image.previewUrl]);
 return <button ref={button} className="generated-image-preview" onClick={()=>onOpen(image.url)} title={image.name}>{src?<img loading="lazy" src={src} alt={image.name}/>:<span>{error||'Загрузка превью…'}</span>}<small>{image.name}</small></button>
}
export default function GeneratedImages({result}:{result:ImageResult}){
 const [opened,setOpened]=useState<{url:string;key:string}|null>(null),[error,setError]=useState('');
 const open=async(url:string)=>{setError('');try{setOpened({url:await capabilityNative<string>('image_asset',{fileUrl:url}),key:url})}catch(e){setError(String(e))}};
 return <div className="generated-images" aria-label="Созданные изображения"><div className="generated-images-grid">{result.images.map(image=><Preview key={image.url} image={image} onOpen={url=>void open(url)}/>)}</div><small>PNG сохранены в рабочей папке агента: .enki/generated-images/{result.archive?' · Набор: images.zip':''}</small>{error&&<p role="alert">{error}</p>}{opened&&<AttachmentViewer files={[{key:opened.key,name:'Созданное изображение.png',mime:'image/png',url:opened.url}]} onClose={()=>setOpened(null)}/>}</div>
}
