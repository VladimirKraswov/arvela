import assert from 'node:assert/strict';
import {createView} from '../src-tauri/resources/browser/view.mjs';
const make=(title)=>({isClosed:()=>false,viewportSize:()=>({width:1280,height:800}),setViewportSize:async()=>{},on:()=>{},url:()=>`https://example.test/${title}`,title:async()=>title,screenshot:async()=>Buffer.from('synthetic'),mainFrame:()=>null});
const a=make('first'),b=make('agent');const context={pages:()=>[a,b],on:()=>{}};
const view=createView(async()=>context);
await view.page();const normal=await view.frame(context);assert.equal(normal.title,'agent');
const observed=await view.frame(context,normal.tabs[0].id);assert.equal(observed.title,'first');assert.equal(observed.tabs[1].active,true);assert.equal(observed.cursor,null);
assert.equal((await view.page()),b);assert.equal((await view.frame(context)).title,'agent');assert.equal((await view.frame(context,'999')).title,'agent');
console.log('Passive alternate-page capture preserves agent page and handles closed/missing page fallback');
