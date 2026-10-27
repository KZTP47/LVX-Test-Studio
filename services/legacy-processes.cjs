'use strict';
const {stopProcessTree}=require('./process-control.cjs');
const children=new Set();let draining=false;
function track(child){children.add(child);const forget=()=>children.delete(child);child.once('close',forget);child.once('error',forget);if(draining)void stopProcessTree(child);return child;}
async function stopAll(){draining=true;try{const results=await Promise.allSettled([...children].map(async child=>{await stopProcessTree(child);if(child.exitCode===null&&!child.signalCode)await new Promise(resolve=>child.once('close',resolve));}));const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;}finally{draining=false;}}
module.exports={track,stopAll};
