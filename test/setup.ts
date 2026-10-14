import {beforeEach} from 'vitest';
// Production browser storage is always present. Node unit tests get an isolated
// equivalent; tests of storage failures can replace it explicitly.
beforeEach(()=>{
  const values=new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,writable:true,value:{
    getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,String(value));},
    removeItem:(key:string)=>{values.delete(key);},clear:()=>values.clear(),get length(){return values.size;},key:(n:number)=>[...values.keys()][n]??null,
  }});
});
