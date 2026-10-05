import {parseConfig,updateConfig} from "./configEditor";
import {isAbsoluteLocalPath} from "../util/paths";
export const COMPUTER_MCP="cua_desktop";
export type ComputerStatus={platform?:string;supported?:boolean;installed:boolean;enabled:boolean;version:string;command:string;skillPath:string;
  permissions:{accessibility?:boolean;screen_recording?:boolean;screen_recording_capturable?:boolean|null;daemon_running?:boolean;status?:string;refusal?:{code?:string};uia?:boolean;interactive_session?:boolean;windows_visible?:boolean}};
export function computerReadinessError(status:ComputerStatus):string|undefined{
  const p=status.permissions;
  if(status.supported===false||p.status==="unsupported"||(status.platform!==undefined&&!["macos","windows"].includes(status.platform)))return "Управление native-окнами недоступно на этой платформе. Используйте инструменты браузера.";
  if(p.status==="refused")return p.refusal?.code==="authorization_suspended"
    ?"Управление отозвано экстренной остановкой. Нажмите «Подключить», чтобы начать новый сеанс драйвера."
    :"Cua Driver отказал в доступе. Проверьте его разрешения и настройки.";
  if(status.platform==="windows"){
    if(p.interactive_session!==true)return "Cua Driver не видит интерактивный рабочий стол Windows. Войдите в сеанс и повторите проверку.";
    if(p.uia!==true||p.windows_visible!==true)return "Cua Driver не подтвердил доступ к UI Automation и окнам Windows. Запустите диагностику драйвера.";
    return;
  }
  if(p.accessibility!==true||p.screen_recording!==true)return "Драйвер не подтвердил доступность и запись экрана. Откройте «Разрешения macOS…», затем проверьте подключение.";
}
export function computerConfig(source:string,status:ComputerStatus,enabled:boolean){
  if(!isAbsoluteLocalPath(status.command)||!isAbsoluteLocalPath(status.skillPath))throw new Error("Нужны абсолютные пути приложения и навыка.");
  const value=parseConfig(source),existing=(value.mcp as Record<string,unknown>|undefined)?.[COMPUTER_MCP] as {command?:string[]}|undefined;
  if(existing&&existing.command?.[1]!=="--computer-mcp")throw new Error("Имя cua_desktop уже занято другой интеграцией. Существующие настройки сохранены.");
  const config={type:"local" as const,command:[status.command,"--computer-mcp"],enabled,timeout:45000};
  let content=updateConfig(source,["mcp",COMPUTER_MCP],config);
  const skills=value.skills as {paths?:unknown}|undefined;
  if(skills?.paths!==undefined&&(!Array.isArray(skills.paths)||!skills.paths.every(x=>typeof x==="string")))throw new Error("Проверьте skills.paths в конфигурации OpenCode.");
  const paths=(skills?.paths??[]) as string[];
  if(enabled&&!paths.includes(status.skillPath))content=updateConfig(content,["skills","paths"],[...paths,status.skillPath]);
  return {content,config};
}
export function isLocalComputer(endpoint:string,remote:boolean):boolean{
  try{return !remote&&["127.0.0.1","localhost","[::1]"].includes(new URL(endpoint).hostname);}catch{return false;}
}
