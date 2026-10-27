/**
 * ============================================
 * COLLABORATION MANAGER
 * ============================================
 * Complete collaboration system supporting:
 * - File-based export/import (always available)
 * - Optional backend sharing (shareable links)
 * - Local comments
 * - Version control
 * - Team member management
 */

class CollaborationManager {
  constructor() {
    // Storage keys
    this.COMMENTS_KEY = 'test_comments';
    this.TEAM_KEY = 'team_members';
    this.BACKEND_CONFIG_KEY = 'sharing_backend_config';
    this.USER_KEY = 'current_user_name';
  }

  // ========================================
  // SHARING BACKEND CONFIGURATION (Optional)
  // ========================================

  /**
   * Save sharing backend configuration
   * This enables real shareable links
   */
  _request(url,options){return window.LVXCredentials?window.LVXCredentials.request(url,options):fetch(url,options);}
  _persistProtected(key,value,result=true){const persist=safe=>{localStorage.setItem(key,JSON.stringify(safe));return result;};if(!window.LVXCredentials)return persist(value);this._protectedWrites||=new Map();const pending=(this._protectedWrites.get(key)||Promise.resolve()).then(()=>window.LVXCredentials.protect(value,'Collaboration '+key)).then(persist);this._protectedWrites.set(key,pending.catch(()=>{}));return pending;}

  saveBackendConfig(config) {
    const safeConfig = {
      backendUrl: config.backendUrl?.trim(),
      apiKey: config.apiKey?.trim(),
      enabled: config.enabled !== false,
      configured: new Date().toISOString()
    };

    // Validate URL format
    if (safeConfig.backendUrl && !this._isValidUrl(safeConfig.backendUrl)) {
      throw new Error('Invalid backend URL format. Must start with http:// or https://');
    }

    if (!safeConfig.apiKey) {
      throw new Error('API key is required');
    }

    return this._persistProtected(this.BACKEND_CONFIG_KEY,safeConfig);
  }

