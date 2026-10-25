'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createPreviewPolicy,configurePreviewContents,preparePreviewHtml,validatePayload}=require('../security');
const WORLD=999;
// This function executes only in an isolated world created by Electron, never the uploaded script realm.
function driver({operation,params={}}){
  const selector=String(params.selector||''),element=()=>{if(!selector)throw Error('A CSS selector is required');const el=document.querySelector(selector);if(!el)throw Error('Element not found: '+selector);return el;};
  if(operation==='snapshot'){
    const clone=document.documentElement.cloneNode(true),source=document.querySelectorAll('input,textarea,select'),targets=clone.querySelectorAll('input,textarea,select');
    for(let i=0;i<source.length;i++){const value=source[i],target=targets[i];if(value.tagName==='TEXTAREA')target.textContent=value.value;else if(value.tagName==='SELECT'){for(let j=0;j<value.options.length;j++){if(value.options[j].selected)target.options[j].setAttribute('selected','');else target.options[j].removeAttribute('selected');}}else{target.setAttribute('value',value.value);if(value.checked)target.setAttribute('checked','');else target.removeAttribute('checked');}}
    if(params.websiteTarget){
      // Materialise stylesheet rules before returning to the non-executable
      // picker iframe. Preserve paths/origin for images and CSS url() assets.
      const originalSheets=[...document.querySelectorAll('style,link[rel~="stylesheet"]')],clonedSheets=[...clone.querySelectorAll('style,link[rel~="stylesheet"]')];
      const resolveCss=(text,base)=>text.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g,(full,quote,value)=>{try{return 'url('+JSON.stringify(new URL(value,base).href)+')';}catch{return full;}});
      const sheetText=(sheet,seen=new Set())=>{if(seen.has(sheet))return '';seen.add(sheet);const base=sheet.href||document.baseURI;return [...sheet.cssRules].map(rule=>{if(rule.type===3&&rule.styleSheet){const css=sheetText(rule.styleSheet,seen),media=rule.media?.mediaText;return media&&media!=='all'?'@media '+media+'{'+css+'}':css;}return resolveCss(rule.cssText,base);}).join('\n');};
      for(const sheet of document.styleSheets)try{if(sheet.disabled)continue;const original=sheet.ownerNode,index=originalSheets.indexOf(original),copy=clonedSheets[index];if(copy){const inline=document.createElement('style');inline.textContent=sheetText(sheet);if(original.media)inline.media=original.media;copy.replaceWith(inline);}}catch{/* Keep resolved cross-origin links when their CSSOM is not readable. */}
      for(const el of clone.querySelectorAll('[src],[href],[srcset],[action]')){for(const attr of ['src','href','action'])if(el.hasAttribute(attr)){try{el.setAttribute(attr,new URL(el.getAttribute(attr),document.baseURI).href);}catch{}}if(el.hasAttribute('srcset')){const original=document.querySelectorAll('[srcset]')[[...clone.querySelectorAll('[srcset]')].indexOf(el)];if(original?.currentSrc){el.setAttribute('src',original.currentSrc);el.removeAttribute('srcset');}}}
      for(const script of clone.querySelectorAll('script'))script.remove();
      for(const meta of clone.querySelectorAll('meta[http-equiv]'))meta.remove();
    }
    return clone.outerHTML;
  }
  if(operation==='Click Element'){element().click();return {logs:['Clicked element: '+selector]};}
  if(operation==='Input Text'){const el=element();if(!('value'in el))throw Error('Selected element does not accept text');const prototype=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,setter=Object.getOwnPropertyDescriptor(prototype,'value')?.set;if(!setter)throw Error('Selected element does not accept text');setter.call(el,String(params.text??''));el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return {logs:['Input text into '+selector]};}
  if(operation==='Element Should Contain'){const text=element().textContent,expected=String(params.text??'');if(!text.includes(expected))throw Error('Assertion Failed: Element '+selector+' does not contain '+JSON.stringify(expected)+'. Actual: '+JSON.stringify(text));return {logs:['Element '+selector+' contains '+JSON.stringify(expected)]};}
  if(operation==='exists')return !!document.querySelector(selector);
  if(operation==='Check Performance'){const p=performance.getEntriesByType('navigation')[0];if(!p||!p.loadEventEnd)throw Error('Page load timing is incomplete');return {loadComplete:p.loadEventEnd,domContentLoaded:p.domContentLoadedEventEnd,domInteractive:p.domInteractive,resourceCount:performance.getEntriesByType('resource').length};}
  if(operation==='Check Accessibility'){
    const issues=[];for(const [index,img]of Array.from(document.querySelectorAll('img')).entries())if(!img.hasAttribute('alt'))issues.push({type:'error',rule:'Images must have alt text',element:'img['+index+']',wcag:'WCAG 2.1 Level A'});
    for(const [index,input]of Array.from(document.querySelectorAll('input,textarea,select')).entries()){
      const type=(input.getAttribute('type')||'').toLowerCase(),style=getComputedStyle(input);if(type==='hidden'||input.hidden||input.getAttribute('aria-hidden')==='true'||style.display==='none'||style.visibility==='hidden')continue;
      const aria=(input.getAttribute('aria-label')||'').trim(),refs=(input.getAttribute('aria-labelledby')||'').trim().split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim(),label=Array.from(input.labels||[]).some(label=>label.textContent.trim())||!!input.closest('label')?.textContent.trim(),button=['button','submit','reset'].includes(type)&&!!input.value?.trim(),image=type==='image'&&!!input.getAttribute('alt')?.trim();
      if(!aria&&!refs&&!label&&!button&&!image&&!input.getAttribute('title')?.trim())issues.push({type:'error',rule:'Form inputs must have an accessible name',element:input.tagName.toLowerCase()+'['+index+']',wcag:'WCAG 2.1 Level A'});
    }
    let level=0;for(const heading of document.querySelectorAll('h1,h2,h3,h4,h5,h6')){const next=Number(heading.tagName[1]);if(next-level>1)issues.push({type:'warning',rule:'Heading levels should not skip',element:heading.tagName,wcag:'WCAG 2.1 Best Practice'});level=next;}
    const links=new Map();for(const link of document.querySelectorAll('a[href]')){const text=link.textContent.trim();if(text){if(links.has(text)&&links.get(text)!==link.href)issues.push({type:'warning',rule:'Links with same text should go to same destination',element:'a[text='+JSON.stringify(text)+']',wcag:'WCAG 2.1 Best Practice'});links.set(text,link.href);}}
    return {passed:!issues.some(i=>i.type==='error'),errorCount:issues.filter(i=>i.type==='error').length,warningCount:issues.filter(i=>i.type==='warning').length,issues,scope:'Basic accessible-name, alt-text, heading and link rules; not a complete WCAG audit'};
  }
  throw Error('Unsupported isolated visual command');
}
function createService({BrowserWindow,dataDir,assertTrusted=()=>{},emit=()=>{},getWorkspaceRoot=()=>null}={}){
  if(!BrowserWindow||!dataDir)throw Error('Electron BrowserWindow and private data directory are required');
  let targets,lifecycleEpoch=0;const webTargets=()=>targets||=require('../web-targets/index.cjs').createTargets({dataDir:path.join(dataDir,'web-targets'),getWorkspaceRoot,assertTrusted});
  const resolveTarget=async target=>{await assertTrusted({target});return webTargets().resolve(target);};
  const sessions=new Map(),baselineDir=()=>{
    const parent=path.join(dataDir,'visual-baselines'),key=crypto.createHash('sha256').update(String(getWorkspaceRoot()||'local-session')).digest('hex'),destination=path.join(parent,key);
    if(!fs.existsSync(destination)&&fs.existsSync(parent)){
      const recovery=fs.readdirSync(parent).filter(name=>new RegExp('^'+key+'\\.import-backup-[a-f0-9-]{36}$').test(name));
      if(recovery.length>1)throw Error('Multiple interrupted baseline imports require recovery before continuing');
      if(recovery.length===1){const backup=path.join(parent,recovery[0]);if(fs.lstatSync(backup).isSymbolicLink()||!fs.statSync(backup).isDirectory())throw Error('Baseline recovery path is invalid');fs.renameSync(backup,destination);}
    }
    return destination;
  };
  const get=id=>{const item=sessions.get(id);if(!item||item.window.isDestroyed())throw Error('The isolated visual session has closed');return item;};
  const invoke=async(item,operation,params={})=>{
    if(item.window.isDestroyed())throw Error('The isolated visual session has closed');
    const code='(()=>{try{return {ok:true,value:('+driver.toString()+')('+JSON.stringify({operation,params})+')}}catch(error){return {ok:false,error:String(error.message)}}})()';
    let timer;try{const result=await Promise.race([item.closed,item.window.webContents.executeJavaScriptInIsolatedWorld(WORLD,[{code}],true),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The isolated page did not respond within 5 seconds')),5000);timer.unref?.();})]);if(!result?.ok)throw Error(result?.error||'Isolated driver returned invalid evidence');return result.value;}finally{clearTimeout(timer);}
  };
  const snapshot=async item=>({id:item.id,html:await invoke(item,'snapshot',{websiteTarget:!!item.websiteTarget}),...(item.websiteTarget?{url:item.window.webContents.getURL(),websiteTarget:true}:{})});
  async function capture(item){await new Promise(resolve=>setTimeout(resolve,70));if(item.window.isDestroyed())throw Error('The isolated visual session has closed');const image=await Promise.race([item.closed,item.window.webContents.capturePage()]);if(image.isEmpty())throw Error('The isolated page returned an empty screenshot');return image;}
  const baselinePath=name=>{if(typeof name!=='string'||!name.trim()||name.length>200)throw Error('Use a baseline name of 1–200 characters');return path.join(baselineDir(),crypto.createHash('sha256').update(name).digest('hex')+'.png');};
  const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
  const imageBytes=(item)=>{
    if(!item||!/^[a-f0-9]{64}$/.test(item.id||'')||!/^[a-f0-9]{64}$/.test(item.sha256||'')||typeof item.image!=='string'||item.image.length>12*1024*1024||item.image.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(item.image))throw Error('Baseline image manifest is invalid');
    const bytes=Buffer.from(item.image,'base64');if(bytes.length!==item.bytes||digest(bytes)!==item.sha256||bytes.length<33||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR')throw Error('Baseline checksum or PNG header is invalid');
    const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||width>8192||height>8192||width*height>16777216)throw Error('Baseline image dimensions exceed the limit');
    const image=require('electron').nativeImage.createFromBuffer(bytes);if(image.isEmpty()||image.getSize().width!==width||image.getSize().height!==height)throw Error('Baseline PNG cannot be decoded');return bytes;
  };
  async function handle(action,payload={}){
    validatePayload(payload);
    if(action==='selectFolder')return webTargets().selectFolder(payload);
    if(action.startsWith('target:')){await assertTrusted(payload);return webTargets().handle(action.slice(7),payload);}
    if(action==='validateBaselines'){action='importBaselines';payload={...payload,validateOnly:true};}
    if(action==='exportBaselines'){
      await assertTrusted(payload);const directory=baselineDir(),items=[];let total=0;
      if(fs.existsSync(directory))for(const file of fs.readdirSync(directory).sort()){if(!/^[a-f0-9]{64}\.png$/.test(file))continue;const name=path.join(directory,file),stat=fs.lstatSync(name);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink>1||stat.size>8*1024*1024)throw Error('Native baseline file is invalid or too large');const image=fs.readFileSync(name);total+=image.length;if(total>12*1024*1024||items.length>=200)throw Error('Native baselines exceed the portable archive limit (200 images / 12 MiB)');items.push({id:file.slice(0,-4),sha256:digest(image),bytes:image.length,image:image.toString('base64')});}
      return {schemaVersion:1,type:'lvx-native-baselines',workspaceBinding:digest(String(getWorkspaceRoot()||'local-session')),items};
    }
    if(action==='importBaselines'){
      if(payload.validateOnly!==undefined&&typeof payload.validateOnly!=='boolean')throw Error('Baseline validation mode must be a boolean');
      await assertTrusted(payload);const archive=payload.archive;if(archive?.schemaVersion!==1||archive.type!=='lvx-native-baselines'||!Array.isArray(archive.items)||archive.items.length>200||!/^[a-f0-9]{64}$/.test(archive.workspaceBinding||''))throw Error('Unsupported native baseline archive');
      const ids=new Set();let total=0,pixels=0;const validated=archive.items.map(item=>{if(ids.has(item.id))throw Error('Duplicate baseline image identifier');ids.add(item.id);const bytes=imageBytes(item);total+=bytes.length;pixels+=bytes.readUInt32BE(16)*bytes.readUInt32BE(20);if(total>12*1024*1024||pixels>64000000)throw Error('Baseline archive exceeds 12 MiB or 64 million decoded pixels');return {id:item.id,bytes};});
      if(payload.validateOnly)return {valid:true,items:validated.length,bytes:total,decodedPixels:pixels};
      const destination=baselineDir(),parent=path.dirname(destination),prefix=path.basename(destination)+'.import-',staging=path.join(parent,prefix+crypto.randomUUID()),backup=path.join(parent,prefix+'backup-'+crypto.randomUUID());fs.mkdirSync(staging,{recursive:true});
      const cleanup=target=>{const resolved=path.resolve(target);if(path.dirname(resolved)!==path.resolve(parent)||!path.basename(resolved).startsWith(prefix))throw Error('Unsafe baseline cleanup target');if(fs.existsSync(resolved))fs.rmSync(resolved,{recursive:true,force:true});};
      let moved=false;try{for(const item of validated)fs.writeFileSync(path.join(staging,item.id+'.png'),item.bytes,{mode:0o600});if(fs.existsSync(destination)){fs.renameSync(destination,backup);moved=true;}try{fs.renameSync(staging,destination);}catch(error){if(moved)fs.renameSync(backup,destination);throw error;}if(moved)cleanup(backup);return {imported:validated.length,workspaceBinding:digest(String(getWorkspaceRoot()||'local-session'))};}finally{cleanup(staging);}
    }
    if(action==='open'){
      const binding=getWorkspaceRoot(),epoch=lifecycleEpoch;await assertTrusted(payload);const websiteTarget=!!payload.target;if(!websiteTarget&&(typeof payload.html!=='string'||!payload.html||Buffer.byteLength(payload.html)>8*1024*1024))throw Error('Upload HTML smaller than 8 MiB');
      if(sessions.size>=8)throw Error('Close an existing visual session before opening another (maximum eight)');
      const resolved=websiteTarget?await resolveTarget(payload.target):null,policy=createPreviewPolicy({allowNetworkOrigins:payload.allowNetworkOrigins||[],websiteTarget}),id=crypto.randomUUID();
      if(binding!==getWorkspaceRoot()||epoch!==lifecycleEpoch){await resolved?.dispose?.();throw Error('Workspace changed or its previews were closed. Load the website again.');}
      // Resolution can yield while other opens claim slots. Recheck before the
      // synchronous window/session insertion and release any prepared server.
      if(sessions.size>=8){await resolved?.dispose?.();throw Error('Close an existing visual session before opening another (maximum eight)');}
      if(websiteTarget)policy.webPreferences.partition='lvx-website-'+crypto.createHash('sha256').update(String(getWorkspaceRoot())+'\0'+new URL(resolved.url).origin).digest('hex');
      let window;try{window=new BrowserWindow({show:false,title:'LVX — interactive website',width:1280,height:900,useContentSize:true,webPreferences:{...policy.webPreferences,...(!websiteTarget?{offscreen:true}:{}),backgroundThrottling:false}});}catch(error){await resolved?.dispose?.();throw error;}
      const item={id,window,websiteTarget,workspaceRoot:binding,queue:Promise.resolve(),dispose:resolved?.dispose};item.closed=new Promise((_,reject)=>{item.rejectClosed=reject;});item.closed.catch(()=>{});sessions.set(id,item);window.on('closed',()=>{item.rejectClosed(Error('The isolated visual session has closed'));sessions.delete(id);Promise.resolve(item.dispose?.()).catch(()=>{});});configurePreviewContents(window.webContents,policy);
      let timer;try{await Promise.race([window.loadURL(websiteTarget?resolved.url:'data:text/html;charset=utf-8,'+encodeURIComponent(preparePreviewHtml(payload.html,policy))),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Website load timed out. Check the address or start the project server.')),30000);timer.unref?.();})]);await new Promise(resolve=>setTimeout(resolve,120));if(item.workspaceRoot!==getWorkspaceRoot())throw Error('Workspace changed while the website loaded. Load it again.');return await snapshot(item);}catch(error){window.destroy();sessions.delete(id);throw error;}finally{clearTimeout(timer);}
    }
    if(action==='closeAll'){lifecycleEpoch++;for(const item of sessions.values())if(!item.window.isDestroyed())item.window.destroy();sessions.clear();const previous=targets;targets=null;await previous?.close();return {closed:true};}
    if(action==='close'){const item=sessions.get(payload.id);if(item&&!item.window.isDestroyed())item.window.destroy();sessions.delete(payload.id);return {closed:true};}
    const item=get(payload.id);
    if(item.workspaceRoot!==getWorkspaceRoot())throw Error('This preview belongs to another workspace. Load the website again.');
    if(action==='show'){if(!item.websiteTarget)throw Error('Reload this website using Files, Folder or Website URL to open its interactive window.');item.window.show();item.window.focus();return {opened:true,id:item.id,url:item.window.webContents.getURL()};}
    if(action==='snapshot')return snapshot(item);
    if(action!=='step')throw Error('Unknown isolated preview action');
    const execute=async()=>{
      await assertTrusted(payload);const params=payload.params||{},logs=[];let evidence={};
      if(payload.name==='Click Element'&&item.websiteTarget){
        const contents=item.window.webContents;let navigated=false,loadError;
        const navigation=(_event,_url,inPlace,isMainFrame)=>{if(isMainFrame&&!inPlace)navigated=true;};
        const failed=(_event,code,description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3)loadError=description;};
        contents.on('did-start-navigation',navigation);contents.on('did-fail-load',failed);
        try{
          try{const result=await invoke(item,payload.name,params);logs.push(...result.logs);}catch(error){if(!navigated||!/context|frame|world|script failed/i.test(error.message))throw error;logs.push('Clicked element: '+String(params.selector||''));}
          await new Promise(resolve=>setTimeout(resolve,80));const deadline=Date.now()+30000;
          while(contents.isLoadingMainFrame()){if(Date.now()>deadline)throw Error('Website navigation timed out after the click');await Promise.race([item.closed,new Promise(resolve=>setTimeout(resolve,40))]);}
          if(loadError)throw Error('Website navigation failed: '+loadError);
        }finally{contents.removeListener('did-start-navigation',navigation);contents.removeListener('did-fail-load',failed);}
      }else if(['Click Element','Input Text','Element Should Contain'].includes(payload.name)){const result=await invoke(item,payload.name,params);logs.push(...result.logs);}
      else if(payload.name==='Wait For Element'){
        const timeout=params.timeout==null||params.timeout===''?5000:Number(params.timeout);if(!Number.isFinite(timeout)||timeout<0||timeout>60000)throw Error('Wait timeout must be between 0 and 60000 ms');
        const deadline=Date.now()+timeout;let exists;do{exists=await invoke(item,'exists',params);if(exists)break;if(Date.now()>=deadline)throw Error('Wait timed out for element: '+params.selector);await new Promise(resolve=>setTimeout(resolve,60));}while(true);logs.push('Waited for element: '+params.selector);
      }else if(payload.name==='Save Screenshot Baseline'){
        const file=baselinePath(params.name),image=await capture(item);fs.mkdirSync(baselineDir(),{recursive:true});fs.writeFileSync(file,image.toPNG(),{mode:0o600});logs.push('Saved isolated screenshot baseline: '+params.name);evidence={baseline:image.toDataURL()};
      }else if(payload.name==='Compare Screenshot'){
        const threshold=params.threshold==null||String(params.threshold).trim()===''?5:Number(params.threshold);if(!Number.isFinite(threshold)||threshold<0||threshold>100)throw Error('Screenshot threshold must be between 0 and 100 percent');
        const file=baselinePath(params.name);if(!fs.existsSync(file))throw Error('No isolated screenshot baseline found: '+params.name);
        const current=await capture(item),baseline=current.constructor.createFromPath?current.constructor.createFromPath(file):require('electron').nativeImage.createFromPath(file);if(baseline.isEmpty())throw Error('Screenshot baseline is invalid');
        const a=baseline.toBitmap(),b=current.toBitmap(),diff=Buffer.from(b),as=baseline.getSize(),bs=current.getSize();let diffPixels=0;
        if(as.width!==bs.width||as.height!==bs.height)diffPixels=Math.max(as.width*as.height,bs.width*bs.height);else for(let index=0;index<a.length;index+=4){let difference=0;for(let channel=0;channel<4;channel++)difference+=Math.abs(a[index+channel]-b[index+channel]);if(difference>(threshold===0?0:30)){diffPixels++;diff[index]=0;diff[index+1]=0;diff[index+2]=255;diff[index+3]=255;}}
        const diffPercentage=diffPixels/Math.max(as.width*as.height,bs.width*bs.height)*100;evidence={passed:diffPercentage<=threshold,diffPercentage,baseline:baseline.toDataURL(),current:current.toDataURL(),diffImageData:require('electron').nativeImage.createFromBitmap(diff,bs).toDataURL()};
        if(!evidence.passed){const error=Error('Visual regression detected: '+diffPercentage.toFixed(2)+'% difference');error.details={evidence};throw error;}logs.push('Screenshot matches isolated baseline: '+params.name+' ('+diffPercentage.toFixed(2)+'%)');
      }else if(payload.name==='Check Performance'){
        evidence=await invoke(item,payload.name);const maximum=params.maxLoadTime==null||params.maxLoadTime===''?3000:Number(params.maxLoadTime);if(!Number.isFinite(maximum)||maximum<0)throw Error('Maximum load time must be zero or a positive number');if(evidence.loadComplete>maximum)throw Error('Page load time ('+evidence.loadComplete+'ms) exceeds max allowed ('+maximum+'ms)');logs.push('Performance check passed ('+evidence.loadComplete.toFixed(1)+'ms)');
      }else if(payload.name==='Check Accessibility'){
        evidence=await invoke(item,payload.name);logs.push('Accessibility: '+evidence.errorCount+' errors, '+evidence.warningCount+' warnings');if(!evidence.passed){const error=Error('Accessibility errors found: '+evidence.errorCount);error.details={evidence};throw error;}
      }else throw Error('Unknown visual step: '+payload.name);
      const result={...await snapshot(item),logs,evidence};emit({type:'step',id:item.id,name:payload.name});return result;
    };
    const pending=item.queue.then(execute,execute).catch(error=>{if(!error.code)error.code=/Assertion Failed|Element not found|Wait timed out|Visual regression|Accessibility errors|exceeds max allowed/.test(error.message)?'ASSERTION_FAILED':'PREVIEW_ERROR';throw error;});item.queue=pending.catch(()=>{});return pending;
  }
  return {handle,resolveTarget,async close(){await handle('closeAll',{});},get size(){return sessions.size;}};
}
module.exports={createService};
