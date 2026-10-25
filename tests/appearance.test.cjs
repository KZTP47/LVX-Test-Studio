'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function product(preference,{blocked=false}={}){
 const store=new Map([['lvx_theme_preference',preference]]),buttons=[],listeners=new Map(),classes=new Set(),notices=[];
 const body={dataset:{},classList:{toggle(name,on){on?classes.add(name):classes.delete(name);}}};
 const header={querySelector:()=>buttons[0]||null,append:button=>buttons.push(button)};
 const document={body,readyState:'loading',querySelector:selector=>selector==='.studio-header'?header:null,querySelectorAll:()=>buttons,addEventListener:(name,fn)=>listeners.set(name,fn),createElement:()=>({dataset:{},addEventListener(name,fn){this[name]=fn;},setAttribute(name,value){this[name]=value;}})};
 const window={LVXIcons:{svg:()=>''},showMessage:message=>notices.push(message),addEventListener(){}};
 const context={document,window,localStorage:{getItem:key=>{if(blocked)throw Error('Unavailable');return store.get(key);},setItem:(key,value)=>{if(blocked)throw Error('Unavailable');store.set(key,value);}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../machina-product.js'),'utf8'),context);
 return {window,body,buttons,classes,store,notices,init:()=>listeners.get('DOMContentLoaded')()};
}
test('saved dark appearance survives a header being decorated before product startup',()=>{
 const p=product('dark');p.window.LVXProduct.decorate();assert.equal(p.store.get('lvx_theme_preference'),'dark');p.init();assert.ok(p.classes.has('theme-dark'));assert.equal(p.body.dataset.theme,'dark');assert.equal(p.buttons[0]['aria-pressed'],'true');assert.match(p.buttons[0].innerHTML,/Light appearance/);
});
test('appearance button changes the displayed theme and saved preference in both directions',()=>{
 const p=product('light');p.init();p.buttons[0].click();assert.equal(p.store.get('lvx_theme_preference'),'dark');assert.ok(p.classes.has('theme-dark'));p.buttons[0].click();assert.equal(p.store.get('lvx_theme_preference'),'light');assert.equal(p.buttons[0]['aria-pressed'],'false');assert.ok(!p.classes.has('theme-dark'));
});
test('unavailable preference storage still renders a usable appearance and explains persistence failure',()=>{
 const p=product('dark',{blocked:true});assert.doesNotThrow(()=>p.init());p.window.LVXProduct.applyTheme('dark');assert.ok(p.classes.has('theme-dark'));assert.equal(p.buttons[0]['aria-pressed'],'true');assert.ok(p.notices.some(message=>message.includes('could not be saved')));
});