  /**
   * Get sharing backend configuration
   */
  getBackendConfig() {
    const data = localStorage.getItem(this.BACKEND_CONFIG_KEY);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Check if sharing backend is configured and enabled
   */
  isBackendConfigured() {
    const config = this.getBackendConfig();
    return !!(config && config.backendUrl && config.apiKey && config.enabled);
  }

  /**
   * Clear backend configuration
   */
  clearBackendConfig() {
    const clear = () => { localStorage.removeItem(this.BACKEND_CONFIG_KEY); return true; };
    if (!window.LVXCredentials) return clear();
    const pending = (this._protectedWrites?.get(this.BACKEND_CONFIG_KEY) || Promise.resolve()).then(clear);
    this._protectedWrites ||= new Map(); this._protectedWrites.set(this.BACKEND_CONFIG_KEY,pending.catch(() => {}));
    return pending;
  }

  /**
   * Test connection to sharing backend
   */
  async testBackendConnection() {
    const config = this.getBackendConfig();
    if (!config || !config.backendUrl || !config.apiKey) {
      throw new Error('Backend not configured. Please enter backend URL and API key.');
    }

    try {

      const response = await this._request(`${config.backendUrl}/health`, {
        method: 'GET',
        headers: {
          'X-API-Key': config.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 0
      });


      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Backend connection successful:', data);

      return {
        success: true,
        message: 'Connected successfully!',
        backendInfo: data
      };
    } catch (error) {
      console.error('Backend connection failed:', error);

      if (error.name === 'AbortError') {
        throw new Error('Connection timed out. Check your backend URL.');
      } else if (error.name === 'TypeError') {
        throw new Error('Cannot connect to backend. Check URL and CORS settings.');
      }

      throw new Error(`Connection failed: ${error.message}`);
    }
  }

  // ========================================
  // SHAREABLE LINKS (Backend Required)
  // ========================================

  /**
   * Generate shareable link via backend
   * Requires backend to be configured
   */
  async generateShareableLink(suite, expiresInDays = 30) {
    if (!this.isBackendConfigured()) {
      throw new Error('Sharing backend not configured. Configure backend in settings or use file export instead.');
    }

    const config = this.getBackendConfig();

    try {
      const response = await this._request(`${config.backendUrl}/shares/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.apiKey
        },
        body: JSON.stringify({
          suiteData: this._sanitizeSuiteForSharing(suite),
          suiteName: suite.name,
          suiteId: suite.id,
          createdBy: this.getCurrentUser(),
          expiresInDays: expiresInDays
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || `Failed to create share link (HTTP ${response.status})`);
      }

      const result = await response.json();
      console.log('Share link generated:', result.shareId);

      return {
        shareId: result.shareId,
        shareUrl: result.shareUrl || `${window.location.origin}${window.location.pathname}#import=${result.shareId}`,
        expiresAt: result.expiresAt,
        accessUrl: `${config.backendUrl}/shares/${result.shareId}`
      };
    } catch (error) {
      console.error('Failed to generate share link:', error);
      throw error;
    }
  }

  /**
   * Import test suite from backend share link
   */
  async importFromBackendShareLink(shareId) {
    if (!this.isBackendConfigured()) {
      throw new Error('Sharing backend not configured. Cannot import from share link.');
    }

    const config = this.getBackendConfig();

    try {
      // Public endpoint - can work without API key for importing
      const headers = {
        'Content-Type': 'application/json'
      };

      // Include API key if available (for better rate limits)
      if (config.apiKey) {
        headers['X-API-Key'] = config.apiKey;
      }

      const response = await this._request(`${config.backendUrl}/shares/${shareId}`, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Share link not found. It may have expired or been revoked.');
        } else if (response.status === 410) {
          throw new Error('Share link has expired.');
        }
        throw new Error(`Failed to fetch shared data (HTTP ${response.status})`);
      }

      const result = await response.json();
      console.log('Successfully imported from share link');

      return result.suiteData;
    } catch (error) {
      console.error('Failed to import from share link:', error);
      throw error;
    }
  }

  /**
   * Get user's shared links from backend
   */
  async getBackendSharedLinks() {
    if (!this.isBackendConfigured()) {
      return [];
    }

    const config = this.getBackendConfig();

    try {
      const response = await this._request(`${config.backendUrl}/shares/list`, {
        method: 'GET',
        headers: {
          'X-API-Key': config.apiKey
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Invalid API key. Please reconfigure backend.');
        }
        throw new Error(`Failed to fetch shared links (HTTP ${response.status})`);
      }

      const shares = await response.json();
      console.log(`Loaded ${shares.length} shared links from backend`);

      return shares;
    } catch (error) {
      console.error('Failed to get shared links:', error);
      return [];
    }
  }

  /**
   * Revoke share link on backend
   */
  async revokeBackendShareLink(shareId) {
    if (!this.isBackendConfigured()) {
      throw new Error('Backend not configured');
    }

    const config = this.getBackendConfig();

    try {
      const response = await this._request(`${config.backendUrl}/shares/${shareId}`, {
        method: 'DELETE',
        headers: {
          'X-API-Key': config.apiKey
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Share link not found');
        }
        throw new Error(`Failed to revoke share link (HTTP ${response.status})`);
      }

      console.log('Share link revoked:', shareId);
      return true;
    } catch (error) {
      console.error('Failed to revoke share link:', error);
      throw error;
    }
  }

  // ========================================
  // FILE-BASED SHARING (Always Works)
  // ========================================

  /**
   * Export test suite as JSON file for team sharing
   * This always works, no backend required
   */
  exportForTeam(suite, includeHistory = false) {
    const exportData = {
      version: '1.0',
      format: 'lvx-machina-export',
      exportedAt: new Date().toISOString(),
      exportedBy: this.getCurrentUser(),
      suite: this._sanitizeSuiteForSharing(suite)
    };

    // Include execution history if requested
    if (includeHistory && window.testHistoryManager) {
      exportData.history = window.testHistoryManager.getSuiteHistory(suite.id) || [];
    }

    // Create downloadable JSON file
    const jsonString = JSON.stringify(this._sanitizeSuiteForSharing(exportData), null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });

    // Generate safe filename
    const safeName = suite.name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${safeName}_${timestamp}.json`;

    console.log(`Exported test suite: ${filename}`);

    return {
      blob,
      filename,
      size: blob.size
    };
  }

  /**
   * Import test suite from team export file
   * This always works, no backend required
   */
  importFromTeamExport(jsonData) {
    try {
      // Parse JSON if it's a string
      const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;

      if (!data || typeof data !== 'object') throw new Error('Invalid export');
      const bulk = data.format === 'lvx-machina-bulk-export';
      if (data.format && !['lvx-machina-export', 'lvx-machina-bulk-export'].includes(data.format)) throw new Error('Unknown export format');
      const source = bulk ? data.suites : [data.suite];
      if (!Array.isArray(source) || !source.length) throw new Error('Missing suite data');
      const suites = source.map(suite => this.prepareImportedSuite(suite, data));
      return {
        suite: suites[0], suites,
        history: data.history || [],
        metadata: { exportedBy: data.exportedBy, exportedAt: data.exportedAt, version: data.version }
      };
    } catch (error) {
      console.error('Import failed:', error);
      throw new Error('Failed to import: ' + error.message);
    }
  }

  prepareImportedSuite(suite, metadata = {}) {
    if (!suite || typeof suite !== 'object' || Array.isArray(suite) || typeof suite.name !== 'string' || !suite.name.trim()) {
      throw new Error('Every imported suite must have a name');
    }
    return { ...JSON.parse(JSON.stringify(suite)), id: this._generateId(), imported: true,
      importedFrom: metadata.exportedBy || 'Unknown', importedAt: new Date().toISOString(), originalExportDate: metadata.exportedAt };
  }

  async persistImportedSuites(suites) {
    const storage = await (window.LVXApp?.getStorage() || window.currentStorage);
    if (!storage?.saveSuite) throw new Error('Suite storage is not available');
    let saved = 0;
    try {
      for (const suite of suites) { const safe=window.LVXCredentials?await window.LVXCredentials.protect(suite,'Imported test'):suite;await storage.saveSuite(safe); saved++; }
    } catch (error) {
      // Refresh partial committed work as well; never announce an uncommitted success.
      await this.refreshSuites();
      throw new Error(`Import stopped after ${saved} of ${suites.length} suites were saved: ${error.message}`);
    }
    await this.refreshSuites();
  }

  async persistRestoredSuite(suite) {
    const storage = await (window.LVXApp?.getStorage() || window.currentStorage);
    if (!storage?.updateSuite) throw new Error('Suite storage is not available');
    const safe=window.LVXCredentials?await window.LVXCredentials.protect(suite,'Restored test'):suite;
    await storage.updateSuite(suite.id, safe);
    await this.refreshSuites();
  }

  async refreshSuites() {
    if (window.LVXApp?.refreshSuites) return await window.LVXApp.refreshSuites();
    const storage = window.currentStorage;
    if (!storage?.getAllSuites) throw new Error('Suite refresh is not available');
    window.testSuites = await storage.getAllSuites();
    if (typeof window.renderTestSuites === 'function') window.renderTestSuites(window.testSuites);
  }

  // ========================================
  // COMMENTS (Local Only)
  // ========================================

  /**
   * Add comment to test suite
   * Comments are stored locally for your own notes
   */
  addComment(suiteId, commentText) {
    if (!commentText || !commentText.trim()) {
      throw new Error('Comment cannot be empty');
    }

    const comments = this.getComments();

    const commentData = {
      id: this._generateId(),
      suiteId,
      user: this.getCurrentUser(),
      text: commentText.trim(),
      timestamp: new Date().toISOString(),
      edited: false
    };

    if (!comments[suiteId]) {
      comments[suiteId] = [];
    }

    comments[suiteId].push(commentData);
    localStorage.setItem(this.COMMENTS_KEY, JSON.stringify(comments));

    console.log(`Comment added to suite ${suiteId}`);
    return commentData;
  }

  /**
   * Get all comments for a specific test suite
   */
  getSuiteComments(suiteId) {
    const comments = this.getComments();
    return (comments[suiteId] || []).sort((a, b) =>
      new Date(b.timestamp) - new Date(a.timestamp)
    );
  }

  /**
   * Get all comments
   */
  getComments() {
    const data = localStorage.getItem(this.COMMENTS_KEY);
    return data ? JSON.parse(data) : {};
  }

  /**
   * Edit existing comment (only your own)
   */
  editComment(commentId, newText) {
    if (!newText || !newText.trim()) {
      throw new Error('Comment cannot be empty');
    }

    const comments = this.getComments();
    const currentUser = this.getCurrentUser();

    for (const suiteId in comments) {
      const comment = comments[suiteId].find(c => c.id === commentId);
      if (comment) {
        // Only allow editing your own comments
        if (comment.user !== currentUser) {
          throw new Error('You can only edit your own comments');
        }

        comment.text = newText.trim();
        comment.edited = true;
        comment.editedAt = new Date().toISOString();

        localStorage.setItem(this.COMMENTS_KEY, JSON.stringify(comments));
        console.log(`Comment edited: ${commentId}`);
        return true;
      }
    }

    throw new Error('Comment not found');
  }

  /**
   * Delete comment (only your own)
   */
  deleteComment(commentId) {
    const comments = this.getComments();
    const currentUser = this.getCurrentUser();

    for (const suiteId in comments) {
      const index = comments[suiteId].findIndex(c => c.id === commentId);
      if (index >= 0) {
        const comment = comments[suiteId][index];

        // Only allow deleting your own comments
        if (comment.user !== currentUser) {
          throw new Error('You can only delete your own comments');
        }

        comments[suiteId].splice(index, 1);

        // Clean up empty arrays
        if (comments[suiteId].length === 0) {
          delete comments[suiteId];
        }

        localStorage.setItem(this.COMMENTS_KEY, JSON.stringify(comments));
        console.log(`Comment deleted: ${commentId}`);
        return true;
      }
    }

    throw new Error('Comment not found');
  }

  // ========================================
  // VERSION CONTROL (Local Only)
  // ========================================

  /**
   * Create version snapshot of test suite
   * Versions are stored locally for rollback
   */
  createVersionSnapshot(suite, description) {
    if(window.electronAPI?.studioOps){const pending=(this._snapshotWrites||Promise.resolve()).then(async()=>{const adapter=await this._nativeVersionAdapter(),versions=await adapter.getVersionHistory(suite.id),number=versions.reduce((n,v)=>Math.max(n,Number(v.version)||0),0)+1,id=this._generateId();const snapshot={versionId:id,suiteId:suite.id,version:number,changeDescription:description?.trim()||`Version ${number}`,suiteSnapshot:JSON.parse(JSON.stringify(suite)),changedBy:this.getCurrentUser(),timestamp:new Date().toISOString()};await adapter.saveVersionHistory(suite.id,[snapshot]);return this._collaborationVersion(snapshot);});this._snapshotWrites=pending.catch(()=>{});return pending;}
    if(window.LVXCredentials){const pending=(this._snapshotWrites||Promise.resolve()).then(()=>this._createVersionSnapshot(suite,description));this._snapshotWrites=pending.catch(()=>{});return pending;}
    return this._createVersionSnapshot(suite,description);
  }

  _createVersionSnapshot(suite, description) {
    const versions = this.getVersionHistory(suite.id);

    const nextVersion = versions.reduce((max, v) => Math.max(max, Number(v.version) || 0), 0) + 1;
    const snapshot = {
      id: this._generateId(),
      suiteId: suite.id,
      version: nextVersion,
      description: description?.trim() || `Version ${nextVersion}`,
      suiteData: JSON.parse(JSON.stringify(suite)), // Deep clone
      createdBy: this.getCurrentUser(),
      createdAt: new Date().toISOString()
    };

    versions.push(snapshot);

    // Preserve complete version history; deletion is an explicit user action.

    return this._persistProtected(`versions_${suite.id}`,versions,snapshot);
  }

  /**
   * Get version history for a test suite
   */
  getVersionHistory(suiteId) {
    if(window.electronAPI?.studioOps)return this._nativeVersionAdapter().then(adapter=>adapter.getVersionHistory(suiteId)).then(versions=>versions.map(v=>this._collaborationVersion(v)));
    const data = localStorage.getItem(`versions_${suiteId}`);
    return data ? JSON.parse(data) : [];
  }

  /**
   * Restore test suite from a specific version
   */
  restoreVersion(versionId) {
    if(window.electronAPI?.studioOps)return this._getAllVersions().then(versions=>{const version=versions.find(v=>v.id===versionId||v.versionId===versionId);if(!version)throw Error('Version not found');return JSON.parse(JSON.stringify(version.suiteData||version.suiteSnapshot));});
    const allVersions = this._getAllVersions();
    const version = allVersions.find(v => v.id === versionId);

    if (!version) {
      throw new Error('Version not found');
    }

    // Deep clone to avoid reference issues
    const restoredSuite = JSON.parse(JSON.stringify(version.suiteData));

    console.log(`Restored version: v${version.version}`);
    return restoredSuite;
  }

  /**
   * Delete version history for a suite
   */
  deleteVersionHistory(suiteId) {
    if(window.electronAPI?.studioOps)return this._nativeVersionAdapter().then(adapter=>adapter.deleteVersionHistory(suiteId));
    localStorage.removeItem(`versions_${suiteId}`);
    console.log(`Version history deleted for suite: ${suiteId}`);
  }

  /**
   * Get all versions from all suites (for internal use)
   */
  _getAllVersions() {
    if(window.electronAPI?.studioOps)return this._nativeVersionAdapter().then(adapter=>adapter.nativeCall('list',{collection:'versions'})).then(result=>result.records.map(r=>this._collaborationVersion(r.value)));
    const versions = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('versions_')) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          if (Array.isArray(data)) {
            versions.push(...data);
          }
        } catch (e) {
          console.error(`Failed to parse versions from key: ${key}`, e);
        }
      }
    }
    return versions;
  }

  async _nativeVersionAdapter() {
    if(!window.indexedDBVersionControl?.storage&&typeof window.IndexedDBVersionStorage!=='function')throw Error('Canonical desktop version adapter is unavailable. Reload the complete desktop UI before saving history.');
    const adapter=window.indexedDBVersionControl?.storage||new window.IndexedDBVersionStorage();
    if(!adapter.native)await adapter.initialize();
    if(!adapter.native)throw Error('Canonical desktop version storage is unavailable.');
    return adapter;
  }

  _collaborationVersion(version) {return {...version,id:version.versionId||version.id,suiteData:version.suiteSnapshot||version.suiteData,description:version.changeDescription||version.description,createdBy:version.changedBy||version.createdBy,createdAt:version.timestamp||version.createdAt};}

  // ========================================
  // TEAM MEMBERS (Local Reference Only)
  // ========================================

  /**
   * Add team member to local reference list
   * This is just for keeping track of team members locally
   */
  addTeamMember(member) {
    if (!member.name || !member.name.trim()) {
      throw new Error('Team member name is required');
    }

    const team = this.getTeamMembers();

    // Check for duplicate email
    if (member.email && team.some(m => m.email === member.email)) {
      throw new Error('Team member with this email already exists');
    }

    const memberData = {
      id: this._generateId(),
      name: member.name.trim(),
      email: member.email?.trim() || null,
      role: member.role || 'member',
      addedAt: new Date().toISOString(),
      addedBy: this.getCurrentUser()
    };

    team.push(memberData);
    localStorage.setItem(this.TEAM_KEY, JSON.stringify(team));

    console.log(`Team member added: ${memberData.name}`);
    return memberData;
  }

  /**
   * Get all team members
   */
  getTeamMembers() {
    const data = localStorage.getItem(this.TEAM_KEY);
    return data ? JSON.parse(data) : [];
  }

  /**
   * Update team member
   */
  updateTeamMember(memberId, updates) {
    const team = this.getTeamMembers();
    const index = team.findIndex(m => m.id === memberId);

    if (index < 0) {
      throw new Error('Team member not found');
    }

    // Update fields
    if (updates.name) team[index].name = updates.name.trim();
    if (updates.email !== undefined) team[index].email = updates.email?.trim() || null;
    if (updates.role) team[index].role = updates.role;

    team[index].updatedAt = new Date().toISOString();

    localStorage.setItem(this.TEAM_KEY, JSON.stringify(team));
    console.log(`Team member updated: ${team[index].name}`);

    return team[index];
  }

  /**
   * Remove team member from local list
   */
  removeTeamMember(memberId) {
    const team = this.getTeamMembers();
    const filtered = team.filter(m => m.id !== memberId);

    if (filtered.length === team.length) {
      throw new Error('Team member not found');
    }

    localStorage.setItem(this.TEAM_KEY, JSON.stringify(filtered));
    console.log(`Team member removed`);
  }

  // ========================================
  // USER MANAGEMENT
  // ========================================

  /**
   * Get current user name
   * Prompts if not set
   */
  getCurrentUser() {
    let user = localStorage.getItem(this.USER_KEY);

    if (!user) {
      // Electron doesn't support prompt(). Default to Anonymous.
      // User can change it via the UI 'Change Username' button.
      user = 'Anonymous User';
      localStorage.setItem(this.USER_KEY, user);
    }

    return user;
  }

  /**
   * Set current user name
   */
  setCurrentUser(name) {
    if (!name || !name.trim()) {
      throw new Error('Name cannot be empty');
    }

    localStorage.setItem(this.USER_KEY, name.trim());
    console.log(`User name set: ${name}`);
  }

  // ========================================
  // HELPER METHODS
  // ========================================

  /**
   * Sanitize test suite for sharing
   * Removes sensitive data
   */
  _sanitizeSuiteForSharing(suite) {
    // Deep clone
    const sensitive=/^(?:api[_-]?(?:key|token)|password|passwd|token|secret|credential|authorization|authHeader|auth|access[_-]?token|refresh[_-]?token|client[_-]?secret|webhook(?:Url|_url)?|private[_-]?key)$/i;
    const sanitize=(value,parentKey='')=>{
      if(Array.isArray(value))return value.map(item=>sanitize(item));
      if(value&&typeof value==='object'){
        const result={},schemaContainer=['schema','parameterSchema','parameter_schema'].includes(parentKey);
        const passwordStep=/password|passwd|secret|api[_-]?key|access[_-]?token/i.test(String(value.selector||value.name||value.field||''))&&/fill|input|type/i.test(String(value.action||value.type||''));
        for(const [key,item]of Object.entries(value)){
          if(sensitive.test(key)&&!schemaContainer&&!(key==='secret'&&typeof item==='boolean'))continue;
          if(key==='parameters'&&item&&typeof item==='object'){
            const schema=value.parameter_schema||value.parameterSchema||{};
            result[key]=Object.fromEntries(Object.entries(item).map(([name,parameter])=>[name,schema[name]?.secret?'[REDACTED]':sanitize(parameter,name)]));
          }else result[key]=(['value','expected','text'].includes(key)&&passwordStep||key==='value'&&(value.secret===true||value.isSecret===true))?'[REDACTED]':sanitize(item,key);
        }
        return result;
      }
      return typeof value==='string'?value.replace(/secret:[a-f0-9-]{36}/g,'[REDACTED]'):value;
    };
    const clean = sanitize(JSON.parse(JSON.stringify(suite)));

    // Remove potentially sensitive fields
    const sensitiveFields = ['apiKey', 'password', 'token', 'secret', 'credential'];
    sensitiveFields.forEach(field => delete clean[field]);

    // Sanitize test steps
    if (clean.steps && Array.isArray(clean.steps)) {
      clean.steps.forEach(step => {
        // Redact passwords in input steps
        if (step.action === 'input' && step.value) {
          if (step.selector && (
            step.selector.toLowerCase().includes('password') ||
            step.selector.toLowerCase().includes('passwd') ||
            step.selector.toLowerCase().includes('secret')
          )) {
            step.value = '[REDACTED]';
          }
        }
      });
    }

    // Preserve complete ordinary assertion text; sensitive fields were redacted above.

    return clean;
  }

  /**
   * Validate URL format
   */
  _isValidUrl(url) {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch (e) {
      return false;
    }
  }

  /**
   * Generate unique ID
   */
  _generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }
}

// Initialize and export
window.CollaborationManager = CollaborationManager;
window.collaborationManager = new CollaborationManager();

console.log('CollaborationManager initialized');

// Check for import link on page load
window.addEventListener('DOMContentLoaded', () => {
  const hash = window.location.hash;
  if (hash.includes('import=')) {
    const shareId = hash.split('import=')[1].split('&')[0];
    console.log('Import link detected:', shareId);

    // Delay to ensure UI is loaded
    setTimeout(() => {
      if (typeof window.importFromSharedLink === 'function') {
        window.importFromSharedLink(shareId);
      }
    }, 1000);
  }
});
