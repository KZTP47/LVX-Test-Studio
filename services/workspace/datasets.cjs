'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { nonnegative } = require('../capacity.cjs');
const { WorkspaceError, sha256 } = require('./store.cjs');

function normalizeSchema(schema) {
  if (!Array.isArray(schema) || !schema.length) throw new WorkspaceError('VALIDATION', 'Define at least one dataset column.');
  const names = new Set();
  for (const column of schema) {
    if (!column || typeof column.name !== 'string' || !column.name.trim() || names.has(column.name) || !['string', 'integer', 'number', 'boolean', 'date', 'email'].includes(column.type)) throw new WorkspaceError('VALIDATION', 'Column names must be unique and each column needs a supported type.');
    names.add(column.name);
    if (column.required !== undefined && typeof column.required !== 'boolean') throw new WorkspaceError('VALIDATION', 'Required must be true or false.');
    if (!['string', 'integer', 'number'].includes(column.type) && (column.min !== undefined || column.max !== undefined)) throw new WorkspaceError('VALIDATION', `Use numeric bounds for numbers and length bounds for strings; ${column.type} does not support min/max.`);
    for (const limit of ['min', 'max']) if (column[limit] !== undefined && !Number.isFinite(column[limit])) throw new WorkspaceError('VALIDATION', `Invalid ${limit} for column ${column.name}.`);
    if (column.min !== undefined && column.max !== undefined && column.min > column.max) throw new WorkspaceError('VALIDATION', `Minimum exceeds maximum for column ${column.name}.`);
    if (column.values !== undefined && (!Array.isArray(column.values) || !column.values.length)) throw new WorkspaceError('VALIDATION', 'Allowed values must be a nonempty array.');
  }
  return schema;
}
function validateRow(row, schema, rowNumber) {
  const errors = [];
  for (const column of schema) {
    const value = row[column.name];
    const empty = value === undefined || value === null || value === '';
    if (empty) { if (column.required) errors.push({ row: rowNumber, column: column.name, code: 'REQUIRED', message: 'A value is required.' }); continue; }
    const text = String(value);
    let valid = true;
    if (column.type === 'string') valid = typeof value === 'string';
    if (column.type === 'integer') valid = /^[-+]?\d+$/.test(text) && Number.isSafeInteger(Number(value));
    if (column.type === 'number') valid = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(text) && Number.isFinite(Number(value));
    if (column.type === 'boolean') valid = value === true || value === false || text === 'true' || text === 'false';
    if (column.type === 'date') {
      const parsed = new Date(text);
      valid = /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
    }
    if (column.type === 'email') valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
    if (!valid) errors.push({ row: rowNumber, column: column.name, code: 'TYPE', message: `Expected ${column.type}.` });
    else {
      const measure = ['number', 'integer'].includes(column.type) ? Number(value) : text.length;
      if (column.min !== undefined && measure < column.min) errors.push({ row: rowNumber, column: column.name, code: 'MIN', message: `Minimum ${column.min}.` });
      if (column.max !== undefined && measure > column.max) errors.push({ row: rowNumber, column: column.name, code: 'MAX', message: `Maximum ${column.max}.` });
      if (column.values && !column.values.some(allowed => String(allowed) === text)) errors.push({ row: rowNumber, column: column.name, code: 'ENUM', message: 'Value is not in the allowed choices.' });
    }
  }
  return errors;
}
// A state machine, rather than line splitting: UTF-8, escaped quotes, and quoted
// multiline fields remain correct when a stream chunk splits any token.
async function* csvRecords(chunks, { maxFieldBytes = 0, maxColumns = 0, signal } = {}) {
  maxFieldBytes = nonnegative(maxFieldBytes, 'CSV field budget'); maxColumns = nonnegative(maxColumns, 'CSV column budget');
  const decoder = new StringDecoder('utf8');
  let field = '', fieldBytes = 0, row = [], state = 'plain', first = true, skipLF = false, touched = false;
  function append(c) {
    field += c; fieldBytes += Buffer.byteLength(c);
    if (maxFieldBytes && fieldBytes > maxFieldBytes) throw new WorkspaceError('CSV_LIMIT', 'A CSV field exceeds the size limit.');
  }
  function push() {
    row.push(field); field = ''; fieldBytes = 0; state = 'plain';
    if (maxColumns && row.length > maxColumns) throw new WorkspaceError('CSV_LIMIT', 'CSV has too many columns.');
  }
  for await (const chunk of (async function* () { for await (const chunk of chunks) yield decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); yield decoder.end(); })()) {
    signal?.throwIfAborted();
    for (const c of chunk) {
      if (first) { first = false; if (c === '\uFEFF') continue; }
      if (skipLF) { skipLF = false; if (c === '\n') continue; }
      touched = true;
      if (state === 'quoted') { if (c === '"') state = 'closed'; else append(c); continue; }
      if (state === 'closed' && c === '"') { append('"'); state = 'quoted'; continue; }
      if (c === ',') { push(); continue; }
      if (c === '\r' || c === '\n') { push(); yield row; row = []; touched = false; if (c === '\r') skipLF = true; continue; }
      if (state === 'closed') throw new WorkspaceError('CSV_INVALID', 'Unexpected text after a closing quote.');
      if (c === '"') { if (field !== '') throw new WorkspaceError('CSV_INVALID', 'Unexpected quote in a CSV field.'); state = 'quoted'; }
      else append(c);
    }
  }
  if (state === 'quoted') throw new WorkspaceError('CSV_INVALID', 'Unterminated CSV quote.');
  if (touched || row.length || field !== '' || state === 'closed') { push(); yield row; }
}
function scopedFile(workspaceRoot, filename) {
  if (!workspaceRoot) throw new WorkspaceError('WORKSPACE_REQUIRED', 'Choose a workspace first.');
  if (typeof filename !== 'string' || !filename) throw new WorkspaceError('VALIDATION', 'Choose a dataset file.');
  const root = fs.realpathSync(workspaceRoot);
  const candidate = fs.realpathSync(path.resolve(root, filename));
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.statSync(candidate).isFile()) throw new WorkspaceError('PATH_SCOPE', 'Dataset files must be inside the selected workspace.');
  return candidate;
}
async function validateDataset({ rows, filePath, schema, maxErrors = 0, sampleSize = 0, signal }, workspaceRoot) {
  normalizeSchema(schema);
  maxErrors = nonnegative(maxErrors, 'Error budget'); sampleSize = nonnegative(sampleSize, 'Sample budget');
  let totalRows = 0, invalidRows = 0, errorCount = 0;
  const errors = [], sample = [];
  const validate = row => {
    signal?.throwIfAborted();
    totalRows++;
    const issues = validateRow(row, schema, totalRows);
    if (issues.length) invalidRows++;
    errorCount += issues.length;
    for (const issue of issues) if (!maxErrors || errors.length < maxErrors) errors.push(issue);
    if (!sampleSize || sample.length < sampleSize) sample.push(row);
  };
  if (filePath !== undefined) {
    let headers;
    for await (const values of csvRecords(fs.createReadStream(scopedFile(workspaceRoot, filePath), { highWaterMark: 64 * 1024 }), {signal})) {
      if (!headers) {
        headers = values;
        if (headers.some(h => !h.trim()) || new Set(headers).size !== headers.length) throw new WorkspaceError('CSV_INVALID', 'CSV header names must be unique and nonempty.');
        const missing = schema.filter(column => !headers.includes(column.name)).map(column => column.name);
        if (missing.length) throw new WorkspaceError('CSV_SCHEMA', `Missing columns: ${missing.join(', ')}`);
      } else {
        if (values.length !== headers.length) throw new WorkspaceError('CSV_INVALID', `CSV record ${totalRows + 2} has ${values.length} fields; expected ${headers.length}.`);
        validate(Object.fromEntries(headers.map((name, index) => [name, values[index]])));
      }
    }
  } else {
    if (!Array.isArray(rows)) throw new WorkspaceError('VALIDATION', 'Supply dataset rows or a workspace CSV file.');
    for (const row of rows) {
      if (totalRows % 1024 === 0) await new Promise(resolve => setImmediate(resolve));
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new WorkspaceError('VALIDATION', 'Dataset rows must be objects.');
      validate(row);
    }
  }
  return { status: totalRows && !invalidRows ? 'SUCCESS' : 'FAILURE', totalRows, validRows: totalRows - invalidRows, invalidRows, errorCount, errors, errorsTruncated: errorCount > errors.length, sample, streamed: filePath !== undefined };
}
function seeded(seed) {
  let state = parseInt(sha256(String(seed)).slice(0, 8), 16) || 1;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}
