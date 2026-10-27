// Browser visibility is a local launch preference, independent of graph edits.
const valid=mode=>mode==='headed'||mode==='headless';
const key=(workspaceRoot,id)=>'lvx:e2e-browser:'+JSON.stringify([String(workspaceRoot||'').replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase(),id||null]);
const read=(storage,workspaceRoot,id)=>{try{return storage.getItem(key(workspaceRoot,id));}catch{return null;}};
export function graphBrowserMode(storage,workspaceRoot,workflow={}){
 const remembered=workflow.id&&read(storage,workspaceRoot,workflow.id);
 if(valid(remembered))return remembered;
 if(valid(workflow.browserMode))return workflow.browserMode;
 const preferred=read(storage,workspaceRoot,null);
 return valid(preferred)?preferred:'headless';
}
export function rememberGraphBrowserMode(storage,workspaceRoot,id,mode){
 if(!valid(mode))throw Error('Choose Headed (visible) or Headless (background).');
 storage.setItem(key(workspaceRoot,null),mode);
 if(id)storage.setItem(key(workspaceRoot,id),mode);
}
