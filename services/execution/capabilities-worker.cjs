'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const controller=new AbortController();parentPort.on('message',message=>{if(message?.type==='cancel')controller.abort();});
require('./adapters.cjs').capabilities({...workerData,signal:controller.signal}).then(value=>parentPort.postMessage({value}),error=>parentPort.postMessage({error:error.message})).finally(()=>parentPort.close());
