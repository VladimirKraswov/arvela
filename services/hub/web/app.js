'use strict';
const $=s=>document.querySelector(s), n=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const fmt=v=>new Intl.NumberFormat('ru').format(v||0), date=v=>v?new Date(v).toLocaleString('ru'):'—';
const memoryLink=new URLSearchParams(location.search);
let admin=false, tab=memoryLink.has('memory')?'memory':'metrics', generation=0, detailGeneration=0;
async function api(path,body){const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store'});const d=await r.json();if(!r.ok){if(r.status===401)showLogin();throw Error(d.error||'Нет подключения');}return d;}
function fail(e){$('#error').textContent=e.message||String(e);}
function button(text,fn){const b=n('button',text);b.onclick=async()=>{b.disabled=true;$('#error').textContent='';try{await fn();}catch(e){fail(e);}finally{b.disabled=false;}};return b;}
function card(title,subtitle){const c=n('section',undefined,'card');if(title)c.append(n('h2',title));if(subtitle)c.append(n('p',subtitle));return c;}
function table(headers,rows){const box=n('div',undefined,'scroll'),t=n('table'),head=n('tr');headers.forEach(h=>head.append(n('th',h)));t.append(head);rows.forEach(row=>{const tr=n('tr');row.forEach(v=>{const td=n('td');td.append(v instanceof Node?v:n('span',v));tr.append(td);});t.append(tr);});box.append(t);return box;}
function showLogin(){generation++;detailGeneration++;$('#detail').close();$('#detail-body').replaceChildren();$('#view').replaceChildren();$('#workspace').hidden=true;$('#login').hidden=false;$('#logout').hidden=true;}
async function start(){const me=await api('me');admin=!!me.admin;$('#login').hidden=true;$('#workspace').hidden=false;$('#logout').hidden=false;await render();}
$('#login-form').onsubmit=async e=>{e.preventDefault();const token=$('#key').value;$('#key').value='';try{await api('login',{token});await start();}catch(e){fail(e);}};
$('#logout').onclick=async()=>{try{await api('logout',{});}catch{}showLogin();};
$('#close-dialog').onclick=()=>$('#detail').close();
$('#detail').addEventListener('close',()=>{detailGeneration++;$('#detail-body').replaceChildren();});
$('#nav').onclick=e=>{if(e.target.dataset.tab){tab=e.target.dataset.tab;render().catch(fail);}};
function dialog(content,expected=generation){if(expected!==generation)return;$('#detail-body').replaceChildren(content);$('#detail').showModal();}
async function render(){const g=++generation;$('#error').textContent='';$('#view').textContent='Загрузка…';for(const b of $('#nav').children){b.removeAttribute('aria-current');if(b.dataset.tab===tab)b.setAttribute('aria-current','page');}
const view=n('div');
if(tab==='metrics'){
const devices=await api('devices'),controls=n('div',undefined,'actions'),device=n('select'),days=n('select');device.setAttribute('aria-label','Устройство');device.append(n('option','Все устройства'));device.firstChild.value='';devices.devices.filter(d=>!d.admin).forEach(d=>{const o=n('option',d.name+' · '+d.platform);o.value=d.id;device.append(o);});days.setAttribute('aria-label','Период');for(const count of [7,30,90,365]){const o=n('option',count+' дней');o.value=count;o.selected=count===30;days.append(o);}controls.append(device,days);view.append(controls);const body=n('div');view.append(body);
let request=0;async function load(){const r=++request,m=await api('metrics?days='+days.value+'&device='+encodeURIComponent(device.value));if(g!==generation||r!==request)return;body.replaceChildren();const tiles=n('div',undefined,'grid');for(const [label,value] of [['Токенов',m.totals.total],['Ответов',m.totals.replies],['Сессий в хранилище',m.counts.sessions],['Записей в библиотеке',m.counts.catalog]]){const c=card(label);c.append(n('div',fmt(value),'metric'));tiles.append(c);}body.append(tiles);const c=card('По моделям',m.attribution+' '+m.reasoning);c.append(table(['Модель / агентский режим','Вход','Выход','Кэш: чтение','Кэш: запись','Всего','Ответы'],m.models.map(x=>[x.model+' · '+x.engine+' · '+(x.variant||'по умолчанию'),fmt(x.input),fmt(x.output),fmt(x.cacheRead),fmt(x.cacheWrite),fmt(x.total),fmt(x.replies)])));if(!m.models.length)c.append(n('p','Пока нет данных. Включите передачу истории на устройстве Arvela.'));body.append(c);const history=card('По дням · UTC');const peak=Math.max(1,...m.days.map(x=>x.total));m.days.forEach(x=>{history.append(n('div',x.day+' · '+fmt(x.total)));const b=n('progress',undefined,'bar');b.max=peak;b.value=x.total;history.append(b);});body.append(history);const tools=card('Инструменты');tools.append(table(['Название','Вызовы','Ошибки','Суммарное время'],m.tools.map(x=>[x.name,fmt(x.calls),fmt(x.errors),fmt(Math.round(x.durationMs/1000))+' с'])));body.append(tools);}device.onchange=()=>load().catch(fail);days.onchange=()=>load().catch(fail);await load();
}else if(tab==='catalog'){
const d=await api('catalog');view.append(n('h1','Библиотека'),n('p','Версии сохраняются. Пакеты загружаются в Arvela по вашему выбору; сервис их не выполняет.'));
for(const x of d.items){const c=card(x.title,x.description),row=n('div',undefined,'row');row.append(n('small',x.kind+' · '+x.revision.slice(0,12)+(x.enabled?'':' · выключено')),button('Посмотреть пакет',async()=>{const data=await api('catalog/'+x.id);const a=card(x.title);a.append(n('pre',JSON.stringify(data,null,2)));dialog(a,g);}));c.append(row);view.append(c);}if(!d.items.length)view.append(card('Библиотека пока пуста'));
if(admin){const c=card('Добавить или обновить пакет','JSON: id, kind (skill / prompt / tool / template / runbook), title, description, files. При обновлении нужен expectedRevision из текущего каталога. Секреты запрещены.');const input=n('textarea');input.setAttribute('aria-label','JSON пакета');input.placeholder='{"id":"my-skill","kind":"skill","title":"Навык","files":{"SKILL.md":"---\\nname: my-skill\\ndescription: Описание\\n---\\nИнструкции"}}';c.append(input,button('Опубликовать версию',async()=>{await api('catalog',JSON.parse(input.value));await render();}));view.append(c);}
 }else if(tab==='diagnostics'){
 const d=await api('diagnostics'), summary=card('Разбор работы','Анализ сохранённой истории; исходные сессии не изменяются.');
 summary.append(n('p',`${fmt(d.records)} сообщений · ${fmt(d.sessions)} сессий · ${fmt(d.tools)} вызовов инструментов · ${fmt(d.toolErrors)} со статусом error · ${fmt(d.agentErrors)} ошибок агента.`));
 summary.append(n('p',`Период записей: ${date(d.from)} — ${date(d.to)}. ${fmt(d.repliesWithNonzeroUsage)} ответов имеют ненулевой usage. Импортированная история без usage не подходит для сравнения скорости моделей.`));
 summary.append(n('p',d.note));
 if(d.truncated)summary.append(n('p',`Показан ограниченный срез: ${fmt(d.records)} из ${fmt(d.recordsAvailable)} сообщений.`, 'danger'));
 view.append(summary);
 const filter=n('select');filter.setAttribute('aria-label','Тип проблем');
 for(const [value,label] of [['all','Все записи'],['review','Для технического разбора'],['expected','Отказы и отмены']]){const o=n('option',label);o.value=value;filter.append(o);}
 view.append(filter);const groups=n('div');view.append(groups);
 function show(){groups.replaceChildren();const selected=d.groups.filter(x=>filter.value==='all'||(filter.value==='review'?x.review:!x.review));
  for(const x of selected){const c=card(x.label,`${fmt(x.count)} записей · ${fmt(x.sessionCount)} сессий · ${x.review?'Кандидат для проверки':'Ожидаемое ограничение / отмена'}`);
   c.append(n('p',x.advice),n('small',Object.entries(x.tools).map(([name,count])=>name+' '+fmt(count)).join(' · ')));
   const links=n('div',undefined,'actions');for(const session of x.sessions)links.append(button((session.project||'Проект')+' · '+session.engine,()=>openSession(session.id,session.title)));c.append(links);groups.append(c);
  }if(!selected.length)groups.append(card('В этом срезе записей нет'));}
 filter.onchange=show;show();
 }else if(tab==='sessions'){
 view.append(n('h1','История'),n('p','Все сохранённые сессии, постранично. Внутри открываются последние сообщения; более ранние можно подгрузить. Одобрение помечает всю сессию как кандидат для дальнейшей подготовки датасета.'));
 const list=n('div');view.append(list);let cursor=null;const seen=new Set();
 const more=button('Показать ещё сессии',load);view.append(more);
 async function load(){const d=await api('sessions?limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):''));if(g!==generation)return;
  for(const session of d.sessions){if(seen.has(session.id))continue;seen.add(session.id);const c=card(session.title||'Сессия',session.engine+' · '+session.project+' · '+date(session.updated)+' · '+session.verdict);
   c.append(button('Открыть',()=>openSession(session.id,session.title)));list.append(c);}
  cursor=d.nextCursor;more.hidden=!cursor;if(!seen.size)list.append(card('История пока пуста'));
 }await load();
 if(admin)view.append(button('Экспорт одобренных · JSONL',async()=>{const d=await api('export');if(g!==generation)return;const url=URL.createObjectURL(new Blob([d.jsonl],{type:'application/x-ndjson'})),a=n('a');a.href=url;a.download='arvela-reviewed-candidates.jsonl';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
 }else if(tab==='memory'){
const d=await api('memory');view.append(n('h1','Память проектов'),n('p','Проверенные владельцем сведения, общие для OpenCode и Pi. Это контекст, а не инструкции: AGENTS.md и контрольные записи остаются главными. Автоматической передачи агентам и обучения нет.'));
const select=n('select');select.setAttribute('aria-label','Проект памяти');select.append(n('option','Выберите проект'));select.firstChild.value='';
for(const p of d.projects){const o=n('option',p.title);o.value=p.id;select.append(o);}if(d.projects.some(p=>p.id===memoryLink.get('memory')))select.value=memoryLink.get('memory');view.append(select);const body=n('div');view.append(body);let request=0;
async function load(){const r=++request;body.replaceChildren();if(!select.value)return;const m=await api('memory?project='+encodeURIComponent(select.value));if(g!==generation||r!==request)return;
 const p=m.projects.find(x=>x.id===select.value),header=card(p.title,'Переносимый код проекта: '+p.id);header.append(n('p','Пути и Git-адреса не связывают проекты автоматически. Изменение источника обнаруживается после синхронизации его устройства. Истечение срока проверяется сервером.'));body.append(header);
 for(const e of m.entries){const state={candidate:'Ждёт вашей проверки',approved:'Одобрено вами',stale:'Неактуально',expired:'Срок истёк'}[e.state],c=card(e.title,state+' · '+(e.kind==='fact'?'факт':'порядок действий')+' · версия '+e.revision);
 c.id='memory-'+e.id;if(e.id===memoryLink.get('entry'))c.append(n('p',Number(memoryLink.get('revision'))===e.revision?'Версия ссылки актуальна.':'Версия ссылки изменилась; показаны текущие данные.'));c.append(n('pre',e.text),n('small',e.source.engine+' · источник '+e.source.anchor+' / '+e.source.revision+' · до '+date(e.expiresAt)+' · обновлено '+date(e.updated)));
 const actions=n('div',undefined,'actions');for(const [action,label] of [['approve','Одобрить запись'],['invalidate','Снять актуальность']]){if(action==='approve'?e.state!=='candidate':!['candidate','approved'].includes(e.state))continue;actions.append(button(label,async()=>{await api('memory',{action,id:e.id,expected:e.revision});if(g===generation)await load();}));}c.append(actions);body.append(c);
 }if(!m.entries.length)body.append(card('Записей пока нет','Создайте кандидата из принятого результата задачи в Arvela.'));
}select.onchange=()=>load().catch(fail);if(select.value)await load();if(!d.projects.length)body.append(card('Проектов пока нет','Свяжите папку с новым проектом памяти в контексте задачи Arvela.'));
}else if(tab==='issues'){
const d=await api('issues');view.append(n('h1','Проблемы для разбора'),n('p','Повторяющиеся ошибки сгруппированы автоматически. Это кандидаты, а не доказанные дефекты. Во внешние трекеры ничего не публикуется.'));
for(const x of d.issues){const c=card(x.title,x.state+' · '+x.occurrences+' повторов · '+x.sessions+' сессий');c.append(n('pre',x.example));if(admin){const actions=n('div',undefined,'actions');for(const [label,state] of [['Подтвердить','confirmed'],['Игнорировать','ignored'],['Исправлено','resolved']])actions.append(button(label,async()=>{await api('issues/review',{id:x.id,state});await render();}));c.append(actions);}view.append(c);}if(!d.issues.length)view.append(card('Зафиксированных ошибок пока нет'));
}else if(tab==='devices'){
const d=await api('devices');view.append(n('h1','Устройства'),table(['Название','Система','Версия','Последняя передача','Доступ'],d.devices.map(x=>[x.name,x.platform,x.app_version||'—',date(x.seen),x.revoked?'Отозван':x.admin?'Администратор':admin?button('Отозвать',async()=>{await api('devices/revoke',{id:x.id});await render();}):'Активен'])));
if(admin){const c=card('Подключить новое устройство','Отдельный ключ для каждого компьютера. После создания он показывается только один раз. Укажите его в Arvela → Облачная библиотека.');const name=n('input');name.placeholder='Например, рабочий Windows';name.setAttribute('aria-label','Название устройства');const os=n('select');for(const x of ['windows','macos','linux'])os.append(n('option',x));os.setAttribute('aria-label','ОС устройства');c.append(name,os,button('Создать ключ',async()=>{const d=await api('devices',{name:name.value,platform:os.value}),a=card('Ключ создан','Сохраните его сейчас. Не отправляйте его в чаты, Git или URL.');a.append(n('pre',d.token),button('Копировать ключ',()=>navigator.clipboard.writeText(d.token)));dialog(a,g);}));view.append(c);}
}else if(tab==='settings'){
const d=await api('settings'),c=card('Сроки хранения','Тексты очищаются по расписанию. Метаданные хранятся дольше; резервные копии имеют собственную ротацию. Каталог и его версии сохраняются.');const text=n('input'),meta=n('input');text.type=meta.type='number';text.value=d.retention.textDays;meta.value=d.retention.metadataDays;const l=n('label','Тексты, дней'),m=n('label','Метаданные, дней');l.append(text);m.append(meta);text.disabled=meta.disabled=!admin;c.append(l,m);if(admin)c.append(button('Сохранить',async()=>{await api('settings',{textDays:Number(text.value),metadataDays:Number(meta.value)});await render();}));view.append(c);}
if(g===generation)$('#view').replaceChildren(view);
}
start().catch(e=>{if(!/Войдите|ключ/i.test(e.message))fail(e);});

async function openSession(id,title){
 const token=++detailGeneration,detail=card(title||'Сессия'),status=n('p','Загрузка…'),records=n('div'),seen=new Set();
 detail.append(status,records);dialog(detail);let cursor=null,total=0;
 const current=()=>token===detailGeneration&&$('#detail').open;
 const more=button('Показать более ранние сообщения',load);more.hidden=true;detail.insertBefore(more,records);
 async function load(){
  const d=await api('sessions/'+encodeURIComponent(id)+'?direction=older&limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):''));if(!current())return;
  total=d.total;const page=n('div');for(const r of d.records){if(seen.has(r.id))continue;seen.add(r.id);
   const part=card(r.role==='user'?'Запрос':'Ответ',r.model+' · '+r.variant+' · '+date(r.created)+' · '+fmt(r.total)+' токенов');
   part.append(n('pre',r.text||'Текст не передан / удалён по сроку хранения.'));if(r.error)part.append(n('p',r.error,'danger'));
   if(r.tools.length)part.append(table(['Инструмент','Статус','Время','Ошибка'],r.tools.map(t=>[t.name,t.status,fmt(t.durationMs)+' мс',t.error])));
   for(const x of r.diagnostics||[]){const d=x.metrics,c=card('Время задачи · '+x.deviceName,'Завершение ответа не означает проверку результата. Источник: '+d.source+' · '+d.state),ms=v=>v==null?'Не измерено':(v/1000).toFixed(1)+' с';c.append(table(['Фаза','Время'],[['Полное время',ms(d.wallMs)],['Очередь Desktop',ms(d.queueMs)],['Подготовка Desktop',ms(d.preparationMs)],['Первый ответ после отправки',ms(d.firstResponseMs)],['Инструменты',ms(d.toolMs)],['Рассуждения',ms(d.reasoningMs)],['Вне известных фаз',ms(d.unattributedMs)]]),n('small','Фазы пересекаются. Очередь сервера/prefill не измерены; повторный вызов инструмента не обязательно ошибка.'),n('p','Вызовы / ошибки / повторные вызовы: '+d.calls+' / '+d.failed+' / '+d.repeatedCalls));part.append(c);}
   for(const a of r.assessments||[]){const verdict={accepted:'Принято пользователем',needs_work:'Нужна доработка',unreviewed:'Не проверено'}[a.verdict]||'Не проверено';const result=card('Оценка результата · '+a.deviceName,verdict+' · версия '+a.revision);result.append(n('small','Проверки указаны пользователем; принятие задачи не одобряет сессию для датасета.'),n('h3','Цель'),n('pre',a.goal||'Текст удалён по сроку хранения.'),n('h3','Критерии приёмки'),n('pre',a.criteria||'—'));if(a.notes)result.append(n('pre',a.notes));if(a.checks.length)result.append(table(['Проверка','Указанный результат','Подтверждение'],a.checks.map(x=>[x.name,{passed:'Прошла',failed:'Не прошла',not_run:'Не выполнена'}[x.status]||'—',x.evidence])));part.append(result);}
   if(r.truncated)part.append(n('small','Текст ограничен 16 000 символами.'));page.append(part);
  }records.prepend(page);cursor=d.nextCursor;more.hidden=!cursor;status.textContent=`Показано ${fmt(seen.size)} из ${fmt(total)} сообщений. Отбор для датасета относится ко всей сессии.`;
  return d;
 }
 try{const d=await load();if(!d||!current())return;
  if(admin){const notes=n('textarea');notes.value=d.session.notes;notes.setAttribute('aria-label','Заметка для анализа');detail.append(notes);
   const actions=n('div',undefined,'actions');for(const [label,verdict] of [['Одобрить','approved'],['Отклонить','rejected'],['Снять оценку','unreviewed']])actions.append(button(label,async()=>{
    await api('sessions/review',{id,verdict,notes:notes.value});if(!current())return;$('#detail').close();await render();
   }));detail.append(actions);
  }
 }catch(e){if(current()){status.textContent='Историю не удалось загрузить.';fail(e);}}
}
