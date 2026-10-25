'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// App-private provenance, not provider authentication. Workspace archives carry
// conversation IDs as data; they cannot mint permission to resume another
// machine's or another project's native conversation.
const ephemeralTestKey = crypto.randomBytes(32);
function createSessionProof(dataDir) {
  let key = ephemeralTestKey;
  if (dataDir) {
    if (!path.isAbsolute(dataDir)) throw Error('Agent data directory must be absolute.');
    fs.mkdirSync(dataDir, { recursive: true });
    const filename = path.join(dataDir, 'native-session-provenance.key');
    if (!fs.existsSync(filename)) {
      try { fs.writeFileSync(filename, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 32 || stat.nlink !== 1) throw Error('Native session provenance key is invalid; original sessions were preserved.');
    key = fs.readFileSync(filename);
  }
  const signature = session => crypto.createHmac('sha256', key).update(JSON.stringify([session.workspaceRoot, session.boardId, session.agentId, session.provider, session.generation, session.nativeSessionId,...(session.workingDirectory!==undefined?[session.workingDirectory]:[])])).digest('hex');
  return {
    sign(session) { return signature(session); },
    verify(session) {
      if (!/^[a-f0-9]{64}$/.test(session.nativeSessionProof || '')) return false;
      return crypto.timingSafeEqual(Buffer.from(session.nativeSessionProof, 'hex'), Buffer.from(signature(session), 'hex'));
    }
  };
}
module.exports = { createSessionProof };
