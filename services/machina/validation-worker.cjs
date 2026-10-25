'use strict';
const {parentPort,workerData}=require('node:worker_threads');
try{const {schemaValidate,operator}=require('./http.cjs');const result=workerData.kind==='schema'?schemaValidate(workerData.value,workerData.schema):operator(workerData.actual,workerData.operator,workerData.expected);parentPort.postMessage({result});}catch(error){parentPort.postMessage({error:error.message});}