async function generateDataset({ schema, count = 100, seed = 'lvx', signal }) {
  normalizeSchema(schema);
  if (!Number.isSafeInteger(count) || count < 1) throw new WorkspaceError('VALIDATION', 'Generate a positive safe-integer row count.');
  const random = seeded(seed);
  const rows = [];
  for (let i = 0; i < count; i++) {
    if (i % 1024 === 0) { await new Promise(resolve => setImmediate(resolve)); signal?.throwIfAborted(); }
    rows.push(Object.fromEntries(schema.map(column => {
    const min = column.min ?? 0, max = column.max ?? (column.type === 'string' ? 20 : 100);
    let value;
    if (column.values) value = column.values[Math.floor(random() * column.values.length)];
    else if (column.type === 'integer') { if (Math.ceil(min) > Math.floor(max)) throw new WorkspaceError('VALIDATION', 'Integer range has no whole-number values.'); value = Math.floor(random() * (Math.floor(max) - Math.ceil(min) + 1)) + Math.ceil(min); }
    else if (column.type === 'number') value = min + random() * (max - min);
    else if (column.type === 'boolean') value = random() >= 0.5;
    else if (column.type === 'date') value = new Date(Date.UTC(2000, 0, 1) + Math.floor(random() * 36525) * 86400000).toISOString().slice(0, 10);
    else if (column.type === 'email') value = `person-${i + 1}-${Math.floor(random() * 10000)}@example.invalid`;
    else {
      const length = Math.max(Math.ceil(min), Math.min(Math.floor(max), 10));
      if (!Number.isSafeInteger(length) || length < 0 || length > max) throw new WorkspaceError('VALIDATION', 'String length bounds are invalid.');
      value = Array.from({ length }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(random() * 26)]).join('');
    }
    return [column.name, value];
    })));
    if (validateRow(rows[i], schema, i + 1).length) throw new WorkspaceError('VALIDATION', 'These constraints cannot be satisfied by the generator. Adjust the schema.');
  }
  return { status: 'SUCCESS', rows, count, seed: String(seed), synthetic: true };
}
async function maskDataset({ rows, columns, seed = 'lvx-mask', signal }) {
  if (!Array.isArray(rows) || !Array.isArray(columns) || !columns.length) throw new WorkspaceError('VALIDATION', 'Select the columns to mask.');
  if (columns.some(column => typeof column !== 'string' || !column)) throw new WorkspaceError('VALIDATION', 'Invalid masking selection.');
  const masked = [];
  for (let i = 0; i < rows.length; i++) {
    if (i % 1024 === 0) { await new Promise(resolve => setImmediate(resolve)); signal?.throwIfAborted(); }
    const row = rows[i];
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new WorkspaceError('VALIDATION', 'Dataset rows must be objects.');
    masked.push(Object.fromEntries(Object.entries(row).map(([name, value]) => [name, columns.includes(name) && value !== null && value !== '' && value !== undefined ? `masked-${sha256(`${seed}\0${name}\0${String(value)}`).slice(0, 16)}` : value])));
  }
  return { status: 'SUCCESS', rows: masked, maskedColumns: [...new Set(columns)], reversible: false, note: 'Pseudonymisation preserves equality. It is not a guarantee of anonymisation.' };
}
module.exports = { validateDataset, generateDataset, maskDataset, csvRecords, validateRow, normalizeSchema, scopedFile };
