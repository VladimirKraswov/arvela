let active=false,handedOff=false;
export const maintenance={
  active:()=>active,
  handoff(){if(!active)throw Error("Maintenance is not active");handedOff=true;},
  async run<T>(fn:()=>Promise<T>):Promise<T>{
    if(active)throw Error('Уже выполняется обслуживание приложения.');
    active=true;try{return await fn();}finally{active=handedOff;}
  },
};
