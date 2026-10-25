/** Dialog semantics and focus lifecycle for the retained suite editors. */
(() => {
 const sessions=new Map(),launchers=new WeakMap();let active=null,lastFocused=document.activeElement;
 document.addEventListener('focusin',event=>{const layer=event.target.closest('[id$="-modal"],.mg-dialog');if(layer&&lastFocused?.isConnected&&!layer.contains(lastFocused))launchers.set(layer,lastFocused);lastFocused=event.target;},true);
 const guardedBackdrops=new WeakSet();
 const visible=el=>!!el?.isConnected&&!el.closest('.hidden,[hidden]')&&getComputedStyle(el).display!=='none';
 const tabbables=el=>[...el.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(e=>e.getClientRects().length&&!e.closest('[inert]'));
 function inspect(){
  for(const [el,session] of sessions)if(!el.isConnected){sessions.delete(el);if(active===el)active=[...sessions.keys()].filter(visible).at(-1)||null;if(visible(session.returnTo)&&!document.querySelector('dialog:modal'))session.returnTo.focus();}
  for(const el of document.querySelectorAll('[id$="-modal"],#input-modal,.mg-dialog[aria-modal="true"]')){
   if(el.matches('.aero-modal-backdrop')&&!guardedBackdrops.has(el)){
    guardedBackdrops.add(el);let down=null;
    el.addEventListener('mousedown',event=>{down=event.target;});
    el.addEventListener('click',event=>{const origin=down;down=null;if(event.target===el&&!window.ModalBackdrop.shouldCloseModalBackdrop(el,origin,event)){event.stopImmediatePropagation();event.preventDefault();}},true);
   }
   const panel=el.matches('.mg-dialog')?el:el.querySelector('.aero-modal')||el;
   panel.setAttribute('role','dialog');if(panel.getAttribute('aria-modal')!=='true')panel.setAttribute('aria-modal','true');
   const heading=panel.querySelector('h1,h2,h3');if(heading){if(!heading.id)heading.id=(el.id||'lvx-dialog-'+crypto.randomUUID())+'-heading';panel.setAttribute('aria-labelledby',heading.id);}else if(!panel.hasAttribute('aria-label'))panel.setAttribute('aria-label',(el.id.replace(/-/g,' ')));
   if(visible(el)&&!sessions.has(el)){const current=document.activeElement;const outside=current&&current!==document.body&&!el.contains(current)&&visible(current);sessions.set(el,{returnTo:outside?current:launchers.get(el)||current});active=el;queueMicrotask(()=>{if(visible(el)&&!panel.contains(document.activeElement)){const f=tabbables(panel)[0]||panel;if(f===panel)f.tabIndex=-1;f.focus();}});}
   else if(!visible(el)&&sessions.has(el)){const previous=sessions.get(el).returnTo;sessions.delete(el);if(active===el)active=[...sessions.keys()].at(-1)||null;if(previous?.isConnected&&previous.getClientRects().length)previous.focus();}
  }
 }
 document.addEventListener('keydown',event=>{if(event.defaultPrevented||document.querySelector('dialog:modal')||!active||!visible(active))return;if(event.key==='Escape'){
  const close=[...active.querySelectorAll('button')].find(b=>/\bclose[A-Z\w]*\(/.test(b.getAttribute('onclick')||''))||[...active.querySelectorAll('button')].find(b=>/^cancel$|^close$/i.test(b.textContent.trim()));
  if(close&&!close.disabled){event.preventDefault();event.stopPropagation();close.click();}return;
 }if(event.key!=='Tab')return;const focus=tabbables(active);if(!focus.length){event.preventDefault();return;}const first=focus[0],last=focus.at(-1);if(event.shiftKey&&(document.activeElement===first||!active.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!active.contains(document.activeElement))){event.preventDefault();first.focus();}});
 function nameControls(){for(const label of document.querySelectorAll('label:not([for])')){if(label.querySelector('input,select,textarea'))continue;const field=label.nextElementSibling;if(!field?.matches('input,select,textarea'))continue;if(!field.id)field.id='lvx-field-'+crypto.randomUUID();label.htmlFor=field.id;}for(const button of document.querySelectorAll('button:not([aria-label])')){if(button.textContent.trim())continue;const label=button.title||(button.getAttribute('onclick')||'').match(/\b(close\w+)\(/)?.[1]?.replace(/([A-Z])/g,' $1');if(label)button.setAttribute('aria-label',label);}}
 document.addEventListener('DOMContentLoaded',()=>{nameControls();inspect();const observer=new MutationObserver(records=>{if(records.some(r=>r.type==='attributes'&&(r.target.id?.endsWith('-modal')||r.target.matches('.mg-dialog'))||r.type==='childList'&&[...r.addedNodes].some(n=>n.nodeType===1&&(n.id?.endsWith('-modal')||n.matches('.mg-dialog')||n.querySelector('[id$="-modal"],.mg-dialog'))))||[...sessions.keys()].some(el=>!el.isConnected))inspect();if(records.some(r=>r.type==='childList'))nameControls();});observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','aria-modal']});});
})();
