let active=false;
export const maintenance={
  active:()=>active,
  async run<T>(fn:()=>Promise<T>):Promise<T>{
    if(active)throw Error('Уже выполняется обслуживание приложения.');
    active=true;try{return await fn();}finally{active=false;}
  },
};
