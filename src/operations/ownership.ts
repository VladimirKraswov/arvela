import { NotDispatched } from './journal';
import { invoke } from '@tauri-apps/api/core';
import { isNative } from '../native/platform';
/** Memory-only native quit lease; never persists credentials or kills a server. */
export async function ownWork(endpoint:string, directory:string, sessionId:string, messageId:string, authorization?:string):Promise<void> {
  try { if(isNative()) await invoke('own_work',{work:{endpoint,directory,sessionId,messageId,authorization:authorization??null}}); } catch(error) { throw new NotDispatched(String(error)); }
}
