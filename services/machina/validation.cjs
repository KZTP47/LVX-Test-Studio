'use strict';
const path=require('node:path'),{Worker}=require('node:worker_threads'),{abort}=require('./util.cjs');
async function validate(data,signal){
 abort(signal);const worker=new Worker(path.join(__dirname,'validation-worker.cjs'),{workerData:data});
 return new Promise((resolve,reject)=>{let settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);void worker.terminate();error?reject(error):resolve(value);},cancel=()=>finish(Object.assign(Error('Execution cancelled.'),{name:'AbortError'}));
  signal?.addEventListener('abort',cancel,{once:true});worker.once('message',message=>finish(message.error?Error(message.error):null,message.result));worker.once('error',error=>finish(error));worker.once('exit',code=>{if(!settled)finish(Error('Contract validation worker stopped without evidence ('+code+').'));});if(signal?.aborted)cancel();
 });
}
module.exports={validate};
