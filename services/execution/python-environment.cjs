'use strict';
const fs = require('node:fs');
const path = require('node:path');
function pythonEnvironment({ resourcePath = process.resourcesPath, env = process.env } = {}) {
    const roots = [resourcePath && path.join(resourcePath, 'python-packages'), path.resolve(__dirname, '../../.external/python-runtime-packages'), path.resolve(__dirname, '../../.external/python-packages')].filter(root => root && fs.existsSync(root));
    return { ...env, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1', PYTHONPATH: [...new Set([...roots, ...(env.PYTHONPATH || '').split(path.delimiter).filter(Boolean)])].join(path.delimiter), PYTHONIOENCODING: 'utf-8' };
}
module.exports = { pythonEnvironment };
