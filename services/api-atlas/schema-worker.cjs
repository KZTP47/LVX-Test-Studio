'use strict';
const { workerData, parentPort } = require('node:worker_threads');
try {
  const Ajv = workerData.dialect === '2020-12' ? require('ajv/dist/2020') : require('ajv');
  const ajv = new Ajv({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true, validateFormats: true });
  require('ajv-formats')(ajv);
  // OpenAPI annotations carry no validation semantics. Unknown assertions still
  // fail compilation, so an unsupported contract cannot acquire a green badge.
  for (const keyword of ['example', 'xml', 'externalDocs']) ajv.addKeyword(keyword);
  const validate = ajv.compile(workerData.schema), valid = validate(workerData.value);
  parentPort.postMessage({ valid, errors: validate.errors || [] });
} catch (error) { parentPort.postMessage({ error: error.message }); }
