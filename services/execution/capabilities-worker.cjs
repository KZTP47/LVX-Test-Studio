'use strict';
const {parentPort,workerData}=require('node:worker_threads');
try { parentPort.postMessage({value:require('./adapters.cjs').capabilities(workerData)}); }
catch(error){parentPort.postMessage({error:error.message});}
